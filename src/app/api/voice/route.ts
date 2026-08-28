import { findLink } from "@/lib/razorpay/audit";
import { DEMO_CASE_IDS } from "@/lib/razorpay/executor";
import { deskEvent, nightQueue, previewNudge } from "@/lib/autopilot/engine";
import { hinglishNudge } from "@/lib/recovery/copy";
import { appendLedger, isCasePaid } from "@/lib/recovery/ledger";
import { grantAdaptive } from "@/lib/recovery/policy";
import { parseReply } from "@/lib/recovery/reply";
import { runPolicy } from "@/lib/recovery/simulate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const LIVE = new Set<string>(DEMO_CASE_IDS);

export function GET(request: Request) {
  const caseId = new URL(request.url).searchParams.get("caseId") ?? "";
  if (!LIVE.has(caseId)) {
    return Response.json({ error: "Voice is only on the three live demo cases." }, { status: 400 });
  }
  return Response.json({ spoken: previewNudge(caseId) });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { caseId?: string; transcript?: string };
  const caseId = body.caseId?.trim();
  const transcript = body.transcript?.trim() ?? "";

  if (!caseId || !LIVE.has(caseId)) {
    return Response.json({ error: "Voice is only on the three live demo cases." }, { status: 400 });
  }
  if (!transcript) {
    return Response.json({ error: "Empty transcript." }, { status: 400 });
  }

  const before = nightQueue().find((row) => row.id === caseId);
  if (!before) {
    return Response.json({ error: "Unknown case." }, { status: 400 });
  }

  const parsed = parseReply(transcript, before.billingDay);
  const ignored = parsed.confidence < 0.6;
  const prior = grantAdaptive(before);

  appendLedger({
    kind: "voice",
    caseId,
    mutation: prior.mutation,
    clock: prior.clock,
    granted: !ignored,
    reason: ignored ? "Low confidence. Policy unchanged." : `Heard ${parsed.intent}.`,
    outcome: ignored ? "ignored" : "heard",
    transcript,
    intent: parsed.intent,
    confidence: parsed.confidence,
    linkUrl: findLink(caseId)?.shortUrl,
  });

  if (ignored) {
    return Response.json({
      ignored: true,
      parsed,
      spoken: hinglishNudge(before, prior),
      event: null,
    });
  }

  const c = nightQueue().find((row) => row.id === caseId);
  if (!c) {
    return Response.json({ error: "Unknown case after overlay." }, { status: 400 });
  }

  const decision = grantAdaptive(c);
  const attempt = runPolicy([c], "adaptive").attempts[0];
  const event = deskEvent(c, decision, isCasePaid(caseId), attempt.executed, {
    live: true,
    linkUrl: findLink(caseId)?.shortUrl,
  });

  return Response.json({
    ignored: false,
    parsed,
    spoken: hinglishNudge(c, decision),
    event,
  });
}

