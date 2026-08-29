import { findLink } from "@/lib/razorpay/audit";
import { DEMO_CASE_IDS } from "@/lib/razorpay/executor";
import { deskEvent, nightQueue, previewNudge } from "@/lib/autopilot/engine";
import { parseReplySmart } from "@/lib/llm/extract";
import { groqStatus } from "@/lib/llm/groq";
import { spokenNudge } from "@/lib/llm/rewrite";
import { appendLedger, isCasePaid } from "@/lib/recovery/ledger";
import { grantAdaptive } from "@/lib/recovery/policy";
import { runPolicy } from "@/lib/recovery/simulate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const LIVE = new Set<string>(DEMO_CASE_IDS);

export async function GET(request: Request) {
  const caseId = new URL(request.url).searchParams.get("caseId") ?? "";
  if (!LIVE.has(caseId)) {
    return Response.json({ error: "Voice is only on the three live demo cases." }, { status: 400 });
  }
  const c = nightQueue().find((row) => row.id === caseId);
  if (!c) return Response.json({ spoken: "" });
  const decision = grantAdaptive(c);
  return Response.json({
    spoken: await spokenNudge(c, decision),
    groq: groqStatus(),
  });
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

  const parsed = await parseReplySmart(transcript, before.billingDay);
  const ignored = parsed.confidence < 0.6;
  const prior = grantAdaptive(before);

  appendLedger({
    kind: "voice",
    caseId,
    mutation: prior.mutation,
    clock: prior.clock,
    granted: !ignored,
    reason: ignored
      ? "Low confidence. Policy unchanged."
      : `Heard ${parsed.intent} (${parsed.source}).`,
    outcome: ignored ? "ignored" : "heard",
    transcript,
    intent: parsed.intent,
    confidence: parsed.confidence,
    promisedDay: parsed.promisedDay,
    source: parsed.source,
    linkUrl: findLink(caseId)?.shortUrl,
  });

  if (ignored) {
    return Response.json({
      ignored: true,
      parsed,
      spoken: await spokenNudge(before, prior),
      groq: groqStatus(),
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
    spoken: await spokenNudge(c, decision),
    groq: groqStatus(),
    event,
  });
}
