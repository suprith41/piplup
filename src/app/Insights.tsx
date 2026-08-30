"use client";

import { useEffect, useState } from "react";
import { formatINR } from "@/lib/recovery/taxonomy";

type Breakdown = {
  key: string;
  label: string;
  cases: number;
  atRiskRupees: number;
  recoveredRupees: number;
  recoveryRate: number;
};

type MethodBreakdown = Breakdown & { npciSlots: number; costRupees: number };

type Analytics = {
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
    paisePerRupeeRecovered: number;
    contactsSent: number;
    humanReviewCases: number;
  };
  stages: {
    recoveredRupees: number;
    inRecoveryRupees: number;
    notRecoveredRupees: number;
    recoveredCases: number;
    inRecoveryCases: number;
    notRecoveredCases: number;
  };
  byMethod: MethodBreakdown[];
  byDecline: Breakdown[];
  byBank: Breakdown[];
  topInRecovery: Array<{
    caseId: string;
    name: string;
    rupees: number;
    decline: string;
    bank: string;
    nextActionDay: number;
    waitingOn: string;
    needsHumanReview: boolean;
  }>;
};

type Prevention = {
  scanned: number;
  flagged: number;
  certain: number;
  elevated: number;
  protectedRupees: number;
  npciSlotsAvoided: number;
  spendRupees: number;
  actions: Array<{
    id: string;
    customerName: string;
    amountPaise: number;
    rail: string;
    bank: string;
    signal: string;
    severity: string;
    billingDay: number;
    noticeDay: number;
    daysOfHeadstart: number;
    finding: string;
    ask: string;
  }>;
};

type Payload = { analytics: Analytics; prevention: Prevention };

function useInsights() {
  const [data, setData] = useState<Payload | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/analytics")
      .then((r) => r.json())
      .then((d: Payload) => {
        if (!cancelled) setData(d);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return data;
}

function inr(rupees: number): string {
  return formatINR(Math.round(rupees * 100));
}

function pct(n: number): string {
  return `${(n * 100).toFixed(0)}%`;
}

export function AnalyticsBoard() {
  const data = useInsights();

  if (!data) return <Loading label="Reading the batch…" />;

  const { kpis, stages, byMethod, byDecline, byBank, topInRecovery } = data.analytics;
  const total = stages.recoveredRupees + stages.inRecoveryRupees + stages.notRecoveredRupees || 1;

  return (
    <div className="mt-8 space-y-6">
      <section className="grid gap-px overflow-hidden rounded-xl border border-neutral-200 bg-neutral-200 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Failure rate"
          value={pct(kpis.failureRate)}
          hint={`${kpis.failedCases} of ${kpis.cycleSubscriptions} subscriptions`}
        />
        <Stat label="Recovery rate" value={pct(kpis.recoveryRate)} hint={`${inr(kpis.recoveredRupees)} by volume`} />
        <Stat
          label="Cost of the chase"
          value={`${kpis.paisePerRupeeRecovered.toFixed(2)}p`}
          hint={`per rupee recovered · ${kpis.contactsSent} contacts`}
        />
        <Stat
          label="NPCI budget used"
          value={pct(kpis.slotUtilisation)}
          hint={`${kpis.npciSlotsSpent} of ${kpis.npciSlotsAvailable} debits`}
        />
      </section>

      <section className="rounded-xl border border-neutral-200 bg-white p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-medium">Where the money stands</h2>
          <p className="text-[11px] text-neutral-400">as of day {data.analytics.asOfDay} of the cycle</p>
        </div>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-500">
          &ldquo;In recovery&rdquo; is money whose next scheduled action has not come round yet. Counting it as lost
          would flatter the recovery rate; counting it as won would be a lie.
        </p>
        <div className="mt-4 flex h-3 overflow-hidden rounded-full bg-neutral-100">
          <span className="bg-emerald-600" style={{ width: `${(stages.recoveredRupees / total) * 100}%` }} />
          <span className="bg-amber-400" style={{ width: `${(stages.inRecoveryRupees / total) * 100}%` }} />
          <span className="bg-neutral-300" style={{ width: `${(stages.notRecoveredRupees / total) * 100}%` }} />
        </div>
        <div className="mt-3 flex flex-wrap gap-6 text-xs text-neutral-500">
          <Legend swatch="bg-emerald-600" label="Recovered" value={inr(stages.recoveredRupees)} n={stages.recoveredCases} />
          <Legend swatch="bg-amber-400" label="In recovery" value={inr(stages.inRecoveryRupees)} n={stages.inRecoveryCases} />
          <Legend swatch="bg-neutral-300" label="Not recovered" value={inr(stages.notRecoveredRupees)} n={stages.notRecoveredCases} />
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <Panel
          title="Recovered volume by method"
          caption="Stripe reports three buckets. These are the six moves the policy can actually make."
        >
          <table className="w-full text-left text-sm">
            <thead className="text-[11px] text-neutral-400">
              <tr>
                <th className="px-5 py-2 font-normal">Method</th>
                <th className="px-3 py-2 font-normal">Cases</th>
                <th className="px-3 py-2 font-normal">Recovered</th>
                <th className="px-5 py-2 font-normal">NPCI</th>
              </tr>
            </thead>
            <tbody>
              {byMethod.map((row) => (
                <tr key={row.key} className="border-t border-neutral-100">
                  <td className="px-5 py-2.5">{row.label}</td>
                  <td className="px-3 py-2.5 text-neutral-500">{row.cases}</td>
                  <td className="px-3 py-2.5 tabular-nums">{inr(row.recoveredRupees)}</td>
                  <td className={`px-5 py-2.5 text-[11px] ${row.npciSlots ? "text-neutral-500" : "text-emerald-700"}`}>
                    {row.npciSlots ? `${row.npciSlots} slots` : "free"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>

        <Panel title="Failed volume by decline reason" caption="Top reasons by money at risk, and what we got back.">
          <table className="w-full text-left text-sm">
            <thead className="text-[11px] text-neutral-400">
              <tr>
                <th className="px-5 py-2 font-normal">Decline</th>
                <th className="px-3 py-2 font-normal">Cases</th>
                <th className="px-3 py-2 font-normal">At risk</th>
                <th className="px-5 py-2 font-normal">Recovered</th>
              </tr>
            </thead>
            <tbody>
              {byDecline.map((row) => (
                <tr key={row.key} className="border-t border-neutral-100">
                  <td className="px-5 py-2.5">{row.label}</td>
                  <td className="px-3 py-2.5 text-neutral-500">{row.cases}</td>
                  <td className="px-3 py-2.5 tabular-nums text-neutral-500">{inr(row.atRiskRupees)}</td>
                  <td className="px-5 py-2.5 tabular-nums">{pct(row.recoveryRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </section>

      <Panel title="By sponsor bank" caption="Which bank is costing Eureka Labs the most this cycle.">
        <table className="w-full text-left text-sm">
          <thead className="text-[11px] text-neutral-400">
            <tr>
              <th className="px-5 py-2 font-normal">Bank</th>
              <th className="px-3 py-2 font-normal">Cases</th>
              <th className="px-3 py-2 font-normal">At risk</th>
              <th className="px-5 py-2 font-normal">Recovered</th>
            </tr>
          </thead>
          <tbody>
            {byBank.map((row) => (
              <tr key={row.key} className="border-t border-neutral-100">
                <td className="px-5 py-2.5">{row.label}</td>
                <td className="px-3 py-2.5 text-neutral-500">{row.cases}</td>
                <td className="px-3 py-2.5 tabular-nums text-neutral-500">{inr(row.atRiskRupees)}</td>
                <td className="px-5 py-2.5 tabular-nums">{pct(row.recoveryRate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <Panel
        title="Top customers in recovery"
        caption={`Still open on day ${data.analytics.asOfDay}. ${kpis.humanReviewCases} are above the human-review threshold.`}
      >
        <ul className="divide-y divide-neutral-100">
          {topInRecovery.map((row) => (
            <li key={row.caseId} className="px-5 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm">
                  {row.name} <span className="text-neutral-400">{inr(row.rupees)}</span>
                  {row.needsHumanReview ? <span className="ml-2 text-[10px] text-orange-700">HUMAN REVIEW</span> : null}
                </p>
                <p className="text-[11px] text-neutral-400">
                  {row.bank} · {row.decline.replaceAll("_", " ")} · next action day {row.nextActionDay}
                </p>
              </div>
              <p className="mt-1 text-xs leading-5 text-neutral-500">{row.waitingOn}</p>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

export function PreventBoard() {
  const data = useInsights();

  if (!data) return <Loading label="Scanning next cycle…" />;

  const p = data.prevention;

  return (
    <div className="mt-8 space-y-6">
      <section className="rounded-xl border border-neutral-200 bg-white p-5">
        <h2 className="text-base font-medium">Failures we can see coming</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-500">
          The cheapest recovery is the debit that never fails. A UPI AutoPay mandate is approved up to a ceiling, so an
          invoice above that ceiling <em>cannot</em> clear — that is arithmetic, not a prediction. Same for a card or
          mandate that lapses before the billing date. We flag them three days out and spend zero NPCI slots.
        </p>
      </section>

      <section className="grid gap-px overflow-hidden rounded-xl border border-neutral-200 bg-neutral-200 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Scanned" value={String(p.scanned)} hint="upcoming debits, nothing charged yet" />
        <Stat label="Will fail" value={String(p.certain)} hint={`${inr(p.protectedRupees)} at stake`} />
        <Stat label="Fails next cycle" value={String(p.elevated)} hint="card expires before the following debit" />
        <Stat label="Slots not burned" value={String(p.npciSlotsAvoided)} hint={`${inr(p.spendRupees)} of notices`} />
      </section>

      <Panel title="Preventive queue" caption="Sent before the billing day, so the customer has time to act.">
        <table className="w-full text-left text-sm">
          <thead className="text-[11px] text-neutral-400">
            <tr>
              <th className="px-5 py-2 font-normal">Customer</th>
              <th className="px-3 py-2 font-normal">Amount</th>
              <th className="px-3 py-2 font-normal">Signal</th>
              <th className="px-3 py-2 font-normal">Notice</th>
              <th className="px-5 py-2 font-normal">Finding</th>
            </tr>
          </thead>
          <tbody>
            {p.actions.map((row) => (
              <tr key={row.id} className="border-t border-neutral-100 align-top">
                <td className="px-5 py-2.5">
                  {row.customerName}
                  <span className="ml-2 text-[10px] text-neutral-400">{row.bank}</span>
                </td>
                <td className="px-3 py-2.5 tabular-nums text-neutral-500">{formatINR(row.amountPaise)}</td>
                <td className="px-3 py-2.5">
                  <span className={`text-[11px] ${row.severity === "certain" ? "text-orange-700" : "text-neutral-500"}`}>
                    {row.signal.replaceAll("_", " ")}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-[11px] text-neutral-500">
                  day {row.noticeDay} → bills day {row.billingDay}
                </td>
                <td className="px-5 py-2.5 text-xs leading-5 text-neutral-500">
                  {row.finding}
                  <span className="mt-1 block text-neutral-400">{row.ask}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}

function Loading({ label }: { label: string }) {
  return <p className="mt-8 text-sm text-neutral-400">{label}</p>;
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="bg-white p-4">
      <p className="text-[11px] text-neutral-400">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-neutral-400">{hint}</p>
    </div>
  );
}

function Legend({ swatch, label, value, n }: { swatch: string; label: string; value: string; n: number }) {
  return (
    <p className="flex items-center gap-2">
      <span className={`h-2 w-2 rounded-sm ${swatch}`} />
      {label} <span className="text-neutral-800">{value}</span> · {n} cases
    </p>
  );
}

function Panel({ title, caption, children }: { title: string; caption: string; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
      <div className="px-5 py-4">
        <h2 className="text-sm font-medium">{title}</h2>
        <p className="mt-1 text-xs leading-5 text-neutral-400">{caption}</p>
      </div>
      <div className="border-t border-neutral-100">{children}</div>
    </div>
  );
}
