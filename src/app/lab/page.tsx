import Link from "next/link";
import { RecoverLive } from "@/app/RecoverLive";
import { evaluateBatch } from "@/lib/recovery/evaluate";
import { formatINR } from "@/lib/recovery/taxonomy";

export const dynamic = "force-dynamic";

export default function LabPage() {
  const report = evaluateBatch();

  return (
    <main className="min-h-screen bg-paper text-ink">
      <div className="mx-auto max-w-5xl px-6 py-10">
      <p className="mono text-xs uppercase tracking-[0.2em] text-ink/45">Internal · not the merchant desk</p>
      <h1 className="mt-2 text-3xl font-semibold">Piplup lab</h1>
      <p className="mt-2 max-w-xl text-sm leading-6 text-ink/60">
        Scorecard and manual Razorpay/mail controls. The product the reviewer should see is{" "}
        <Link className="underline" href="/">
          Eureka Labs revenue desk
        </Link>
        .
      </p>
      <dl className="mt-8 grid gap-4 sm:grid-cols-3">
        <Stat k="Adaptive recovered" v={formatINR(Math.round(report.adaptive.rupeesRecovered * 100))} />
        <Stat k="Incremental lift" v={formatINR(Math.round(report.lift.incrementalRupees * 100))} />
        <Stat k="T+3 recovered" v={formatINR(Math.round(report.baseline.rupeesRecovered * 100))} />
      </dl>
      <RecoverLive />
      </div>
    </main>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-lg border border-ink/10 bg-white p-4">
      <dt className="mono text-[10px] uppercase tracking-wider text-ink/40">{k}</dt>
      <dd className="mt-1 text-xl font-semibold">{v}</dd>
    </div>
  );
}
