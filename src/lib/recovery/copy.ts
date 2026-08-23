import type { PolicyDecision, RecoveryCase } from "./types.ts";

/** Hinglish customer copy. LLM can rewrite later; policy still owns the action. */
export function hinglishNudge(c: RecoveryCase, decision: PolicyDecision): string {
  if (decision.clock === "stop") {
    return `${c.customerName} ji, is mandate pe retry nahi karenge. Pehle naya AutoPay set karna hoga.`;
  }
  if (decision.mutation === "next_rail") {
    return "";
  }
  if (decision.mutation === "payment_link") {
    return `${c.customerName}, last payment fail ho gaya. 1-tap link se complete kar lo — plan same rahega.`;
  }
  if (decision.mutation === "mandate_reauth") {
    return `${c.customerName} ji, UPI AutoPay pause ho gaya hai. 30 second mein wapas on karo, warna plan hold pe chala jayega.`;
  }
  if (c.promiseToPayDay) {
    return `${c.customerName}, samajh gaye — ${c.promiseToPayDay} tarikh ko salary ke baad retry karenge. Usse pehle spam nahi karenge.`;
  }
  if (c.salaryDay) {
    return `${c.customerName}, balance short tha. ${c.salaryDay} tarikh ko ek baar try karenge.`;
  }
  return `${c.customerName}, payment fail hua. Hum smart retry schedule kar rahe hain — roz nahi kaatenge.`;
}
