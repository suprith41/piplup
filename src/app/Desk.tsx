"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnalyticsBoard, PreventBoard } from "@/app/Insights";
import type { DeskEvent, IngressEvent, QueueItem } from "@/lib/autopilot/types";
import { DEMO_INBOXES } from "@/lib/email/recipients";
import { EUREKA } from "@/lib/merchant/eureka";
import { formatINR } from "@/lib/recovery/taxonomy";

type Tab = "desk" | "students" | "promises" | "halted" | "analytics" | "prevent";
type Seat = "pending" | "hot" | "recovered" | "parked" | "stopped";

const NIGHT_SNAP = "piplup-desk-night";

type NightSnap = {
  tape: string;
  cursor: number;
  total: number;
  ingress: IngressEvent[];
  feed: DeskEvent[];
  byId: Record<string, DeskEvent>;
  done: boolean;
};

let memoryNight: NightSnap | null = null;

function readStore(): string | null {
  try {
    return localStorage.getItem(NIGHT_SNAP) ?? sessionStorage.getItem(NIGHT_SNAP);
  } catch {
    return null;
  }
}

function loadNight(): NightSnap | null {
  if (memoryNight) return memoryNight;
  try {
    const raw = readStore();
    memoryNight = raw ? (JSON.parse(raw) as NightSnap) : null;
    return memoryNight;
  } catch {
    return null;
  }
}

function saveNight(snap: NightSnap) {
  memoryNight = snap;
  const raw = JSON.stringify(snap);
  try {
    localStorage.setItem(NIGHT_SNAP, raw);
  } catch {
    try {
      sessionStorage.setItem(NIGHT_SNAP, raw);
    } catch {
      /* quota */
    }
  }
}

function clearNight() {
  memoryNight = null;
  try {
    localStorage.removeItem(NIGHT_SNAP);
    sessionStorage.removeItem(NIGHT_SNAP);
  } catch {
    /* private mode */
  }
}

type Boot = {
  merchant: typeof EUREKA;
  razorpay: { configured: boolean; testMode: boolean };
  mail: { configured: boolean };
  groq: { configured: boolean; model: string };
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
  const [seen, setSeen] = useState<Record<Tab, boolean>>({
    desk: true,
    students: false,
    promises: false,
    halted: false,
    analytics: false,
    prevent: false,
  });

  function openTab(next: Tab) {
    setTab(next);
    setSeen((prev) => (prev[next] ? prev : { ...prev, [next]: true }));
  }
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
  const [ready, setReady] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const started = useRef(false);
  const restored = useRef(false);
  const pending = useRef<StreamMessage[]>([]);
  const raf = useRef(0);
  const snapshot = useRef<NightSnap>({
    tape: "Razorpay has not posted tonight yet.",
    cursor: 0,
    total: 0,
    ingress: [],
    feed: [],
    byId: {},
    done: false,
  });

  useLayoutEffect(() => {
    const snap = loadNight();
    if (snap && snap.feed.length > 0) {
      restored.current = true;
      started.current = true;
      snapshot.current = snap;
      saveNight(snap);
      setTape(snap.tape);
      setCursor(snap.cursor);
      setTotal(snap.total);
      setIngress(snap.ingress);
      setFeed(snap.feed);
      setById(snap.byId);
      setDone(snap.done);
      setRunning(false);
    }
    setReady(true);
  }, []);

  useEffect(() => {
    void fetch("/api/desk")
      .then((r) => r.json())
      .then(setBoot);
  }, []);

  useEffect(() => {
    if (!boot) return;
    let cancelled = false;

    async function pullPaid() {
      const res = await fetch("/api/ledger");
      if (!res.ok || cancelled) return;
      const data = (await res.json()) as { paidCaseIds?: string[] };
      const paid = data.paidCaseIds ?? [];
      if (paid.length === 0) return;
      setById((prev) => {
        const next = { ...prev };
        let changed = false;
        for (const id of paid) {
          const existing = next[id];
          if (!existing || existing.recovered) continue;
          next[id] = {
            ...existing,
            recovered: true,
            stopped: false,
            action: "Payment Link paid. Case closed.",
          };
          changed = true;
        }
        return changed ? next : prev;
      });
    }

    void pullPaid();
    const id = window.setInterval(() => void pullPaid(), 4000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [boot]);

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
    if (!ready || !boot || restored.current || started.current) return;
    started.current = true;
    void runNight();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, boot]);

  useEffect(() => {
    return () => {
      abort.current?.abort();
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, []);

  function persist(partial: Partial<NightSnap>) {
    snapshot.current = { ...snapshot.current, ...partial };
    if (partial.done || (partial.cursor ?? 0) % 8 === 0) {
      saveNight(snapshot.current);
    }
  }

  function applyMessage(payload: StreamMessage) {
    if (payload.type === "hello") {
      const tape = `${payload.merchant} · ${payload.cycle} · ${payload.operator} has the desk. ${payload.cases} AutoPays incoming.`;
      setTotal(payload.cases);
      setTape(tape);
      persist({ total: payload.cases, tape });
      return;
    }
    if (payload.type === "ingress") {
      setHotId(payload.caseId);
      setIngress((prev) => {
        const next = [payload, ...prev].slice(0, 40);
        persist({ ingress: next });
        return next;
      });
      if (payload.live) {
        const tape = `${payload.name} just failed on a live rail. Piplup is talking to Razorpay.`;
        setTape(tape);
        persist({ tape });
      }
      return;
    }
    if (payload.type === "decision") {
      const event = payload.event;
      const tape = `${event.name} · ${event.action}`;
      setFeed((prev) => {
        const next = [event, ...prev];
        persist({ feed: next, cursor: payload.index, total: payload.total, tape });
        return next;
      });
      setById((prev) => {
        const next = { ...prev, [event.caseId]: event };
        persist({ byId: next });
        return next;
      });
      setCursor(payload.index);
      setTotal(payload.total);
      setHotId(null);
      setTape(tape);
      return;
    }
    if (payload.type === "done") {
      setRunning(false);
      setDone(true);
      setHotId(null);
      persist({ done: true });
      saveNight({ ...snapshot.current, done: true });
      return;
    }
    if (payload.type === "error") {
      setError(payload.message);
      setRunning(false);
    }
  }

  function queueMessage(payload: StreamMessage) {
    pending.current.push(payload);
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = 0;
      const batch = pending.current;
      pending.current = [];
      for (const item of batch) applyMessage(item);
    });
  }

  async function runNight() {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    pending.current = [];
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = 0;
    clearNight();
    snapshot.current = {
      tape: "Listening for Razorpay. Failures will land on this desk.",
      cursor: 0,
      total: 0,
      ingress: [],
      feed: [],
      byId: {},
      done: false,
    };

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
          queueMessage(JSON.parse(line.slice(6)) as StreamMessage);
        }
      }
      if (!controller.signal.aborted) setRunning(false);
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
    const tape = "Ada paused the night. Queue is frozen where it is.";
    setTape(tape);
    persist({ tape, done: true });
    saveNight({ ...snapshot.current, tape, done: true });
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
          ? "Mailed Sam, Elon, and Dario once."
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
    <div className="flex min-h-screen bg-white text-[#02042b]">
      <aside className="sticky top-0 flex h-screen w-[232px] shrink-0 flex-col border-r border-[#e6e9ee] bg-white">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <span className="grid h-8 w-8 place-items-center rounded bg-[#305eff] text-[13px] font-extrabold text-white">E</span>
          <div>
            <p className="text-[13px] font-extrabold leading-none">{EUREKA.name}</p>
            <p className="mt-1 text-[11px] text-[#6c737f]">{EUREKA.city}</p>
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 px-3">
          <NavBtn active={tab === "desk"} onClick={() => openTab("desk")}>
            Desk
          </NavBtn>
          <NavBtn active={tab === "students"} onClick={() => openTab("students")}>
            Students
          </NavBtn>
          <NavBtn active={tab === "promises"} onClick={() => openTab("promises")}>
            Promises
          </NavBtn>
          <NavBtn active={tab === "halted"} onClick={() => openTab("halted")}>
            Stopped{stopped ? ` · ${stopped}` : ""}
          </NavBtn>
          <NavBtn active={tab === "analytics"} onClick={() => openTab("analytics")}>
            Analytics
          </NavBtn>
          <NavBtn active={tab === "prevent"} onClick={() => openTab("prevent")}>
            Prevent
          </NavBtn>
        </nav>
        <div className="border-t border-[#e6e9ee] px-5 py-4">
          <p className="text-[11px] font-semibold text-[#305eff]">TEST MODE</p>
          <p className="mt-1 text-[11px] leading-4 text-[#6c737f]">UPI AutoPay · eNACH · cards</p>
          <Link className="mt-3 inline-block text-[12px] font-semibold text-[#305eff]" href="/lab">
            Developer lab →
          </Link>
        </div>
      </aside>

      <div className="min-w-0 flex-1 bg-white">
        <header className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b border-[#e6e9ee] bg-white px-6 py-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#6c737f]">
              {EUREKA.cohort} · {EUREKA.cycle}
            </p>
            <p className="text-sm font-semibold">
              {EUREKA.operator}
              {boot?.groq?.configured ? " · Groq" : " · rules"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <p className="mono text-xs tabular-nums text-[#6c737f]">{clock || "—"} IST</p>
            <span className={`text-xs font-semibold ${running ? "text-[#0d9f6e]" : "text-[#6c737f]"}`}>
              <span className={running ? "desk-pulse" : ""}>{running ? "●" : "○"}</span>{" "}
              {running ? "Live" : done ? "Closed" : "Idle"}
            </span>
            {running ? (
              <button type="button" className="rzp-btn-ghost px-3 py-1.5" onClick={stopNight}>
                Pause
              </button>
            ) : (
              <button
                type="button"
                disabled={!boot}
                onClick={() => {
                  restored.current = false;
                  started.current = true;
                  void runNight();
                }}
                className="rzp-btn-ghost px-3 py-1.5 disabled:opacity-40"
              >
                Replay
              </button>
            )}
            <button
              type="button"
              disabled={!boot?.mail.configured || mailing}
              onClick={() => void sendEmails()}
              className="rzp-btn px-4 py-1.5 disabled:opacity-40"
            >
              {mailing ? "Sending…" : "Send emails"}
            </button>
          </div>
        </header>

        <main className="px-6 py-6">

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
            onVoice={(event) => {
              setById((prev) => ({ ...prev, [event.caseId]: event }));
              setFeed((prev) => [event, ...prev]);
              setTape(`${event.name} · ${event.action}`);
            }}
            onVoiceNote={setTape}
          />
        ) : null}
        {tab === "students" ? <StudentsTable queue={boot?.queue ?? []} byId={byId} hotId={hotId} /> : null}
        {tab === "promises" ? <PromisesBoard queue={boot?.queue ?? []} byId={byId} /> : null}
        {tab === "halted" ? <HaltedList feed={feed.filter((e) => e.stopped)} /> : null}
        {seen.analytics ? (
          <div hidden={tab !== "analytics"}>
            <AnalyticsBoard />
          </div>
        ) : null}
        {seen.prevent ? (
          <div hidden={tab !== "prevent"}>
            <PreventBoard />
          </div>
        ) : null}
        {error ? <p className="mt-4 text-sm text-[#e5533c]">{error}</p> : null}
        </main>
      </div>
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
      className={`w-full rounded px-3 py-2 text-left text-[13px] ${active ? "bg-[#eef2ff] font-semibold text-[#305eff]" : "font-medium text-[#4f566b] hover:bg-[#f6f7f9] hover:text-[#02042b]"}`}
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
  onVoice: (event: DeskEvent) => void;
  onVoiceNote: (note: string) => void;
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
    onVoice,
    onVoiceNote,
  } = props;

  return (
    <div className="mt-8 space-y-8">
      <section className="min-h-[88px]">
        <p className="line-clamp-2 max-w-2xl font-display text-[32px] leading-10 text-[#02042b]">
          {tape}
        </p>
        <p className="mt-2 text-sm text-ink/50">
          {running
            ? `${cursor} of ${total} handled.`
            : done
              ? `Night closed. Recovered ${formatINR(recoveredPaise)} vs T+3.`
              : "Autopilot starts when this page loads."}
        </p>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Recovered tonight" value={formatINR(recoveredPaise)} hint={`${recovered} students`} />
        <Kpi label="At risk" value={boot?.kpis.atRisk ?? "—"} hint={`${boot?.kpis.cases ?? 0} seats`} />
        <Kpi label="Lift vs T+3" value={boot?.kpis.lift ?? "—"} hint={`T+3 keeps ${boot?.kpis.t3 ?? "—"}`} />
        <Kpi label="Left alone" value={String(stopped)} hint={`${boot?.kpis.slotsSaved ?? "—"} slots saved`} />
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        {liveStudents.map((row) => (
          <LiveCard
            key={row.id}
            row={row}
            event={byId[row.id]}
            hot={hotId === row.id}
            mail={boot?.mail.configured ?? false}
            onVoice={onVoice}
            onVoiceNote={onVoiceNote}
          />
        ))}
      </section>
      {mailNote ? <p className="text-sm text-moss">{mailNote}</p> : null}

      <section className="grid gap-4 xl:grid-cols-2">
        <Tape title="Incoming" caption="Razorpay" empty="Waiting for the first failed AutoPay.">
          {ingress.map((row) => (
            <li key={`${row.caseId}-${row.at}`} className="border-t border-ink/5 px-4 py-3 first:border-t-0">
              <p className="text-xs text-ink/40">
                {row.source}
                {row.live ? " · live" : ""}
              </p>
              <p className="mt-0.5 text-sm">
                {row.name}{" "}
                <span className="text-neutral-400">
                  {row.amount} · {row.decline.replaceAll("_", " ")} · {row.bank}
                </span>
              </p>
            </li>
          ))}
        </Tape>
        <Tape title="Piplup" caption="Decisions" empty="Decisions land here.">
          {feed.map((row) => (
            <li key={`${row.caseId}-${row.at}`} className="border-t border-ink/5 px-4 py-3 first:border-t-0">
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

      <section className="desk-card p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="font-display text-base tracking-tight">September cohort</h2>
          <p className="text-xs text-ink/40">
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
        <div className="mt-4 flex flex-wrap gap-4 text-xs text-ink/50">
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
  onVoice,
  onVoiceNote,
}: {
  row: QueueItem;
  event?: DeskEvent;
  hot: boolean;
  mail: boolean;
  onVoice: (event: DeskEvent) => void;
  onVoiceNote: (note: string) => void;
}) {
  return (
    <article className={`desk-card p-4 transition-shadow duration-200 ${hot ? "shadow-[0_0_0_1px_#305eff]" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-moss">Live</p>
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
      {event?.emailed ? <p className="mt-2 text-xs text-moss">Mailed from Eureka Labs.</p> : null}
      {event?.emailError ? <p className="mt-2 text-xs text-orange-700">{event.emailError}</p> : null}
      {mail && !event?.emailed ? <p className="mt-2 text-xs text-neutral-400">Mail only on Send emails.</p> : null}
      {event?.linkUrl ? (
        <a className="mt-3 inline-block text-xs text-moss underline" href={event.linkUrl} target="_blank" rel="noreferrer">
          {event.linkUrl}
        </a>
      ) : null}
      <CallButton caseId={row.id} name={row.name} onVoice={onVoice} onVoiceNote={onVoiceNote} />
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
    <div className="desk-card">
      <div className="flex items-baseline justify-between px-4 py-3">
        <h2 className="font-display text-base tracking-tight">{title}</h2>
        <p className="text-[11px] text-ink/40">{caption}</p>
      </div>
      <ul className="desk-scroll max-h-[360px] overflow-y-auto border-t border-ink/5">
        {emptyish ? <li className="px-4 py-12 text-center text-sm text-ink/40">{empty}</li> : children}
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
    <div className="mt-8 overflow-hidden desk-card">
      <div className="px-5 py-4">
        <h2 className="font-display text-lg tracking-tight">September roster</h2>
      </div>
      <div className="desk-scroll max-h-[70vh] overflow-auto">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-white text-[11px] text-ink/40">
            <tr>
              <th className="px-5 py-2 font-normal">Student</th>
              <th className="px-3 py-2 font-normal">Course</th>
              <th className="px-3 py-2 font-normal">Bank</th>
              <th className="px-3 py-2 font-normal">Fail</th>
              <th className="px-3 py-2 font-normal">Piplup</th>
              <th className="px-3 py-2 font-normal">NPCI</th>
              <th className="px-5 py-2 font-normal">Seat</th>
            </tr>
          </thead>
          <tbody>
            {queue.map((row) => {
              const event = byId[row.id];
              const hot = hotId === row.id;
              return (
                <tr key={row.id} className="border-t border-ink/5">
                  <td className="px-5 py-2.5">
                    {row.name}
                    {row.live ? <span className="ml-2 text-[10px] text-moss">LIVE</span> : null}
                  </td>
                  <td className="px-3 py-2.5 text-neutral-500">{row.course}</td>
                  <td className="px-3 py-2.5 text-neutral-500">{row.bank}</td>
                  <td className="px-3 py-2.5 text-neutral-500">{row.decline.replaceAll("_", " ")}</td>
                  <td className="px-3 py-2.5 text-neutral-500">{event?.action ?? (hot ? "on the wire" : "—")}</td>
                  <td className="px-3 py-2.5 text-[11px] text-neutral-400">{npciCell(event)}</td>
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

function PromisesBoard({ queue, byId }: { queue: QueueItem[]; byId: Record<string, DeskEvent> }) {
  const rows = queue
    .map((row) => {
      const event = byId[row.id];
      const status = promiseStatus(row, event);
      if (!status) return null;
      return {
        row,
        event,
        status,
        day: event?.promiseToPayDay ?? row.promiseToPayDay,
        quote: event?.inbound ?? row.inbound,
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));

  return (
    <div className="mt-8 desk-card p-5">
      <h2 className="font-display text-lg tracking-tight">Promise to pay</h2>
      <p className="mt-2 max-w-xl text-sm leading-6 text-ink/55">
        Inbound replies become a date, a freeze, or a broken promise. Policy waits. It does not guess.
      </p>
      {rows.length === 0 ? (
        <p className="mt-8 text-sm text-neutral-400">Promises land here as the night runs, or after a live call.</p>
      ) : (
        <ul className="mt-6 divide-y divide-ink/5">
          {rows.map(({ row, event, status, day, quote }) => (
            <li key={row.id} className="py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm">
                  {row.name} <span className="text-neutral-400">{row.amount}</span>
                </p>
                <p className="text-[11px] text-neutral-500">{status.replaceAll("_", " ")}</p>
              </div>
              <p className="mt-1 text-xs leading-5 text-neutral-500">
                {status === "claimed_paid"
                  ? "Customer says already paid. Retries frozen."
                  : status === "honored"
                    ? `Paid after promising day ${day}.`
                    : status === "broken"
                      ? `Waited until day ${day}. Still open.`
                      : `Parked until day ${day}.`}
              </p>
              {quote ? <p className="mt-1 text-xs italic text-neutral-400">“{quote}”</p> : null}
              {event?.action ? <p className="mt-1 text-xs text-neutral-400">{event.action}</p> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function promiseStatus(row: QueueItem, event?: DeskEvent): "waiting" | "honored" | "broken" | "claimed_paid" | null {
  const claimed = row.claimedPaid || event?.claimedPaid;
  const day = event?.promiseToPayDay ?? row.promiseToPayDay;
  const promised = Boolean(day) || row.parsedIntent === "promise_to_pay" || event?.parsedIntent === "promise_to_pay";
  if (!claimed && !promised) return null;
  if (claimed) return "claimed_paid";
  if (event?.recovered) return "honored";
  if (row.live && event && !event.stopped) return "waiting";
  if (event && !event.recovered && !event.stopped) return "broken";
  return promised ? "waiting" : null;
}

function CallButton({
  caseId,
  name,
  onVoice,
  onVoiceNote,
}: {
  caseId: string;
  name: string;
  onVoice: (event: DeskEvent) => void;
  onVoiceNote: (note: string) => void;
}) {
  const [phase, setPhase] = useState<"idle" | "speaking" | "listening" | "busy">("idle");
  const [note, setNote] = useState<string | null>(null);

  function recognitionCtor() {
    return typeof window !== "undefined" ? window.SpeechRecognition || window.webkitSpeechRecognition : undefined;
  }

  async function submitTranscript(transcript: string) {
    const res = await fetch("/api/voice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caseId, transcript }),
    });
    const data = (await res.json()) as {
      ignored?: boolean;
      event?: DeskEvent | null;
      parsed?: { intent: string };
      error?: string;
    };
    if (!res.ok) throw new Error(data.error ?? "voice failed");
    if (data.ignored || !data.event) {
      setNote(`Heard “${transcript}” — too unclear to act.`);
      return;
    }
    onVoice(data.event);
    setNote(`Heard “${transcript}” → ${data.parsed?.intent.replaceAll("_", " ")}`);
  }

  async function listenAndSubmit() {
    const Ctor = recognitionCtor();
    if (!Ctor) {
      setNote("Speech recognition needs Chrome or Edge.");
      return;
    }
    setPhase("listening");
    onVoiceNote(`Listening to ${name}…`);
    const transcript = await listenOnce(Ctor);
    if (!transcript) {
      setNote("Didn't catch that. Tap Reply and speak.");
      setPhase("idle");
      return;
    }
    setPhase("busy");
    await submitTranscript(transcript);
    setPhase("idle");
  }

  async function call() {
    if (!window.speechSynthesis) {
      setNote("This browser has no speech synthesis. Use Chrome or Edge.");
      return;
    }

    setPhase("busy");
    setNote(null);
    try {
      const preview = await fetch(`/api/voice?caseId=${caseId}`).then((r) => r.json() as Promise<{ spoken?: string; error?: string }>);
      const line = preview.spoken ?? "";
      if (!line) {
        setNote(preview.error ?? "Nothing to say.");
        setPhase("idle");
        return;
      }

      setPhase("speaking");
      onVoiceNote(`Ada calling ${name}…`);
      await speakHinglish(line);
      await listenAndSubmit();
    } catch (err) {
      setNote(err instanceof Error ? err.message : "voice failed");
      setPhase("idle");
    }
  }

  const label = phase === "speaking" ? "Speaking…" : phase === "listening" ? "Listening…" : phase === "busy" ? "Calling…" : "Call";

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={phase !== "idle"}
        onClick={() => void call()}
        className="rounded px-3 py-1.5 text-xs font-semibold text-[#305eff] disabled:opacity-40"
      >
        {label}
      </button>
      <button
        type="button"
        disabled={phase !== "idle"}
        onClick={() => void listenAndSubmit().catch((err) => setNote(err instanceof Error ? err.message : "voice failed"))}
        className="rounded px-3 py-1.5 text-xs font-semibold text-[#305eff] disabled:opacity-40"
      >
        Reply
      </button>
      {note ? <p className="basis-full text-xs text-neutral-500">{note}</p> : null}
    </div>
  );
}

function speakHinglish(text: string): Promise<void> {
  return new Promise((resolve) => {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "hi-IN";
    const hindi = window.speechSynthesis.getVoices().find((voice) => voice.lang.toLowerCase().startsWith("hi"));
    if (hindi) utterance.voice = hindi;
    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();
    window.speechSynthesis.speak(utterance);
  });
}

function listenOnce(Ctor: SpeechRecognitionConstructor): Promise<string> {
  return new Promise((resolve) => {
    const rec = new Ctor();
    rec.lang = "hi-IN";
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    let settled = false;
    const finish = (text: string) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      try {
        rec.stop();
      } catch {
        /* already stopped */
      }
      resolve(text);
    };
    const timer = window.setTimeout(() => finish(""), 8000);
    rec.onresult = (event) => {
      const said = event.results[0]?.[0]?.transcript ?? "";
      finish(said);
    };
    rec.onerror = () => finish("");
    rec.start();
  });
}

type SpeechRecognitionConstructor = new () => {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

function HaltedList({ feed }: { feed: DeskEvent[] }) {
  return (
    <div className="mt-8 desk-card p-5">
      <h2 className="font-display text-lg tracking-tight">Stopped on purpose</h2>
      <p className="mt-2 max-w-xl text-sm leading-6 text-ink/55">
        Disputes, already-paid claims and stop-texting-me get neither a debit nor a message. Calendar T+3 still hammers
        them. Revoked mandates are not here — they keep their NPCI slots and get a re-auth ask instead.
      </p>
      {feed.length === 0 ? (
        <p className="mt-8 text-sm text-neutral-400">Terminal cases collect here as the night runs.</p>
      ) : (
        <ul className="mt-6 divide-y divide-ink/5">
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
    <div className="desk-card p-4">
      <p className="text-[11px] uppercase tracking-[0.12em] text-ink/40">{label}</p>
      <p className="mt-2 font-display text-3xl tracking-tight tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-ink/45">{hint}</p>
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
  if (e.recovered) return "text-moss";
  return "text-rust";
}

/** NPCI allows 1 original debit plus 3 retries. This column is what we spent of it. */
function npciCell(e?: DeskEvent): string {
  if (!e) return "—";
  return e.npciSlotsUsed > 0 ? `−${e.npciSlotsUsed} · ${e.npciSlotsLeftAfter} left` : "0 spent";
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
  if (seat === "hot") return `bg-[#305eff] ${ring}`;
  if (seat === "recovered") return `bg-moss ${ring}`;
  if (seat === "stopped") return `bg-[#c5d0de] ${ring}`;
  if (seat === "parked") return `bg-[#f5a623] ${ring}`;
  return `bg-[#e4ebf3] ${ring}`;
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
