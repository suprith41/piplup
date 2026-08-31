import { DEMO_INBOXES } from "../email/recipients.ts";
import { mailStatus, sendReminders } from "../email/send.ts";
import { eurekaCourse, railLabel } from "../merchant/eureka.ts";
import { findLink, liveLinks } from "../razorpay/audit.ts";
import { DEMO_CASE_IDS, executeRecovery } from "../razorpay/executor.ts";
import { hinglishNudge } from "../recovery/copy.ts";
import { isCasePaid, latestHeardVoice } from "../recovery/ledger.ts";
import { grantAdaptive, nextRail } from "../recovery/policy.ts";
import { applyParsedReply, applyVoiceOverlay, enrichWithReply } from "../recovery/reply.ts";
import { seedBatch } from "../recovery/seed.ts";
import { exposurePaise, runPolicy } from "../recovery/simulate.ts";
import { formatINR } from "../recovery/taxonomy.ts";
import type { ParsedReply, PolicyDecision, RecoveryCase } from "../recovery/types.ts";
import type { DeskEvent, IngressEvent, QueueItem } from "./types.ts";

export type { DeskEvent, IngressEvent, QueueItem } from "./types.ts";

const LIVE = new Set<string>(DEMO_CASE_IDS);

/** Demo students first so the reviewer sees real Razorpay + mail in the opening seconds. */
export function nightQueue(): RecoveryCase[] {
  const all = seedBatch().map(enrichWithReply).map(withVoiceOverlay);
  const head = DEMO_CASE_IDS.map((id) => all.find((row) => row.id === id)).filter(
    (row): row is RecoveryCase => Boolean(row),
  );
  const rest = all.filter((row) => !LIVE.has(row.id));
  return [...head, ...rest];
}

function withVoiceOverlay(c: RecoveryCase): RecoveryCase {
  const voice = latestHeardVoice(c.id);
  if (!voice?.transcript) return c;

  const parsed = parsedFromLedger(voice);
  if (parsed) return applyParsedReply(c, parsed);
  return applyVoiceOverlay(c, voice.transcript);
}

function parsedFromLedger(voice: { transcript?: string; intent?: string; confidence?: number; promisedDay?: number; source?: string }): ParsedReply | null {
  const intents = new Set(["promise_to_pay", "already_paid", "dispute", "opt_out", "unclear"]);
  if (!voice.transcript || !voice.intent || !intents.has(voice.intent)) return null;
  if ((voice.confidence ?? 0) < 0.6) return null;
  return {
    raw: voice.transcript,
    intent: voice.intent as ParsedReply["intent"],
    promisedDay: voice.promisedDay,
    confidence: voice.confidence ?? 0.6,
    source: voice.source === "llm" ? "llm" : "rules",
  };
}

export function queuePreview(): QueueItem[] {
  const minted = new Map(liveLinks().map((row) => [row.caseId, row.link.shortUrl]));
  return nightQueue().map((c) => ({
    id: c.id,
    name: c.customerName,
    amount: formatINR(exposurePaise(c)),
    amountPaise: exposurePaise(c),
    decline: c.declineCode,
    klass: c.trueClass,
    rail: c.rail,
    bank: c.bank,
    course: eurekaCourse(c.id),
    live: LIVE.has(c.id),
    linkUrl: minted.get(c.id),
    inbound: c.customerReply,
    promiseToPayDay: c.promiseToPayDay,
    claimedPaid: c.claimedPaid,
    parsedIntent: c.parsedReply?.intent,
  }));
}

export function ingressFor(c: RecoveryCase): IngressEvent {
  return {
    type: "ingress",
    at: new Date().toISOString(),
    caseId: c.id,
    name: c.customerName,
    amount: formatINR(exposurePaise(c)),
    decline: c.declineCode,
    rail: c.rail,
    bank: c.bank,
    course: eurekaCourse(c.id),
    source: webhookSource(c),
    live: LIVE.has(c.id),
  };
}

export async function actOnCase(
  caseId: string,
  live: boolean,
  options: { notify?: boolean } = {},
): Promise<DeskEvent> {
  const c = nightQueue().find((row) => row.id === caseId);
  if (!c) {
    throw new Error(`Unknown case ${caseId}`);
  }

  const decision = grantAdaptive(c);
  const score = runPolicy([c], "adaptive");
  const attempt = score.attempts[0];
  const isLiveTarget = live && LIVE.has(caseId);
  const shouldNotify = options.notify === true;

  let linkUrl = findLink(caseId)?.shortUrl;
  let emailed = false;
  let emailError: string | undefined;

  if (isLiveTarget && decision.allowed) {
    const audit = await executeRecovery(caseId);
    linkUrl = audit.link?.shortUrl ?? linkUrl;
    const inbox = DEMO_INBOXES.find((row) => row.caseId === caseId);
    if (shouldNotify && inbox && mailStatus().configured && audit.outcome !== "failed") {
      const sent = await sendReminders([inbox.email]);
      emailed = Boolean(sent[0]?.ok);
      emailError = sent[0]?.ok ? undefined : sent[0]?.error;
    }
  }

  const recovered = isLiveTarget ? isCasePaid(caseId) : attempt.recovered;

  return deskEvent(c, decision, recovered, attempt.executed, {
    live: isLiveTarget,
    linkUrl,
    emailed,
    emailError,
  });
}

export function deskEvent(
  c: RecoveryCase,
  decision: PolicyDecision,
  recovered: boolean,
  executed: boolean,
  extra: Partial<DeskEvent> = {},
): DeskEvent {
  return {
    at: extra.at ?? new Date().toISOString(),
    caseId: c.id,
    name: c.customerName,
    amount: formatINR(exposurePaise(c)),
    amountPaise: exposurePaise(c),
    decline: c.declineCode,
    rail: c.rail,
    bank: c.bank,
    klass: c.trueClass,
    course: eurekaCourse(c.id),
    clock: decision.clock,
    mutation: decision.mutation,
    npciSlotsUsed: decision.npciSlotsUsed,
    npciSlotsLeftAfter: decision.npciSlotsLeftAfter,
    cooldownSeconds: decision.cooldownSeconds,
    action:
      extra.live && recovered
        ? "Payment Link paid. Case closed."
        : actionLine(c, decision, recovered, executed),
    recovered,
    stopped: !executed,
    reason: decision.reason,
    live: extra.live ?? false,
    inbound: c.customerReply,
    linkUrl: extra.linkUrl,
    emailed: extra.emailed,
    emailError: extra.emailError,
    promiseToPayDay: c.promiseToPayDay,
    claimedPaid: c.claimedPaid,
    scheduledDay: decision.scheduledDay,
    scheduledHourIST: decision.scheduledHourIST,
    parsedIntent: c.parsedReply?.intent,
  };
}

export function previewNudge(caseId: string): string {
  const c = nightQueue().find((row) => row.id === caseId);
  if (!c) return "";
  return hinglishNudge(c, grantAdaptive(c));
}

function webhookSource(c: RecoveryCase): string {
  if (c.trueClass === "behavioral") return "checkout.abandoned";
  if (c.trueClass === "uncollected") return "invoice.uncollected";
  if (c.mandateState === "revoked") return "subscription.mandate.revoked";
  return "subscription.charged.failed";
}

function actionLine(
  c: RecoveryCase,
  decision: PolicyDecision,
  recovered: boolean,
  executed: boolean,
): string {
  if (!executed || decision.clock === "stop") {
    return `Stopped. ${decision.stopReason ?? decision.reason}`;
  }
  switch (decision.mutation) {
    case "cooldown_retry":
      return `${c.bank} switch was lagging. Held ${decision.cooldownSeconds ?? 8}s and re-presented on ${railLabel(c.rail)} — no second rail needed.`;
    case "next_rail":
      return `${c.bank} down on ${railLabel(c.rail)}. Cascaded to ${railLabel(nextRail(c.rail))} in the same second.`;
    case "payment_link":
      if (c.promiseToPayDay && !recovered) {
        return `Held until day ${c.promiseToPayDay}. We will not chase before then.`;
      }
      return recovered
        ? "Minted a one-tap Payment Link. Did not replay the dead debit."
        : "Payment Link queued.";
    case "mandate_reauth":
      if (c.promiseToPayDay && !recovered) {
        return `Held until day ${c.promiseToPayDay}. We will not chase before then.`;
      }
      if (decision.clock === "terminal_mutation") {
        return "Mandate revoked. Spent 0 of 3 NPCI retries and asked for a fresh AutoPay instead.";
      }
      return "Asked the student to wake UPI AutoPay. Same mandate is dead.";
    case "back_charge_invoices":
      return "Swept invoices Razorpay left sitting after the subscription revived.";
    case "same_rail_retry": {
      if (!decision.scheduledDay) return "Retrying the same rail now.";
      const at =
        decision.scheduledHourIST === undefined
          ? `day ${decision.scheduledDay}`
          : `day ${decision.scheduledDay}, ${String(decision.scheduledHourIST).padStart(2, "0")}:00`;
      const held = (decision.attempts?.length ?? 1) > 1 ? " One window held in reserve." : "";
      return `Best of ${decision.timing?.considered ?? 0} windows: ${at}, after the salary posts.${held}`;
    }
    default:
      return decision.reason;
  }
}
