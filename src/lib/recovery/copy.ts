import type { PolicyDecision, RecoveryCase } from "./types.ts";

/** Hinglish customer copy for voice. Emails stay English. Policy still owns the action. */
export function hinglishNudge(c: RecoveryCase, decision: PolicyDecision): string {
  if (c.claimedPaid || decision.stopReason?.includes("already paid")) {
    return `${c.customerName} ji, aapne bola payment ho gayi. Hum retry nahi karenge jab tak reconcile na ho.`;
  }
  if (decision.clock === "stop") {
    return `${c.customerName} ji, Eureka Labs AutoPay pe retry nahi karenge. Pehle naya AutoPay set karna hoga, warna course access band ho jayega.`;
  }
  if (decision.clock === "terminal_mutation") {
    return `${c.customerName} ji, aapka AutoPay mandate cancel ho chuka hai — hum baar-baar debit try nahi karenge. Ek naya AutoPay set kar do, 30 second ka kaam hai, course chalta rahega.`;
  }
  // Cascade and cooldown both finish before the customer knows anything failed.
  if (decision.clock === "sync_cascade") {
    return "";
  }
  if (c.promiseToPayDay) {
    return `${c.customerName}, samajh gaye — ${c.promiseToPayDay} tarikh ko salary ke baad Eureka Labs retry karenge. Usse pehle spam nahi karenge.`;
  }
  if (decision.mutation === "payment_link") {
    return `${c.customerName}, Eureka Labs AI/ML course ki last payment fail ho gayi. 1-tap link se complete kar lo — subscription same rahegi.`;
  }
  if (decision.mutation === "mandate_reauth") {
    return `${c.customerName} ji, UPI AutoPay pause ho gaya hai. 30 second mein wapas on karo, warna Eureka Labs course hold pe chala jayega.`;
  }
  if (c.salaryDay) {
    return `${c.customerName}, balance short tha. ${c.salaryDay} tarikh ko course subscription ek baar try karenge.`;
  }
  return `${c.customerName}, Eureka Labs payment fail hui. Hum smart retry schedule kar rahe hain — roz nahi kaatenge.`;
}
