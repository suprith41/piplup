import { findLink } from "@/lib/razorpay/audit";
import { applyPaymentLinkPaid, parsePaymentLinkPaid, verifyWebhookSignature } from "@/lib/razorpay/webhooks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const raw = await request.text();
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET ?? "";
  if (!secret) {
    return Response.json({ error: "RAZORPAY_WEBHOOK_SECRET missing. Use the lab injector on localhost." }, { status: 401 });
  }

  const signature = request.headers.get("x-razorpay-signature");
  if (!verifyWebhookSignature(raw, signature, secret)) {
    return Response.json({ error: "Invalid signature." }, { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const paid = parsePaymentLinkPaid(body);
  if (!paid) {
    return Response.json({ ok: true, ignored: true });
  }

  const result = applyPaymentLinkPaid({ ...paid, source: "webhook" });
  if (!result.caseId) {
    return Response.json({ error: result.reason }, { status: 400 });
  }

  return Response.json({
    ok: true,
    ...result,
    linkUrl: findLink(result.caseId)?.shortUrl,
  });
}
