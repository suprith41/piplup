import type { Bank, DeclineClass, Rail, RecoveryCase } from "./types.ts";

export const NAMES = [
  "Jensen Huang",
  "James Walker",
  "Mark Zuckerberg",
  "Emma Clarke",
  "Tim Cook",
  "Oliver Bennett",
  "Bill Gates",
  "Demis Hassabis",
  "Charlotte Hayes",
  "Patrick Collison",
  "Sam Altman",
  "Elon Musk",
  "Greg Brockman",
  "Amelia Brooks",
  "Jeff Bezos",
  "Dario Amodei",
  "Jony Ive",
  "Andrej Karpathy",
  "Henry Walsh",
  "Lisa Su",
];

function name(i: number): string {
  return NAMES[i % NAMES.length];
}

function amount(i: number): number {
  const slabs = [19900, 29900, 49900, 79900, 99900, 149900];
  return slabs[i % slabs.length];
}

function rail(i: number): Rail {
  return (["upi_autopay", "card", "enach"] as const)[i % 3];
}

const BANKS: readonly Bank[] = ["HDFC", "SBI", "ICICI", "Axis", "Kotak"];

function bank(i: number): Bank {
  return BANKS[i % BANKS.length];
}

/**
 * Indian payroll, as it actually lands: a day and an hour.
 *
 * Large employers credit in the morning clearing batch on the 1st; SMEs run
 * payroll late on the 10th. A retry cycle that presents at 02:00 is presented
 * against the previous day's balance in every one of these cases.
 */
const PAYROLL = [
  { day: 1, hour: 9 },
  { day: 5, hour: 8 },
  { day: 7, hour: 10 },
  { day: 10, hour: 18 },
] as const;

/**
 * Customers who never declared a payday but have a clearing history with us.
 * `cleared` is what the merchant can see; `day` / `hour` are the truth.
 */
const CLEARING_HISTORY = [
  { cleared: [11, 12, 12], day: 12, hour: 9 },
  { cleared: [6, 7, 6], day: 7, hour: 11 },
  { cleared: [3, 4, 3], day: 4, hour: 8 },
] as const;

function base(i: number, trueClass: DeclineClass, declineCode: string): RecoveryCase {
  const on = rail(i);
  return {
    id: `rc_${String(i + 1).padStart(3, "0")}`,
    customerName: name(i),
    amountPaise: amount(i),
    rail: on,
    bank: bank(i),
    mandateState: "active",
    // A failed debit has already moved the subscription out of active.
    subscriptionState: "pending",
    declineCode,
    domesticCard: on === "card",
    trueClass,
    retryBudgetLeft: 3,
    billingDay: 1,
    optedOut: false,
    chargeback: false,
    claimedPaid: false,
    willSucceedOn: {
      sameRailImmediate: false,
      sameRailAfterCooldown: false,
      nextRailImmediate: false,
      sameRailOnSalaryDay: false,
      paymentLink: false,
      reauth: false,
      backCharge: false,
    },
  };
}

/** 112 labeled cases. The evaluate harness is only honest if this mix is ugly. */
export function seedBatch(): RecoveryCase[] {
  const cases: RecoveryCase[] = [];

  // 25 technical. The bank, not the rail, decides which move works.
  //
  // A slow switch is the same switch a minute later, so holding clears it —
  // but the backup rail sits behind the same bank and is just as slow. Core
  // banking being down is the opposite: holding is useless, routing around it
  // is the only thing that works. A policy that always cascades loses the
  // first group; one that always waits loses the second.
  for (let i = 0; i < 25; i += 1) {
    const latency = i % 2 === 0;
    const c = base(i, "technical", latency ? "gateway_timeout" : "bank_downtime");
    c.bankSignal = latency ? "latency_spike" : "cbs_down";
    c.willSucceedOn.sameRailAfterCooldown = latency;
    c.willSucceedOn.nextRailImmediate = !latency;
    c.willSucceedOn.sameRailImmediate = i % 7 === 0;
    cases.push(c);
  }

  // 13 financial NSF where a payday is on file. Four real Indian payroll
  // patterns, and each one credits at its own hour — which is the whole point.
  // Day 1 is the billing day: the debit ran at 02:00 and the salary posted at
  // 09:00, so the case failed by seven hours, not by seven days. A cycle that
  // only knows about days cannot see that, and re-presents tomorrow.
  for (let i = 25; i < 38; i += 1) {
    const pay = PAYROLL[i % PAYROLL.length];
    const c = base(i, "financial", "insufficient_funds");
    c.salaryDay = pay.day;
    c.willSucceedOn.sameRailOnSalaryDay = true;
    c.willSucceedOn.liquidOnDay = pay.day;
    c.willSucceedOn.liquidAtHourIST = pay.hour;
    // Domestic cards cannot be debited at all, so for half of these the link is
    // the only channel. It converts once the money is there, and not before.
    c.willSucceedOn.paymentLink = true;
    // Promise dates are not handed over: they are parsed out of the reply.
    if (i % 5 === 0) {
      c.customerReply = `I'm short right now, salary lands on the ${pay.day}th then I'll pay`;
    }
    if (i % 7 === 0) {
      c.customerReply = "I'll pay at month end";
    }
    if (i % 8 === 0) {
      c.liquidity = { instrumentSucceededElsewhere: true, atDay: pay.day };
    }
    cases.push(c);
  }

  // 12 financial NSF where nobody ever declared a payday — the ordinary case.
  // What the merchant does have is this customer's own history: the day their
  // debit cleared in previous cycles. A fixed offset from the billing date
  // fits one of these cohorts and misses the other two.
  for (let i = 38; i < 50; i += 1) {
    const seenBefore = CLEARING_HISTORY[i % CLEARING_HISTORY.length];
    const c = base(i, "financial", "insufficient_funds");
    c.priorClearedDays = [...seenBefore.cleared];
    c.willSucceedOn.sameRailOnSalaryDay = true;
    c.willSucceedOn.liquidOnDay = seenBefore.day;
    c.willSucceedOn.liquidAtHourIST = seenBefore.hour;
    c.willSucceedOn.paymentLink = true;
    cases.push(c);
  }

  // 20 revoked mandates. T+3 burns three slots each and cannot win any of
  // them. The debit is unrecoverable, the customer is not: some share will set
  // up a fresh AutoPay when asked, and asking costs no NPCI slot.
  for (let i = 50; i < 70; i += 1) {
    const c = base(i, "terminal", "mandate_revoked");
    c.mandateState = "revoked";
    c.willSucceedOn.reauth = i % 5 < 2;
    cases.push(c);
  }

  // 15 instrument — need mutation, not the same debit
  for (let i = 70; i < 85; i += 1) {
    const paused = i % 2 === 0;
    const c = base(i, "instrument", paused ? "mandate_paused" : "card_expired");
    c.mandateState = paused ? "paused" : "active";
    c.willSucceedOn.reauth = paused;
    c.willSucceedOn.paymentLink = !paused;
    cases.push(c);
  }

  // 10 chargeback / opt-out — must freeze. Two arrive only as inbound text,
  // so the parser has to catch them before the policy touches money.
  for (let i = 85; i < 95; i += 1) {
    const c = base(i, "terminal", i % 2 === 0 ? "chargeback" : "do_not_retry");
    c.chargeback = i % 2 === 0;
    c.optedOut = i % 2 === 1;
    if (i === 87) {
      c.declineCode = "insufficient_funds";
      c.chargeback = false;
      c.optedOut = false;
      c.customerReply = "this charge is wrong, I never subscribed";
    }
    if (i === 89) {
      c.declineCode = "insufficient_funds";
      c.chargeback = false;
      c.optedOut = false;
      c.customerReply = "stop, don't send these messages";
    }
    cases.push(c);
  }

  // 5 checkout abandon
  for (let i = 95; i < 100; i += 1) {
    const c = base(i, "behavioral", "checkout_abandoned");
    c.willSucceedOn.paymentLink = true;
    cases.push(c);
  }

  // 10 revived-but-unswept subscriptions. The customer fixed their card, the
  // subscription went back to active, and the invoices from the halted window
  // were never charged. The calendar flow has no path to this money at all.
  for (let i = 100; i < 110; i += 1) {
    const c = base(i, "uncollected", "halted_invoice_uncharged");
    c.subscriptionState = "halted";
    c.mandateState = "active";
    c.revivedOnDay = 6 + (i % 4);
    c.uncollectedInvoicesPaise = c.amountPaise * (1 + (i % 3));
    // One customer disputes the back-charge, so the sweeper must not force it.
    c.willSucceedOn.backCharge = i !== 104;
    if (i === 104) {
      c.customerReply = "this is wrong, I already updated my card";
    }
    cases.push(c);
  }

  // Looks like NSF. Inbound text is the only signal that we must not retry.
  const paid = base(110, "terminal", "insufficient_funds");
  paid.customerReply = "payment done, I already paid";
  cases.push(paid);

  // Promised day 3. Money never shows up. Adaptive waits; T+3 still hammers.
  const broken = base(111, "financial", "insufficient_funds");
  broken.salaryDay = 5;
  broken.customerReply = "I'll pay on the 3rd";
  broken.willSucceedOn.sameRailOnSalaryDay = false;
  cases.push(broken);

  return cases;
}
