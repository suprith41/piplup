import { recoveryAnalytics } from "../src/lib/recovery/analytics.ts";
import { sweepEnvelopes } from "../src/lib/recovery/benchmark.ts";
import { evaluateBatch } from "../src/lib/recovery/evaluate.ts";
import { preventionSummary } from "../src/lib/recovery/prevent.ts";
import { CALENDAR_PRESENT_HOUR } from "../src/lib/recovery/simulate.ts";
import { formatINR } from "../src/lib/recovery/taxonomy.ts";

const report = evaluateBatch();
const analytics = recoveryAnalytics(report);
const prevention = preventionSummary();
const sweep = sweepEnvelopes();
const timing = timingSummary();

console.log("\nPiplup  ·  Adaptive Recovery vs the calendar retry cycle\n");
console.log(`cases              ${report.adaptive.cases}`);
console.log(`at risk            ${inr(report.adaptive.rupeesAtRisk)}`);
console.log("");
console.log("                          T+3 all      T+3 charitable         Adaptive");
row("recovered (gross)", inr(report.baseline.rupeesRecovered), inr(report.baselineCharitable.rupeesRecovered), inr(report.adaptive.rupeesRecovered));
row("recovery rate", pct(report.baseline.recoveryRate), pct(report.baselineCharitable.recoveryRate), pct(report.adaptive.recoveryRate));
row("outreach spend", inr(report.baseline.rupeesSpent), inr(report.baselineCharitable.rupeesSpent), inr(report.adaptive.rupeesSpent));
row("net of chase cost", inr(report.baseline.rupeesNet), inr(report.baselineCharitable.rupeesNet), inr(report.adaptive.rupeesNet));
row("NPCI debits spent", report.baseline.retriesUsed, report.baselineCharitable.retriesUsed, report.adaptive.retriesUsed);
row("out-of-band actions", report.baseline.outOfBandActions, report.baselineCharitable.outOfBandActions, report.adaptive.outOfBandActions);
row("slots wasted", report.baseline.slotsWasted, report.baselineCharitable.slotsWasted, report.adaptive.slotsWasted);
row("involuntary churn", report.baseline.involuntaryChurn, report.baselineCharitable.involuntaryChurn, report.adaptive.involuntaryChurn);
row("stop accuracy", pct(report.baseline.stopAccuracy), pct(report.baselineCharitable.stopAccuracy), pct(report.adaptive.stopAccuracy));

console.log("\nBaseline assumption");
console.log("  'T+3 all' retries every failure class, including revoked mandates.");
console.log("  'T+3 charitable' stops after one hard decline. Our lift has to survive both.");

console.log("\nIncremental lift (the number vendors do not publish)");
liftBlock("vs T+3 all", report.lift);
liftBlock("vs T+3 charitable", report.liftCharitable);

console.log("\nOf which: revoked mandates re-authorised");
console.log(`  ${report.reauth.cases} customers came back, ${inr(report.reauth.rupees)}`);
console.log(`  ${report.reauth.slotsNotSpent} NPCI debits the calendar spends on dead mandates and we do not.`);

console.log("\nOf which: uncollected-invoice sweep");
console.log(`  ${report.sweep.cases} revived subscriptions, ${inr(report.sweep.rupees)}`);
console.log(`  ${pct(report.sweep.shareOfIncremental)} of incremental lift comes from money`);
console.log("  the calendar flow has no path to charge at all.");

console.log("\nDelta vs T+3 all");
console.log(`  +${inr(report.delta.extraRupeesRecovered)} gross`);
console.log(`  +${inr(report.delta.netAdvantage)} net of chase cost`);
console.log(`  ${report.delta.retriesSaved} fewer NPCI debits`);
console.log(`  ${report.delta.slotsSaved} NPCI slots saved`);
console.log(`  ${report.delta.churnAvoided} recoverable subscriptions kept alive`);

console.log(`\nRecovery analytics  ·  as of day ${analytics.asOfDay} of the cycle`);
console.log(
  `  failure rate ${pct(analytics.kpis.failureRate)} of ${analytics.kpis.cycleSubscriptions} subscriptions · recovery rate ${pct(analytics.kpis.recoveryRate)} by volume`,
);
console.log(
  `  ${analytics.kpis.paisePerRupeeRecovered.toFixed(2)} paise spent per rupee recovered · ${analytics.kpis.contactsSent} customer contacts · ${analytics.kpis.humanReviewCases} routed to a human`,
);
console.log(
  `  NPCI budget used ${analytics.kpis.npciSlotsSpent}/${analytics.kpis.npciSlotsAvailable} (${pct(analytics.kpis.slotUtilisation)})`,
);
console.log(
  `  recovered ${inr(analytics.stages.recoveredRupees)} · in recovery ${inr(analytics.stages.inRecoveryRupees)} · not recovered ${inr(analytics.stages.notRecoveredRupees)}`,
);

console.log("\n  Recovered volume by method");
for (const row of analytics.byMethod) {
  console.log(
    `    ${row.label.padEnd(24)} ${String(row.cases).padStart(3)} cases  ${inr(row.recoveredRupees).padStart(10)}  ${String(row.npciSlots).padStart(3)} slots`,
  );
}

console.log("\n  Failed volume by decline reason");
for (const row of analytics.byDecline) {
  console.log(
    `    ${row.label.padEnd(24)} ${String(row.cases).padStart(3)} cases  ${inr(row.atRiskRupees).padStart(10)}  ${pct(row.recoveryRate).padStart(4)} recovered`,
  );
}

console.log("\nWhen to present  ·  the window model, not a fixed offset");
console.log(
  `  ${timing.scored} windows scored across ${timing.cases} debit cases · ${timing.grid} slots per case`,
);
console.log(
  `  chosen hour: ${timing.hours.map((h) => `${String(h.hour).padStart(2, "0")}:00 ×${h.cases}`).join("  ")}`,
);
console.log(
  `  ${timing.movedOffBillingDay} debits moved off the billing date · ${timing.reserveUsed} needed the reserve window`,
);
console.log(
  `  a calendar presents every one of them at 0${CALENDAR_PRESENT_HOUR}:00, before any salary credit posts`,
);

console.log("\nEnvelope benchmark  ·  what the drop-dead day is worth");
console.log("        window   attempts   recovered        net   debits   churn");
for (const row of sweep.results) {
  const star =
    row.dropDeadDay === sweep.recommended.dropDeadDay && row.maxAttempts === sweep.recommended.maxAttempts
      ? " <- recommended"
      : "";
  console.log(
    `      ${String(row.dropDeadDay).padStart(3)} days        x${row.maxAttempts}   ${inr(row.rupeesRecovered).padStart(9)}  ${inr(row.rupeesNet).padStart(9)}   ${String(row.npciDebits).padStart(6)}   ${String(row.involuntaryChurn).padStart(5)}${star}`,
  );
}
console.log(
  `  Shipped default is ${sweep.current.dropDeadDay} days × ${sweep.current.maxAttempts} attempts, ${
    sweep.gapToBest === 0 ? "which is the best row on this book." : `${inr(sweep.gapToBest)} behind the best row.`
  }`,
);
console.log("  A third attempt recovers nothing more and costs a slot, so NPCI decides the cap, not taste.");

console.log("\nPrevention  ·  next cycle, scanned before anything is charged");
console.log(`  ${prevention.scanned} upcoming debits scanned, ${prevention.flagged} flagged`);
console.log(`  ${prevention.certain} will fail on arithmetic, not on a guess: ${inr(prevention.protectedRupees)}`);
console.log(`  ${prevention.elevated} will fail next cycle unless the card is replaced`);
console.log(
  `  ${inr(prevention.spendRupees)} of notices, 0 NPCI slots, ${prevention.npciSlotsAvoided} slots the calendar would burn rediscovering it`,
);
console.log("");

function liftBlock(label: string, lift: { adaptiveOnly: number; incrementalRupees: number; baselineOnly: number; regressionRupees: number; bothRecovered: number; neitherRecovered: number }): void {
  console.log(`  ${label}`);
  console.log(`    adaptive only   ${String(lift.adaptiveOnly).padStart(3)} cases  ${inr(lift.incrementalRupees)}`);
  console.log(`    baseline only   ${String(lift.baselineOnly).padStart(3)} cases  ${inr(lift.regressionRupees)}`);
  console.log(`    both / neither  ${String(lift.bothRecovered).padStart(3)} / ${lift.neitherRecovered}`);
}

function row(label: string, naive: string | number, charitable: string | number, adaptive: string | number): void {
  console.log(`${label.padEnd(22)} ${pad(naive)} ${pad(charitable)} ${pad(adaptive)}`);
}

/** What the window model actually chose, read back off the decisions. */
function timingSummary() {
  const scheduled = report.adaptive.attempts.filter((a) => a.decision.timing);
  const byHour = new Map<number, number>();
  let scored = 0;
  let reserveUsed = 0;
  let movedOffBillingDay = 0;

  for (const attempt of scheduled) {
    const timing = attempt.decision.timing;
    if (!timing) continue;
    scored += timing.considered;
    if (attempt.retriesUsed > 1) reserveUsed += 1;
    const first = timing.chosen[0];
    if (first) {
      byHour.set(first.hourIST, (byHour.get(first.hourIST) ?? 0) + 1);
      if (first.day > 1) movedOffBillingDay += 1;
    }
  }

  return {
    cases: scheduled.length,
    scored,
    grid: scheduled.length ? Math.round(scored / scheduled.length) : 0,
    reserveUsed,
    movedOffBillingDay,
    hours: [...byHour.entries()]
      .map(([hour, cases]) => ({ hour, cases }))
      .sort((a, b) => b.cases - a.cases),
  };
}

function pct(n: number): string {
  return `${(n * 100).toFixed(0)}%`;
}

function inr(rupees: number): string {
  return formatINR(Math.round(rupees * 100));
}

function pad(value: string | number): string {
  return String(value).padStart(16, " ");
}
