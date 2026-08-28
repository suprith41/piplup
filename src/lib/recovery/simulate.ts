import { grantT3 } from "./baseline.ts";
import { adaptiveCostPaise, T3_COST_PER_FAILED_RETRY_PAISE } from "./cost.ts";
import { grantAdaptive } from "./policy.ts";
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

function simulateAdaptive(c: RecoveryCase): AttemptResult {
  const decision = grantAdaptive(c);

  if (!decision.allowed) {
    const correctlyStopped = c.trueClass === "terminal" || c.optedOut || c.chargeback || c.claimedPaid;
    return {
      decision,
      executed: false,
      recovered: false,
      retriesUsed: 0,
      slotWasted: false,
      costPaise: adaptiveCostPaise(c, decision),
      endedSubscriptionState: resolveEndState(c, false),
      note: correctlyStopped ? "Correct stop. Slot saved." : "Stopped; no recovery path taken.",
    };
  }

  const recovered = succeeds(c, decision.mutation, decision.scheduledDay);
  return {
    decision,
    executed: true,
    recovered,
    retriesUsed: decision.mutation === "back_charge_invoices" ? 0 : 1,
    slotWasted: false,
    costPaise: adaptiveCostPaise(c, decision),
    endedSubscriptionState: resolveEndState(c, recovered),
    note: recovered
      ? decision.mutation === "back_charge_invoices"
        ? "Swept uncollected invoices on a revived subscription."
        : "Recovered with mutated attempt."
      : "Attempted, still open. Exception list.",
  };
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

  return {
    decision,
    executed: true,
    recovered,
    retriesUsed: recovered ? 1 : shots,
    slotWasted,
    costPaise: failedShots * T3_COST_PER_FAILED_RETRY_PAISE,
    // Exhausting the cycle is exactly what moves a subscription to halted.
    endedSubscriptionState: resolveEndState(c, recovered),
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

  const shouldStop = cases.filter((c) => c.trueClass === "terminal" || c.optedOut || c.chargeback || c.claimedPaid);
  const correctlyStoppedPaise = shouldStop.reduce((sum, c) => {
    const attempt = attempts[cases.indexOf(c)];
    if (attempt && !attempt.executed) return sum + exposurePaise(c);
    return sum;
  }, 0);

  const stopCorrect = shouldStop.filter((c) => {
    const attempt = attempts[cases.indexOf(c)];
    return attempt && !attempt.executed;
  }).length;

  const retriesUsed = attempts.reduce((sum, a) => sum + a.retriesUsed, 0);
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
    slotsWasted,
    stopAccuracy: shouldStop.length ? stopCorrect / shouldStop.length : 1,
    recoveryRate: cases.length ? attempts.filter((a) => a.recovered).length / cases.length : 0,
    subscriptionsHalted: halted,
    involuntaryChurn: churn,
    attempts,
  };
}
