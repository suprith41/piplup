import { bankSignalFor, classifyDecline, isContactFrozen, isRevokedMandate } from "./taxonomy.ts";
import type { Clock, Mutation, PolicyDecision, RecoveryCase } from "./types.ts";

/** NPCI allows 1 original debit plus 3 retries on a mandate. That is the whole budget. */
export const NPCI_MAX_ATTEMPTS = 4;

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
export function grantAdaptive(c: RecoveryCase): PolicyDecision {
  const inferredClass = classifyDecline(c);

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
      scheduledDay: c.promiseToPayDay ?? c.billingDay,
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
      scheduledDay: c.promiseToPayDay ?? c.billingDay,
      reason: c.promiseToPayDay
        ? `Checkout dropped. Customer promised day ${c.promiseToPayDay}. Do not chase before then.`
        : "Checkout dropped after instrument select. Send a one-time recovery link, do not auto-debit.",
    });
  }

  // financial
  const scheduledDay = pickLiquidityDay(c);

  // Razorpay does not permit manual charge on an Indian domestic card, so the
  // only compliant path is a link the customer completes themselves.
  if (c.domesticCard && c.rail === "card") {
    return allow(c, {
      inferredClass,
      clock: "async_dunning",
      mutation: "payment_link",
      scheduledDay,
      reason: "Domestic card: manual charge is not supported. Recovery has to go through a customer-completed link.",
    });
  }

  return allow(c, {
    inferredClass,
    clock: "async_dunning",
    mutation: "same_rail_retry",
    scheduledDay,
    reason:
      scheduledDay === c.billingDay
        ? "Financial decline with no salary/promise signal. One delayed same-rail shot only."
        : `Financial decline. Wait for liquidity on day ${scheduledDay}, do not T+1 hammer.`,
  });
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

function pickLiquidityDay(c: RecoveryCase): number {
  if (c.promiseToPayDay) return c.promiseToPayDay;
  if (c.liquidity?.instrumentSucceededElsewhere && c.liquidity.atDay) return c.liquidity.atDay;
  if (c.salaryDay) return c.salaryDay;
  return Math.min(c.billingDay + 4, 28);
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
  reason: string;
  cooldownSeconds?: number;
}

function allow(c: RecoveryCase, grant: Grant): PolicyDecision {
  let { clock, mutation, reason } = grant;
  let cooldownSeconds = grant.cooldownSeconds;
  const slotsLeft = Math.max(0, c.retryBudgetLeft);

  // The budget guard does not stop recovery, it changes the instrument. A
  // mandate with no slots left still has a customer who can tap a link.
  if (spendsNpciSlot(mutation) && slotsLeft <= 0) {
    clock = "async_dunning";
    mutation = "payment_link";
    cooldownSeconds = undefined;
    reason = `NPCI budget spent (1 original + 3 retries). No slot left to debit, so recovery moves out of band to a link. ${reason}`;
  }

  const slotsUsed = spendsNpciSlot(mutation) ? 1 : 0;
  const compliance = applyPreDebitNotice(c, mutation, grant.scheduledDay);

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
