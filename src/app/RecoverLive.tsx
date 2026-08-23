"use client";

import { useEffect, useState } from "react";

type Status = {
  configured: boolean;
  testMode: boolean;
  keyPrefix: string;
  demo: Array<{ id: string; name: string; decline: string; mutation: string }>;
};

type Row = {
  at: string;
  caseId: string;
  mutation: string;
  granted: boolean;
  reason: string;
  outcome: string;
  error?: string;
  link?: { id: string; shortUrl: string; status: string };
};

type Inbox = { caseId: string; name: string; decline: string; email: string };

export function RecoverLive() {
  const [status, setStatus] = useState<Status | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inboxes, setInboxes] = useState<Inbox[]>([]);
  const [mailReady, setMailReady] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [mailBusy, setMailBusy] = useState(false);
  const [mailNote, setMailNote] = useState<string | null>(null);
  const [quota, setQuota] = useState<Record<string, { sent: number; left: number }>>({});

  useEffect(() => {
    void fetch("/api/razorpay/status")
      .then((r) => r.json())
      .then(setStatus);
    void fetch("/api/recover")
      .then((r) => r.json())
      .then((d: { audit?: Row[] }) => setRows(d.audit ?? []));
    void loadMail();
  }, []);

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

  async function run(injectTimeout = false) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/recover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ demo: true, injectTimeout }),
      });
      const data = (await res.json()) as { rows?: Row[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? "recover failed");
      setRows((prev) => [...prev, ...(data.rows ?? [])]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "recover failed");
    } finally {
      setBusy(false);
    }
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
    } catch (err) {
      setMailNote(err instanceof Error ? err.message : "send failed");
    } finally {
      setMailBusy(false);
    }
  }

  return (
    <section className="mt-8 rounded-lg border border-ink/10 bg-white p-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mono text-[11px] uppercase tracking-wider text-moss">Live · Razorpay Test Mode</p>
          <h2 className="mt-1 text-lg font-semibold">Create recovery Payment Links</h2>
          <p className="mt-2 max-w-xl text-sm leading-6 text-ink/65">
            Eureka Labs students whose AI/ML subscription failed. Policy grants first. Then we mint a real test-mode
            link for three demo cases only — expired card, paused mandate, checkout drop. Test accounts cap at 30
            links, so the batch itself stays simulated.
          </p>
        </div>
        <div className="mono text-right text-[11px] text-ink/45">
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
          <li key={d.id} className="rounded border border-ink/10 px-2 py-1">
            <span className="mono">{d.id}</span> {d.name} · {d.decline} → {d.mutation}
          </li>
        ))}
      </ul>

      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="button"
          disabled={busy || !status?.configured}
          onClick={() => void run(false)}
          className="rounded bg-ink px-4 py-2 text-sm text-paper disabled:opacity-40"
        >
          {busy ? "Calling Razorpay…" : "Create 3 test links"}
        </button>
        <button
          type="button"
          disabled={busy || !status?.configured}
          onClick={() => void run(true)}
          className="rounded border border-ink/20 px-4 py-2 text-sm disabled:opacity-40"
        >
          Inject timeout
        </button>
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
          className="mt-4 rounded bg-moss px-4 py-2 text-sm text-white disabled:opacity-40"
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

      {error ? <p className="mt-3 text-sm text-rust">{error}</p> : null}

      {rows.length > 0 ? (
        <ol className="mt-5 space-y-2 text-sm">
          {rows
            .slice()
            .reverse()
            .slice(0, 12)
            .map((row, i) => (
              <li key={`${row.at}-${i}`} className="border-t border-ink/5 pt-2">
                <p className="mono text-[11px] uppercase tracking-wider text-ink/40">
                  {row.outcome} · {row.caseId} · {row.mutation}
                </p>
                <p className="mt-1 text-ink/70">{row.reason}</p>
                {row.link ? (
                  <a className="mt-1 inline-block text-moss underline" href={row.link.shortUrl} target="_blank" rel="noreferrer">
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
