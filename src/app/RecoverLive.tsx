"use client";

import { useEffect, useState } from "react";

type Needed = { id: string; name: string; decline: string; mutation: string };

type Status = {
  configured: boolean;
  testMode: boolean;
  keyPrefix: string;
  demo: Array<{ id: string; name: string; decline: string; mutation: string }>;
  needed?: Needed[];
  cap?: number;
};

type Row = {
  at: string;
  caseId: string;
  name?: string;
  mutation: string;
  granted: boolean;
  reason: string;
  outcome: string;
  error?: string;
  link?: { id: string; shortUrl: string; status: string };
};

type LedgerLine = {
  at: string;
  kind: string;
  caseId: string;
  name?: string;
  mutation: string;
  outcome: string;
  reason: string;
  transcript?: string;
  linkUrl?: string;
  error?: string;
};

type LastBatch = {
  generatedAt: string;
  cases: number;
  recovered: number;
  t3: number;
  lift: number;
  slotsSaved: number;
  stopAccuracy: number;
};

type Inbox = { caseId: string; name: string; decline: string; email: string };

export function RecoverLive() {
  const [status, setStatus] = useState<Status | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [live, setLive] = useState<Array<{ id: string; name: string; decline: string; mutation: string; shortUrl: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inboxes, setInboxes] = useState<Inbox[]>([]);
  const [mailReady, setMailReady] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [mailBusy, setMailBusy] = useState(false);
  const [mailNote, setMailNote] = useState<string | null>(null);
  const [quota, setQuota] = useState<Record<string, { sent: number; left: number }>>({});
  const [ledger, setLedger] = useState<LedgerLine[]>([]);
  const [paidIds, setPaidIds] = useState<string[]>([]);
  const [lastBatch, setLastBatch] = useState<LastBatch | null>(null);
  const [paidNote, setPaidNote] = useState<string | null>(null);

  useEffect(() => {
    void fetch("/api/razorpay/status")
      .then((r) => r.json())
      .then(setStatus);
    void fetch("/api/recover")
      .then((r) => r.json())
      .then((d: { audit?: Row[]; live?: typeof live }) => {
        setRows(d.audit ?? []);
        setLive(d.live ?? []);
      });
    void loadMail();
    void loadLedger();
  }, []);

  async function loadLedger() {
    const res = await fetch("/api/ledger");
    const d = (await res.json()) as {
      entries?: LedgerLine[];
      paidCaseIds?: string[];
      lastBatch?: LastBatch | null;
    };
    setLedger(d.entries ?? []);
    setPaidIds(d.paidCaseIds ?? []);
    setLastBatch(d.lastBatch ?? null);
  }

  async function loadMail() {
    const res = await fetch("/api/remind");
    const d = (await res.json()) as {
      configured?: boolean;
      inboxes?: Inbox[];
      quota?: Array<{ email: string; sent: number; left: number }>;
    };
    setMailReady(Boolean(d.configured));
    const list = d.inboxes ?? [];
    setInboxes(list);
    setPicked((cur) => (cur.length ? cur : list.map((row) => row.email)));
    const next: Record<string, { sent: number; left: number }> = {};
    for (const row of d.quota ?? []) next[row.email] = { sent: row.sent, left: row.left };
    setQuota(next);
  }

  async function run(injectTimeout = false, granted = false) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/recover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(granted ? { granted: true, injectTimeout } : { demo: true, injectTimeout }),
      });
      const data = (await res.json()) as {
        rows?: Row[];
        needed?: number;
        capped?: string;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "recover failed");
      const extra = data.rows ?? [];
      if (extra.length) setRows((prev) => [...prev, ...extra]);
      if (data.capped) setError(data.capped);
      const fresh = await fetch("/api/recover").then((r) => r.json()) as { live?: typeof live };
      setLive(fresh.live ?? []);
      await loadLedger();
    } catch (err) {
      setError(err instanceof Error ? err.message : "recover failed");
    } finally {
      setBusy(false);
    }
  }

  async function markPaid(caseId: string) {
    setBusy(true);
    setPaidNote(null);
    setError(null);
    try {
      const res = await fetch("/api/recover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markPaid: true, caseId }),
      });
      const data = (await res.json()) as { paid?: { caseId: string; reason: string }; error?: string };
      if (!res.ok) throw new Error(data.error ?? "mark paid failed");
      setPaidNote(data.paid ? `${data.paid.caseId}: ${data.paid.reason}` : "Marked paid.");
      await loadLedger();
    } catch (err) {
      setError(err instanceof Error ? err.message : "mark paid failed");
    } finally {
      setBusy(false);
    }
  }

  async function downloadBatch() {
    const res = await fetch("/api/ledger");
    const d = (await res.json()) as { lastBatch?: unknown };
    if (!d.lastBatch) return;
    const blob = new Blob([JSON.stringify(d.lastBatch, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "piplup-last-batch.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function sendMail() {
    setMailBusy(true);
    setMailNote(null);
    try {
      const res = await fetch("/api/remind", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emails: picked }),
      });
      const data = (await res.json()) as {
        error?: string;
        results?: Array<{ email: string; name: string; ok: boolean; error?: string; sent?: number; left?: number }>;
      };
      if (!res.ok) throw new Error(data.error ?? "send failed");
      const ok = (data.results ?? []).filter((r) => r.ok);
      const bad = (data.results ?? []).filter((r) => !r.ok);
      setMailNote(
        [
          ok.length
            ? `Sent: ${ok.map((r) => `${r.name} (${r.sent}/20, ${r.left} left)`).join(", ")}`
            : "",
          bad.length ? `Failed: ${bad.map((r) => `${r.name}: ${r.error}`).join("; ")}` : "",
        ]
          .filter(Boolean)
          .join(" "),
      );
      await loadMail();
      await loadLedger();
      await loadLedger();
    } catch (err) {
      setMailNote(err instanceof Error ? err.message : "send failed");
    } finally {
      setMailBusy(false);
    }
  }

  return (
    <section className="desk-card mt-8 p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="rzp-chip bg-[#fff4d6] text-[#8a5a00]">Live · Razorpay Test Mode</p>
          <h2 className="mt-2 font-display text-lg tracking-tight">Create recovery Payment Links</h2>
          <p className="mt-2 max-w-xl text-sm leading-6 text-[#5a6178]">
            Eureka Labs students whose AI/ML subscription failed. Policy grants first. Silent retries and freezes do
            not get a link. Test accounts cap at {status?.cap ?? 30} Payment Links, so we mint until that ceiling and
            reuse any live ones.
          </p>
        </div>
        <div className="mono text-right text-[11px] text-[#8c93a3]">
          {status?.configured ? (
            <p>
              {status.testMode ? "test keys" : "not test mode"} · {status.keyPrefix}
            </p>
          ) : (
            <p>keys missing — add .env.local</p>
          )}
        </div>
      </div>

      <ul className="mt-4 flex flex-wrap gap-2 text-xs">
        {(status?.demo ?? []).map((d) => (
          <li key={d.id} className="rounded-md border border-[#e6eaf2] bg-[#f8f9fc] px-2 py-1">
            <span className="mono">{d.id}</span> {d.name} · {d.decline} → {d.mutation}
          </li>
        ))}
      </ul>

      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          disabled={busy || !status?.configured}
          onClick={() => void run(false)}
          className="rzp-btn-ghost px-4 py-2 text-sm disabled:opacity-40"
        >
          {busy ? "Calling Razorpay…" : "Create 3 test links"}
        </button>
        <button
          type="button"
          disabled={busy || !status?.configured}
          onClick={() => void run(false, true)}
          className="rzp-btn px-4 py-2 text-sm disabled:opacity-40"
        >
          {busy
            ? "Calling Razorpay…"
            : `Create links for everyone who needs one (${status?.needed?.length ?? 0})`}
        </button>
        <button
          type="button"
          disabled={busy || !status?.configured}
          onClick={() => void run(true)}
          className="rzp-btn-ghost px-4 py-2 text-sm disabled:opacity-40"
        >
          Inject timeout
        </button>
        <button
          type="button"
          disabled={!lastBatch}
          onClick={downloadBatch}
          className="rzp-btn-ghost px-4 py-2 text-sm disabled:opacity-40"
        >
          Download last batch
        </button>
      </div>
      {lastBatch ? (
        <p className="mt-2 text-xs text-ink/50">
          Last batch · {lastBatch.cases} cases · lift {lastBatch.lift} · {lastBatch.slotsSaved} slots saved
        </p>
      ) : null}

      <div className="mt-6">
        <p className="mono text-[11px] uppercase tracking-wider text-ink/45">Close the loop</p>
        <p className="mt-1 text-sm text-ink/65">
          Razorpay cannot reach localhost. Mark a live link paid here — same function as the webhook.
        </p>
        <ul className="mt-3 flex flex-wrap gap-2">
          {(status?.demo ?? []).map((d) => (
            <li key={`paid-${d.id}`}>
              <button
                type="button"
                disabled={busy}
                onClick={() => void markPaid(d.id)}
                className="rzp-btn-ghost px-3 py-1.5 text-xs disabled:opacity-40"
              >
                {paidIds.includes(d.id) ? `${d.name} paid` : `Mark ${d.name} paid`}
              </button>
            </li>
          ))}
        </ul>
        {paidNote ? <p className="mt-2 text-sm text-ink/70">{paidNote}</p> : null}
      </div>

      <div className="mt-8 border-t border-ink/10 pt-6">
        <p className="mono text-[11px] uppercase tracking-wider text-ink/45">Reminder email</p>
        <h3 className="mt-1 text-base font-semibold">Send a reminder</h3>
        <p className="mt-2 max-w-xl text-sm leading-6 text-ink/65">
          Pick who gets mail. Each problem gets a different English note — AutoPay paused, card expired, or leftover
          checkout. Tick one, two, or all three. The Payment Link is included if you already created it.
        </p>

        <ul className="mt-4 space-y-2">
          {inboxes.map((inbox) => (
            <li key={inbox.email}>
              <label className="flex cursor-pointer items-start gap-3 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={picked.includes(inbox.email)}
                  onChange={() => {
                    setPicked((cur) =>
                      cur.includes(inbox.email) ? cur.filter((e) => e !== inbox.email) : [...cur, inbox.email],
                    );
                  }}
                />
                <span>
                  <span className="font-medium">{inbox.name}</span>{" "}
                  <span className="text-ink/50">({inbox.decline})</span>
                  <br />
                  <span className="mono text-xs text-ink/55">{inbox.email}</span>
                  <span className="ml-2 text-xs text-ink/40">
                    {quota[inbox.email]
                      ? `${quota[inbox.email].sent}/20 sent · ${quota[inbox.email].left} left`
                      : "0/20 sent"}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>

        <button
          type="button"
          disabled={mailBusy || !mailReady || picked.length === 0}
          onClick={() => void sendMail()}
          className="rzp-btn mt-4 px-4 py-2 text-sm disabled:opacity-40"
        >
          {mailBusy ? "Sending…" : `Send reminder (${picked.length})`}
        </button>
        {!mailReady ? (
          <p className="mt-2 text-xs text-ink/50">
            Add SMTP_USER and SMTP_PASS to .env.local (Gmail app password), then restart npm run dev.
          </p>
        ) : null}
        {mailNote ? <p className="mt-2 text-sm text-ink/70">{mailNote}</p> : null}
      </div>

      {live.length > 0 ? (
        <div className="mt-6">
          <p className="mono text-[11px] uppercase tracking-wider text-ink/45">Live Payment Links</p>
          <ul className="mt-3 space-y-2 text-sm">
            {live.map((row) => (
              <li key={row.id} className="flex flex-wrap items-baseline justify-between gap-2 border-t border-ink/5 pt-2">
                <p>
                  <span className="font-medium">{row.name}</span>{" "}
                  <span className="mono text-xs text-ink/45">
                    {row.id} · {row.decline.replaceAll("_", " ")}
                  </span>
                </p>
                <a className="rzp-link" href={row.shortUrl} target="_blank" rel="noreferrer">
                  {row.shortUrl}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {error ? <p className="mt-3 text-sm text-rust">{error}</p> : null}

      {ledger.length > 0 ? (
        <div className="mt-8 border-t border-ink/10 pt-6">
          <p className="mono text-[11px] uppercase tracking-wider text-ink/45">Live ledger</p>
          <ol className="mt-3 space-y-2 text-sm">
            {ledger.slice(0, 16).map((row, i) => (
              <li key={`${row.at}-${row.kind}-${i}`} className="border-t border-ink/5 pt-2">
                <p className="mono text-[11px] uppercase tracking-wider text-ink/40">
                  {row.kind} · {row.outcome} · {row.name ?? row.caseId}
                </p>
                <p className="mt-0.5 text-xs text-ink/45">{row.caseId}</p>
                <p className="mt-1 text-ink/70">{row.reason}</p>
                {row.transcript ? <p className="mt-1 text-xs italic text-ink/50">“{row.transcript}”</p> : null}
                {row.linkUrl ? (
                  <a className="rzp-link mt-1 inline-block" href={row.linkUrl} target="_blank" rel="noreferrer">
                    {row.linkUrl}
                  </a>
                ) : null}
                {row.error ? <p className="mt-1 text-xs text-rust">{row.error}</p> : null}
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {rows.length > 0 ? (
        <ol className="mt-5 space-y-2 text-sm">
          {rows
            .slice()
            .reverse()
            .slice(0, 12)
            .map((row, i) => (
              <li key={`${row.at}-${i}`} className="border-t border-ink/5 pt-2">
                <p className="mono text-[11px] uppercase tracking-wider text-ink/40">
                  {row.outcome} · {row.name ?? row.caseId} · {row.mutation}
                </p>
                <p className="mt-0.5 text-xs text-ink/45">{row.caseId}</p>
                <p className="mt-1 text-ink/70">{row.reason}</p>
                {row.link ? (
                  <a className="rzp-link mt-1 inline-block" href={row.link.shortUrl} target="_blank" rel="noreferrer">
                    {row.link.shortUrl}
                  </a>
                ) : null}
                {row.error ? <p className="mt-1 text-xs text-rust">{row.error}</p> : null}
              </li>
            ))}
        </ol>
      ) : null}
    </section>
  );
}
