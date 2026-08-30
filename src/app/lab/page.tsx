import Link from "next/link";
import { LadderCompare } from "@/app/LadderCompare";
import { RecoverLive } from "@/app/RecoverLive";
import { evaluateBatch } from "@/lib/recovery/evaluate";
import { formatINR } from "@/lib/recovery/taxonomy";

export const dynamic = "force-dynamic";

export default function LabPage() {
  const report = evaluateBatch();

  return (
    <main className="min-h-screen bg-white text-[#02042b]">
      <div className="bg-[#072654] px-6 py-1.5 text-center text-[11px] font-semibold text-white">TEST MODE</div>
      <div className="mx-auto max-w-5xl px-6 py-10">
      <p className="text-xs text-neutral-400">Internal</p>
      <h1 className="mt-1 font-display text-3xl tracking-tight">Piplup lab</h1>
      <p className="mt-2 max-w-xl text-sm leading-6 text-neutral-500">
        Scorecard and manual Razorpay/mail controls. The product is the{" "}
        <Link className="font-semibold text-[#305eff]" href="/">
          Eureka Labs revenue desk
        </Link>
        .
      </p>
      <dl className="mt-8 grid gap-4 sm:grid-cols-3">
        <Stat k="Adaptive recovered" v={formatINR(Math.round(report.adaptive.rupeesRecovered * 100))} />
        <Stat k="Incremental lift" v={formatINR(Math.round(report.lift.incrementalRupees * 100))} />
        <Stat k="T+3 recovered" v={formatINR(Math.round(report.baseline.rupeesRecovered * 100))} />
      </dl>
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

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="desk-card p-4">
      <dt className="text-[11px] text-neutral-400">{k}</dt>
      <dd className="mt-1 text-xl font-semibold tracking-tight">{v}</dd>
    </div>
  );
}
