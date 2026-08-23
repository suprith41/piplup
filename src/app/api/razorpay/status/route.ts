import { razorpayStatus } from "@/lib/razorpay/client";
import { describeDemoCases, DEMO_CASE_IDS } from "@/lib/razorpay/executor";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({
    ...razorpayStatus(),
    demoCaseIds: DEMO_CASE_IDS,
    demo: describeDemoCases(),
  });
}
