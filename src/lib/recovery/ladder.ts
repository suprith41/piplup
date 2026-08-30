import { CHANNEL_COST_PAISE } from "./cost.ts";
import type { LadderStep, PolicyDecision, RecoveryCase } from "./types.ts";

/**
 * The bounded workflow. A policy grant says what to do once; this says how the
 * whole cycle plays out, including when we give up.
 *
 * Every step is generated deterministically from the grant, so the plan on
 * screen and the money in the scoreboard come from the same object. Steps after
 * the one that recovers are marked skipped and cost nothing.
 */

/** Customer contact only inside daylight hours IST. Silent rail work is exempt. */
export const CONTACT_HOUR_IST = 10;
export const QUIET_HOURS_IST = "21:00–09:00";

/** Hard ceiling on outbound messages per case per cycle, whatever the ladder wants. */
export const MAX_CONTACTS_PER_CYCLE = 3;

/** Above this, a human looks at the case before the cycle closes. */
export const HUMAN_REVIEW_THRESHOLD_PAISE = 100000;

export interface Ladder {
  caseId: string;
  steps: LadderStep[];
  /** Only the steps that actually ran. This is what the scoreboard is charged for. */
  spentPaise: number;
  npciSlots: number;
  contactsUsed: number;
  stopsOnDay: number;
  guardrails: string[];
  needsHumanReview: boolean;
}

interface Draft {
  day: number;
  action: LadderStep["action"];
  channel: LadderStep["channel"];
  note: string;
  /** Runs regardless of outcome. Anything else is skipped once the money is in. */
  always?: boolean;
}

const COST: Record<LadderStep["channel"], number> = {
  silent: CHANNEL_COST_PAISE.silent,
  npci: CHANNEL_COST_PAISE.silent,
  whatsapp: CHANNEL_COST_PAISE.whatsapp,
  sms: CHANNEL_COST_PAISE.sms,
  email: CHANNEL_COST_PAISE.email,
  notice: CHANNEL_COST_PAISE.preDebitNotice,
};

function isContact(channel: LadderStep["channel"]): boolean {
  return channel === "whatsapp" || channel === "sms" || channel === "email";
}

export function buildLadder(c: RecoveryCase, decision: PolicyDecision, recovered: boolean): Ladder {
  const drafts = draftsFor(c, decision);
  const steps: LadderStep[] = [];

  let contactsUsed = 0;
  let settled = false;

  for (const draft of drafts) {
    const cappedOut = isContact(draft.channel) && contactsUsed >= MAX_CONTACTS_PER_CYCLE;
    // A step runs unless the money already landed, or the contact cap is hit.
    const skipped = draft.action === "stop" ? false : (settled && !draft.always) || cappedOut;

    steps.push({
      day: draft.day,
      hourIST: draft.channel === "silent" || draft.channel === "npci" ? 0 : CONTACT_HOUR_IST,
      action: draft.action,
      channel: draft.channel,
      costPaise: skipped ? 0 : COST[draft.channel],
      npciSlotsUsed: skipped || draft.channel !== "npci" ? 0 : 1,
      skipped,
      note: cappedOut ? `${draft.note} Held: ${MAX_CONTACTS_PER_CYCLE}-contact cap reached.` : draft.note,
    });

    if (!skipped && isContact(draft.channel)) contactsUsed += 1;
    // Everything after the money-moving step is contingent on it having failed.
    if (!skipped && recovered && movesMoney(draft.action)) settled = true;
  }

  const stopStep = steps.find((s) => s.action === "stop");

  return {
    caseId: c.id,
    steps,
    spentPaise: steps.reduce((sum, s) => sum + s.costPaise, 0),
    npciSlots: steps.reduce((sum, s) => sum + s.npciSlotsUsed, 0),
    contactsUsed,
    stopsOnDay: stopStep?.day ?? decision.scheduledDay ?? c.billingDay,
    guardrails: guardrailsFor(c, decision),
    needsHumanReview: exposureFor(c) >= HUMAN_REVIEW_THRESHOLD_PAISE && !recovered,
  };
}

/**
 * The control's workflow, modelled as it is documented rather than as we would
 * write it: same debit every morning, a failure email each time, then halted.
 * Our guardrails are deliberately not applied here — capping the baseline's
 * messages would flatter its cost.
 */
export function buildCalendarLadder(c: RecoveryCase, shots: number, failedShots: number): Ladder {
  const steps: LadderStep[] = [];

  for (let i = 1; i <= shots; i += 1) {
    const failed = i <= failedShots;
    steps.push({
      day: c.billingDay + i,
      hourIST: 0,
      action: "debit",
      channel: "npci",
      costPaise: 0,
      npciSlotsUsed: 1,
      skipped: false,
      note: failed ? `T+${i}: same rail, same mandate. Failed.` : `T+${i}: same rail, same mandate. Cleared.`,
    });
    if (!failed) break;
    steps.push({
      day: c.billingDay + i,
      hourIST: CONTACT_HOUR_IST,
      action: "final_notice",
      channel: "email",
      costPaise: COST.email,
      npciSlotsUsed: 0,
      skipped: false,
      note: "Automatic failure email with a hosted card-change link.",
    });
    steps.push({
      day: c.billingDay + i,
      hourIST: CONTACT_HOUR_IST,
      action: "nudge",
      channel: "sms",
      costPaise: COST.sms,
      npciSlotsUsed: 0,
      skipped: false,
      note: "SMS alongside the email. No decline-code awareness.",
    });
  }

  steps.push({
    day: c.billingDay + shots + 1,
    hourIST: 0,
    action: "stop",
    channel: "silent",
    costPaise: 0,
    npciSlotsUsed: 0,
    skipped: false,
    note: failedShots >= shots ? "Retry cycle exhausted. Subscription halted." : "Recovered on the calendar.",
  });

  return {
    caseId: c.id,
    steps,
    spentPaise: steps.reduce((sum, s) => sum + s.costPaise, 0),
    npciSlots: steps.reduce((sum, s) => sum + s.npciSlotsUsed, 0),
    contactsUsed: steps.filter((s) => isContact(s.channel)).length,
    stopsOnDay: c.billingDay + shots + 1,
    guardrails: ["None. The calendar retries every failure class on the same mandate."],
    needsHumanReview: false,
  };
}

function exposureFor(c: RecoveryCase): number {
  return c.uncollectedInvoicesPaise ?? c.amountPaise;
}

function movesMoney(action: LadderStep["action"]): boolean {
  return action === "silent_retry" || action === "debit" || action === "link" || action === "sweep";
}

function guardrailsFor(c: RecoveryCase, decision: PolicyDecision): string[] {
  const rails = [
    `Contact only ${CONTACT_HOUR_IST}:00 IST. Quiet hours ${QUIET_HOURS_IST}.`,
    `Max ${MAX_CONTACTS_PER_CYCLE} outbound messages this cycle.`,
    `Max ${decision.npciSlotsUsed} NPCI debit${decision.npciSlotsUsed === 1 ? "" : "s"} on this mandate.`,
  ];
  if (decision.preDebitNoticeDay) {
    rails.push(`RBI pre-debit notice on day ${decision.preDebitNoticeDay}, 24h before the debit.`);
  }
  if (c.domesticCard && c.rail === "card") {
    rails.push("Domestic card: no merchant-initiated charge. Customer completes the link.");
  }
  if (exposureFor(c) >= HUMAN_REVIEW_THRESHOLD_PAISE) {
    rails.push("High value: routed to a human before the cycle closes.");
  }
  return rails;
}

function draftsFor(c: RecoveryCase, decision: PolicyDecision): Draft[] {
  const start = decision.scheduledDay && decision.scheduledDay > 0 ? decision.scheduledDay : c.billingDay;

  if (decision.clock === "stop") {
    return [
      {
        day: c.billingDay,
        action: "stop",
        channel: "silent",
        note: decision.stopReason ?? decision.reason,
        always: true,
      },
    ];
  }

  if (decision.clock === "sync_cascade") {
    const first =
      decision.mutation === "cooldown_retry"
        ? `Hold ${decision.cooldownSeconds ?? 8}s, re-present on the same rail. Customer sees nothing.`
        : `Cascade to the backup rail in the same second. Customer sees nothing.`;
    return [
      { day: c.billingDay, action: "silent_retry", channel: "npci", note: first },
      { day: c.billingDay + 1, action: "nudge", channel: "whatsapp", note: "Rail work did not clear it. One link, next morning." },
      { day: c.billingDay + 3, action: "final_notice", channel: "email", note: "Last written notice before we close the cycle." },
      { day: c.billingDay + 5, action: "stop", channel: "silent", note: "Cycle closed. No further contact until the next billing date." },
    ];
  }

  if (decision.clock === "terminal_mutation") {
    return [
      { day: start, action: "reauth", channel: "whatsapp", note: "Mandate is revoked. Ask for a fresh AutoPay. Zero NPCI slots spent." },
      { day: start + 3, action: "final_notice", channel: "email", note: "Second and last ask. We never retry the dead mandate." },
      { day: start + 5, action: "stop", channel: "silent", note: "Mandate stays revoked. Stop contacting." },
    ];
  }

  if (decision.mutation === "back_charge_invoices") {
    return [
      { day: start, action: "notice", channel: "email", note: "Tell the customer we are charging the invoices their revived subscription left unpaid." },
      { day: start, action: "sweep", channel: "silent", note: "Charge the uncollected invoices. No mandate debit involved." },
      { day: start + 3, action: "stop", channel: "silent", note: "Sweep window closed." },
    ];
  }

  if (decision.mutation === "same_rail_retry") {
    const steps: Draft[] = [];
    if (decision.preDebitNoticeDay) {
      steps.push({
        day: decision.preDebitNoticeDay,
        action: "notice",
        channel: "notice",
        note: "RBI pre-debit notice. The debit cannot move to a new date without it.",
        always: true,
      });
    }
    steps.push(
      { day: start, action: "nudge", channel: "whatsapp", note: "Heads-up on the morning we debit, so it is not a surprise." },
      { day: start, action: "debit", channel: "npci", note: "One debit, on the day the money is actually there." },
      { day: start + 2, action: "final_notice", channel: "email", note: "Debit missed. Written notice, no second debit." },
      { day: start + 4, action: "stop", channel: "silent", note: "Budget and patience both spent. Close the cycle." },
    );
    return steps;
  }

  // payment_link and mandate_reauth on the dunning clock
  return [
    { day: start, action: "link", channel: "whatsapp", note: "One-tap link on the day we agreed. No auto-debit." },
    { day: start + 2, action: "nudge", channel: "email", note: "Link unused. One written reminder." },
    { day: start + 4, action: "final_notice", channel: "whatsapp", note: "Final ask before the seat goes on hold." },
    { day: start + 6, action: "stop", channel: "silent", note: "Cycle closed. Nothing further until the next billing date." },
  ];
}
