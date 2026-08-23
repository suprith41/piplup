import { hinglishNudge } from "@/lib/recovery/copy";
import { evaluateBatch } from "@/lib/recovery/evaluate";
import { replyIntentLabel } from "@/lib/recovery/reply";
import { formatINR } from "@/lib/recovery/taxonomy";
import type { PolicyScore, RecoveryCase } from "@/lib/recovery/types";

export const dynamic = "force-dynamic";

export default function Page() {
  const report = evaluateBatch();

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="flex flex-wrap items-end justify-between gap-6 border-b border-ink/15 pb-8">
        <div>
          <p className="mono text-xs uppercase tracking-[0.2em] text-ink/50">Track 03 · AI Revenue Recovery</p>
          <h1 className="mt-2 text-4xl font-semibold tracking-tight">Piplup</h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-ink/70">
            Stripe&apos;s method on Indian rails. Type the decline, mutate the next attempt, cascade now or dunning later. Beat calendar T+3 on the same batch.
          </p>
        </div>
        <div className="mono text-right text-xs text-ink/50">
          <p>npm run evaluate</p>
          <p>{report.cases.length} labeled cases</p>
        </div>
      </header>

      <section className="mt-8 grid gap-4 md:grid-cols-3">
        <DeltaCard
          label="Incremental lift"
          value={formatINR(Math.round(report.lift.incrementalRupees * 100))}
          hint={`${report.lift.adaptiveOnly} cases only Adaptive recovered. ${report.lift.bothRecovered} would have cleared anyway, so they do not count.`}
        />
        <DeltaCard
          label="Net of chase cost"
          value={formatINR(Math.round(report.adaptive.rupeesNet * 100))}
          hint={`Spent ${formatINR(Math.round(report.adaptive.rupeesSpent * 100))} on outreach against T+3's ${formatINR(Math.round(report.baseline.rupeesSpent * 100))}.`}
        />
        <DeltaCard
          label="Churn avoided"
          value={String(report.delta.churnAvoided)}
          hint={`Recoverable subscriptions kept out of halted. ${report.delta.retriesSaved} fewer retries, ${report.delta.slotsSaved} NPCI slots saved.`}
        />
      </section>

      <section className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-ink/10 bg-white p-5">
          <p className="mono text-[11px] uppercase tracking-wider text-ink/45">Counterfactual</p>
          <p className="mt-2 text-sm leading-6 text-ink/70">
            Gross recovery flatters every vendor. Of {report.cases.length} cases, {report.lift.bothRecovered} would have
            cleared on the calendar anyway and {report.lift.neitherRecovered} were never recoverable. The honest number
            is <strong>{report.lift.adaptiveOnly} cases</strong> worth{" "}
            <strong>{formatINR(Math.round(report.lift.incrementalRupees * 100))}</strong> that only Adaptive collected.
            Regressions where the calendar won and Adaptive lost: <strong>{report.lift.baselineOnly}</strong>.
          </p>
          <p className="mt-3 text-sm leading-6 text-ink/70">
            Of that lift, <strong>{formatINR(Math.round(report.sweep.rupees * 100))}</strong> across{" "}
            {report.sweep.cases} revived subscriptions comes from uncollected invoices the calendar flow has no path to
            charge at all &mdash; {(report.sweep.shareOfIncremental * 100).toFixed(0)}% of the total.
          </p>
        </div>
        <div className="rounded-lg border border-ink/10 bg-white p-5">
          <p className="mono text-[11px] uppercase tracking-wider text-ink/45">Baseline assumption</p>
          <p className="mt-2 text-sm leading-6 text-ink/70">
            The documented retry cycle lists mandate cancellation as a failure reason and describes automatic retries
            with no carve-out, so the primary baseline retries every class. A charitable reading &mdash; stopping after
            one hard decline &mdash; is scored too.
          </p>
          <dl className="mt-4 grid grid-cols-2 gap-4 text-sm">
            <Stat
              k="Charitable recovered"
              v={formatINR(Math.round(report.baselineCharitable.rupeesRecovered * 100))}
            />
            <Stat
              k="Lift vs charitable"
              v={formatINR(Math.round(report.liftCharitable.incrementalRupees * 100))}
            />
          </dl>
        </div>
      </section>

      <section className="mt-8 grid gap-4 md:grid-cols-2">
        <ScoreColumn title="T+3 calendar" subtitle="Same debit, same rail, T+1 T+2 T+3" score={report.baseline} tone="rust" />
        <ScoreColumn title="Adaptive Recovery" subtitle="Two clocks · mutate · stop" score={report.adaptive} tone="moss" />
      </section>

      <section className="mt-12">
        <div className="mb-4 flex items-end justify-between">
          <h2 className="text-lg font-semibold">Batch</h2>
          <p className="mono text-xs text-ink/45">click a row in the video: NSF vs revoked vs timeout</p>
        </div>
        <div className="overflow-hidden rounded-lg border border-ink/10 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="mono bg-ink/[0.03] text-[11px] uppercase tracking-wider text-ink/50">
              <tr>
                <th className="px-4 py-3">Case</th>
                <th className="px-4 py-3">Decline</th>
                <th className="px-4 py-3">Adaptive</th>
                <th className="px-4 py-3">T+3</th>
                <th className="px-4 py-3">Nudge</th>
              </tr>
            </thead>
            <tbody>
              {report.cases.map((c, i) => (
                <CaseRow key={c.id} c={c} adaptive={report.adaptive.attempts[i]} t3={report.baseline.attempts[i]} />
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

function DeltaCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-lg border border-ink/10 bg-white p-5">
      <p className="mono text-[11px] uppercase tracking-wider text-ink/45">{label}</p>
      <p className="mt-2 text-3xl font-semibold">{value}</p>
      <p className="mt-2 text-xs leading-5 text-ink/55">{hint}</p>
    </div>
  );
}

function ScoreColumn({
  title,
  subtitle,
  score,
  tone,
}: {
  title: string;
  subtitle: string;
  score: PolicyScore;
  tone: "rust" | "moss";
}) {
  const color = tone === "moss" ? "text-moss" : "text-rust";
  return (
    <div className="rounded-lg border border-ink/10 bg-white p-6">
      <p className={`mono text-[11px] uppercase tracking-wider ${color}`}>{title}</p>
      <p className="mt-1 text-xs text-ink/50">{subtitle}</p>
      <dl className="mt-5 grid grid-cols-2 gap-4 text-sm">
        <Stat k="Recovered" v={formatINR(Math.round(score.rupeesRecovered * 100))} />
        <Stat k="Rate" v={`${(score.recoveryRate * 100).toFixed(0)}%`} />
        <Stat k="Outreach spend" v={formatINR(Math.round(score.rupeesSpent * 100))} />
        <Stat k="Net" v={formatINR(Math.round(score.rupeesNet * 100))} />
        <Stat k="Retries" v={String(score.retriesUsed)} />
        <Stat k="Slots wasted" v={String(score.slotsWasted)} />
        <Stat k="Involuntary churn" v={String(score.involuntaryChurn)} />
        <Stat k="Stop accuracy" v={`${(score.stopAccuracy * 100).toFixed(0)}%`} />
        <Stat k="Correctly stopped" v={formatINR(Math.round(score.rupeesCorrectlyStopped * 100))} />
      </dl>
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="mono text-[10px] uppercase tracking-wider text-ink/40">{k}</dt>
      <dd className="mt-1 font-medium">{v}</dd>
    </div>
  );
}

function CaseRow({
  c,
  adaptive,
  t3,
}: {
  c: RecoveryCase;
  adaptive: PolicyScore["attempts"][number];
  t3: PolicyScore["attempts"][number];
}) {
  return (
    <tr className="border-t border-ink/5 align-top">
      <td className="px-4 py-3">
        <p className="font-medium">{c.customerName}</p>
        <p className="mono text-[11px] text-ink/40">
          {c.id} · {formatINR(c.amountPaise)} · {c.rail}
        </p>
      </td>
      <td className="px-4 py-3">
        <p>{c.declineCode}</p>
        <p className="mono text-[11px] text-ink/40">{c.trueClass}</p>
        {c.parsedReply ? (
          <p className="mt-1 max-w-[14rem] text-[11px] leading-4 text-ink/50">
            <span className="mono uppercase tracking-wider text-rust">
              {replyIntentLabel(c.parsedReply.intent)}
            </span>{" "}
            <span className="italic">&ldquo;{c.parsedReply.raw}&rdquo;</span>
          </p>
        ) : null}
      </td>
      <td className="px-4 py-3">
        <Outcome ok={adaptive.recovered} stopped={!adaptive.executed} label={adaptive.decision.clock} />
        <p className="mt-1 max-w-xs text-xs leading-5 text-ink/55">{adaptive.decision.reason}</p>
      </td>
      <td className="px-4 py-3">
        <Outcome ok={t3.recovered} stopped={false} label={t3.slotWasted ? "burned slots" : "calendar"} />
        <p className="mt-1 text-xs text-ink/55">{t3.note}</p>
      </td>
      <td className="px-4 py-3 text-xs leading-5 text-ink/70">{hinglishNudge(c, adaptive.decision) || "— silent cascade"}</td>
    </tr>
  );
}

function Outcome({ ok, stopped, label }: { ok: boolean; stopped: boolean; label: string }) {
  const text = stopped ? "stopped" : ok ? "recovered" : "open";
  const color = stopped ? "text-ink/60" : ok ? "text-moss" : "text-rust";
  return (
    <p className={`mono text-[11px] uppercase tracking-wider ${color}`}>
      {text} · {label}
    </p>
  );
}
