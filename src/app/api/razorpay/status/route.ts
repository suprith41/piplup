import { razorpayStatus, TEST_MODE_LINK_CAP } from "@/lib/razorpay/client";
import { casesNeedingLinks, describeDemoCases, DEMO_CASE_IDS } from "@/lib/razorpay/executor";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({
    ...razorpayStatus(),
    demoCaseIds: DEMO_CASE_IDS,
    demo: describeDemoCases(),
    needed: casesNeedingLinks(),
    cap: TEST_MODE_LINK_CAP,
  });
}
