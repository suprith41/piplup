import type { ParsedReply, RecoveryCase } from "./types.ts";

const OPT_OUT = /\b(stop|band karo|mat bhejo|unsubscribe|cancel kar|nahi chahiye)\b/i;
const ALREADY_PAID = /\b(kar diya|ho gaya|paid|payment done|de diya)\b/i;
const DISPUTE = /\b(galat|wrong|dispute|maine nahi|charge kyu|refund)\b/i;
const PROMISE = /\b(karunga|karungi|kar dunga|kar dungi|de dunga|de dungi|pay karunga|i'?ll pay|will pay|salary|tankha|baad me)\b/i;

const DAY = /\b([0-3]?\d)\s*(?:tarikh|tareek|th|st|nd|rd)?\b/;
const MONTH_END = /\b(month end|mahine ke end|last week)\b/i;

/**
 * Rule-based English / Hinglish reply parser.
 *
 * Deliberately conservative: anything it is not sure about comes back as
 * "unclear" with low confidence so the policy engine ignores it.
 */
export function parseReply(raw: string, billingDay: number): ParsedReply {
  const text = raw.trim();

  if (OPT_OUT.test(text)) {
    return { raw, intent: "opt_out", confidence: 0.95, source: "rules" };
  }
  if (DISPUTE.test(text)) {
    return { raw, intent: "dispute", confidence: 0.9, source: "rules" };
  }
  if (ALREADY_PAID.test(text)) {
    return { raw, intent: "already_paid", confidence: 0.7, source: "rules" };
  }

  if (PROMISE.test(text)) {
    const day = extractDay(text, billingDay);
    return {
      raw,
      intent: "promise_to_pay",
      promisedDay: day,
      confidence: day ? 0.85 : 0.5,
      source: "rules",
    };
  }

  return { raw, intent: "unclear", confidence: 0.2, source: "rules" };
}

function extractDay(text: string, billingDay: number): number | undefined {
  if (MONTH_END.test(text)) return 28;

  const match = text.match(DAY);
  if (!match) return undefined;

  const day = Number(match[1]);
  if (!Number.isFinite(day) || day < 1 || day > 31) return undefined;
  // A promise for a day that already passed means next cycle; out of scope.
  if (day < billingDay) return undefined;
  return day;
}

function applyParsedReply(c: RecoveryCase, parsed: ParsedReply): RecoveryCase {
  const enriched: RecoveryCase = {
    ...c,
    customerReply: parsed.raw,
    optedOut: false,
    claimedPaid: false,
    chargeback: c.declineCode === "chargeback",
    promiseToPayDay: undefined,
    parsedReply: parsed,
  };

  if (parsed.confidence < 0.6) return enriched;

  if (parsed.intent === "opt_out") enriched.optedOut = true;
  if (parsed.intent === "dispute") enriched.chargeback = true;
  if (parsed.intent === "already_paid") enriched.claimedPaid = true;
  if (parsed.intent === "promise_to_pay" && parsed.promisedDay) {
    enriched.promiseToPayDay = parsed.promisedDay;
  }

  return enriched;
}

/**
 * Turn an inbound message into structured state before policy runs.
 * Promise dates are derived here, not handed to us by the fixture.
 */
export function enrichWithReply(c: RecoveryCase): RecoveryCase {
  if (!c.customerReply) return c;
  return applyParsedReply(c, parseReply(c.customerReply, c.billingDay));
}
