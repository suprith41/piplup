import { bankSignalFor, classifyDecline, isContactFrozen, isRevokedMandate } from "./taxonomy.ts";
import type {
  Clock,
  Mutation,
  PolicyDecision,
  RecoveryCase,
  RetryEnvelope,
  ScheduledAttempt,
  TimingExplanation,
} from "./types.ts";
import { bestContactDay, DEFAULT_ENVELOPE, MIN_CLEAR_PROBABILITY, planWindows } from "./windows.ts";

/** NPCI allows 1 original debit plus 3 retries on a mandate. That is the whole budget. */
export const NPCI_MAX_ATTEMPTS = 4;

/**
 * The merchant owns the boundary; the model owns everything inside it.
 *
 * Stripe lets a business set the drop-dead day and the max attempts and then
 * scores the retry times itself. The same split, except NPCI already fixed our
 * ceiling: whatever the merchant asks for, a mandate gets 1 original debit plus
 * 3 retries and no more.
 */
export function envelopeFor(c: RecoveryCase, override?: Partial<RetryEnvelope>): RetryEnvelope {
  const merchant = { ...DEFAULT_ENVELOPE, ...override };
  return {
    dropDeadDay: Math.min(Math.max(merchant.dropDeadDay, c.billingDay), 28),
    maxAttempts: Math.max(
      0,
      Math.min(merchant.maxAttempts, NPCI_MAX_ATTEMPTS - 1, Math.max(0, c.retryBudgetLeft)),
    ),
    finalAction: merchant.finalAction,
  };
}

/** A slow switch clears in seconds. Long enough to matter, short enough to stay in-session. */
export const MICRO_COOLDOWN_SECONDS = 8;

/** Only a mandate debit spends an NPCI slot. Links, re-auth and sweeps do not. */
const SLOT_SPENDING = new Set<Mutation>(["same_rail_retry", "cooldown_retry", "next_rail"]);

const NEXT_RAIL: Record<RecoveryCase["rail"], RecoveryCase["rail"]> = {
  upi_autopay: "card",
  card: "upi_autopay",
  enach: "upi_autopay",
};

export function nextRail(rail: RecoveryCase["rail"]): RecoveryCase["rail"] {
  return NEXT_RAIL[rail];
}

export function spendsNpciSlot(mutation: Mutation): boolean {
  return SLOT_SPENDING.has(mutation);
}

/**
 * Hard gates. The LLM never calls this — the executor does.
 * Money does not move without a grant from here.
 *
 * Three ways to act, in the order we check them:
 *
 *   terminal mutation  dead mandate, live customer. Re-authorise out of band.
 *   sync cascade       bank-side glitch. Hold or switch rail before anyone notices.
 *   async dunning      no money or no instrument. Wait for liquidity, or hand over a link.
 *
 * Anything that is neither recoverable nor contactable falls through to a stop.
 */
export function grantAdaptive(c: RecoveryCase, override?: Partial<RetryEnvelope>): PolicyDecision {
  const inferredClass = classifyDecline(c);
  const envelope = envelopeFor(c, override);

  if (c.optedOut) {
    return stop(c, inferredClass, "Customer opted out. Contact freeze.");
  }
  if (c.claimedPaid) {
    return stop(c, inferredClass, "Customer says already paid. Freeze until we reconcile.");
  }
  if (isContactFrozen(c)) {
    return stop(c, inferredClass, "Disputed or flagged do-not-retry. Neither a debit nor a message is safe here.");
  }

  if (inferredClass === "terminal") {
    // The mandate is gone, so no retry can ever work. The customer is still
    // reachable, and re-authorising costs zero NPCI slots — so this is a
    // mutation, not a stop.
    if (isRevokedMandate(c)) {
      return allow(c, {
        inferredClass,
        clock: "terminal_mutation",
        mutation: "mandate_reauth",
        scheduledDay: c.promiseToPayDay ?? c.billingDay,
        reason:
          "Mandate revoked. Every retry from here is a wasted NPCI slot, so we spend none and ask for a fresh AutoPay instead.",
      });
    }
    return stop(c, inferredClass, "Terminal decline. Retrying burns an NPCI slot and can trigger network penalties.");
  }

  if (inferredClass === "uncollected") {
    return allow(c, {
      inferredClass,
      clock: "async_dunning",
      mutation: "back_charge_invoices",
      scheduledDay: c.revivedOnDay ?? c.billingDay,
      reason:
        "Subscription revived after halt. Razorpay creates those invoices but never charges them, so the money sits uncollected until someone sweeps it.",
    });
  }

  if (inferredClass === "technical") {
    return cascade(c, inferredClass);
  }

  if (inferredClass === "instrument") {
    const mutation: Mutation =
      c.mandateState === "paused" || c.declineCode === "mandate_paused" ? "mandate_reauth" : "payment_link";
    return allow(c, {
      inferredClass,
      clock: "async_dunning",
      mutation,
      scheduledDay: bestContactDay(c, envelope),
      reason: c.promiseToPayDay
        ? `Dead instrument. Customer promised day ${c.promiseToPayDay}. Hold the recovery link until then.`
        : "Dead or stale instrument. Mutate the instrument — do not replay the same mandate.",
    });
  }

  if (inferredClass === "behavioral") {
    return allow(c, {
      inferredClass,
      clock: "async_dunning",
      mutation: "payment_link",
      scheduledDay: bestContactDay(c, envelope),
      reason: c.promiseToPayDay
        ? `Checkout dropped. Customer promised day ${c.promiseToPayDay}. Do not chase before then.`
        : "Checkout dropped after instrument select. Send a one-time recovery link, do not auto-debit.",
    });
  }

  // financial

  // Razorpay does not permit manual charge on an Indian domestic card, so the
  // only compliant path is a link the customer completes themselves.
  if (c.domesticCard && c.rail === "card") {
    return allow(c, {
      inferredClass,
      clock: "async_dunning",
      mutation: "payment_link",
      scheduledDay: bestContactDay(c, envelope),
      reason: "Domestic card: manual charge is not supported. Recovery has to go through a customer-completed link.",
    });
  }

  // Score every hour of every day inside the envelope and take the best slot,
  // rather than reading one signal and adding a fixed offset to the due date.
  const plan = planWindows(c, envelope);
  const first = plan.chosen[0];

  if (!first) {
    // Nothing in the window clears the floor, so the slot is worth more unspent.
    return allow(c, {
      inferredClass,
      clock: "async_dunning",
      mutation: "payment_link",
      scheduledDay: bestContactDay(c, envelope),
      reason: `No window in the next ${envelope.dropDeadDay - c.billingDay} days scores above the ${Math.round(
        MIN_CLEAR_PROBABILITY * 100,
      )}% floor, so the NPCI slot stays unspent and the customer gets a link instead.`,
    });
  }

  return allow(c, {
    inferredClass,
    clock: "async_dunning",
    mutation: "same_rail_retry",
    scheduledDay: first.day,
    scheduledHourIST: first.hourIST,
    attempts: plan.chosen,
    timing: plan.explanation,
    reason: timingReason(c, plan.chosen),
  });
}

function clockTime(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

function timingReason(c: RecoveryCase, chosen: ScheduledAttempt[]): string {
  const first = chosen[0];
  const when =
    first.day === c.billingDay
      ? `the billing day itself at ${clockTime(first.hourIST)} IST`
      : `day ${first.day} at ${clockTime(first.hourIST)} IST`;
  const odds = `${Math.round(first.probability * 100)}%`;
  const backup =
    chosen.length > 1
      ? ` One held in reserve for day ${chosen[1].day} at ${clockTime(chosen[1].hourIST)}.`
      : "";
  return `Financial decline. Best-scoring window is ${when} at ${odds}, not T+1.${backup}`;
}

/**
 * Bank-side failure. The customer did nothing wrong and should not see this,
 * so both branches run inside the original attempt window.
 */
function cascade(c: RecoveryCase, inferredClass: PolicyDecision["inferredClass"]): PolicyDecision {
  if (bankSignalFor(c) === "latency_spike") {
    return allow(c, {
      inferredClass,
      clock: "sync_cascade",
      mutation: "cooldown_retry",
      scheduledDay: 0,
      cooldownSeconds: MICRO_COOLDOWN_SECONDS,
      reason: `${c.bank} switch is slow, not down. Hold ${MICRO_COOLDOWN_SECONDS}s and re-present on the same rail — cheaper than moving the customer to another instrument.`,
    });
  }

  return allow(c, {
    inferredClass,
    clock: "sync_cascade",
    mutation: "next_rail",
    scheduledDay: 0,
    reason: `${c.bank} core banking is down for ${c.rail.replaceAll("_", " ")}. Cascade to ${nextRail(c.rail).replaceAll("_", " ")} now — waiting for the bank means waiting past the billing day.`,
  });
}

/**
 * RBI requires the customer to be notified 24h before an auto-debit.
 * The original billing-day attempt was already covered by its notice.
 * Moving the debit to a new date means a fresh notice, which in turn
 * can push the debit itself later. Compliance changes the schedule.
 */
function applyPreDebitNotice(c: RecoveryCase, mutation: Mutation, scheduledDay: number) {
  const coveredByOriginalNotice = scheduledDay <= c.billingDay + 1;

  if (!spendsNpciSlot(mutation) || coveredByOriginalNotice || c.preDebitNotifiedForDay === scheduledDay) {
    return { scheduledDay, preDebitNoticeDay: undefined as number | undefined };
  }

  const noticeDay = Math.max(c.billingDay, scheduledDay - 1);
  const debitDay = noticeDay >= scheduledDay ? noticeDay + 1 : scheduledDay;
  return { scheduledDay: debitDay, preDebitNoticeDay: noticeDay };
}

interface Grant {
  inferredClass: PolicyDecision["inferredClass"];
  clock: Clock;
  mutation: Mutation;
  scheduledDay: number;
  scheduledHourIST?: number;
  attempts?: ScheduledAttempt[];
  timing?: TimingExplanation;
  reason: string;
  cooldownSeconds?: number;
}

function allow(c: RecoveryCase, grant: Grant): PolicyDecision {
  let { clock, mutation, reason } = grant;
  let cooldownSeconds = grant.cooldownSeconds;
  let attempts = grant.attempts;
  const slotsLeft = Math.max(0, c.retryBudgetLeft);

  // The budget guard does not stop recovery, it changes the instrument. A
  // mandate with no slots left still has a customer who can tap a link.
  if (spendsNpciSlot(mutation) && slotsLeft <= 0) {
    clock = "async_dunning";
    mutation = "payment_link";
    cooldownSeconds = undefined;
    attempts = undefined;
    reason = `NPCI budget spent (1 original + 3 retries). No slot left to debit, so recovery moves out of band to a link. ${reason}`;
  }

  const compliance = applyPreDebitNotice(c, mutation, grant.scheduledDay);

  // A notice that moves the first debit moves the ones behind it by the same days.
  const shift = compliance.scheduledDay - grant.scheduledDay;
  if (attempts && shift !== 0) {
    attempts = attempts.map((a) => ({ ...a, day: a.day + shift }));
  }

  // One slot per planned debit. A cooldown or a cascade only ever presents once.
  const planned = attempts?.length ?? 1;
  const slotsUsed = spendsNpciSlot(mutation) ? Math.min(planned, slotsLeft) : 0;

  return {
    caseId: c.id,
    policy: "adaptive",
    inferredClass: grant.inferredClass,
    clock,
    mutation,
    reason: compliance.preDebitNoticeDay
      ? `${reason} RBI pre-debit notice on day ${compliance.preDebitNoticeDay}.`
      : reason,
    allowed: true,
    scheduledDay: compliance.scheduledDay,
    scheduledHourIST: attempts?.[0]?.hourIST ?? grant.scheduledHourIST,
    attempts,
    timing: grant.timing,
    preDebitNoticeDay: compliance.preDebitNoticeDay,
    cooldownSeconds,
    npciSlotsUsed: slotsUsed,
    npciSlotsLeftAfter: slotsLeft - slotsUsed,
  };
}

function stop(c: RecoveryCase, inferredClass: PolicyDecision["inferredClass"], stopReason: string): PolicyDecision {
  return {
    caseId: c.id,
    policy: "adaptive",
    inferredClass,
    clock: "stop",
    mutation: "none",
    reason: stopReason,
    allowed: false,
    stopReason,
    npciSlotsUsed: 0,
    npciSlotsLeftAfter: Math.max(0, c.retryBudgetLeft),
  };
}
