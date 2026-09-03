import type { DeskEvent, IngressEvent, QueueItem } from "@/lib/autopilot/types";
import { formatINR } from "@/lib/recovery/taxonomy";
import type { ReactNode } from "react";
import { Kpi, StatusChip } from "./chrome";
import { seatClass, seatFor } from "./helpers";
import type { Boot } from "./types";

export function DeskFloor(props: {
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
