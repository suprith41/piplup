import { evaluateBatch } from "../src/lib/recovery/evaluate.ts";
import { formatINR } from "../src/lib/recovery/taxonomy.ts";

const report = evaluateBatch();

console.log("\nPiplup  ·  Adaptive Recovery vs the calendar retry cycle\n");
console.log(`cases              ${report.adaptive.cases}`);
console.log(`at risk            ${inr(report.adaptive.rupeesAtRisk)}`);
console.log("");
console.log("                          T+3 all      T+3 charitable         Adaptive");
row("recovered (gross)", inr(report.baseline.rupeesRecovered), inr(report.baselineCharitable.rupeesRecovered), inr(report.adaptive.rupeesRecovered));
row("recovery rate", pct(report.baseline.recoveryRate), pct(report.baselineCharitable.recoveryRate), pct(report.adaptive.recoveryRate));
row("outreach spend", inr(report.baseline.rupeesSpent), inr(report.baselineCharitable.rupeesSpent), inr(report.adaptive.rupeesSpent));
row("net of chase cost", inr(report.baseline.rupeesNet), inr(report.baselineCharitable.rupeesNet), inr(report.adaptive.rupeesNet));
row("retries used", report.baseline.retriesUsed, report.baselineCharitable.retriesUsed, report.adaptive.retriesUsed);
row("slots wasted", report.baseline.slotsWasted, report.baselineCharitable.slotsWasted, report.adaptive.slotsWasted);
row("involuntary churn", report.baseline.involuntaryChurn, report.baselineCharitable.involuntaryChurn, report.adaptive.involuntaryChurn);
row("stop accuracy", pct(report.baseline.stopAccuracy), pct(report.baselineCharitable.stopAccuracy), pct(report.adaptive.stopAccuracy));

console.log("\nBaseline assumption");
console.log("  'T+3 all' retries every failure class, including revoked mandates.");
console.log("  'T+3 charitable' stops after one hard decline. Our lift has to survive both.");

console.log("\nIncremental lift (the number vendors do not publish)");
liftBlock("vs T+3 all", report.lift);
liftBlock("vs T+3 charitable", report.liftCharitable);

console.log("\nOf which: uncollected-invoice sweep");
console.log(`  ${report.sweep.cases} revived subscriptions, ${inr(report.sweep.rupees)}`);
console.log(`  ${pct(report.sweep.shareOfIncremental)} of incremental lift comes from money`);
console.log("  the calendar flow has no path to charge at all.");

console.log("\nDelta vs T+3 all");
console.log(`  +${inr(report.delta.extraRupeesRecovered)} gross`);
console.log(`  +${inr(report.delta.netAdvantage)} net of chase cost`);
console.log(`  ${report.delta.retriesSaved} fewer retries`);
console.log(`  ${report.delta.slotsSaved} NPCI slots saved`);
console.log(`  ${report.delta.churnAvoided} recoverable subscriptions kept alive`);
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

function pct(n: number): string {
  return `${(n * 100).toFixed(0)}%`;
}

function inr(rupees: number): string {
  return formatINR(Math.round(rupees * 100));
}

function pad(value: string | number): string {
  return String(value).padStart(16, " ");
}
