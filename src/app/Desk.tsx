"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { DeskEvent, IngressEvent, QueueItem } from "@/lib/autopilot/types";
import { DEMO_INBOXES } from "@/lib/email/recipients";
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
  const [mailing, setMailing] = useState(false);
  const [mailNote, setMailNote] = useState<string | null>(null);
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
    const timer = window.setTimeout(() => {
      if (started.current) return;
      started.current = true;
      void runNight();
    }, 80);
    return () => window.clearTimeout(timer);
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

  async function runNight() {
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

    try {
      const res = await fetch("/api/desk/stream?live=1", {
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

  async function sendEmails() {
    setMailing(true);
    setMailNote(null);
    setError(null);
    try {
      const res = await fetch("/api/remind", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emails: DEMO_INBOXES.map((row) => row.email) }),
      });
      const data = (await res.json()) as {
        error?: string;
        results?: Array<{ email: string; name: string; ok: boolean; error?: string }>;
      };
      if (!res.ok) throw new Error(data.error ?? "send failed");
      const results = data.results ?? [];
      const failed = results.filter((row) => !row.ok);
      setMailNote(
        failed.length === 0
          ? "Mailed Arjun, Nisha, and Riya once."
          : failed.map((row) => `${row.name}: ${row.error ?? "failed"}`).join(" · "),
      );
      setById((prev) => {
        const next = { ...prev };
        for (const inbox of DEMO_INBOXES) {
          const result = results.find((row) => row.email === inbox.email);
          const existing = next[inbox.caseId];
          if (!existing || !result) continue;
          next[inbox.caseId] = {
            ...existing,
            emailed: result.ok,
            emailError: result.ok ? undefined : result.error,
          };
        }
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "send failed");
    } finally {
      setMailing(false);
    }
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
    <div className="min-h-screen bg-[#f7f7f5] text-neutral-900">
      <header className="border-b border-neutral-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-4">
          <div className="flex flex-wrap items-center gap-8">
            <div>
              <p className="text-[11px] text-neutral-400">{EUREKA.city}</p>
              <h1 className="text-lg font-semibold tracking-tight">{EUREKA.name}</h1>
            </div>
            <nav className="flex gap-1 text-sm">
              <NavBtn active={tab === "desk"} onClick={() => setTab("desk")}>
                Desk
              </NavBtn>
              <NavBtn active={tab === "students"} onClick={() => setTab("students")}>
                Students
              </NavBtn>
              <NavBtn active={tab === "halted"} onClick={() => setTab("halted")}>
                Stopped{stopped ? ` ${stopped}` : ""}
              </NavBtn>
            </nav>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <p className="mono text-xs tabular-nums text-neutral-400">
              {clock || "—"} IST
            </p>
            <span className={`text-xs ${running ? "text-emerald-700" : "text-neutral-400"}`}>
              <span className={running ? "desk-pulse" : ""}>{running ? "●" : "○"}</span>{" "}
              {running ? "Live" : done ? "Closed" : "Idle"}
            </span>
            {running ? (
              <button type="button" className="rounded-md border border-neutral-200 px-3 py-1.5 text-sm" onClick={stopNight}>
                Pause
              </button>
            ) : (
              <button
                type="button"
                disabled={!boot}
                onClick={() => {
                  started.current = true;
                  void runNight();
                }}
                className="rounded-md border border-neutral-200 px-3 py-1.5 text-sm disabled:opacity-40"
              >
                Replay
              </button>
            )}
            <button
              type="button"
              disabled={!boot?.mail.configured || mailing}
              onClick={() => void sendEmails()}
              className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white disabled:opacity-40"
            >
              {mailing ? "Sending…" : "Send emails"}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        <p className="text-sm text-neutral-500">
          {EUREKA.cohort} · {EUREKA.cycle} · {EUREKA.operator} · Powered by Piplup
          <Link className="ml-3 text-neutral-400 underline decoration-neutral-300" href="/lab">
            Lab
          </Link>
        </p>

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
            mailNote={mailNote}
          />
        ) : null}
        {tab === "students" ? <StudentsTable queue={boot?.queue ?? []} byId={byId} hotId={hotId} /> : null}
        {tab === "halted" ? <HaltedList feed={feed.filter((e) => e.stopped)} /> : null}
        {error ? <p className="mt-4 text-sm text-orange-700">{error}</p> : null}
      </main>
    </div>
  );
}

function NavBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-3 py-1.5 ${active ? "bg-neutral-100 text-neutral-900" : "text-neutral-500 hover:text-neutral-800"}`}
    >
      {children}
    </button>
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
  mailNote: string | null;
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
    mailNote,
  } = props;

  return (
    <div className="mt-8 space-y-8">
      <section>
        <p key={tape} className="desk-in max-w-2xl text-2xl font-medium leading-8 tracking-tight">
          {tape}
        </p>
        <p className="mt-2 text-sm text-neutral-500">
          {running
            ? `${cursor} of ${total} handled.`
            : done
              ? `Night closed. Recovered ${formatINR(recoveredPaise)} vs T+3.`
              : "Autopilot starts when this page loads."}
        </p>
      </section>

      <section className="grid gap-px overflow-hidden rounded-xl border border-neutral-200 bg-neutral-200 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Recovered tonight" value={formatINR(recoveredPaise)} hint={`${recovered} students`} />
        <Kpi label="At risk" value={boot?.kpis.atRisk ?? "—"} hint={`${boot?.kpis.cases ?? 0} seats`} />
        <Kpi label="Lift vs T+3" value={boot?.kpis.lift ?? "—"} hint={`T+3 keeps ${boot?.kpis.t3 ?? "—"}`} />
        <Kpi label="Left alone" value={String(stopped)} hint={`${boot?.kpis.slotsSaved ?? "—"} slots saved`} />
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        {liveStudents.map((row) => (
          <LiveCard key={row.id} row={row} event={byId[row.id]} hot={hotId === row.id} mail={boot?.mail.configured ?? false} />
        ))}
      </section>
      {mailNote ? <p className="text-sm text-emerald-700">{mailNote}</p> : null}

      <section className="grid gap-4 xl:grid-cols-2">
        <Tape title="Incoming" caption="Razorpay" empty="Waiting for the first failed AutoPay.">
          {ingress.map((row) => (
            <li key={`${row.caseId}-${row.at}`} className="border-t border-neutral-100 px-4 py-3 first:border-t-0">
              <p className="text-xs text-neutral-400">
                {row.source}
                {row.live ? " · live" : ""}
              </p>
              <p className="mt-0.5 text-sm">
                {row.name}{" "}
                <span className="text-neutral-400">
                  {row.amount} · {row.decline.replaceAll("_", " ")}
                </span>
              </p>
            </li>
          ))}
        </Tape>
        <Tape title="Piplup" caption="Decisions" empty="Decisions land here.">
          {feed.map((row) => (
            <li key={`${row.caseId}-${row.at}`} className="border-t border-neutral-100 px-4 py-3 first:border-t-0">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm">
                  {row.name} <span className="text-neutral-400">{row.amount}</span>
                </p>
                <p className={`text-[11px] ${tone(row)}`}>{badge(row)}</p>
              </div>
              <p className="mt-1 text-xs leading-5 text-neutral-500">{row.action}</p>
            </li>
          ))}
        </Tape>
      </section>

      <section className="rounded-xl border border-neutral-200 bg-white p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-sm font-medium">September cohort</h2>
          <p className="text-xs text-neutral-400">
            {liveHits} live {liveHits === 1 ? "hit" : "hits"} · {cursor}/{total}
          </p>
        </div>
        <div className="mt-4 flex flex-wrap gap-1">
          {queue.map((row) => (
            <span
              key={row.id}
              title={`${row.name} · ${row.decline}`}
              className={`h-3 w-3 rounded-sm ${seatClass(seatFor(row.id, byId, hotId), row.live)}`}
            />
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-4 text-xs text-neutral-500">
          {mix.map((row) => (
            <p key={row.key}>
              <span className="text-neutral-800">{row.n}</span> {row.key}
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
    <article className={`rounded-xl border bg-white p-4 ${hot ? "border-emerald-400" : "border-neutral-200"}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[11px] text-emerald-700">Live</p>
          <h3 className="mt-0.5 text-base font-medium">{row.name}</h3>
          <p className="text-xs text-neutral-400">
            {row.course} · {row.amount}
          </p>
        </div>
        <p className={`text-[11px] ${event ? tone(event) : "text-neutral-400"}`}>
          {hot ? "Razorpay" : event ? badge(event) : "queued"}
        </p>
      </div>
      <p className="mt-3 text-sm leading-6 text-neutral-600">
        {event?.action ?? `${row.decline.replaceAll("_", " ")}. Waiting.`}
      </p>
      {event?.emailed ? <p className="mt-2 text-xs text-emerald-700">Mailed from Eureka Labs.</p> : null}
      {event?.emailError ? <p className="mt-2 text-xs text-orange-700">{event.emailError}</p> : null}
      {mail && !event?.emailed ? <p className="mt-2 text-xs text-neutral-400">Mail only on Send emails.</p> : null}
      {event?.linkUrl ? (
        <a className="mt-3 inline-block text-xs text-emerald-700 underline" href={event.linkUrl} target="_blank" rel="noreferrer">
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
    <div className="rounded-xl border border-neutral-200 bg-white">
      <div className="flex items-baseline justify-between px-4 py-3">
        <h2 className="text-sm font-medium">{title}</h2>
        <p className="text-[11px] text-neutral-400">{caption}</p>
      </div>
      <ul className="desk-scroll max-h-[360px] overflow-y-auto border-t border-neutral-100">
        {emptyish ? <li className="px-4 py-12 text-center text-sm text-neutral-400">{empty}</li> : children}
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
    <div className="mt-8 overflow-hidden rounded-xl border border-neutral-200 bg-white">
      <div className="px-5 py-4">
        <h2 className="text-base font-medium">September roster</h2>
      </div>
      <div className="desk-scroll max-h-[70vh] overflow-auto">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-white text-[11px] text-neutral-400">
            <tr>
              <th className="px-5 py-2 font-normal">Student</th>
              <th className="px-3 py-2 font-normal">Course</th>
              <th className="px-3 py-2 font-normal">Fail</th>
              <th className="px-3 py-2 font-normal">Piplup</th>
              <th className="px-5 py-2 font-normal">Seat</th>
            </tr>
          </thead>
          <tbody>
            {queue.map((row) => {
              const event = byId[row.id];
              const hot = hotId === row.id;
              return (
                <tr key={row.id} className="border-t border-neutral-100">
                  <td className="px-5 py-2.5">
                    {row.name}
                    {row.live ? <span className="ml-2 text-[10px] text-emerald-700">LIVE</span> : null}
                  </td>
                  <td className="px-3 py-2.5 text-neutral-500">{row.course}</td>
                  <td className="px-3 py-2.5 text-neutral-500">{row.decline.replaceAll("_", " ")}</td>
                  <td className="px-3 py-2.5 text-neutral-500">{event?.action ?? (hot ? "on the wire" : "—")}</td>
                  <td className={`px-5 py-2.5 text-[11px] ${event ? tone(event) : "text-neutral-300"}`}>
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
    <div className="mt-8 rounded-xl border border-neutral-200 bg-white p-5">
      <h2 className="text-base font-medium">Stopped on purpose</h2>
      <p className="mt-2 max-w-xl text-sm leading-6 text-neutral-500">
        Revoked mandates, disputes, and stop-texting-me never get a retry. Calendar T+3 still hammers them.
      </p>
      {feed.length === 0 ? (
        <p className="mt-8 text-sm text-neutral-400">Terminal cases collect here as the night runs.</p>
      ) : (
        <ul className="mt-6 divide-y divide-neutral-100">
          {feed.map((row) => (
            <li key={row.caseId} className="py-3">
              <p className="text-sm">
                {row.name}{" "}
                <span className="text-neutral-400">
                  {row.amount} · {row.decline.replaceAll("_", " ")}
                </span>
              </p>
              <p className="mt-1 text-xs leading-5 text-neutral-500">{row.reason}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="bg-white p-4">
      <p className="text-[11px] text-neutral-400">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-neutral-400">{hint}</p>
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
  if (e.stopped) return "text-neutral-400";
  if (e.recovered) return "text-emerald-700";
  return "text-orange-700";
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
  const ring = live ? "ring-1 ring-neutral-900" : "";
  if (seat === "hot") return `bg-amber-400 desk-pulse ${ring}`;
  if (seat === "recovered") return `bg-emerald-600 ${ring}`;
  if (seat === "stopped") return `bg-neutral-300 ${ring}`;
  if (seat === "parked") return `bg-amber-500 ${ring}`;
  return `bg-neutral-200 ${ring}`;
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
