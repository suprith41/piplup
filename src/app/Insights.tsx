"use client";

import { useEffect, useState, type ReactNode } from "react";
import { DistBar, HBar, StackedBars, type StackKey } from "@/app/charts";
import { CountInt, CountPct, CountRupees } from "@/app/motion";
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

type CycleBar = {
  cycle: number;
  label: string;
  recoveredRupees: number;
  inRecoveryRupees: number;
  notRecoveredRupees: number;
  recoveryRate: number;
  outOfBandRupees: number;
  railRupees: number;
  linkRupees: number;
  reauthRupees: number;
  sweepRupees: number;
};

type Analytics = {
  asOfDay: number;
  history: CycleBar[];
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
type Window = "this" | "last4" | "year";

const STAGE_KEYS: StackKey[] = [
  { key: "recovered", label: "Recovered", color: "#0d9f6e" },
  { key: "inRecovery", label: "Still open", color: "#305eff" },
  { key: "notRecovered", label: "Closed unpaid", color: "#e5533c" },
];

const METHOD_KEYS: StackKey[] = [
  { key: "rail", label: "Silent rails", color: "#0d9f6e" },
  { key: "link", label: "Payment link", color: "#305eff" },
  { key: "reauth", label: "Mandate re-auth", color: "#f5a623" },
  { key: "sweep", label: "Invoice sweep", color: "#072654" },
];

const SLICE_COLORS = ["#072654", "#305eff", "#0d9f6e", "#f5a623", "#e5533c", "#6c737f"];

let cached: Payload | null = null;

function useInsights() {
  const [data, setData] = useState<Payload | null>(cached);

  useEffect(() => {
    if (cached) return;
    let cancelled = false;
    void fetch("/api/analytics")
      .then((r) => r.json())
      .then((d: Payload) => {
        cached = d;
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

function take(history: CycleBar[], window: Window): CycleBar[] {
  if (window === "this") return history.slice(-1);
  if (window === "last4") return history.slice(-4);
  return history;
}

export function AnalyticsBoard() {
  const data = useInsights();
  const [window, setWindow] = useState<Window>("year");

  if (!data) return <Loading label="Opening the book…" />;

  const { kpis, byMethod, byDecline, byBank, topInRecovery, history } = data.analytics;
  const shown = take(history, window);
  const stageRows = shown.map((c) => ({
    label: c.label,
    overlay: c.recoveryRate,
    values: {
      recovered: c.recoveredRupees,
      inRecovery: c.inRecoveryRupees,
      notRecovered: c.notRecoveredRupees,
    },
  }));
  const methodRows = shown.map((c) => ({
    label: c.label,
    values: {
      rail: c.railRupees,
      link: c.linkRupees,
      reauth: c.reauthRupees,
      sweep: c.sweepRupees,
    },
  }));
  const declineMax = Math.max(...byDecline.map((r) => r.atRiskRupees), 1);
  const bankMax = Math.max(...byBank.map((r) => r.atRiskRupees), 1);

  return (
    <div className="mt-8 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 rise-in">
        <div>
          <p className="font-display text-[28px] text-[#02042b]">Overview</p>
          <p className="mt-1 max-w-xl text-sm leading-6 text-ink/55">
            Last bar is Cycle 47 — the same batch the desk is running. Earlier months are Eureka Labs&apos; prior
            books. Hover a column for the split.
          </p>
        </div>
        <div className="flex gap-1 rounded border border-[#e6e9ee] bg-white p-1">
          {(["this", "last4", "year"] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setWindow(key)}
              className={`rounded px-3 py-1.5 text-xs ${window === key ? "bg-[#305eff] font-semibold text-white" : "text-[#4f566b] hover:text-[#02042b]"}`}
            >
              {key === "this" ? "This cycle" : key === "last4" ? "Last 4" : "Year"}
            </button>
          ))}
        </div>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Failed this cycle" value={<CountRupees value={kpis.failedRupees} />} hint={`${kpis.failedCases} of ${kpis.cycleSubscriptions} seats`} delay={0} />
        <Kpi label="Failure rate" value={<CountPct value={kpis.failureRate} />} hint="first attempt, this cycle" delay={0.05} />
        <Kpi label="Recovered" value={<CountRupees value={kpis.recoveredRupees} />} hint="volume, not case count" delay={0.1} />
        <Kpi label="Recovery rate" value={<CountPct value={kpis.recoveryRate} />} hint={`${kpis.paisePerRupeeRecovered.toFixed(2)}p per rupee chased`} delay={0.15} />
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
        <Panel
          title="Where the money stands"
          caption={`Recovered / still open / closed unpaid. Line is recovery rate. As of day ${data.analytics.asOfDay}.`}
        >
          <div className="px-4 pb-4 pt-2">
            <Legend keys={STAGE_KEYS} extra="Recovery rate" />
            <StackedBars key={window} rows={stageRows} keys={STAGE_KEYS} overlayLabel="Recovery rate" />
          </div>
        </Panel>

        <aside className="rise-in space-y-3" style={{ animationDelay: "0.12s" }}>
          <div className="desk-card p-4">
            <p className="text-[11px] uppercase tracking-[0.14em] text-ink/40">Standing orders</p>
            <p className="mt-1 text-xs leading-5 text-ink/50">
              Not toggles. These are already how the engine runs.
            </p>
            <ul className="mt-3 space-y-2.5 text-sm">
              <Order on label="NPCI budget guard" detail={`${kpis.npciSlotsSpent} of ${kpis.npciSlotsAvailable} slots`} />
              <Order on label="Bank-signal cascade" detail="Hold on latency. Switch on CBS down." />
              <Order on label="Salary-day dunning" detail="Insufficient funds wait for payday." />
              <Order on label="RBI 24h notice" detail="A moved debit gets a fresh pre-debit." />
              <Order on label="Domestic card" detail="Customer completes the link. No MIT." />
              <Order on label="Quiet hours" detail="Contact only 10:00 IST. Cap of 3." />
            </ul>
          </div>
          <div className="rounded-xl bg-[#0b1d3a] p-4 text-white">
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-white/45">Cost of the chase</p>
            <p className="mt-2 font-display text-3xl tracking-tight tabular-nums">
              {kpis.paisePerRupeeRecovered.toFixed(2)}
              <span className="text-lg text-white/50">p</span>
            </p>
            <p className="mt-1 text-xs text-white/55">
              per rupee recovered · {kpis.contactsSent} contacts · {kpis.humanReviewCases} with a human
            </p>
          </div>
        </aside>
      </section>

      <Panel
        title="How the money came back"
        caption="Silent rails spend NPCI slots. Links, re-auth and the invoice sweep do not. Over half of Cycle 47 is the second group."
      >
        <div className="px-4 pb-4 pt-2">
          <Legend keys={METHOD_KEYS} />
          <StackedBars key={`m-${window}`} rows={methodRows} keys={METHOD_KEYS} />
          <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {byMethod
              .filter((row) => row.key !== "none")
              .slice(0, 4)
              .map((row) => (
                <div key={row.key} className="rounded-lg border border-[#e4ebf3] px-3 py-2">
                  <p className="text-[11px] text-ink/40">{row.label}</p>
                  <p className="mt-1 text-sm tabular-nums">{inr(row.recoveredRupees)}</p>
                  <p className={`text-[11px] ${row.npciSlots ? "text-ink/45" : "text-moss"}`}>
                    {row.npciSlots ? `${row.npciSlots} NPCI` : "zero slots"}
                  </p>
                </div>
              ))}
          </div>
        </div>
      </Panel>

      <section className="grid gap-4 xl:grid-cols-2">
        <Panel title="Failed volume by decline" caption="Share of money at risk, then what we got back.">
          <div className="space-y-4 px-5 py-4">
            <DistBar
              slices={byDecline.map((row, i) => ({
                key: row.key,
                label: row.label,
                value: row.atRiskRupees,
                color: SLICE_COLORS[i % SLICE_COLORS.length],
              }))}
            />
            <table className="w-full text-left text-sm">
              <thead className="text-[11px] text-ink/40">
                <tr>
                  <th className="pb-2 font-normal">Reason</th>
                  <th className="pb-2 font-normal">At risk</th>
                  <th className="pb-2 font-normal">Share</th>
                  <th className="pb-2 font-normal">Back</th>
                </tr>
              </thead>
              <tbody>
                {byDecline.map((row, i) => (
                  <tr key={row.key} className="border-t border-ink/5">
                    <td className="py-2.5">
                      <span className="mr-2 inline-block h-2 w-2 rounded-sm" style={{ background: SLICE_COLORS[i] }} />
                      {row.label}
                    </td>
                    <td className="py-2.5 tabular-nums text-ink/60">{inr(row.atRiskRupees)}</td>
                    <td className="w-28 py-2.5">
                      <HBar value={row.atRiskRupees} max={declineMax} color={SLICE_COLORS[i]} delay={i * 0.05} />
                    </td>
                    <td className="py-2.5 tabular-nums">{Math.round(row.recoveryRate * 100)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title="By sponsor bank" caption="Which bank is costing Eureka Labs the most this cycle.">
          <div className="space-y-3 px-5 py-4">
            {byBank.map((row, i) => (
              <div key={row.key}>
                <div className="flex items-baseline justify-between text-sm">
                  <p>{row.label}</p>
                  <p className="tabular-nums text-ink/55">
                    {inr(row.atRiskRupees)} · {Math.round(row.recoveryRate * 100)}% back
                  </p>
                </div>
                <div className="mt-1.5">
                  <HBar value={row.atRiskRupees} max={bankMax} color={i % 2 === 0 ? "#305eff" : "#072654"} delay={i * 0.06} />
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </section>

      <Panel
        title="Still open"
        caption={`Day ${data.analytics.asOfDay}. ${kpis.humanReviewCases} above the human-review threshold. Next action has a date on it.`}
      >
        <ul className="divide-y divide-ink/5">
          {topInRecovery.map((row, i) => (
            <li key={row.caseId} className="rise-in flex flex-wrap items-start justify-between gap-3 px-5 py-3" style={{ animationDelay: `${i * 0.04}s` }}>
              <div>
                <p className="text-sm">
                  {row.name} <span className="text-ink/40">{inr(row.rupees)}</span>
                  {row.needsHumanReview ? <span className="ml-2 text-[10px] uppercase tracking-wide text-rust">Human</span> : null}
                </p>
                <p className="mt-1 max-w-xl text-xs leading-5 text-ink/50">{row.waitingOn}</p>
              </div>
              <p className="mono text-[11px] text-ink/40">
                {row.bank} · {row.decline.replaceAll("_", " ")} · day {row.nextActionDay}
              </p>
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
  const signalMax = Math.max(...p.actions.map((a) => a.amountPaise), 1);

  return (
    <div className="mt-8 space-y-6">
      <div className="rise-in">
        <p className="font-display text-[28px] text-[#02042b]">Failures we can see coming</p>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-ink/55">
          A UPI AutoPay mandate is approved up to a ceiling. An invoice above that ceiling cannot clear — that is
          arithmetic, not a prediction. Same for a card or mandate that lapses before the billing date. Flagged three
          days out. Zero NPCI slots.
        </p>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Scanned" value={<CountInt value={p.scanned} />} hint="upcoming debits, nothing charged" delay={0} />
        <Kpi label="Will fail" value={<CountInt value={p.certain} />} hint={`${inr(p.protectedRupees)} at stake`} delay={0.05} />
        <Kpi label="Fails next cycle" value={<CountInt value={p.elevated} />} hint="card expires before the following debit" delay={0.1} />
        <Kpi label="Slots not burned" value={<CountInt value={p.npciSlotsAvoided} />} hint={`${inr(p.spendRupees)} of notices`} delay={0.15} />
      </section>

      <Panel title="Preventive queue" caption="Sent before the billing day, so the customer has time to act.">
        <table className="w-full text-left text-sm">
          <thead className="text-[11px] text-ink/40">
            <tr>
              <th className="px-5 py-2 font-normal">Customer</th>
              <th className="px-3 py-2 font-normal">Amount</th>
              <th className="px-3 py-2 font-normal">Signal</th>
              <th className="px-3 py-2 font-normal">Notice</th>
              <th className="px-5 py-2 font-normal">Finding</th>
            </tr>
          </thead>
          <tbody>
            {p.actions.map((row, i) => (
              <tr key={row.id} className="rise-in border-t border-ink/5 align-top" style={{ animationDelay: `${i * 0.03}s` }}>
                <td className="px-5 py-2.5">
                  {row.customerName}
                  <span className="ml-2 text-[10px] text-ink/40">{row.bank}</span>
                </td>
                <td className="px-3 py-2.5">
                  <p className="tabular-nums text-ink/70">{formatINR(row.amountPaise)}</p>
                  <div className="mt-1 w-20">
                    <HBar value={row.amountPaise} max={signalMax} color={row.severity === "certain" ? "#e5533c" : "#f5a623"} delay={i * 0.04} />
                  </div>
                </td>
                <td className="px-3 py-2.5">
                  <span className={`text-[11px] ${row.severity === "certain" ? "text-rust" : "text-ink/50"}`}>
                    {row.signal.replaceAll("_", " ")}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-[11px] text-ink/50">
                  day {row.noticeDay} → {row.billingDay}
                </td>
                <td className="px-5 py-2.5 text-xs leading-5 text-ink/55">
                  {row.finding}
                  <span className="mt-1 block text-ink/40">{row.ask}</span>
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
  return <p className="mt-8 text-sm text-ink/40">{label}</p>;
}

function Kpi({
  label,
  value,
  hint,
  delay,
}: {
  label: string;
  value: ReactNode;
  hint: string;
  delay: number;
}) {
  return (
    <div className="desk-card rise-in p-4" style={{ animationDelay: `${delay}s` }}>
      <p className="text-[11px] uppercase tracking-[0.12em] text-ink/40">{label}</p>
      <p className="mt-2 font-display text-3xl tracking-tight tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-ink/45">{hint}</p>
    </div>
  );
}

function Legend({ keys, extra }: { keys: StackKey[]; extra?: string }) {
  return (
    <div className="mb-3 flex flex-wrap gap-4 text-[11px] text-ink/55">
      {keys.map((k) => (
        <p key={k.key} className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm" style={{ background: k.color }} />
          {k.label}
        </p>
      ))}
      {extra ? (
        <p className="flex items-center gap-1.5">
          <span className="h-px w-3 bg-ink" />
          {extra}
        </p>
      ) : null}
    </div>
  );
}

function Order({ on, label, detail }: { on: boolean; label: string; detail: string }) {
  return (
    <li className="flex gap-2">
      <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${on ? "bg-moss desk-pulse" : "bg-ink/20"}`} />
      <span>
        <span className="block text-[13px]">{label}</span>
        <span className="block text-[11px] text-ink/45">{detail}</span>
      </span>
    </li>
  );
}

function Panel({ title, caption, children }: { title: string; caption: string; children: ReactNode }) {
  return (
    <div className="desk-card rise-in overflow-hidden">
      <div className="px-5 py-4">
        <h2 className="font-display text-lg tracking-tight">{title}</h2>
        <p className="mt-1 text-xs leading-5 text-ink/45">{caption}</p>
      </div>
      <div className="border-t border-ink/5">{children}</div>
    </div>
  );
}
