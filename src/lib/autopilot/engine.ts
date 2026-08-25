import { DEMO_INBOXES } from "../email/recipients.ts";
import { mailStatus, sendReminders } from "../email/send.ts";
import { eurekaCourse, railLabel } from "../merchant/eureka.ts";
import { DEMO_CASE_IDS, executeRecovery } from "../razorpay/executor.ts";
import { grantAdaptive, nextRail } from "../recovery/policy.ts";
import { enrichWithReply } from "../recovery/reply.ts";
import { seedBatch } from "../recovery/seed.ts";
import { exposurePaise, runPolicy } from "../recovery/simulate.ts";
import { formatINR } from "../recovery/taxonomy.ts";
import type { PolicyDecision, RecoveryCase } from "../recovery/types.ts";
import type { DeskEvent, IngressEvent, QueueItem } from "./types.ts";

export type { DeskEvent, IngressEvent, QueueItem } from "./types.ts";

const LIVE = new Set<string>(DEMO_CASE_IDS);

/** Demo students first so the reviewer sees real Razorpay + mail in the opening seconds. */
export function nightQueue(): RecoveryCase[] {
  const all = seedBatch().map(enrichWithReply);
  const head = DEMO_CASE_IDS.map((id) => all.find((row) => row.id === id)).filter(
    (row): row is RecoveryCase => Boolean(row),
  );
  const rest = all.filter((row) => !LIVE.has(row.id));
  return [...head, ...rest];
}

export function queuePreview(): QueueItem[] {
  return nightQueue().map((c) => ({
    id: c.id,
    name: c.customerName,
    amount: formatINR(exposurePaise(c)),
    amountPaise: exposurePaise(c),
    decline: c.declineCode,
    klass: c.trueClass,
    rail: c.rail,
    course: eurekaCourse(c.id),
    live: LIVE.has(c.id),
    inbound: c.customerReply,
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

  let linkUrl: string | undefined;
  let emailed = false;
  let emailError: string | undefined;

  if (isLiveTarget) {
    const audit = await executeRecovery(caseId);
    linkUrl = audit.link?.shortUrl;
    const inbox = DEMO_INBOXES.find((row) => row.caseId === caseId);
    if (shouldNotify && inbox && mailStatus().configured && audit.outcome !== "failed") {
      const sent = await sendReminders([inbox.email]);
      emailed = Boolean(sent[0]?.ok);
      emailError = sent[0]?.ok ? undefined : sent[0]?.error;
    }
  }

  return {
    at: new Date().toISOString(),
    caseId: c.id,
    name: c.customerName,
    amount: formatINR(exposurePaise(c)),
    amountPaise: exposurePaise(c),
    decline: c.declineCode,
    rail: c.rail,
    klass: c.trueClass,
    course: eurekaCourse(c.id),
    clock: decision.clock,
    mutation: decision.mutation,
    action: actionLine(c, decision, attempt.recovered, attempt.executed),
    recovered: attempt.recovered,
    stopped: !attempt.executed,
    reason: decision.reason,
    live: isLiveTarget,
    inbound: c.customerReply,
    linkUrl,
    emailed,
    emailError,
  };
}

function webhookSource(c: RecoveryCase): string {
  if (c.trueClass === "behavioral") return "checkout.abandoned";
  if (c.trueClass === "uncollected") return "invoice.uncollected";
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
    case "next_rail":
      return `Cascaded ${railLabel(c.rail)} → ${railLabel(nextRail(c.rail))} in the same second.`;
    case "payment_link":
      return recovered
        ? "Minted a one-tap Payment Link. Did not replay the dead debit."
        : "Payment Link queued.";
    case "mandate_reauth":
      return "Asked the student to wake UPI AutoPay. Same mandate is dead.";
    case "back_charge_invoices":
      return "Swept invoices Razorpay left sitting after the subscription revived.";
    case "same_rail_retry":
      return decision.scheduledDay
        ? `Parked until day ${decision.scheduledDay}. Liquidity comes back; spam does not.`
        : "Retrying the same rail now.";
    default:
      return decision.reason;
  }
}
