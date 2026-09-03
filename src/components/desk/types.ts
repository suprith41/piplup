import type { DeskEvent, IngressEvent, QueueItem } from "@/lib/autopilot/types";
import { EUREKA } from "@/lib/merchant/eureka";

export type Tab = "desk" | "students" | "promises" | "halted" | "analytics" | "prevent";
export type Seat = "pending" | "hot" | "recovered" | "parked" | "stopped";

export type NightSnap = {
  tape: string;
  cursor: number;
  total: number;
  ingress: IngressEvent[];
  feed: DeskEvent[];
  byId: Record<string, DeskEvent>;
  done: boolean;
};

export type Boot = {
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

export type StreamMessage =
  | { type: "hello"; merchant: string; operator: string; cohort: string; cycle: string; cases: number }
  | IngressEvent
  | { type: "decision"; event: DeskEvent; index: number; total: number }
  | { type: "done"; cases: number }
  | { type: "error"; message: string };
