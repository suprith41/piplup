export const EUREKA = {
  name: "Eureka Labs",
  legal: "Eureka Labs Pvt. Ltd.",
  city: "San Francisco",
  product: "Online AI/ML courses",
  operator: "Ada",
  operatorRole: "Head of Revenue",
  cohort: "September 2026",
  cycle: "Cycle 47",
  /**
   * Subscriptions billed this cycle. The recovery batch is the slice that
   * failed, so this is the denominator behind the failure rate. Fixture value:
   * Eureka Labs is a demo merchant.
   */
  cycleSubscriptions: 1240,
} as const;

const COURSES = [
  "Applied Machine Learning",
  "LLM Systems",
  "Computer Vision",
  "MLOps Intensive",
  "Generative AI",
] as const;

export function eurekaCourse(caseId: string): string {
  const n = Number(caseId.replace("rc_", "")) || 1;
  return COURSES[(n - 1) % COURSES.length];
}

export function railLabel(rail: string): string {
  if (rail === "upi_autopay") return "UPI AutoPay";
  if (rail === "enach") return "eNACH";
  if (rail === "card") return "card";
  return rail;
}
