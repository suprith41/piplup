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
  liveLinks?: Array<{ id: string; name: string; decline: string; mutation: string; shortUrl: string }>;
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
    const links = boot?.liveLinks;
    if (!links?.length) return;
    const urls = new Map(links.map((row) => [row.id, row.shortUrl]));
    const byIdNext = { ...snapshot.current.byId };
    let changed = false;
    for (const [id, url] of urls) {
      const existing = byIdNext[id];
      if (!existing || existing.linkUrl === url) continue;
      byIdNext[id] = { ...existing, linkUrl: url };
      changed = true;
    }
    const feedNext = snapshot.current.feed.map((event) => {
      const url = urls.get(event.caseId);
      if (!url || event.linkUrl === url) return event;
      changed = true;
      return { ...event, linkUrl: url };
    });
    if (!changed) return;
    snapshot.current = { ...snapshot.current, byId: byIdNext, feed: feedNext };
    saveNight(snapshot.current);
    setById(byIdNext);
    setFeed(feedNext);
  }, [boot]);

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
    const tape = "Paused. Queue is frozen where it is.";
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
    <div className="flex min-h-screen flex-col bg-canvas text-ink">
      <div className="test-mode-bar">Test mode</div>
      <div className="flex min-h-0 flex-1">
      <aside className="sticky top-0 hidden h-[calc(100vh-28px)] w-[240px] shrink-0 flex-col border-r border-[#e6eaf2] bg-white lg:flex">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <RzpMark />
          <div>
            <p className="text-[13px] font-extrabold leading-none tracking-tight">Piplup</p>
            <p className="mt-1 text-[11px] text-[#8c93a3]">Recovery desk</p>
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 px-3">
          <NavBtn active={tab === "desk"} icon={<IconDesk />} onClick={() => openTab("desk")}>
            Payments
          </NavBtn>
          <NavBtn active={tab === "students"} icon={<IconUsers />} onClick={() => openTab("students")}>
            Customers
          </NavBtn>
          <NavBtn active={tab === "promises"} icon={<IconPromise />} onClick={() => openTab("promises")}>
            Settlements
          </NavBtn>
          <NavBtn active={tab === "halted"} icon={<IconStop />} onClick={() => openTab("halted")}>
            Disputes{stopped ? ` · ${stopped}` : ""}
          </NavBtn>
          <NavBtn active={tab === "analytics"} icon={<IconChart />} onClick={() => openTab("analytics")}>
            Reports
          </NavBtn>
          <NavBtn active={tab === "prevent"} icon={<IconShield />} onClick={() => openTab("prevent")}>
            Smart Prevent
          </NavBtn>
        </nav>
        <div className="border-t border-[#e6eaf2] px-5 py-4">
          <p className="rzp-chip bg-[#fff4d6] text-[#8a5a00]">TEST MODE</p>
          <p className="mt-2 text-[11px] leading-4 text-[#8c93a3]">UPI AutoPay · eNACH · cards</p>
          <Link className="rzp-link mt-3 inline-block text-[12px]" href="/lab">
            Developer lab →
          </Link>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-10 border-b border-[#e6eaf2] bg-white/95 backdrop-blur-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2.5">
            <span className="lg:hidden">
              <RzpMark />
            </span>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8c93a3]">
                {EUREKA.name}
              </p>
              <p className="font-display text-[15px] leading-5">{EUREKA.city}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <p className="mono text-xs tabular-nums text-[#8c93a3]">{clock || "—"} IST</p>
            <span
              className={`rzp-chip ${
                running ? "bg-[#e8f8f0] text-[#007a4d]" : done ? "bg-[#eef1f8] text-[#5a6178]" : "bg-[#eef1f8] text-[#5a6178]"
              }`}
            >
              {running ? <span className="live-dot" /> : <span className="h-1.5 w-1.5 rounded-full bg-[#c5cad6]" />}
              {running ? "Live" : done ? "Closed" : "Idle"}
            </span>
            {running ? (
              <button type="button" className="rzp-btn-ghost px-3.5 py-2" onClick={stopNight}>
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
                className="rzp-btn-ghost px-3.5 py-2 disabled:opacity-40"
              >
                Replay
              </button>
            )}
            <button
              type="button"
              disabled={!boot?.mail.configured || mailing}
              onClick={() => void sendEmails()}
              className="rzp-btn px-4 py-2 disabled:opacity-40"
            >
              {mailing ? "Sending…" : "Send emails"}
            </button>
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-2 lg:hidden">
          <NavBtn active={tab === "desk"} icon={<IconDesk />} onClick={() => openTab("desk")} compact>
            Payments
          </NavBtn>
          <NavBtn active={tab === "students"} icon={<IconUsers />} onClick={() => openTab("students")} compact>
            Customers
          </NavBtn>
          <NavBtn active={tab === "promises"} icon={<IconPromise />} onClick={() => openTab("promises")} compact>
            Settlements
          </NavBtn>
          <NavBtn active={tab === "halted"} icon={<IconStop />} onClick={() => openTab("halted")} compact>
            Disputes{stopped ? ` · ${stopped}` : ""}
          </NavBtn>
          <NavBtn active={tab === "analytics"} icon={<IconChart />} onClick={() => openTab("analytics")} compact>
            Reports
          </NavBtn>
          <NavBtn active={tab === "prevent"} icon={<IconShield />} onClick={() => openTab("prevent")} compact>
            Prevent
          </NavBtn>
        </nav>
        </header>

        <main className="px-6 py-6">
        <PageTitle tab={tab} />

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
            liveLinks={boot?.liveLinks ?? []}
            mailNote={mailNote}
          />
        ) : null}
        {tab === "students" ? (
          <StudentsTable queue={boot?.queue ?? []} byId={byId} hotId={hotId} liveLinks={boot?.liveLinks ?? []} />
        ) : null}
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
        {error ? <p className="mt-4 text-sm text-rust">{error}</p> : null}
        </main>
      </div>
      </div>
    </div>
  );
}

const PAGE_COPY: Record<Tab, { title: string; caption: string }> = {
  desk: { title: "Payments", caption: "Failed AutoPays land here. Policy grants first." },
  students: { title: "Customers", caption: "September roster — every seat, bank, and next action." },
  promises: { title: "Settlements", caption: "Inbound replies become a date, a freeze, or a broken promise." },
  halted: { title: "Disputes", caption: "Cases we left alone on purpose. Calendar T+3 still hammers them." },
  analytics: { title: "Reports", caption: "The same book the desk is running, scored like Stripe’s KPI set." },
  prevent: { title: "Smart Prevent", caption: "Failures we can see coming — flagged three days out, zero NPCI slots." },
};

function PageTitle({ tab }: { tab: Tab }) {
  const copy = PAGE_COPY[tab];
  return (
    <div className="mb-5 rise-in">
      <h1 className="font-display text-[28px] leading-8 tracking-tight">{copy.title}</h1>
      <p className="mt-1 text-sm text-[#5a6178]">{copy.caption}</p>
    </div>
  );
}

function NavBtn({
  active,
  onClick,
  icon,
  children,
  compact = false,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  children: ReactNode;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative flex items-center gap-2 rounded-md px-3 py-2 text-left text-[13px] transition-colors duration-150 ease-blade ${
        compact ? "shrink-0 whitespace-nowrap" : "w-full"
      } ${
        active ? "bg-[#eef2ff] font-semibold text-rzp" : "font-medium text-[#5a6178] hover:bg-[#f4f6fb] hover:text-ink"
      }`}
    >
      {!compact && active ? <span className="absolute bottom-1.5 left-0 top-1.5 w-[3px] rounded-r bg-rzp" /> : null}
      <span className={active ? "text-rzp" : "text-[#8c93a3]"}>{icon}</span>
      {children}
    </button>
  );
}

function RzpMark() {
  return (
    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[7px] bg-rzp text-[15px] font-extrabold text-white">
      P
    </span>
  );
}

function IconDesk() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="1.5" y="1.5" width="5.5" height="5.5" rx="1.2" stroke="currentColor" strokeWidth="1.4" />
      <rect x="9" y="1.5" width="5.5" height="5.5" rx="1.2" stroke="currentColor" strokeWidth="1.4" />
      <rect x="1.5" y="9" width="5.5" height="5.5" rx="1.2" stroke="currentColor" strokeWidth="1.4" />
      <rect x="9" y="9" width="5.5" height="5.5" rx="1.2" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function IconUsers() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="6" cy="5" r="2.2" stroke="currentColor" strokeWidth="1.4" />
      <path d="M2.2 13c.4-2.2 2-3.4 3.8-3.4S9.4 10.8 9.8 13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="11.2" cy="5.2" r="1.8" stroke="currentColor" strokeWidth="1.4" />
      <path d="M13.8 13c-.3-1.6-1.3-2.6-2.6-2.8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function IconPromise() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="2" y="2.5" width="12" height="11" rx="1.6" stroke="currentColor" strokeWidth="1.4" />
      <path d="M2 6h12M5.5 1.5v2.5M10.5 1.5v2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function IconStop() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.4" />
      <path d="M4.2 4.2l7.6 7.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function IconChart() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M2 13h12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <rect x="3.2" y="7" width="2.2" height="4.2" rx="0.5" fill="currentColor" />
      <rect x="6.9" y="4.2" width="2.2" height="7" rx="0.5" fill="currentColor" />
      <rect x="10.6" y="5.6" width="2.2" height="5.6" rx="0.5" fill="currentColor" />
    </svg>
  );
}

function IconShield() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M8 2.2l5.2 1.8v4.4c0 3.1-2.1 5.2-5.2 6.2-3.1-1-5.2-3.1-5.2-6.2V4L8 2.2z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
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
  liveLinks: Array<{ id: string; name: string; decline: string; mutation: string; shortUrl: string }>;
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
    liveLinks,
    mailNote,
  } = props;

  return (
    <div className="space-y-5">
      <section className="desk-card overflow-hidden">
        <div className="flex items-start gap-3 border-l-[3px] border-rzp bg-[#eef2ff] px-4 py-3.5">
          {running ? <span className="live-dot mt-1.5 shrink-0" /> : <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-rzp" />}
          <div className="min-w-0">
            <p key={tape} className="tape-swap line-clamp-2 text-sm font-semibold leading-6 text-ink">
              {tape}
            </p>
            <p className="mt-0.5 text-xs text-[#5a6178]">
              {running
                ? `${cursor} of ${total} handled.`
                : done
                  ? `Night closed. Recovered ${formatINR(recoveredPaise)} vs T+3.`
                  : "Autopilot starts when this page loads."}
            </p>
          </div>
        </div>
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
          />
        ))}
      </section>

      {liveLinks.length > 0 ? (
        <section className="desk-card p-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h2 className="font-display text-base tracking-tight">Live Payment Links</h2>
            <p className="text-xs text-[#8c93a3]">{liveLinks.length} minted tonight</p>
          </div>
          <ul className="mt-3 divide-y divide-[#eef1f8]">
            {liveLinks.map((row) => (
              <li key={row.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2.5 text-sm">
                <p>
                  <span className="font-medium">{row.name}</span>{" "}
                  <span className="text-[#8c93a3]">
                    {row.id} · {row.decline.replaceAll("_", " ")}
                  </span>
                </p>
                <a className="rzp-link text-xs" href={row.shortUrl} target="_blank" rel="noreferrer">
                  {row.shortUrl}
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {mailNote ? <p className="text-sm font-medium text-moss">{mailNote}</p> : null}

      <section className="grid gap-4 xl:grid-cols-2">
        <Tape title="Incoming" caption="Razorpay" empty="Waiting for the first failed AutoPay.">
          {ingress.map((row) => (
            <li key={`${row.caseId}-${row.at}`} className="desk-in border-t border-[#eef1f8] px-4 py-3 first:border-t-0">
              <p className="text-xs text-[#8c93a3]">
                {row.source}
                {row.live ? " · live" : ""}
              </p>
              <p className="mt-0.5 text-sm">
                {row.name}{" "}
                <span className="text-[#8c93a3]">
                  {row.amount} · {row.decline.replaceAll("_", " ")} · {row.bank}
                </span>
              </p>
            </li>
          ))}
        </Tape>
        <Tape title="Piplup" caption="Decisions" empty="Decisions land here.">
          {feed.map((row) => (
            <li key={`${row.caseId}-${row.at}`} className="desk-in border-t border-[#eef1f8] px-4 py-3 first:border-t-0">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm">
                  {row.name} <span className="text-[#8c93a3]">{row.amount}</span>
                </p>
                <StatusChip event={row} />
              </div>
              <p className="mt-1 text-xs leading-5 text-[#5a6178]">{row.action}</p>
            </li>
          ))}
        </Tape>
      </section>

      <section className="desk-card p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="font-display text-base tracking-tight">September cohort</h2>
          <p className="text-xs text-[#8c93a3]">
            {liveHits} live {liveHits === 1 ? "hit" : "hits"} · {cursor}/{total}
          </p>
        </div>
        <div className="mt-4 flex flex-wrap gap-1">
          {queue.map((row) => (
            <span
              key={row.id}
              title={`${row.name} · ${row.decline}`}
              className={`h-3 w-3 rounded-[3px] transition-transform duration-150 ease-blade hover:scale-125 ${seatClass(seatFor(row.id, byId, hotId), row.live)}`}
            />
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-4 text-xs text-[#5a6178]">
          {mix.map((row) => (
            <p key={row.key}>
              <span className="font-semibold text-ink">{row.n}</span> {row.key}
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
    <article
      className={`desk-card desk-card-hover overflow-hidden p-4 ${hot ? "border-rzp shadow-[0_0_0_1px_#305eff]" : ""}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="rzp-chip bg-[#e8f8f0] text-[#007a4d]">
            <span className="live-dot" />
            Live
          </p>
          <h3 className="mt-2 text-base font-semibold tracking-tight">{row.name}</h3>
          <p className="text-xs text-[#8c93a3]">
            {row.course} · {row.amount}
          </p>
        </div>
        {hot ? (
          <span className="rzp-chip bg-[#eef2ff] text-rzp">Razorpay</span>
        ) : event ? (
          <StatusChip event={event} />
        ) : (
          <span className="rzp-chip bg-[#eef1f8] text-[#8c93a3]">queued</span>
        )}
      </div>
      <p className="mt-3 text-sm leading-6 text-[#5a6178]">
        {event?.action ?? `${row.decline.replaceAll("_", " ")}. Waiting.`}
      </p>
      {event?.emailed ? <p className="mt-2 text-xs font-medium text-moss">Mailed from Eureka Labs.</p> : null}
      {event?.emailError ? <p className="mt-2 text-xs text-amber-800">{event.emailError}</p> : null}
      {mail && !event?.emailed ? <p className="mt-2 text-xs text-[#8c93a3]">Mail only on Send emails.</p> : null}
      {(event?.linkUrl ?? row.linkUrl) ? (
        <a className="rzp-link mt-3 inline-block text-xs" href={event?.linkUrl ?? row.linkUrl} target="_blank" rel="noreferrer">
          {event?.linkUrl ?? row.linkUrl}
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
    <div className="desk-card">
      <div className="flex items-baseline justify-between px-4 py-3">
        <h2 className="font-display text-base tracking-tight">{title}</h2>
        <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#8c93a3]">{caption}</p>
      </div>
      <ul className="desk-scroll max-h-[360px] overflow-y-auto border-t border-[#eef1f8]">
        {emptyish ? <li className="px-4 py-12 text-center text-sm text-[#8c93a3]">{empty}</li> : children}
      </ul>
    </div>
  );
}

function StudentsTable({
  queue,
  byId,
  hotId,
  liveLinks,
}: {
  queue: QueueItem[];
  byId: Record<string, DeskEvent>;
  hotId: string | null;
  liveLinks: Array<{ id: string; shortUrl: string }>;
}) {
  const urls = new Map(liveLinks.map((row) => [row.id, row.shortUrl]));
  return (
    <div className="overflow-hidden desk-card">
      <div className="px-5 py-4">
        <h2 className="font-display text-lg tracking-tight">September roster</h2>
      </div>
      <div className="desk-scroll max-h-[70vh] overflow-auto">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-[#f8f9fc] text-[11px] font-semibold uppercase tracking-[0.06em] text-[#8c93a3]">
            <tr>
              <th className="px-5 py-2.5 font-semibold">Student</th>
              <th className="px-3 py-2.5 font-semibold">Course</th>
              <th className="px-3 py-2.5 font-semibold">Bank</th>
              <th className="px-3 py-2.5 font-semibold">Fail</th>
              <th className="px-3 py-2.5 font-semibold">Piplup</th>
              <th className="px-3 py-2.5 font-semibold">Link</th>
              <th className="px-3 py-2.5 font-semibold">NPCI</th>
              <th className="px-5 py-2.5 font-semibold">Seat</th>
            </tr>
          </thead>
          <tbody>
            {queue.map((row) => {
              const event = byId[row.id];
              const hot = hotId === row.id;
              const url = event?.linkUrl ?? row.linkUrl ?? urls.get(row.id);
              return (
                <tr key={row.id} className="border-t border-[#eef1f8] transition-colors duration-150 hover:bg-[#f8f9fc]">
                  <td className="px-5 py-2.5 font-medium">
                    {row.name}
                    {row.live ? <span className="ml-2 rzp-chip bg-[#e8f8f0] text-[#007a4d]">LIVE</span> : null}
                  </td>
                  <td className="px-3 py-2.5 text-[#5a6178]">{row.course}</td>
                  <td className="px-3 py-2.5 text-[#5a6178]">{row.bank}</td>
                  <td className="px-3 py-2.5 text-[#5a6178]">{row.decline.replaceAll("_", " ")}</td>
                  <td className="px-3 py-2.5 text-[#5a6178]">{event?.action ?? (hot ? "on the wire" : "—")}</td>
                  <td className="px-3 py-2.5">
                    {url ? (
                      <a className="rzp-link text-xs" href={url} target="_blank" rel="noreferrer">
                        Pay
                      </a>
                    ) : (
                      <span className="text-[#c5cad6]">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-[11px] text-[#8c93a3]">{npciCell(event)}</td>
                  <td className="px-5 py-2.5">
                    {hot ? (
                      <span className="rzp-chip bg-[#eef2ff] text-rzp">hot</span>
                    ) : event ? (
                      <StatusChip event={event} />
                    ) : (
                      <span className="rzp-chip bg-[#eef1f8] text-[#8c93a3]">waiting</span>
                    )}
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
    <div className="desk-card p-5">
      <h2 className="font-display text-lg tracking-tight">Promise to pay</h2>
      <p className="mt-2 max-w-xl text-sm leading-6 text-[#5a6178]">
        Inbound replies become a date, a freeze, or a broken promise. Policy waits. It does not guess.
      </p>
      {rows.length === 0 ? (
        <p className="mt-8 text-sm text-[#8c93a3]">Promises land here as the night runs.</p>
      ) : (
        <ul className="mt-6 divide-y divide-[#eef1f8]">
          {rows.map(({ row, event, status, day, quote }) => (
            <li key={row.id} className="py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-medium">
                  {row.name} <span className="font-normal text-[#8c93a3]">{row.amount}</span>
                </p>
                <span className={`rzp-chip ${promiseTone(status)}`}>{status.replaceAll("_", " ")}</span>
              </div>
              <p className="mt-1 text-xs leading-5 text-[#5a6178]">
                {status === "claimed_paid"
                  ? "Customer says already paid. Retries frozen."
                  : status === "honored"
                    ? `Paid after promising day ${day}.`
                    : status === "broken"
                      ? `Waited until day ${day}. Still open.`
                      : `Parked until day ${day}.`}
              </p>
              {quote ? <p className="mt-1 text-xs italic text-[#8c93a3]">“{quote}”</p> : null}
              {event?.action ? <p className="mt-1 text-xs text-[#8c93a3]">{event.action}</p> : null}
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

function HaltedList({ feed }: { feed: DeskEvent[] }) {
  return (
    <div className="desk-card p-5">
      <h2 className="font-display text-lg tracking-tight">Stopped on purpose</h2>
      <p className="mt-2 max-w-xl text-sm leading-6 text-[#5a6178]">
        Disputes, already-paid claims and stop-texting-me get neither a debit nor a message. Calendar T+3 still hammers
        them. Revoked mandates are not here — they keep their NPCI slots and get a re-auth ask instead.
      </p>
      {feed.length === 0 ? (
        <p className="mt-8 text-sm text-[#8c93a3]">Terminal cases collect here as the night runs.</p>
      ) : (
        <ul className="mt-6 divide-y divide-[#eef1f8]">
          {feed.map((row) => (
            <li key={row.caseId} className="py-3">
              <p className="text-sm font-medium">
                {row.name}{" "}
                <span className="font-normal text-[#8c93a3]">
                  {row.amount} · {row.decline.replaceAll("_", " ")}
                </span>
              </p>
              <p className="mt-1 text-xs leading-5 text-[#5a6178]">{row.reason}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="desk-card desk-card-hover p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#8c93a3]">{label}</p>
      <p className="mt-2 font-display text-3xl tracking-tight tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-[#8c93a3]">{hint}</p>
    </div>
  );
}

function StatusChip({ event }: { event: DeskEvent }) {
  const label = badge(event);
  const cls =
    event.stopped
      ? "bg-[#eef1f8] text-[#5a6178]"
      : event.recovered
        ? "bg-[#e8f8f0] text-[#007a4d]"
        : event.emailed
          ? "bg-[#eef2ff] text-rzp"
          : "bg-[#fdecea] text-[#c0392b]";
  return <span className={`rzp-chip ${cls}`}>{label}</span>;
}

function promiseTone(status: string): string {
  if (status === "honored") return "bg-[#e8f8f0] text-[#007a4d]";
  if (status === "broken") return "bg-[#fdecea] text-[#c0392b]";
  if (status === "claimed_paid") return "bg-[#eef2ff] text-rzp";
  return "bg-[#fff4d6] text-[#8a5a00]";
}

function badge(e: DeskEvent): string {
  if (e.stopped) return "stopped";
  if (e.recovered && e.clock === "sync_cascade") return "recovered now";
  if (e.recovered) return "recovered later";
  if (e.emailed) return "emailed";
  return "open";
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
  const ring = live ? "ring-1 ring-[#02042b]" : "";
  if (seat === "hot") return `bg-rzp ${ring}`;
  if (seat === "recovered") return `bg-moss ${ring}`;
  if (seat === "stopped") return `bg-[#c5d0de] ${ring}`;
  if (seat === "parked") return `bg-amber ${ring}`;
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
