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

  // 25 financial NSF — money appears on salary day 5. T+1..T+3 is too early.
  // Promise dates are not handed over: they are parsed out of the reply.
  for (let i = 25; i < 50; i += 1) {
    const c = base(i, "financial", "insufficient_funds");
    c.salaryDay = 5;
    c.willSucceedOn.sameRailOnSalaryDay = true;
    if (i % 5 === 0) {
      c.customerReply = "I'm short right now, salary lands on the 5th then I'll pay";
    }
    if (i % 7 === 0) {
      c.customerReply = "I'll pay at month end";
    }
    if (i % 8 === 0) {
      c.liquidity = { instrumentSucceededElsewhere: true, atDay: 5 };
    }
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
