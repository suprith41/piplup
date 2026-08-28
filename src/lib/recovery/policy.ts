import { classifyDecline } from "./taxonomy.ts";
import type { Clock, Mutation, PolicyDecision, RecoveryCase } from "./types.ts";

const NEXT_RAIL: Record<RecoveryCase["rail"], RecoveryCase["rail"]> = {
  upi_autopay: "card",
  card: "upi_autopay",
  enach: "upi_autopay",
};

export function nextRail(rail: RecoveryCase["rail"]): RecoveryCase["rail"] {
  return NEXT_RAIL[rail];
}

/**
 * Hard gates. The LLM never calls this — the executor does.
 * Money does not move without a grant from here.
 */
export function grantAdaptive(c: RecoveryCase): PolicyDecision {
  const inferredClass = classifyDecline(c);

  if (c.optedOut) {
    return stop(c, inferredClass, "Customer opted out. Contact freeze.");
  }
  if (c.claimedPaid) {
    return stop(c, inferredClass, "Customer says already paid. Freeze until we reconcile.");
  }
  if (c.chargeback || inferredClass === "terminal") {
    return stop(c, inferredClass, "Terminal decline. Retrying burns an NPCI slot and can trigger network penalties.");
  }
  if (c.retryBudgetLeft <= 0) {
    return stop(c, inferredClass, "NPCI-style budget exhausted (1 original + 3 retries).");
  }

  if (inferredClass === "uncollected") {
    return allow(
      c,
      inferredClass,
      "async_dunning",
      "back_charge_invoices",
      c.revivedOnDay ?? c.billingDay,
      "Subscription revived after halt. Razorpay creates those invoices but never charges them, so the money sits uncollected until someone sweeps it.",
    );
  }

  if (inferredClass === "technical") {
    return allow(c, inferredClass, "sync_cascade", "next_rail", 0, `Technical ${c.declineCode}. Cascade now to ${nextRail(c.rail)} — user should not see this fail.`);
  }

  if (inferredClass === "instrument") {
    const mutation: Mutation = c.mandateState === "paused" || c.declineCode === "mandate_paused" ? "mandate_reauth" : "payment_link";
    const scheduledDay = c.promiseToPayDay ?? c.billingDay;
    return allow(
      c,
      inferredClass,
      "async_dunning",
      mutation,
      scheduledDay,
      c.promiseToPayDay
        ? `Dead instrument. Customer promised day ${c.promiseToPayDay}. Hold the recovery link until then.`
        : "Dead or stale instrument. Mutate the instrument — do not replay the same mandate.",
    );
  }

  if (inferredClass === "behavioral") {
    const scheduledDay = c.promiseToPayDay ?? c.billingDay;
    return allow(
      c,
      inferredClass,
      "async_dunning",
      "payment_link",
      scheduledDay,
      c.promiseToPayDay
        ? `Checkout dropped. Customer promised day ${c.promiseToPayDay}. Do not chase before then.`
        : "Checkout dropped after instrument select. Send a one-time recovery link, do not auto-debit.",
    );
  }

  // financial
  const scheduledDay = pickLiquidityDay(c);

  // Razorpay does not permit manual charge on an Indian domestic card, so the
  // only compliant path is a link the customer completes themselves.
  if (c.domesticCard && c.rail === "card") {
    return allow(
      c,
      inferredClass,
      "async_dunning",
      "payment_link",
      scheduledDay,
      "Domestic card: manual charge is not supported. Recovery has to go through a customer-completed link.",
    );
  }

  return allow(
    c,
    inferredClass,
    "async_dunning",
    "same_rail_retry",
    scheduledDay,
    scheduledDay === c.billingDay
      ? "Financial decline with no salary/promise signal. One delayed same-rail shot only."
      : `Financial decline. Wait for liquidity on day ${scheduledDay}, do not T+1 hammer.`,
  );
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
  const isDebit = mutation === "same_rail_retry" || mutation === "next_rail";
  const coveredByOriginalNotice = scheduledDay <= c.billingDay + 1;

  if (!isDebit || coveredByOriginalNotice || c.preDebitNotifiedForDay === scheduledDay) {
    return { scheduledDay, preDebitNoticeDay: undefined as number | undefined };
  }

  const noticeDay = Math.max(c.billingDay, scheduledDay - 1);
  const debitDay = noticeDay >= scheduledDay ? noticeDay + 1 : scheduledDay;
  return { scheduledDay: debitDay, preDebitNoticeDay: noticeDay };
}

function allow(
  c: RecoveryCase,
  inferredClass: PolicyDecision["inferredClass"],
  clock: Clock,
  mutation: Mutation,
  scheduledDay: number,
  reason: string,
): PolicyDecision {
  const compliance = applyPreDebitNotice(c, mutation, scheduledDay);

  return {
    caseId: c.id,
    policy: "adaptive",
    inferredClass,
    clock,
    mutation,
    reason: compliance.preDebitNoticeDay
      ? `${reason} RBI pre-debit notice on day ${compliance.preDebitNoticeDay}.`
      : reason,
    allowed: true,
    scheduledDay: compliance.scheduledDay,
    preDebitNoticeDay: compliance.preDebitNoticeDay,
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
  };
}
