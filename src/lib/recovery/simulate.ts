import { grantT3 } from "./baseline.ts";
import { buildCalendarLadder, buildLadder } from "./ladder.ts";
import { grantAdaptive, spendsNpciSlot } from "./policy.ts";
import { rupees } from "./taxonomy.ts";
import type {
  AttemptResult,
  Mutation,
  PolicyDecision,
  PolicyName,
  PolicyScore,
  RecoveryCase,
  RetryEnvelope,
  SubscriptionState,
} from "./types.ts";

/**
 * The hour a calendar retry cycle presents on: a nightly batch, before any
 * salary credit has posted. It is not a strawman — it is what a fixed schedule
 * with no timing model has to do.
 */
export const CALENDAR_PRESENT_HOUR = 2;

export function runPolicy(
  cases: RecoveryCase[],
  policy: PolicyName,
  envelope?: Partial<RetryEnvelope>,
): PolicyScore {
  const attempts = cases.map((c) =>
    policy === "adaptive" ? simulateAdaptive(c, envelope) : simulateT3(c, policy),
  );
  return score(policy, cases, attempts);
}

/** Money in play for a case: a failed debit, or invoices nobody charged. */
export function exposurePaise(c: RecoveryCase): number {
  return c.uncollectedInvoicesPaise ?? c.amountPaise;
}

/**
 * Same rule for both policies. Modelling Adaptive's misses as merely "pending"
 * while the baseline's misses go "halted" would be scoring our own exam.
 *
 * A revived subscription stays active whether or not we sweep its invoices:
 * the customer fixed their card, so only the money is outstanding.
 */
function resolveEndState(c: RecoveryCase, recovered: boolean): SubscriptionState {
  if (c.trueClass === "uncollected") return "active";
  return recovered ? "active" : "halted";
}

/**
 * Halting a revoked mandate is the correct outcome, not churn. Involuntary
 * churn is a subscription we could have saved and did not.
 */
function isInvoluntaryChurn(c: RecoveryCase, end: SubscriptionState): boolean {
  if (end !== "halted") return false;
  if (c.trueClass === "terminal" || c.trueClass === "uncollected") return false;
  return !c.optedOut && !c.chargeback && !c.claimedPaid;
}

/**
 * Cases where presenting a debit is the wrong move no matter what it would
 * recover. Reaching out is sometimes still fine; spending an NPCI slot is not.
 */
function mustNotDebit(c: RecoveryCase): boolean {
  return c.trueClass === "terminal" || c.optedOut || c.chargeback || c.claimedPaid;
}

function simulateAdaptive(c: RecoveryCase, envelope?: Partial<RetryEnvelope>): AttemptResult {
  const decision = grantAdaptive(c, envelope);

  if (!decision.allowed) {
    const ladder = buildLadder(c, decision, false);
    return {
      decision,
      executed: false,
      recovered: false,
      retriesUsed: 0,
      slotWasted: false,
      costPaise: ladder.spentPaise,
      endedSubscriptionState: resolveEndState(c, false),
      ladder: ladder.steps,
      contactsUsed: ladder.contactsUsed,
      needsHumanReview: false,
      note: mustNotDebit(c) ? "Correct stop. Slot saved." : "Stopped; no recovery path taken.",
    };
  }

  const run = present(c, decision);
  const recovered = run.recovered;
  const ladder = buildLadder(c, decision, recovered, Math.max(1, run.slotsSpent));
  return {
    decision,
    executed: true,
    recovered,
    // What we actually presented, not what we planned: a second window is only
    // spent when the first one missed.
    retriesUsed: run.slotsSpent,
    // Adaptive only ever presents a debit on a mandate that can still take one.
    slotWasted: run.slotsSpent > 0 && mustNotDebit(c),
    costPaise: ladder.spentPaise,
    endedSubscriptionState: resolveEndState(c, recovered),
    ladder: ladder.steps,
    contactsUsed: ladder.contactsUsed,
    needsHumanReview: ladder.needsHumanReview,
    note: adaptiveNote(decision.mutation, recovered),
  };
}

function adaptiveNote(mutation: Mutation, recovered: boolean): string {
  if (!recovered) return "Attempted, still open. Exception list.";
  if (mutation === "back_charge_invoices") return "Swept uncollected invoices on a revived subscription.";
  if (mutation === "cooldown_retry") return "Cleared on the same rail once the switch caught up.";
  if (mutation === "mandate_reauth") return "Customer re-authorised. No NPCI slot spent getting here.";
  return "Recovered with mutated attempt.";
}

function simulateT3(c: RecoveryCase, policy: PolicyName): AttemptResult {
  const decision = grantT3(c, policy);

  if (!decision.allowed) {
    return {
      decision,
      executed: false,
      recovered: false,
      retriesUsed: 0,
      slotWasted: false,
      costPaise: 0,
      endedSubscriptionState: resolveEndState(c, false),
      ladder: [],
      contactsUsed: 0,
      needsHumanReview: false,
      note: "Uncollected invoices left sitting. The calendar flow never charges them.",
    };
  }

  const hardDecline = isHardDecline(c);
  const stopsEarly = policy === "t3_hard_decline_aware" && hardDecline;
  const shots = stopsEarly ? 1 : Math.min(3, Math.max(1, c.retryBudgetLeft));

  let recovered = false;
  let recoveredByLink = false;
  let slotWasted = false;
  let debits = 0;

  for (let i = 1; i <= shots; i += 1) {
    const day = c.billingDay + i;
    debits += 1;
    if (hardDecline) {
      slotWasted = true;
      continue;
    }
    // Same rail, same mandate, same nightly batch hour, three mornings running.
    if (debitClears(c, day, CALENDAR_PRESENT_HOUR)) {
      recovered = true;
      break;
    }
    // Each failure fires an email carrying a hosted card-change link. Crediting
    // only our links and not the calendar's would be scoring our own exam.
    if (linkConverts(c, day)) {
      recovered = true;
      recoveredByLink = true;
      break;
    }
  }

  const failedShots = recovered && !recoveredByLink ? debits - 1 : debits;
  const ladder = buildCalendarLadder(c, debits, failedShots);

  return {
    decision,
    executed: true,
    recovered,
    // Every morning it presented a debit, including the one that finally cleared.
    retriesUsed: debits,
    slotWasted,
    costPaise: ladder.spentPaise,
    // Exhausting the cycle is exactly what moves a subscription to halted.
    endedSubscriptionState: resolveEndState(c, recovered),
    ladder: ladder.steps,
    contactsUsed: ladder.contactsUsed,
    needsHumanReview: false,
    note: slotWasted
      ? stopsEarly
        ? "Stopped after one hard decline."
        : `Burned ${shots} NPCI slot(s) on a terminal/opt-out case.`
      : recoveredByLink
        ? "Debits all missed. The customer paid the failure email's link themselves."
        : recovered
          ? "Cleared on a calendar retry."
          : "Retry cycle exhausted. Subscription halted.",
  };
}

function isHardDecline(c: RecoveryCase): boolean {
  return c.trueClass === "terminal" || c.chargeback || c.optedOut || c.mandateState === "revoked";
}

/**
 * Ground truth for one presentment.
 *
 * A payday is a day *and* an hour. Present at 02:00 on the morning the salary
 * lands at 09:00 and the debit bounces against yesterday's balance — the right
 * date and the wrong time. This is the only place that reads `liquidOnDay`;
 * no policy is allowed anywhere near it.
 */
function debitClears(c: RecoveryCase, day: number, hourIST: number): boolean {
  // Razorpay does not permit a merchant-initiated charge on an Indian domestic
  // card. That is the platform's rule, not a policy choice, so it binds the
  // baseline exactly as hard as it binds us.
  if (c.domesticCard && c.rail === "card") return false;

  if (c.willSucceedOn.sameRailImmediate) return true;
  if (!c.willSucceedOn.sameRailOnSalaryDay) return false;

  const liquidDay = c.willSucceedOn.liquidOnDay;
  if (liquidDay === undefined) return false;
  if (day > liquidDay) return true;
  if (day < liquidDay) return false;
  return hourIST >= (c.willSucceedOn.liquidAtHourIST ?? 0);
}

/**
 * A link is a request, not a debit, but it is still timed.
 *
 * Half our volume can only ever be recovered by a link, because domestic cards
 * cannot be charged. A link handed to someone whose account is empty is not a
 * recovery channel, it is a notification — so the same liquidity date that
 * gates a debit gates the link, and both policies are scored on it.
 */
function linkConverts(c: RecoveryCase, day: number): boolean {
  if (!c.willSucceedOn.paymentLink) return false;
  const liquidDay = c.willSucceedOn.liquidOnDay;
  if (liquidDay === undefined) return true;
  return day >= liquidDay;
}

function succeedsOutOfBand(c: RecoveryCase, mutation: Mutation, day: number): boolean {
  if (mutation === "payment_link") return linkConverts(c, day);
  if (mutation === "mandate_reauth") return c.willSucceedOn.reauth;
  if (mutation === "back_charge_invoices") return c.willSucceedOn.backCharge;
  return false;
}

/** Present the scheduled debits in order and stop at the first one that clears. */
function present(c: RecoveryCase, decision: PolicyDecision): { recovered: boolean; slotsSpent: number } {
  if (!spendsNpciSlot(decision.mutation)) {
    const day = decision.scheduledDay ?? c.billingDay;
    return { recovered: succeedsOutOfBand(c, decision.mutation, day), slotsSpent: 0 };
  }

  const windows = decision.attempts?.length
    ? decision.attempts
    : [
        {
          day: decision.scheduledDay ?? c.billingDay,
          hourIST: decision.scheduledHourIST ?? CALENDAR_PRESENT_HOUR,
        },
      ];

  let slotsSpent = 0;
  for (const window of windows) {
    slotsSpent += 1;

    // Both cascade moves happen inside the original attempt window, so the
    // clock never advances and there is nothing for the hour to change.
    if (decision.mutation === "cooldown_retry") {
      if (c.willSucceedOn.sameRailAfterCooldown) return { recovered: true, slotsSpent };
      continue;
    }
    if (decision.mutation === "next_rail") {
      if (c.willSucceedOn.nextRailImmediate) return { recovered: true, slotsSpent };
      continue;
    }
    if (debitClears(c, window.day, window.hourIST)) return { recovered: true, slotsSpent };
  }

  return { recovered: false, slotsSpent };
}

function score(policy: PolicyName, cases: RecoveryCase[], attempts: AttemptResult[]): PolicyScore {
  const atRiskPaise = cases.reduce((sum, c) => sum + exposurePaise(c), 0);
  const recoveredPaise = attempts.reduce(
    (sum, a, i) => sum + (a.recovered ? exposurePaise(cases[i]) : 0),
    0,
  );

  // Correct behaviour is "did not spend an NPCI slot", not "did nothing".
  // Asking a revoked mandate to re-authorise is free; retrying it is not.
  const shouldStop = cases.filter(mustNotDebit);
  const spentNoSlot = (c: RecoveryCase) => {
    const attempt = attempts[cases.indexOf(c)];
    return Boolean(attempt) && attempt.retriesUsed === 0;
  };

  const correctlyStoppedPaise = shouldStop.reduce((sum, c) => {
    const attempt = attempts[cases.indexOf(c)];
    // Money we walked away from without touching the network. Anything we
    // actually recovered out of band is counted as recovery, not as a refusal.
    if (spentNoSlot(c) && attempt && !attempt.recovered) return sum + exposurePaise(c);
    return sum;
  }, 0);

  const stopCorrect = shouldStop.filter(spentNoSlot).length;

  const retriesUsed = attempts.reduce((sum, a) => sum + a.retriesUsed, 0);
  const outOfBandActions = attempts.filter(
    (a) => a.executed && !spendsNpciSlot(a.decision.mutation) && a.decision.mutation !== "none",
  ).length;
  const slotsWasted = attempts.filter((a) => a.slotWasted).length;
  const spentPaise = attempts.reduce((sum, a) => sum + a.costPaise, 0);
  const halted = attempts.filter((a) => a.endedSubscriptionState === "halted").length;
  const churn = attempts.filter((a, i) => isInvoluntaryChurn(cases[i], a.endedSubscriptionState)).length;

  return {
    policy,
    cases: cases.length,
    rupeesAtRisk: rupees(atRiskPaise),
    rupeesRecovered: rupees(recoveredPaise),
    rupeesCorrectlyStopped: rupees(correctlyStoppedPaise),
    rupeesSpent: rupees(spentPaise),
    rupeesNet: rupees(recoveredPaise - spentPaise),
    retriesUsed,
    outOfBandActions,
    slotsWasted,
    stopAccuracy: shouldStop.length ? stopCorrect / shouldStop.length : 1,
    recoveryRate: cases.length ? attempts.filter((a) => a.recovered).length / cases.length : 0,
    subscriptionsHalted: halted,
    involuntaryChurn: churn,
    attempts,
  };
}
