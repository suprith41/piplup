import type { DeclineClass, RecoveryCase } from "./types.ts";

const TECHNICAL = new Set([
  "gateway_timeout",
  "bank_downtime",
  "network_error",
  "issuer_unavailable",
]);

const FINANCIAL = new Set([
  "insufficient_funds",
  "soft_decline",
  "do_not_honor",
]);

const INSTRUMENT = new Set([
  "card_expired",
  "mandate_paused",
  "method_mismatch",
]);

const TERMINAL = new Set([
  "mandate_revoked",
  "stolen_card",
  "card_blocked",
  "chargeback",
  "do_not_retry",
]);

const BEHAVIORAL = new Set(["checkout_abandoned"]);

const UNCOLLECTED = new Set(["halted_invoice_uncharged"]);

/** Infer class from the decline + mandate state. Never trust the LLM for this. */
export function classifyDecline(input: Pick<RecoveryCase, "declineCode" | "mandateState" | "chargeback" | "optedOut">): DeclineClass {
  if (UNCOLLECTED.has(input.declineCode)) return "uncollected";
  if (input.chargeback || input.declineCode === "chargeback") return "terminal";
  if (input.mandateState === "revoked") return "terminal";
  if (TERMINAL.has(input.declineCode)) return "terminal";
  if (TECHNICAL.has(input.declineCode)) return "technical";
  if (FINANCIAL.has(input.declineCode)) return "financial";
  if (INSTRUMENT.has(input.declineCode) || input.mandateState === "paused") return "instrument";
  if (BEHAVIORAL.has(input.declineCode)) return "behavioral";
  return "financial";
}

export function rupees(paise: number): number {
  return paise / 100;
}

export function formatINR(paise: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(rupees(paise));
}
