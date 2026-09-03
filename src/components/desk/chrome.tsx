import type { DeskEvent } from "@/lib/autopilot/types";
import type { ReactNode } from "react";
import { badge } from "./helpers";
import type { Tab } from "./types";

const PAGE_COPY: Record<Tab, { title: string; caption: string }> = {
  desk: { title: "Payments", caption: "Failed AutoPays land here. Policy grants first." },
  students: { title: "Customers", caption: "September roster — every seat, bank, and next action." },
  promises: { title: "Settlements", caption: "Inbound replies become a date, a freeze, or a broken promise." },
  halted: { title: "Disputes", caption: "Cases we left alone on purpose. Calendar T+3 still hammers them." },
  analytics: { title: "Reports", caption: "The same book the desk is running, scored like Stripe’s KPI set." },
  prevent: { title: "Smart Prevent", caption: "Failures we can see coming — flagged three days out, zero NPCI slots." },
};

export function PageTitle({ tab }: { tab: Tab }) {
  const copy = PAGE_COPY[tab];
  return (
    <div className="mb-5 rise-in">
      <h1 className="font-display text-[28px] leading-8 tracking-tight">{copy.title}</h1>
      <p className="mt-1 text-sm text-[#5a6178]">{copy.caption}</p>
    </div>
  );
}

export function NavBtn({
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

export function RzpMark() {
  return (
    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[7px] bg-rzp text-[15px] font-extrabold text-white">
      P
    </span>
  );
}

export function IconDesk() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="1.5" y="1.5" width="5.5" height="5.5" rx="1.2" stroke="currentColor" strokeWidth="1.4" />
      <rect x="9" y="1.5" width="5.5" height="5.5" rx="1.2" stroke="currentColor" strokeWidth="1.4" />
      <rect x="1.5" y="9" width="5.5" height="5.5" rx="1.2" stroke="currentColor" strokeWidth="1.4" />
      <rect x="9" y="9" width="5.5" height="5.5" rx="1.2" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

export function IconUsers() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="6" cy="5" r="2.2" stroke="currentColor" strokeWidth="1.4" />
      <path d="M2.2 13c.4-2.2 2-3.4 3.8-3.4S9.4 10.8 9.8 13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="11.2" cy="5.2" r="1.8" stroke="currentColor" strokeWidth="1.4" />
      <path d="M13.8 13c-.3-1.6-1.3-2.6-2.6-2.8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

export function IconPromise() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="2" y="2.5" width="12" height="11" rx="1.6" stroke="currentColor" strokeWidth="1.4" />
      <path d="M2 6h12M5.5 1.5v2.5M10.5 1.5v2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

export function IconStop() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.4" />
      <path d="M4.2 4.2l7.6 7.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

export function IconChart() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M2 13h12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <rect x="3.2" y="7" width="2.2" height="4.2" rx="0.5" fill="currentColor" />
      <rect x="6.9" y="4.2" width="2.2" height="7" rx="0.5" fill="currentColor" />
      <rect x="10.6" y="5.6" width="2.2" height="5.6" rx="0.5" fill="currentColor" />
    </svg>
  );
}

export function IconShield() {
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

export function StatusChip({ event }: { event: DeskEvent }) {
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

export function Kpi({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="desk-card desk-card-hover p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#8c93a3]">{label}</p>
      <p className="mt-2 font-display text-3xl tracking-tight tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-[#8c93a3]">{hint}</p>
    </div>
  );
}
