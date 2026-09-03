import type { DeskEvent, QueueItem } from "@/lib/autopilot/types";
import { StatusChip } from "./chrome";
import { npciCell, promiseStatus, promiseTone } from "./helpers";

export function StudentsTable({
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

export function PromisesBoard({ queue, byId }: { queue: QueueItem[]; byId: Record<string, DeskEvent> }) {
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

export function HaltedList({ feed }: { feed: DeskEvent[] }) {
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
