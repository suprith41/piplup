import { hinglishNudge } from "../recovery/copy.ts";
import type { PolicyDecision, RecoveryCase } from "../recovery/types.ts";
import { groqChat, groqStatus } from "./groq.ts";

/**
 * Speak after the policy grant. Facts come from the template; Groq only rewrites.
 */
export async function spokenNudge(c: RecoveryCase, decision: PolicyDecision): Promise<string> {
  const template = hinglishNudge(c, decision);
  if (!template) return "";
  if (!groqStatus().configured) return template;

  const rewritten = await groqChat({
    temperature: 0.3,
    maxTokens: 160,
    system: `You rewrite a spoken Hinglish line for a recovery phone call.
Keep every fact in the template: the name, stop vs wait vs pay-link, and any calendar day.
Do not add new offers, threats, discounts, or a different date.
One or two short spoken sentences. Hinglish, not formal Hindi, not English-only.
Return only the line.`,
    user: template,
  });

  const line = rewritten?.replace(/^["']|["']$/g, "").trim();
  if (!line || line.length > 320) return template;
  return line;
}
