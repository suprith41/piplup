"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { DeskEvent, IngressEvent, QueueItem } from "@/lib/autopilot/types";
import { EUREKA } from "@/lib/merchant/eureka";
import { formatINR } from "@/lib/recovery/taxonomy";

type Tab = "desk" | "students" | "halted";
type Seat = "pending" | "hot" | "recovered" | "parked" | "stopped";

type Boot = {
  merchant: typeof EUREKA;
  razorpay: { configured: boolean; testMode: boolean };
  mail: { configured: boolean };
  kpis: {
    atRisk: string;
    recovered: string;
    t3: string;
    lift: string;
    churnAvoided: number;
    slotsSaved: number;
    cases: number;
  };
  queue: QueueItem[];
};

const NOTIFY_KEY = "piplup.eureka.notified";

export function Desk() {
  const [boot, setBoot] = useState<Boot | null>(null);
  const [tab, setTab] = useState<Tab>("desk");
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [total, setTotal] = useState(0);
  const [ingress, setIngress] = useState<IngressEvent[]>([]);
  const [feed, setFeed] = useState<DeskEvent[]>([]);
  const [byId, setById] = useState<Record<string, DeskEvent>>({});
  const [hotId, setHotId] = useState<string | null>(null);
  const [tape, setTape] = useState("Razorpay has not posted tonight yet.");
  const [clock, setClock] = useState("");
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const started = useRef(false);

  useEffect(() => {
    void fetch("/api/desk")
      .then((r) => r.json())
      .then(setBoot);
  }, []);

  useEffect(() => {
    const tick = () =>
      setClock(
        new Intl.DateTimeFormat("en-IN", {
          timeZone: "Asia/Kolkata",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        }).format(new Date()),
      );
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!boot) return;
    const notify = !sessionStorage.getItem(NOTIFY_KEY);
    // Delay so React Strict Mode's fake unmount does not start two nights.
    const timer = window.setTimeout(() => {
      if (started.current) return;
      started.current = true;
      void runNight(notify);
    }, 80);
    return () => window.clearTimeout(timer);
    // runNight is stable enough: it only uses setState and refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boot]);

  useEffect(() => {
    return () => abort.current?.abort();
  }, []);

  function applyMessage(payload: StreamMessage) {
    if (payload.type === "hello") {
      setTotal(payload.cases);
      setTape(
        `${payload.merchant} · ${payload.cycle} · ${payload.operator} has the desk. ${payload.cases} AutoPays incoming.`,
      );
      return;
    }
    if (payload.type === "ingress") {
      setHotId(payload.caseId);
      setIngress((prev) => [payload, ...prev].slice(0, 40));
      setTape(
        payload.live
          ? `${payload.name} just failed on a live rail. Piplup is talking to Razorpay.`
          : `${payload.name} · ${payload.decline.replaceAll("_", " ")} · ${payload.course}`,
      );
      return;
    }
    if (payload.type === "decision") {
      const event = payload.event;
      setFeed((prev) => [event, ...prev]);
      setById((prev) => ({ ...prev, [event.caseId]: event }));
      setCursor(payload.index);
      setTotal(payload.total);
      setHotId(null);
      setTape(`${event.name} · ${event.action}`);
      return;
    }
    if (payload.type === "done") {
      setRunning(false);
      setDone(true);
      setHotId(null);
      return;
    }
    if (payload.type === "error") {
      setError(payload.message);
      setRunning(false);
    }
  }

  async function runNight(notify: boolean) {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;

    setRunning(true);
    setDone(false);
    setError(null);
    setCursor(0);
    setIngress([]);
    setFeed([]);
    setById({});
    setHotId(null);
    setTape("Listening for Razorpay. Failures will land on this desk.");
    if (notify) sessionStorage.setItem(NOTIFY_KEY, "1");

    try {
      const res = await fetch(`/api/desk/stream?live=1&notify=${notify ? "1" : "0"}`, {
        signal: controller.signal,
        headers: { Accept: "text/event-stream" },
      });
      if (!res.ok || !res.body) throw new Error("Desk stream failed");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done: finished, value } = await reader.read();
        if (finished) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          const line = part.split("\n").find((row) => row.startsWith("data: "));
          if (!line) continue;
          applyMessage(JSON.parse(line.slice(6)) as StreamMessage);
        }
      }
      setRunning(false);
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : "autopilot stopped");
      setRunning(false);
    }
  }

  function stopNight() {
    abort.current?.abort();
    abort.current = null;
    setRunning(false);
    setTape("Mira paused the night. Queue is frozen where it is.");
  }

  const recoveredPaise = useMemo(
    () => Object.values(byId).reduce((sum, e) => sum + (e.recovered ? e.amountPaise : 0), 0),
    [byId],
  );
  const recovered = Object.values(byId).filter((e) => e.recovered).length;
  const stopped = Object.values(byId).filter((e) => e.stopped).length;
  const liveHits = Object.values(byId).filter((e) => e.live && (e.linkUrl || e.emailed)).length;
  const liveStudents = boot?.queue.filter((row) => row.live) ?? [];
  const mix = mixCounts(boot?.queue ?? [], byId);

  return (
    <div className="min-h-screen bg-[#07090d] text-[#e8e4d9]">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 px-5 py-4 lg:px-8">
        <div>
          <p className="mono text-[10px] uppercase tracking-[0.28em] text-white/35">
            {EUREKA.city} · {EUREKA.product}
          </p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight">{EUREKA.name}</h1>
          <p className="mt-0.5 text-xs text-white/45">
            {EUREKA.cohort} · {EUREKA.cycle} · {EUREKA.operator}, {EUREKA.operatorRole}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-5">
          <div className="text-right">
            <p className="mono text-lg tabular-nums text-white/80">{clock || "—"}</p>
            <p className="mono text-[10px] uppercase tracking-[0.2em] text-white/35">IST · billing night</p>
          </div>
          <span className={`mono text-[11px] uppercase tracking-wider ${running ? "text-[#3dba7a]" : done ? "text-white/40" : "text-white/35"}`}>
            <span className={running ? "desk-pulse" : ""}>{running ? "●" : done ? "○" : "○"}</span>{" "}
            {running ? "Piplup live" : done ? "night closed" : "idle"}
          </span>
          {running ? (
            <button type="button" className="rounded border border-white/15 px-3 py-1.5 text-xs" onClick={stopNight}>
              Pause
            </button>
          ) : (
            <button
              type="button"
              disabled={!boot}
              onClick={() => {
                started.current = true;
                void runNight(false);
              }}
              className="rounded bg-[#e8e4d9] px-4 py-1.5 text-xs font-medium text-[#07090d] disabled:opacity-40"
            >
              Replay tonight
            </button>
          )}
        </div>
      </header>

      <div className="grid min-h-[calc(100vh-73px)] lg:grid-cols-[200px_1fr]">
        <aside className="border-b border-white/10 px-3 py-5 lg:border-b-0 lg:border-r">
          <Nav tab={tab} onChange={setTab} halted={stopped} />
          <div className="mt-10 px-3">
            <p className="mono text-[10px] uppercase tracking-[0.22em] text-white/30">Powered by</p>
            <p className="mt-1 text-lg font-medium">Piplup</p>
            <p className="mt-1 text-[11px] leading-5 text-white/40">
              Types the fail. Grants in code. Mutates the attempt. The model never moves money.
            </p>
            <p className="mt-4">
              <Link className="mono text-[11px] text-white/35 underline" href="/lab">
                Internal lab
              </Link>
            </p>
          </div>
        </aside>

        <main className="px-5 py-6 lg:px-8">
          {tab === "desk" ? (
            <DeskFloor
              boot={boot}
              tape={tape}
              running={running}
              done={done}
              cursor={cursor}
              total={total || boot?.queue.length || 0}
              recoveredPaise={recoveredPaise}
              recovered={recovered}
              stopped={stopped}
              liveHits={liveHits}
              liveStudents={liveStudents}
              byId={byId}
              hotId={hotId}
              ingress={ingress}
              feed={feed}
              mix={mix}
              queue={boot?.queue ?? []}
            />
          ) : null}
          {tab === "students" ? <StudentsTable queue={boot?.queue ?? []} byId={byId} hotId={hotId} /> : null}
          {tab === "halted" ? <HaltedList feed={feed.filter((e) => e.stopped)} /> : null}
          {error ? <p className="mt-4 text-sm text-[#e06a4c]">{error}</p> : null}
        </main>
      </div>
    </div>
  );
}

function Nav({ tab, onChange, halted }: { tab: Tab; onChange: (t: Tab) => void; halted: number }) {
  const items: { id: Tab; label: string; hint?: string }[] = [
    { id: "desk", label: "Revenue desk" },
    { id: "students", label: "Students" },
    { id: "halted", label: "Stopped", hint: halted ? String(halted) : undefined },
  ];
  return (
    <nav className="space-y-1 text-sm">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onChange(item.id)}
          className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left ${
            tab === item.id ? "bg-white/10 text-[#e8e4d9]" : "text-white/40 hover:text-white/70"
          }`}
        >
          {item.label}
          {item.hint ? <span className="mono text-[10px] text-white/40">{item.hint}</span> : null}
        </button>
      ))}
    </nav>
  );
}

function DeskFloor(props: {
  boot: Boot | null;
  tape: string;
  running: boolean;
  done: boolean;
  cursor: number;
  total: number;
  recoveredPaise: number;
  recovered: number;
  stopped: number;
  liveHits: number;
  liveStudents: QueueItem[];
  byId: Record<string, DeskEvent>;
  hotId: string | null;
  ingress: IngressEvent[];
  feed: DeskEvent[];
  mix: { key: string; n: number }[];
  queue: QueueItem[];
}) {
  const {
    boot,
    tape,
    running,
    done,
    cursor,
    total,
    recoveredPaise,
    recovered,
    stopped,
    liveHits,
    liveStudents,
    byId,
    hotId,
    ingress,
    feed,
    mix,
    queue,
  } = props;

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-white/10 bg-[#10141c] px-5 py-5">
        <p className="mono text-[10px] uppercase tracking-[0.22em] text-white/35">Tonight on the wire</p>
        <p key={tape} className="desk-in mt-2 max-w-3xl text-xl font-medium leading-8 tracking-tight sm:text-2xl">
          {tape}
        </p>
        <p className="mt-3 mono text-[11px] text-white/35">
          {running
            ? `${cursor} of ${total} handled. Nobody at Eureka Labs is clicking.`
            : done
              ? `Closed. Piplup recovered ${formatINR(recoveredPaise)} that T+3 would have left on the table or hammered.`
              : "Autopilot starts the moment this desk loads."}
        </p>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Recovered tonight" value={formatINR(recoveredPaise)} hint={`${recovered} students back on the course`} />
        <Kpi label="At risk this cycle" value={boot?.kpis.atRisk ?? "—"} hint={`${boot?.kpis.cases ?? 0} September seats`} />
        <Kpi
          label="Vs calendar T+3"
          value={boot?.kpis.lift ?? "—"}
          hint={`T+3 keeps ${boot?.kpis.t3 ?? "—"}. Piplup forecast ${boot?.kpis.recovered ?? "—"}`}
        />
        <Kpi
          label="Left alone"
          value={String(stopped)}
          hint={`${boot?.kpis.slotsSaved ?? "—"} NPCI slots saved vs retrying everyone`}
        />
      </section>

      <section className="grid gap-3 lg:grid-cols-3">
        {liveStudents.map((row) => (
          <LiveCard key={row.id} row={row} event={byId[row.id]} hot={hotId === row.id} mail={boot?.mail.configured ?? false} />
        ))}
      </section>

      <section className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <Tape
          title="Incoming"
          caption="Razorpay webhooks"
          empty="Waiting for the first failed AutoPay."
        >
          {ingress.map((row) => (
            <li key={`${row.caseId}-${row.at}`} className="border-b border-white/5 px-4 py-3">
              <p className="mono text-[10px] uppercase tracking-wider text-white/35">
                {row.source}
                {row.live ? " · live" : ""}
              </p>
              <p className="mt-1 text-sm">
                {row.name}{" "}
                <span className="text-white/40">
                  {row.amount} · {row.decline.replaceAll("_", " ")}
                </span>
              </p>
              <p className="mt-0.5 text-xs text-white/40">{row.course}</p>
            </li>
          ))}
        </Tape>
        <Tape title="Piplup" caption="Grant · mutate · clock" empty="Decisions land here. The model does not mint links.">
          {feed.map((row) => (
            <li key={`${row.caseId}-${row.at}`} className="border-b border-white/5 px-4 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm">
                  {row.name}{" "}
                  <span className="text-white/40">{row.amount}</span>
                </p>
                <p className={`mono text-[10px] uppercase tracking-wider ${tone(row)}`}>{badge(row)}</p>
              </div>
              <p className="mt-1 text-xs leading-5 text-white/55">{row.action}</p>
              {row.inbound ? (
                <p className="mt-1 text-xs italic text-white/40">Student: “{row.inbound}”</p>
              ) : null}
            </li>
          ))}
        </Tape>
      </section>

      <section className="rounded-2xl border border-white/10 bg-[#10141c] p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="mono text-[10px] uppercase tracking-[0.22em] text-white/35">September cohort</p>
            <h2 className="mt-1 text-base font-semibold">110 seats · one cell each</h2>
          </div>
          <p className="mono text-[11px] text-white/35">
            {liveHits} live Razorpay {liveHits === 1 ? "hit" : "hits"} · {cursor}/{total} seen
          </p>
        </div>
        <div className="mt-4 flex flex-wrap gap-1.5">
          {queue.map((row) => (
            <span
              key={row.id}
              title={`${row.name} · ${row.decline}`}
              className={`h-3.5 w-3.5 rounded-[3px] ${seatClass(seatFor(row.id, byId, hotId), row.live)}`}
            />
          ))}
        </div>
        <div className="mt-5 flex flex-wrap gap-4">
          {mix.map((row) => (
            <p key={row.key} className="mono text-[11px] text-white/45">
              <span className="text-white/70">{row.n}</span> {row.key}
            </p>
          ))}
        </div>
      </section>
    </div>
  );
}

function LiveCard({
  row,
  event,
  hot,
  mail,
}: {
  row: QueueItem;
  event?: DeskEvent;
  hot: boolean;
  mail: boolean;
}) {
  return (
    <article className={`rounded-2xl border p-4 ${hot ? "border-[#3dba7a]/60 bg-[#3dba7a]/5" : "border-white/10 bg-[#10141c]"}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="mono text-[10px] uppercase tracking-[0.18em] text-[#3dba7a]">Live student</p>
          <h3 className="mt-1 text-lg font-semibold">{row.name}</h3>
          <p className="text-xs text-white/45">
            {row.course} · {row.amount}
          </p>
        </div>
        <p className={`mono text-[10px] uppercase ${event ? tone(event) : "text-white/35"}`}>
          {hot ? "talking to razorpay" : event ? badge(event) : "queued"}
        </p>
      </div>
      <p className="mt-3 text-sm leading-6 text-white/65">
        {event?.action ?? `${row.decline.replaceAll("_", " ")} on ${row.rail.replaceAll("_", " ")}. Waiting for Piplup.`}
      </p>
      {event?.emailed ? <p className="mt-2 text-xs text-[#3dba7a]">Mira mailed them from Eureka Labs.</p> : null}
      {event?.emailError ? <p className="mt-2 text-xs text-[#e06a4c]">{event.emailError}</p> : null}
      {!mail ? <p className="mt-2 text-xs text-white/35">SMTP off. Link still mints in test mode.</p> : null}
      {event?.linkUrl ? (
        <a className="mt-3 inline-block text-xs text-[#3dba7a] underline" href={event.linkUrl} target="_blank" rel="noreferrer">
          {event.linkUrl}
        </a>
      ) : null}
    </article>
  );
}

function Tape({
  title,
  caption,
  empty,
  children,
}: {
  title: string;
  caption: string;
  empty: string;
  children: ReactNode;
}) {
  const emptyish = Array.isArray(children) && children.length === 0;
  return (
    <div className="rounded-2xl border border-white/10 bg-[#10141c]">
      <div className="flex items-baseline justify-between border-b border-white/5 px-4 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        <p className="mono text-[10px] uppercase tracking-[0.18em] text-white/35">{caption}</p>
      </div>
      <ul className="desk-scroll max-h-[380px] overflow-y-auto">
        {emptyish ? <li className="px-4 py-14 text-center text-sm text-white/35">{empty}</li> : children}
      </ul>
    </div>
  );
}

function StudentsTable({
  queue,
  byId,
  hotId,
}: {
  queue: QueueItem[];
  byId: Record<string, DeskEvent>;
  hotId: string | null;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#10141c]">
      <div className="border-b border-white/5 px-5 py-4">
        <h2 className="text-base font-semibold">September roster</h2>
        <p className="mt-1 text-xs text-white/40">Statuses update as Piplup clears the night. No export button. This is the source.</p>
      </div>
      <div className="desk-scroll max-h-[70vh] overflow-auto">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-[#10141c] mono text-[10px] uppercase tracking-[0.16em] text-white/35">
            <tr>
              <th className="px-5 py-3 font-normal">Student</th>
              <th className="px-3 py-3 font-normal">Course</th>
              <th className="px-3 py-3 font-normal">Fail</th>
              <th className="px-3 py-3 font-normal">Piplup</th>
              <th className="px-5 py-3 font-normal">Seat</th>
            </tr>
          </thead>
          <tbody>
            {queue.map((row) => {
              const event = byId[row.id];
              const hot = hotId === row.id;
              return (
                <tr key={row.id} className="border-t border-white/5">
                  <td className="px-5 py-2.5">
                    {row.name}
                    {row.live ? <span className="ml-2 mono text-[10px] text-[#3dba7a]">LIVE</span> : null}
                  </td>
                  <td className="px-3 py-2.5 text-white/50">{row.course}</td>
                  <td className="px-3 py-2.5 text-white/50">{row.decline.replaceAll("_", " ")}</td>
                  <td className="px-3 py-2.5 text-white/55">{event?.action ?? (hot ? "on the wire" : "—")}</td>
                  <td className={`px-5 py-2.5 mono text-[11px] uppercase ${event ? tone(event) : "text-white/30"}`}>
                    {hot ? "hot" : event ? badge(event) : "waiting"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function HaltedList({ feed }: { feed: DeskEvent[] }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-[#10141c] p-5">
      <h2 className="text-base font-semibold">Stopped on purpose</h2>
      <p className="mt-2 max-w-xl text-sm leading-6 text-white/50">
        Revoked mandates, disputes, and stop-texting-me never get a retry. Calendar T+3 still hammers them. That is the
        product.
      </p>
      {feed.length === 0 ? (
        <p className="mt-10 text-sm text-white/35">Terminal cases will collect here as the night runs.</p>
      ) : (
        <ul className="mt-6 divide-y divide-white/5">
          {feed.map((row) => (
            <li key={row.caseId} className="py-3">
              <p className="text-sm">
                {row.name}{" "}
                <span className="text-white/40">
                  {row.amount} · {row.decline.replaceAll("_", " ")}
                </span>
              </p>
              <p className="mt-1 text-xs leading-5 text-white/50">{row.reason}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-[#10141c] p-4">
      <p className="mono text-[10px] uppercase tracking-[0.18em] text-white/35">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
      <p className="mt-1 text-xs leading-5 text-white/40">{hint}</p>
    </div>
  );
}

function badge(e: DeskEvent): string {
  if (e.stopped) return "stopped";
  if (e.recovered && e.clock === "sync_cascade") return "recovered now";
  if (e.recovered) return "recovered later";
  if (e.emailed) return "emailed";
  return "open";
}

function tone(e: DeskEvent): string {
  if (e.stopped) return "text-white/40";
  if (e.recovered) return "text-[#3dba7a]";
  return "text-[#e06a4c]";
}

function seatFor(id: string, byId: Record<string, DeskEvent>, hotId: string | null): Seat {
  if (hotId === id) return "hot";
  const e = byId[id];
  if (!e) return "pending";
  if (e.stopped) return "stopped";
  if (e.recovered) return "recovered";
  return "parked";
}

function seatClass(seat: Seat, live: boolean): string {
  const ring = live ? "ring-1 ring-white/70" : "";
  if (seat === "hot") return `bg-[#d4b483] desk-pulse ${ring}`;
  if (seat === "recovered") return `bg-[#3dba7a] ${ring}`;
  if (seat === "stopped") return `bg-white/20 ${ring}`;
  if (seat === "parked") return `bg-[#c28a2b] ${ring}`;
  return `bg-white/10 ${ring}`;
}

function mixCounts(queue: QueueItem[], byId: Record<string, DeskEvent>): { key: string; n: number }[] {
  const keys = ["technical", "financial", "instrument", "terminal", "behavioral", "uncollected"];
  return keys
    .map((key) => ({
      key,
      n: queue.filter((row) => {
        const klass = byId[row.id]?.klass ?? row.klass;
        return klass === key && Boolean(byId[row.id]);
      }).length,
    }))
    .filter((row) => row.n > 0);
}

type StreamMessage =
  | { type: "hello"; merchant: string; operator: string; cohort: string; cycle: string; cases: number }
  | IngressEvent
  | { type: "decision"; event: DeskEvent; index: number; total: number }
  | { type: "done"; cases: number }
  | { type: "error"; message: string };
