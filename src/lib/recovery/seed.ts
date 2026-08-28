import type { DeclineClass, Rail, RecoveryCase } from "./types.ts";

const NAMES = [
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

function base(i: number, trueClass: DeclineClass, declineCode: string): RecoveryCase {
  const on = rail(i);
  return {
    id: `rc_${String(i + 1).padStart(3, "0")}`,
    customerName: name(i),
    amountPaise: amount(i),
    rail: on,
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

  // 25 technical — cascade to next rail works; same-rail T+3 usually does not
  for (let i = 0; i < 25; i += 1) {
    const c = base(i, "technical", i % 2 === 0 ? "gateway_timeout" : "bank_downtime");
    c.willSucceedOn.nextRailImmediate = true;
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

  // 20 terminal revoked — T+3 burns slots. Adaptive must stop.
  for (let i = 50; i < 70; i += 1) {
    const c = base(i, "terminal", "mandate_revoked");
    c.mandateState = "revoked";
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
