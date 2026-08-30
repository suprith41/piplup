import { CHANNEL_COST_PAISE } from "./cost.ts";
import { NPCI_MAX_ATTEMPTS } from "./policy.ts";
import { NAMES } from "./seed.ts";
import { rupees } from "./taxonomy.ts";
import type { Bank, Rail } from "./types.ts";

/**
 * Recovery that happens before the failure.
 *
 * Stripe emails a customer a month before their card expires, because the
 * cheapest recovery is the debit that never fails. The Indian version of that
 * is arithmetic rather than prediction: a UPI AutoPay mandate carries a maximum
 * debit amount, so if this cycle's invoice is larger than the mandate, the
 * debit cannot succeed. No model is needed to know that. Same for a card or a
 * mandate that expires before the billing date.
 *
 * The calendar finds these on the billing day and then burns its whole retry
 * budget rediscovering that a number is bigger than another number.
 */

export type RiskSignal = "mandate_headroom" | "card_expiring" | "mandate_expiring";

/** `certain` means the debit is guaranteed to fail. `elevated` means next cycle will. */
export type RiskSeverity = "certain" | "elevated";

export interface UpcomingCharge {
  id: string;
  customerName: string;
  amountPaise: number;
  rail: Rail;
  bank: Bank;
  billingDay: number;
  /** UPI AutoPay and eNACH mandates are approved up to a ceiling. Cards are not. */
  mandateMaxPaise?: number;
  cardExpiresOnDay?: number;
  mandateExpiresOnDay?: number;
}

export interface PreventiveAction {
  id: string;
  customerName: string;
  amountPaise: number;
  rail: Rail;
  bank: Bank;
  signal: RiskSignal;
  severity: RiskSeverity;
  billingDay: number;
  /** When we tell them, which is early enough for them to actually fix it. */
  noticeDay: number;
  daysOfHeadstart: number;
  finding: string;
  ask: string;
  costPaise: number;
  npciSlotsUsed: 0;
}

export interface PreventionSummary {
  scanned: number;
  flagged: number;
  certain: number;
  elevated: number;
  /** Money on debits that are guaranteed to fail if nobody intervenes. */
  protectedRupees: number;
  /** What the calendar would spend discovering the same thing on the billing day. */
  npciSlotsAvoided: number;
  spendRupees: number;
  actions: PreventiveAction[];
}

/** Fixed three-day head start: long enough to raise a mandate, short enough to be remembered. */
const NOTICE_LEAD_DAYS = 3;

const BANKS: readonly Bank[] = ["HDFC", "SBI", "ICICI", "Axis", "Kotak"];
const RAILS: readonly Rail[] = ["upi_autopay", "card", "enach"];

/**
 * Next cycle's book, before anything has been charged. Most of it is healthy;
 * the point of the scan is that the unhealthy rows are knowable in advance.
 */
export function seedUpcoming(): UpcomingCharge[] {
  const charges: UpcomingCharge[] = [];
  const slabs = [19900, 29900, 49900, 79900, 99900, 149900];

  for (let i = 0; i < 60; i += 1) {
    const rail = RAILS[i % 3];
    const amountPaise = slabs[i % slabs.length];
    // Eureka Labs bills across the month, not all on the 1st.
    const billingDay = 5 + (i % 24);

    const charge: UpcomingCharge = {
      id: `up_${String(i + 1).padStart(3, "0")}`,
      customerName: NAMES[(i * 7) % NAMES.length],
      amountPaise,
      rail,
      bank: BANKS[i % BANKS.length],
      billingDay,
    };

    if (rail !== "card") {
      // Mandates were approved at the price the customer signed up on. Eureka
      // raised prices for the September cohort, so some ceilings are now too low.
      const raisedPrice = i % 7 === 0;
      charge.mandateMaxPaise = raisedPrice ? Math.round(amountPaise * 0.6) : Math.max(amountPaise, 150000);
      if (i % 11 === 0) charge.mandateExpiresOnDay = billingDay - 1;
    } else if (i % 9 === 0) {
      charge.cardExpiresOnDay = billingDay - 1;
    } else {
      // India has no card account updater, so an expiry inside the next cycle
      // is a failure with a date on it.
      charge.cardExpiresOnDay = i % 4 === 0 ? billingDay + 21 : billingDay + 400;
    }

    charges.push(charge);
  }

  return charges;
}

export function scanUpcoming(charges: UpcomingCharge[] = seedUpcoming()): PreventiveAction[] {
  const actions: PreventiveAction[] = [];

  for (const charge of charges) {
    const noticeDay = Math.max(0, charge.billingDay - NOTICE_LEAD_DAYS);
    const base = {
      id: charge.id,
      customerName: charge.customerName,
      amountPaise: charge.amountPaise,
      rail: charge.rail,
      bank: charge.bank,
      billingDay: charge.billingDay,
      noticeDay,
      daysOfHeadstart: charge.billingDay - noticeDay,
      costPaise: CHANNEL_COST_PAISE.whatsapp,
      npciSlotsUsed: 0 as const,
    };

    if (charge.mandateMaxPaise !== undefined && charge.amountPaise > charge.mandateMaxPaise) {
      actions.push({
        ...base,
        signal: "mandate_headroom",
        severity: "certain",
        finding: `Invoice ${inr(charge.amountPaise)} exceeds the approved AutoPay ceiling of ${inr(charge.mandateMaxPaise)}. The debit cannot clear.`,
        ask: "Approve a higher AutoPay limit, or pay this cycle on a one-time link.",
      });
      continue;
    }

    if (charge.mandateExpiresOnDay !== undefined && charge.mandateExpiresOnDay < charge.billingDay) {
      actions.push({
        ...base,
        signal: "mandate_expiring",
        severity: "certain",
        finding: `Mandate lapses on day ${charge.mandateExpiresOnDay}, before the day ${charge.billingDay} debit.`,
        ask: "Renew the AutoPay mandate before the billing date.",
      });
      continue;
    }

    if (charge.cardExpiresOnDay !== undefined && charge.cardExpiresOnDay < charge.billingDay) {
      actions.push({
        ...base,
        signal: "card_expiring",
        severity: "certain",
        finding: `Card expires on day ${charge.cardExpiresOnDay}, before the day ${charge.billingDay} debit.`,
        ask: "Update the card on file. India has no card account updater, so the customer has to do it.",
      });
      continue;
    }

    if (charge.cardExpiresOnDay !== undefined && charge.cardExpiresOnDay <= charge.billingDay + 30) {
      actions.push({
        ...base,
        signal: "card_expiring",
        severity: "elevated",
        finding: `Card expires on day ${charge.cardExpiresOnDay}. This cycle clears; the next one will not.`,
        ask: "Update the card now, while nothing is broken.",
      });
    }
  }

  return actions;
}

export function preventionSummary(charges: UpcomingCharge[] = seedUpcoming()): PreventionSummary {
  const actions = scanUpcoming(charges);
  const certain = actions.filter((a) => a.severity === "certain");

  return {
    scanned: charges.length,
    flagged: actions.length,
    certain: certain.length,
    elevated: actions.length - certain.length,
    protectedRupees: rupees(certain.reduce((sum, a) => sum + a.amountPaise, 0)),
    // Each guaranteed failure is a full retry budget the calendar would spend
    // learning what the scan already knows.
    npciSlotsAvoided: certain.length * NPCI_MAX_ATTEMPTS,
    spendRupees: rupees(actions.reduce((sum, a) => sum + a.costPaise, 0)),
    actions,
  };
}

function inr(paise: number): string {
  return `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;
}
