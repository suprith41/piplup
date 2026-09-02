import Link from "next/link";
import { LadderCompare } from "@/app/LadderCompare";
import { RecoverLive } from "@/app/RecoverLive";
import { TimingModel } from "@/app/TimingModel";
import { sweepEnvelopes } from "@/lib/recovery/benchmark";
import { evaluateBatch } from "@/lib/recovery/evaluate";
import { CALENDAR_PRESENT_HOUR } from "@/lib/recovery/simulate";
import { formatINR } from "@/lib/recovery/taxonomy";
import { DEFAULT_ENVELOPE, planWindows } from "@/lib/recovery/windows";

export const dynamic = "force-dynamic";

export default function LabPage() {
  const report = evaluateBatch();
  const timingPicks = pickTimingCases(report);

  return (
    <main className="min-h-screen bg-canvas text-ink">
      <div className="test-mode-bar">Test mode</div>
      <div className="mx-auto max-w-5xl px-6 py-10">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#8c93a3]">Internal</p>
      <h1 className="mt-1 font-display text-3xl tracking-tight">Piplup lab</h1>
      <p className="mt-2 max-w-xl text-sm leading-6 text-[#5a6178]">
        Scorecard and manual Razorpay/mail controls. The product is the{" "}
        <Link className="rzp-link" href="/">
          Eureka Labs revenue desk
        </Link>
        . The map is{" "}
        <Link className="rzp-link" href="/architecture">
          architecture
        </Link>
        .
      </p>
      <dl className="mt-8 grid gap-4 sm:grid-cols-3">
        <Stat k="Adaptive recovered" v={formatINR(Math.round(report.adaptive.rupeesRecovered * 100))} />
        <Stat k="Incremental lift" v={formatINR(Math.round(report.lift.incrementalRupees * 100))} />
        <Stat k="T+3 recovered" v={formatINR(Math.round(report.baseline.rupeesRecovered * 100))} />
      </dl>
      <TimingModel picks={timingPicks} sweep={sweepEnvelopes()} calendarHour={CALENDAR_PRESENT_HOUR} />
      <LadderCompare
        cases={report.cases}
        adaptive={report.adaptive.attempts}
        baseline={report.baseline.attempts}
      />
      <RecoverLive />
      </div>
    </main>
  );
}

/**
 * Two cases where the timing is the whole decision: one where nobody ever
 * declared a payday and only the clearing history knows, and one where the
 * money lands after the hour we picked, so the reserve window is what saves it.
 */
function pickTimingCases(report: ReturnType<typeof evaluateBatch>) {
  const wanted: Array<{ blurb: string; match: (i: number) => boolean }> = [
    {
      blurb:
        "Nobody ever told us when this customer gets paid. Three cycles of clearing history did, and a fixed offset from the due date has no way to read them.",
      match: (i) => Boolean(report.cases[i].priorClearedDays?.length) && !report.cases[i].salaryDay,
    },
    {
      blurb:
        "Payroll here runs late in the evening, and no merchant-visible signal says so. The first window misses by hours, which is exactly what the reserve window is for.",
      match: (i) => report.adaptive.attempts[i].retriesUsed > 1,
    },
  ];

  const picks: Array<{
    caseRow: (typeof report.cases)[number];
    grid: ReturnType<typeof planWindows>;
    blurb: string;
  }> = [];

  for (const { blurb, match } of wanted) {
    const i = report.cases.findIndex(
      (_, index) => match(index) && report.adaptive.attempts[index].decision.attempts?.length,
    );
    if (i === -1 || picks.some((p) => p.caseRow.id === report.cases[i].id)) continue;
    const envelope = report.adaptive.attempts[i].decision.timing?.envelope ?? DEFAULT_ENVELOPE;
    picks.push({ caseRow: report.cases[i], grid: planWindows(report.cases[i], envelope), blurb });
  }

  return picks;
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="desk-card desk-card-hover p-4">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#8c93a3]">{k}</dt>
      <dd className="mt-1 font-display text-xl tracking-tight">{v}</dd>
    </div>
  );
}
