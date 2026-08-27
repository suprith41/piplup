import type { PolicyDecision, RecoveryCase } from "./types.ts";

/** English customer copy. LLM can rewrite later; policy still owns the action. */
export function hinglishNudge(c: RecoveryCase, decision: PolicyDecision): string {
  if (decision.clock === "stop") {
    return `${c.customerName}, we will not retry Eureka Labs AutoPay. Set up a new AutoPay first, or course access will pause.`;
  }
  if (decision.mutation === "next_rail") {
    return "";
  }
  if (decision.mutation === "payment_link") {
    return `${c.customerName}, your last Eureka Labs AI/ML course payment failed. Finish it with the 1-tap link — same subscription.`;
  }
  if (decision.mutation === "mandate_reauth") {
    return `${c.customerName}, AutoPay is paused. Turn it back on in 30 seconds, or the Eureka Labs course goes on hold.`;
  }
  if (c.promiseToPayDay) {
    return `${c.customerName}, got it — we will retry Eureka Labs after salary on the ${c.promiseToPayDay}th. No spam before then.`;
  }
  if (c.salaryDay) {
    return `${c.customerName}, the balance was short. We will try the course subscription once on the ${c.salaryDay}th.`;
  }
  return `${c.customerName}, the Eureka Labs payment failed. We are scheduling a smart retry — we will not debit you every day.`;
}
