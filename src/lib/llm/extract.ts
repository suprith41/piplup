import { parseReply } from "../recovery/reply.ts";
import type { ParsedReply, ReplyIntent } from "../recovery/types.ts";
import { groqChat, groqStatus } from "./groq.ts";

const INTENTS = new Set<ReplyIntent>(["promise_to_pay", "already_paid", "dispute", "opt_out", "unclear"]);

/**
 * Live voice only. Rules first as a floor, Groq if the key is set.
 * Malformed or low-confidence Groq output falls back to rules.
 * Policy never sees the raw model text — only this typed object.
 */
export async function parseReplySmart(raw: string, billingDay: number): Promise<ParsedReply> {
  const rules = parseReply(raw, billingDay);
  if (!groqStatus().configured) return rules;

  const llm = await extractWithGroq(raw, billingDay);
  if (!llm) return rules;

  // A confident rule match (opt-out / dispute) wins over a vague model.
  if (rules.confidence >= 0.9 && llm.confidence < 0.9) return rules;

  return llm.confidence >= rules.confidence ? llm : rules;
}

async function extractWithGroq(raw: string, billingDay: number): Promise<ParsedReply | null> {
  const content = await groqChat({
    json: true,
    maxTokens: 120,
    system: `You extract intent from an Indian student's reply about a failed Eureka Labs course payment.
Return JSON only:
{"intent":"opt_out"|"already_paid"|"promise_to_pay"|"dispute"|"unclear","promisedDay":null,"confidence":0.0}
Rules:
- opt_out: they asked to stop messages / cancel contact.
- already_paid: they claim this charge already went through.
- dispute: they say the charge is wrong or they never subscribed.
- promise_to_pay: they will pay later. promisedDay is 1-31 only if they named a date. Month end = 28. If no date, promisedDay null and confidence 0.45.
- unclear: anything else, confidence 0.2.
- Never invent a date. Never pick a retry. Language may be Hinglish or English.`,
    user: `Billing day this cycle: ${billingDay}.\nStudent said: ${raw}`,
  });

  if (!content) return null;

  let parsed: {
    intent?: string;
    promisedDay?: number | null;
    confidence?: number;
  };
  try {
    parsed = JSON.parse(content) as typeof parsed;
  } catch {
    return null;
  }

  const intent = parsed.intent as ReplyIntent | undefined;
  if (!intent || !INTENTS.has(intent)) return null;

  const confidence = clamp(parsed.confidence ?? 0.2);
  let promisedDay: number | undefined;
  if (intent === "promise_to_pay" && parsed.promisedDay != null) {
    const day = Number(parsed.promisedDay);
    if (Number.isInteger(day) && day >= billingDay && day <= 31) promisedDay = day;
  }

  if (intent === "promise_to_pay" && !promisedDay) {
    return { raw, intent, confidence: Math.min(confidence, 0.5), source: "llm" };
  }

  return { raw, intent, promisedDay, confidence, source: "llm" };
}

function clamp(n: number): number {
  if (!Number.isFinite(n)) return 0.2;
  return Math.min(1, Math.max(0, n));
}
