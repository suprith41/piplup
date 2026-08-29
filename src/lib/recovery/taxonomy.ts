import type { BankSignal, DeclineClass, RecoveryCase } from "./types.ts";

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

/**
 * A revoked mandate is terminal for the *debit* and nothing else. The customer
 * can still re-authorise, and asking them to costs no NPCI slot. Lumping it in
 * with chargebacks is how recovery tools leave money on the table.
 */
export function isRevokedMandate(input: Pick<RecoveryCase, "declineCode" | "mandateState">): boolean {
  return input.mandateState === "revoked" || input.declineCode === "mandate_revoked";
}

/** Cases where any outbound contact is wrong, not just any debit. */
export function isContactFrozen(
  input: Pick<RecoveryCase, "declineCode" | "chargeback" | "optedOut" | "claimedPaid">,
): boolean {
  return (
    input.chargeback ||
    input.optedOut ||
    input.claimedPaid ||
    input.declineCode === "chargeback" ||
    input.declineCode === "do_not_retry"
  );
}

/**
 * Which bank-side condition we are looking at. A switch that is merely slow
 * clears on its own; core banking being down does not.
 */
export function bankSignalFor(input: Pick<RecoveryCase, "bankSignal" | "declineCode">): BankSignal {
  if (input.bankSignal) return input.bankSignal;
  return input.declineCode === "gateway_timeout" || input.declineCode === "network_error"
    ? "latency_spike"
    : "cbs_down";
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
