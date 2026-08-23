import type { PolicyDecision, RecoveryCase } from "./types.ts";

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

export function adaptiveCostPaise(c: RecoveryCase, decision: PolicyDecision): number {
  if (decision.clock === "sync_cascade") {
    return CHANNEL_COST_PAISE.silent;
  }

  if (decision.clock === "stop") {
    // Never message a chargeback or an opt-out. Both are contact freezes.
    if (c.chargeback || c.optedOut) return CHANNEL_COST_PAISE.silent;
    return CHANNEL_COST_PAISE.whatsapp;
  }

  const notice = decision.preDebitNoticeDay ? CHANNEL_COST_PAISE.preDebitNotice : 0;
  return CHANNEL_COST_PAISE.whatsapp + notice;
}
