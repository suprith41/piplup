import { queuePreview } from "@/lib/autopilot/engine";
import { mailStatus } from "@/lib/email/send";
import { EUREKA } from "@/lib/merchant/eureka";
import { razorpayStatus } from "@/lib/razorpay/client";
import { evaluateBatch } from "@/lib/recovery/evaluate";
import { formatINR } from "@/lib/recovery/taxonomy";

export const dynamic = "force-dynamic";

export function GET() {
  const report = evaluateBatch();
  return Response.json({
    merchant: EUREKA,
    razorpay: razorpayStatus(),
    mail: mailStatus(),
    kpis: {
      atRisk: formatINR(Math.round(report.adaptive.rupeesAtRisk * 100)),
      recovered: formatINR(Math.round(report.adaptive.rupeesRecovered * 100)),
      t3: formatINR(Math.round(report.baseline.rupeesRecovered * 100)),
      lift: formatINR(Math.round(report.lift.incrementalRupees * 100)),
      churnAvoided: report.delta.churnAvoided,
      slotsSaved: report.delta.slotsSaved,
      cases: report.cases.length,
    },
    queue: queuePreview(),
  });
}

export async function POST(request: Request) {
  const { actOnCase } = await import("@/lib/autopilot/engine");
  const body = (await request.json().catch(() => ({}))) as {
    caseId?: string;
    live?: boolean;
    notify?: boolean;
  };
  if (!body.caseId) {
    return Response.json({ error: "caseId required" }, { status: 400 });
  }
  try {
    const event = await actOnCase(body.caseId, body.live !== false, { notify: body.notify });
    return Response.json({ event });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "act failed" },
      { status: 400 },
    );
  }
}
