import type { DeskEvent, QueueItem } from "@/lib/autopilot/types";
import type { Seat } from "./types";

export function promiseStatus(
  row: QueueItem,
  event?: DeskEvent,
): "waiting" | "honored" | "broken" | "claimed_paid" | null {
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

export function promiseTone(status: string): string {
  if (status === "honored") return "bg-[#e8f8f0] text-[#007a4d]";
  if (status === "broken") return "bg-[#fdecea] text-[#c0392b]";
  if (status === "claimed_paid") return "bg-[#eef2ff] text-rzp";
  return "bg-[#fff4d6] text-[#8a5a00]";
}

export function badge(e: DeskEvent): string {
  if (e.stopped) return "stopped";
  if (e.recovered && e.clock === "sync_cascade") return "recovered now";
  if (e.recovered) return "recovered later";
  if (e.emailed) return "emailed";
  return "open";
}

/** NPCI allows 1 original debit plus 3 retries. This column is what we spent of it. */
export function npciCell(e?: DeskEvent): string {
  if (!e) return "—";
  return e.npciSlotsUsed > 0 ? `−${e.npciSlotsUsed} · ${e.npciSlotsLeftAfter} left` : "0 spent";
}

export function seatFor(id: string, byId: Record<string, DeskEvent>, hotId: string | null): Seat {
  if (hotId === id) return "hot";
  const e = byId[id];
  if (!e) return "pending";
  if (e.stopped) return "stopped";
  if (e.recovered) return "recovered";
  return "parked";
}

export function seatClass(seat: Seat, live: boolean): string {
  const ring = live ? "ring-1 ring-[#02042b]" : "";
  if (seat === "hot") return `bg-rzp ${ring}`;
  if (seat === "recovered") return `bg-moss ${ring}`;
  if (seat === "stopped") return `bg-[#c5d0de] ${ring}`;
  if (seat === "parked") return `bg-amber ${ring}`;
  return `bg-[#e4ebf3] ${ring}`;
}

export function mixCounts(queue: QueueItem[], byId: Record<string, DeskEvent>): { key: string; n: number }[] {
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
