import { readAudit } from "@/lib/razorpay/audit";
import { executeDemo, executeRecovery } from "@/lib/razorpay/executor";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ audit: readAudit() });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    caseId?: string;
    demo?: boolean;
    injectTimeout?: boolean;
  };

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
