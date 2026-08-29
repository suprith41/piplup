import { classifyDecline } from "./taxonomy.ts";
import type { PolicyDecision, PolicyName, RecoveryCase } from "./types.ts";

/**
 * Razorpay-style calendar retry: same rail, same mandate, T+1 / T+2 / T+3,
 * then halted. This is the control that Adaptive has to beat.
 *
 * Two readings, because the honest comparison needs both:
 *
 *   t3_calendar            — retries every failure class, including revoked
 *                            mandates. Matches the documented flow, which
 *                            lists mandate cancellation as a failure reason
 *                            and describes automatic retries with no carve-out.
 *   t3_hard_decline_aware  — charitable reading. Assumes the calendar stops
 *                            after one hard decline. If our lift only exists
 *                            against the harsher reading, it is not real.
 */
export function grantT3(c: RecoveryCase, policy: PolicyName = "t3_calendar"): PolicyDecision {
  const inferredClass = classifyDecline(c);

  // Neither baseline has any concept of sweeping uncollected invoices on a
  // revived subscription. Nothing in the standard flow charges them.
  if (inferredClass === "uncollected") {
    return {
      caseId: c.id,
      policy,
      inferredClass,
      clock: "stop",
      mutation: "none",
      reason: "Calendar flow has no path here. The invoices exist but nothing charges them.",
      allowed: false,
      stopReason: "Not modelled by the retry cycle.",
      npciSlotsUsed: 0,
      npciSlotsLeftAfter: Math.max(0, c.retryBudgetLeft),
    };
  }

  return {
    caseId: c.id,
    policy,
    inferredClass,
    clock: "async_dunning",
    mutation: "same_rail_retry",
    reason:
      policy === "t3_hard_decline_aware"
        ? "Calendar policy, stopping after a hard decline."
        : "Calendar policy: retry the same debit on T+1, T+2, T+3 regardless of decline class.",
    allowed: true,
    scheduledDay: c.billingDay + 1,
    // The calendar plans the whole cycle up front; the simulator counts what it
    // actually burns, because that is the number Adaptive has to beat.
    npciSlotsUsed: 0,
    npciSlotsLeftAfter: Math.max(0, c.retryBudgetLeft),
  };
}
