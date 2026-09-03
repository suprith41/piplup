"use client";

/**
 * Night-loop shell. Tab bodies live next to this file:
 * payments.tsx (Payments), boards.tsx (Customers / Settlements / Disputes).
 */
import { AnalyticsBoard, PreventBoard } from "@/components/insights/Insights";
import type { DeskEvent, IngressEvent } from "@/lib/autopilot/types";
import { DEMO_INBOXES } from "@/lib/email/recipients";
import { EUREKA } from "@/lib/merchant/eureka";
import Link from "next/link";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { HaltedList, PromisesBoard, StudentsTable } from "./boards";
import {
  IconChart,
  IconDesk,
  IconPromise,
  IconShield,
  IconStop,
  IconUsers,
  NavBtn,
  PageTitle,
  RzpMark,
} from "./chrome";
import { mixCounts } from "./helpers";
import { DeskFloor } from "./payments";
import { clearNight, loadNight, saveNight } from "./persist";
import type { Boot, NightSnap, StreamMessage, Tab } from "./types";

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
          <Link className="rzp-link mt-3 inline-block text-[12px]" href="/architecture">
            Architecture →
          </Link>
          <Link className="rzp-link mt-1 inline-block text-[12px]" href="/lab">
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
