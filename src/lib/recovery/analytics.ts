import { EUREKA } from "../merchant/eureka.ts";
import { evaluateBatch, type Evaluation } from "./evaluate.ts";
import { NPCI_MAX_ATTEMPTS } from "./policy.ts";
import { exposurePaise } from "./simulate.ts";
import { rupees } from "./taxonomy.ts";
import type { AttemptResult, RecoveryCase } from "./types.ts";

/**
 * Stripe publishes a recovery dashboard: failure rate, recovery rate, recovered
 * volume by method, failed volume by decline reason, and the customers still in
 * recovery. This is that dashboard, plus the two columns an Indian merchant
 * actually needs — NPCI slots burned and cost per rupee recovered.
 *
 * Everything here is derived from the same batch the scoreboard scores. No
 * separate numbers, no second source of truth.
 */

/**
 * How far into the cycle we are reporting from. A case whose next action falls
 * after this day has not failed to recover — it has not been tried yet, which
 * is Stripe's "in recovery" bucket.
 */
export const AS_OF_DAY = 3;

export interface Breakdown {
  key: string;
  label: string;
  cases: number;
  atRiskRupees: number;
  recoveredRupees: number;
  recoveryRate: number;
}

export interface MethodBreakdown extends Breakdown {
  npciSlots: number;
  costRupees: number;
}

export interface StageSplit {
  recoveredRupees: number;
  inRecoveryRupees: number;
  notRecoveredRupees: number;
  recoveredCases: number;
  inRecoveryCases: number;
  notRecoveredCases: number;
}

export interface CustomerInRecovery {
  caseId: string;
  name: string;
  rupees: number;
  decline: string;
  bank: string;
  clock: string;
  mutation: string;
  nextActionDay: number;
  waitingOn: string;
  needsHumanReview: boolean;
}

export interface RecoveryAnalytics {
  generatedAt: string;
  asOfDay: number;
  kpis: {
    cycleSubscriptions: number;
    failedCases: number;
    failedRupees: number;
    failureRate: number;
    recoveredRupees: number;
    recoveryRate: number;
    npciSlotsSpent: number;
    npciSlotsAvailable: number;
    slotUtilisation: number;
    /** Paise spent on outreach for every rupee recovered. Nobody publishes this. */
    paisePerRupeeRecovered: number;
    contactsSent: number;
    humanReviewCases: number;
  };
  stages: StageSplit;
  byMethod: MethodBreakdown[];
  byDecline: Breakdown[];
  byBank: Breakdown[];
  topInRecovery: CustomerInRecovery[];
}

const METHOD_LABEL: Record<string, string> = {
  cooldown_retry: "Cooldown, same rail",
  next_rail: "Rail cascade",
  same_rail_retry: "Liquidity-timed debit",
  payment_link: "Payment link",
  mandate_reauth: "Mandate re-auth",
  back_charge_invoices: "Invoice sweep",
  none: "Stopped on purpose",
};

export function recoveryAnalytics(report: Evaluation = evaluateBatch(), asOfDay = AS_OF_DAY): RecoveryAnalytics {
  const { cases, adaptive } = report;
  const attempts = adaptive.attempts;

  const failedPaise = cases.reduce((sum, c) => sum + exposurePaise(c), 0);
  const recoveredPaise = Math.round(adaptive.rupeesRecovered * 100);
  const spentPaise = Math.round(adaptive.rupeesSpent * 100);

  return {
    generatedAt: report.generatedAt,
    asOfDay,
    kpis: {
      cycleSubscriptions: EUREKA.cycleSubscriptions,
      failedCases: cases.length,
      failedRupees: rupees(failedPaise),
      failureRate: cases.length / EUREKA.cycleSubscriptions,
      recoveredRupees: adaptive.rupeesRecovered,
      /** Volume-weighted, the way Stripe defines it. The scoreboard's rate counts cases. */
      recoveryRate: failedPaise ? recoveredPaise / failedPaise : 0,
      npciSlotsSpent: adaptive.retriesUsed,
      npciSlotsAvailable: cases.length * NPCI_MAX_ATTEMPTS,
      slotUtilisation: adaptive.retriesUsed / (cases.length * NPCI_MAX_ATTEMPTS),
      paisePerRupeeRecovered: recoveredPaise ? (spentPaise * 100) / recoveredPaise : 0,
      contactsSent: attempts.reduce((sum, a) => sum + a.contactsUsed, 0),
      humanReviewCases: attempts.filter((a) => a.needsHumanReview).length,
    },
    stages: splitStages(cases, attempts, asOfDay),
    byMethod: byMethod(cases, attempts),
    byDecline: group(cases, attempts, (c) => c.declineCode, (key) => key.replaceAll("_", " ")).slice(0, 6),
    byBank: group(cases, attempts, (c) => c.bank, (key) => key),
    topInRecovery: topInRecovery(cases, attempts, asOfDay),
  };
}

/**
 * Recovered / in recovery / not recovered, the way Stripe splits it. The middle
 * bucket is the honest one: money whose scheduled action has not come round yet.
 */
function splitStages(cases: RecoveryCase[], attempts: AttemptResult[], asOfDay: number): StageSplit {
  const split: StageSplit = {
    recoveredRupees: 0,
    inRecoveryRupees: 0,
    notRecoveredRupees: 0,
    recoveredCases: 0,
    inRecoveryCases: 0,
    notRecoveredCases: 0,
  };

  cases.forEach((c, i) => {
    const attempt = attempts[i];
    const paise = exposurePaise(c);

    if (attempt.recovered) {
      split.recoveredRupees += paise;
      split.recoveredCases += 1;
    } else if (isInRecovery(attempt, asOfDay)) {
      split.inRecoveryRupees += paise;
      split.inRecoveryCases += 1;
    } else {
      split.notRecoveredRupees += paise;
      split.notRecoveredCases += 1;
    }
  });

  split.recoveredRupees = rupees(split.recoveredRupees);
  split.inRecoveryRupees = rupees(split.inRecoveryRupees);
  split.notRecoveredRupees = rupees(split.notRecoveredRupees);
  return split;
}

function isInRecovery(attempt: AttemptResult, asOfDay: number): boolean {
  if (!attempt.executed || attempt.recovered) return false;
  const next = attempt.ladder.find((step) => !step.skipped && step.action !== "stop" && step.day > asOfDay);
  return Boolean(next);
}

function byMethod(cases: RecoveryCase[], attempts: AttemptResult[]): MethodBreakdown[] {
  const rows = new Map<string, MethodBreakdown>();

  cases.forEach((c, i) => {
    const attempt = attempts[i];
    const key = attempt.decision.mutation;
    const row = rows.get(key) ?? {
      key,
      label: METHOD_LABEL[key] ?? key.replaceAll("_", " "),
      cases: 0,
      atRiskRupees: 0,
      recoveredRupees: 0,
      recoveryRate: 0,
      npciSlots: 0,
      costRupees: 0,
    };

    row.cases += 1;
    row.atRiskRupees += exposurePaise(c);
    if (attempt.recovered) row.recoveredRupees += exposurePaise(c);
    row.npciSlots += attempt.retriesUsed;
    row.costRupees += attempt.costPaise;
    rows.set(key, row);
  });

  return [...rows.values()]
    .map((row) => ({
      ...row,
      recoveryRate: row.atRiskRupees ? row.recoveredRupees / row.atRiskRupees : 0,
      atRiskRupees: rupees(row.atRiskRupees),
      recoveredRupees: rupees(row.recoveredRupees),
      costRupees: rupees(row.costRupees),
    }))
    .sort((a, b) => b.recoveredRupees - a.recoveredRupees);
}

function group(
  cases: RecoveryCase[],
  attempts: AttemptResult[],
  keyOf: (c: RecoveryCase) => string,
  labelOf: (key: string) => string,
): Breakdown[] {
  const rows = new Map<string, Breakdown>();

  cases.forEach((c, i) => {
    const key = keyOf(c);
    const row = rows.get(key) ?? { key, label: labelOf(key), cases: 0, atRiskRupees: 0, recoveredRupees: 0, recoveryRate: 0 };
    row.cases += 1;
    row.atRiskRupees += exposurePaise(c);
    if (attempts[i].recovered) row.recoveredRupees += exposurePaise(c);
    rows.set(key, row);
  });

  return [...rows.values()]
    .map((row) => ({
      ...row,
      recoveryRate: row.atRiskRupees ? row.recoveredRupees / row.atRiskRupees : 0,
      atRiskRupees: rupees(row.atRiskRupees),
      recoveredRupees: rupees(row.recoveredRupees),
    }))
    .sort((a, b) => b.atRiskRupees - a.atRiskRupees);
}

/** Stripe's "top customers in recovery": still open, still worth a human's time. */
function topInRecovery(cases: RecoveryCase[], attempts: AttemptResult[], asOfDay: number): CustomerInRecovery[] {
  return cases
    .map((c, i) => ({ c, attempt: attempts[i] }))
    .filter(({ attempt }) => isInRecovery(attempt, asOfDay))
    .map(({ c, attempt }) => {
      const next = attempt.ladder.find((step) => !step.skipped && step.action !== "stop" && step.day > asOfDay);
      return {
        caseId: c.id,
        name: c.customerName,
        rupees: rupees(exposurePaise(c)),
        decline: c.declineCode,
        bank: c.bank,
        clock: attempt.decision.clock,
        mutation: attempt.decision.mutation,
        nextActionDay: next?.day ?? attempt.decision.scheduledDay ?? c.billingDay,
        waitingOn: next?.note ?? attempt.decision.reason,
        needsHumanReview: attempt.needsHumanReview,
      };
    })
    .sort((a, b) => b.rupees - a.rupees)
    .slice(0, 8);
}
