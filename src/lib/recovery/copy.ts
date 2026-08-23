import type { PolicyDecision, RecoveryCase } from "./types.ts";

/** Hinglish customer copy. LLM can rewrite later; policy still owns the action. */
export function hinglishNudge(c: RecoveryCase, decision: PolicyDecision): string {
  if (decision.clock === "stop") {
    return `${c.customerName} ji, Eureka Labs AutoPay pe retry nahi karenge. Pehle naya AutoPay set karna hoga, warna course access band ho jayega.`;
  }
  if (decision.mutation === "next_rail") {
    return "";
  }
  if (decision.mutation === "payment_link") {
    return `${c.customerName}, Eureka Labs AI/ML course ki last payment fail ho gayi. 1-tap link se complete kar lo — subscription same rahegi.`;
  }
  if (decision.mutation === "mandate_reauth") {
    return `${c.customerName} ji, UPI AutoPay pause ho gaya hai. 30 second mein wapas on karo, warna Eureka Labs course hold pe chala jayega.`;
  }
  if (c.promiseToPayDay) {
    return `${c.customerName}, samajh gaye — ${c.promiseToPayDay} tarikh ko salary ke baad Eureka Labs retry karenge. Usse pehle spam nahi karenge.`;
  }
  if (c.salaryDay) {
    return `${c.customerName}, balance short tha. ${c.salaryDay} tarikh ko course subscription ek baar try karenge.`;
  }
  return `${c.customerName}, Eureka Labs payment fail hui. Hum smart retry schedule kar rahe hain — roz nahi kaatenge.`;
}
