import { readAudit } from "@/lib/razorpay/audit";
import { executeDemo, executeRecovery } from "@/lib/razorpay/executor";
import { applyPaymentLinkPaid } from "@/lib/razorpay/webhooks";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ audit: readAudit() });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    caseId?: string;
    demo?: boolean;
    injectTimeout?: boolean;
    markPaid?: boolean;
  };

  if (body.markPaid) {
    if (!body.caseId) {
      return Response.json({ error: "caseId required to mark paid" }, { status: 400 });
    }
    const result = applyPaymentLinkPaid({ caseId: body.caseId, source: "lab" });
    if (!result.caseId) {
      return Response.json({ error: result.reason }, { status: 400 });
    }
    return Response.json({ paid: result });
  }

  if (body.demo) {
    const rows = await executeDemo({ injectTimeout: body.injectTimeout });
    return Response.json({ rows });
  }

  if (!body.caseId) {
    return Response.json({ error: "caseId or demo required" }, { status: 400 });
  }

  const row = await executeRecovery(body.caseId, { injectTimeout: body.injectTimeout });
  return Response.json({ row });
}
