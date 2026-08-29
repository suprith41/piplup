import { writeLastBatch } from "./ledger.ts";
import { enrichWithReply } from "./reply.ts";
import { seedBatch } from "./seed.ts";
import { exposurePaise, runPolicy } from "./simulate.ts";
import { rupees } from "./taxonomy.ts";
import type { Lift, PolicyScore, RecoveryCase } from "./types.ts";

export interface Evaluation {
  generatedAt: string;
  cases: RecoveryCase[];
  baseline: PolicyScore;
  baselineCharitable: PolicyScore;
  adaptive: PolicyScore;
  lift: Lift;
  liftCharitable: Lift;
  /**
   * Part of our incremental lift comes from a category the calendar flow
   * structurally cannot address. Reported separately so nobody has to
   * discover it themselves.
   */
  sweep: {
    cases: number;
    rupees: number;
    shareOfIncremental: number;
  };
  /**
   * Revoked mandates the calendar can only burn slots on. Recovered by asking
   * for a fresh AutoPay, which costs nothing from the NPCI budget.
   */
  reauth: {
    cases: number;
    rupees: number;
    slotsNotSpent: number;
  };
  delta: {
    extraRupeesRecovered: number;
    retriesSaved: number;
    slotsSaved: number;
    rupeesSavedOnOutreach: number;
    netAdvantage: number;
    churnAvoided: number;
  };
}

export function evaluateBatch(rawCases: RecoveryCase[] = seedBatch()): Evaluation {
  // Inbound replies become structured state before any policy sees the case.
  const cases = rawCases.map(enrichWithReply);

  const baseline = runPolicy(cases, "t3_calendar");
  const baselineCharitable = runPolicy(cases, "t3_hard_decline_aware");
  const adaptive = runPolicy(cases, "adaptive");

  const lift = computeLift(cases, baseline, adaptive);
  const generatedAt = new Date().toISOString();

  const report: Evaluation = {
    generatedAt,
    cases,
    baseline,
    baselineCharitable,
    adaptive,
    lift,
    liftCharitable: computeLift(cases, baselineCharitable, adaptive),
    sweep: computeSweep(cases, adaptive, lift),
    reauth: computeReauth(cases, baseline, adaptive),
    delta: {
      extraRupeesRecovered: round2(adaptive.rupeesRecovered - baseline.rupeesRecovered),
      retriesSaved: baseline.retriesUsed - adaptive.retriesUsed,
      slotsSaved: baseline.slotsWasted - adaptive.slotsWasted,
      rupeesSavedOnOutreach: round2(baseline.rupeesSpent - adaptive.rupeesSpent),
      netAdvantage: round2(adaptive.rupeesNet - baseline.rupeesNet),
      churnAvoided: baseline.involuntaryChurn - adaptive.involuntaryChurn,
    },
  };

  writeLastBatch({
    generatedAt,
    cases: cases.length,
    atRisk: adaptive.rupeesAtRisk,
    recovered: adaptive.rupeesRecovered,
    t3: baseline.rupeesRecovered,
    lift: lift.incrementalRupees,
    slotsSaved: report.delta.slotsSaved,
    stopAccuracy: adaptive.stopAccuracy,
    decisions: cases.map((c, i) => {
      const attempt = adaptive.attempts[i];
      return {
        caseId: c.id,
        name: c.customerName,
        decline: c.declineCode,
        klass: c.trueClass,
        bank: c.bank,
        clock: attempt.decision.clock,
        mutation: attempt.decision.mutation,
        npciSlotsUsed: attempt.decision.npciSlotsUsed,
        recovered: attempt.recovered,
        stopped: !attempt.executed,
        reason: attempt.decision.stopReason ?? attempt.decision.reason,
        scheduledDay: attempt.decision.scheduledDay,
      };
    }),
  });

  return report;
}

/**
 * Gross recovery flatters everyone. A case both policies would have won is
 * not a win for us. Incremental lift is the money only Adaptive collected,
 * and regressions are cases the baseline got that we lost.
 */
function computeLift(cases: RecoveryCase[], baseline: PolicyScore, adaptive: PolicyScore): Lift {
  let bothRecovered = 0;
  let adaptiveOnly = 0;
  let baselineOnly = 0;
  let neitherRecovered = 0;
  let incrementalPaise = 0;
  let regressionPaise = 0;

  cases.forEach((c, i) => {
    const a = adaptive.attempts[i].recovered;
    const b = baseline.attempts[i].recovered;

    if (a && b) bothRecovered += 1;
    else if (a) {
      adaptiveOnly += 1;
      incrementalPaise += exposurePaise(c);
    } else if (b) {
      baselineOnly += 1;
      regressionPaise += exposurePaise(c);
    } else neitherRecovered += 1;
  });

  return {
    bothRecovered,
    adaptiveOnly,
    baselineOnly,
    neitherRecovered,
    incrementalRupees: rupees(incrementalPaise),
    regressionRupees: rupees(regressionPaise),
  };
}

/**
 * The NPCI budget guard, priced. Every revoked mandate is three slots the
 * calendar spends and we do not, and some of them pay anyway.
 */
function computeReauth(cases: RecoveryCase[], baseline: PolicyScore, adaptive: PolicyScore) {
  let recoveredCases = 0;
  let recoveredPaise = 0;
  let slotsNotSpent = 0;

  cases.forEach((c, i) => {
    if (c.mandateState !== "revoked") return;
    slotsNotSpent += baseline.attempts[i].retriesUsed - adaptive.attempts[i].retriesUsed;
    if (!adaptive.attempts[i].recovered) return;
    recoveredCases += 1;
    recoveredPaise += exposurePaise(c);
  });

  return { cases: recoveredCases, rupees: rupees(recoveredPaise), slotsNotSpent };
}

function computeSweep(cases: RecoveryCase[], adaptive: PolicyScore, lift: Lift) {
  let sweptCases = 0;
  let sweptPaise = 0;

  cases.forEach((c, i) => {
    if (c.trueClass !== "uncollected") return;
    if (!adaptive.attempts[i].recovered) return;
    sweptCases += 1;
    sweptPaise += exposurePaise(c);
  });

  const swept = rupees(sweptPaise);
  return {
    cases: sweptCases,
    rupees: swept,
    shareOfIncremental: lift.incrementalRupees ? round2(swept / lift.incrementalRupees) : 0,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
