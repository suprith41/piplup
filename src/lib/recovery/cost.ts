import type { PolicyDecision } from "./types.ts";

/**
 * Chasing money is not free. Vendors quote gross recovery and never net it
 * against what the chase cost. Indicative Indian channel prices, in paise.
 */
export const CHANNEL_COST_PAISE = {
  silent: 0,
  email: 5,
  sms: 20,
  whatsapp: 35,
  preDebitNotice: 20,
} as const;

/** A failed calendar retry still emails the customer and sends a hosted link. */
export const T3_COST_PER_FAILED_RETRY_PAISE = CHANNEL_COST_PAISE.email + CHANNEL_COST_PAISE.sms;

export function adaptiveCostPaise(decision: PolicyDecision): number {
  // A cooldown or a rail switch happens inside the original attempt. The
  // customer is never told, so there is nothing to pay for.
  if (decision.clock === "sync_cascade") {
    return CHANNEL_COST_PAISE.silent;
  }

  // A stop is a stop: no debit and no message. Chargebacks, opt-outs and
  // already-paid claims are contact freezes, not cheaper dunning.
  if (decision.clock === "stop") {
    return CHANNEL_COST_PAISE.silent;
  }

  // Re-authorising a dead mandate is one outbound ask and no debit, so there
  // is no pre-debit notice to pay for either.
  if (decision.clock === "terminal_mutation") {
    return CHANNEL_COST_PAISE.whatsapp;
  }

  const notice = decision.preDebitNoticeDay ? CHANNEL_COST_PAISE.preDebitNotice : 0;
  return CHANNEL_COST_PAISE.whatsapp + notice;
}
