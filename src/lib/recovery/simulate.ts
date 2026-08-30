import { grantT3 } from "./baseline.ts";
import { buildCalendarLadder, buildLadder } from "./ladder.ts";
import { grantAdaptive, spendsNpciSlot } from "./policy.ts";
import { rupees } from "./taxonomy.ts";
import type {
  AttemptResult,
  Mutation,
  PolicyName,
  PolicyScore,
  RecoveryCase,
  SubscriptionState,
} from "./types.ts";

export function runPolicy(cases: RecoveryCase[], policy: PolicyName): PolicyScore {
  const attempts = cases.map((c) =>
    policy === "adaptive" ? simulateAdaptive(c) : simulateT3(c, policy),
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

function simulateAdaptive(c: RecoveryCase): AttemptResult {
  const decision = grantAdaptive(c);

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

  const recovered = succeeds(c, decision.mutation, decision.scheduledDay);
  const ladder = buildLadder(c, decision, recovered);
  return {
    decision,
    executed: true,
    recovered,
    retriesUsed: decision.npciSlotsUsed,
    // Adaptive only ever presents a debit on a mandate that can still take one.
    slotWasted: decision.npciSlotsUsed > 0 && mustNotDebit(c),
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
  let slotWasted = false;
  let failedShots = 0;

  for (let i = 1; i <= shots; i += 1) {
    const day = c.billingDay + i;
    if (hardDecline) {
      slotWasted = true;
      failedShots += 1;
      continue;
    }
    if (c.willSucceedOn.sameRailImmediate) recovered = true;
    if (c.salaryDay && day >= c.salaryDay && c.willSucceedOn.sameRailOnSalaryDay) recovered = true;
    if (recovered) break;
    failedShots += 1;
  }

  const ladder = buildCalendarLadder(c, recovered ? failedShots + 1 : shots, failedShots);

  return {
    decision,
    executed: true,
    recovered,
    // Every morning it presented a debit, including the one that finally cleared.
    retriesUsed: recovered ? failedShots + 1 : shots,
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
      : recovered
        ? "Cleared on a calendar retry."
        : "Retry cycle exhausted. Subscription halted.",
  };
}

function isHardDecline(c: RecoveryCase): boolean {
  return c.trueClass === "terminal" || c.chargeback || c.optedOut || c.mandateState === "revoked";
}

function succeeds(c: RecoveryCase, mutation: Mutation, day?: number): boolean {
  if (mutation === "cooldown_retry") return c.willSucceedOn.sameRailAfterCooldown;
  if (mutation === "next_rail") return c.willSucceedOn.nextRailImmediate;
  if (mutation === "payment_link") return c.willSucceedOn.paymentLink;
  if (mutation === "mandate_reauth") return c.willSucceedOn.reauth;
  if (mutation === "back_charge_invoices") return c.willSucceedOn.backCharge;
  if (mutation === "same_rail_retry") {
    if (c.willSucceedOn.sameRailImmediate) return true;
    if (day && c.salaryDay && day >= c.salaryDay) return c.willSucceedOn.sameRailOnSalaryDay;
    if (day && c.promiseToPayDay && day >= c.promiseToPayDay) return c.willSucceedOn.sameRailOnSalaryDay;
    if (c.liquidity?.instrumentSucceededElsewhere && day && c.liquidity.atDay && day >= c.liquidity.atDay) {
      return c.willSucceedOn.sameRailOnSalaryDay;
    }
    return false;
  }
  return false;
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
