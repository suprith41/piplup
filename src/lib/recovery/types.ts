export type Rail = "upi_autopay" | "card" | "enach";

/** Sponsor / issuer bank behind the mandate. Routing is a bank decision, not a rail decision. */
export type Bank = "HDFC" | "SBI" | "ICICI" | "Axis" | "Kotak";

/**
 * Why the bank side failed, which decides cascade vs cooldown.
 *
 * A latency spike on a switch clears in seconds — re-present on the same rail
 * and the customer never sees a failure. Core banking being down does not
 * clear in seconds, so the only useful move is another rail.
 */
export type BankSignal = "latency_spike" | "cbs_down";

export type MandateState = "active" | "paused" | "revoked" | "halted";

/**
 * Stripe-style typed decline. This is the first decision.
 * Razorpay T+3 treats most of these as "failed, retry tomorrow".
 */
export type DeclineClass =
  | "technical"
  | "financial"
  | "instrument"
  | "terminal"
  | "behavioral"
  /** Not a failed debit. Money owed on a revived subscription nobody charged. */
  | "uncollected";

/**
 * Three ways to act, plus a freeze.
 *
 * `terminal_mutation` is the India-specific one: the mandate is dead, so the
 * debit is over, but the customer is not. Re-authorising costs zero NPCI
 * slots, which is why it is not the same thing as stopping.
 */
export type Clock = "sync_cascade" | "async_dunning" | "terminal_mutation" | "stop";

export type Mutation =
  | "same_rail_retry"
  | "cooldown_retry"
  | "next_rail"
  | "payment_link"
  | "mandate_reauth"
  | "back_charge_invoices"
  | "none";

/**
 * Razorpay Subscriptions lifecycle: first failure moves a subscription to
 * pending, and exhausting the retry cycle moves it to halted.
 */
export type SubscriptionState = "active" | "pending" | "halted";

export type PolicyName =
  | "t3_calendar"
  /**
   * Charitable baseline. Assumes the calendar flow stops after one hard
   * decline instead of burning the whole retry cycle. Our lift has to
   * survive this reading too.
   */
  | "t3_hard_decline_aware"
  | "adaptive";

export interface LiquiditySignal {
  instrumentSucceededElsewhere: boolean;
  atDay?: number;
}

/** What an inbound customer message means, once parsed into something typed. */
export type ReplyIntent =
  | "promise_to_pay"
  | "already_paid"
  | "dispute"
  | "opt_out"
  | "unclear";

export interface ParsedReply {
  raw: string;
  intent: ReplyIntent;
  promisedDay?: number;
  confidence: number;
  source: "rules" | "llm";
}

export interface RecoveryCase {
  id: string;
  customerName: string;
  amountPaise: number;
  rail: Rail;
  bank: Bank;
  /** Bank-side condition at attempt time. Only meaningful on a technical decline. */
  bankSignal?: BankSignal;
  mandateState: MandateState;
  subscriptionState: SubscriptionState;
  declineCode: string;
  /** True for Indian domestic cards, where manual charge is not permitted. */
  domesticCard: boolean;
  /**
   * Halted subscription that came back to life when the customer fixed their
   * card. Razorpay creates the invoices but never charges them.
   */
  revivedOnDay?: number;
  uncollectedInvoicesPaise?: number;
  /** Ground-truth label for evaluate. The policy must infer from declineCode + state. */
  trueClass: DeclineClass;
  retryBudgetLeft: number;
  billingDay: number;
  salaryDay?: number;
  promiseToPayDay?: number;
  liquidity?: LiquiditySignal;
  optedOut: boolean;
  chargeback: boolean;
  /** Customer says the charge already cleared. Freeze retries until we reconcile. */
  claimedPaid: boolean;
  /** Raw inbound message. Parsed into promiseToPayDay / optedOut before policy runs. */
  customerReply?: string;
  parsedReply?: ParsedReply;
  /**
   * RBI requires a pre-debit notification 24h before an auto-debit.
   * The original billing-day attempt was already covered. A debit on a new
   * date needs a fresh notice.
   */
  preDebitNotifiedForDay?: number;
  /** Simulator: which mutated attempts would actually clear. */
  willSucceedOn: {
    sameRailImmediate: boolean;
    /** Switch was slow, not down: the same rail clears after a few seconds. */
    sameRailAfterCooldown: boolean;
    nextRailImmediate: boolean;
    sameRailOnSalaryDay: boolean;
    paymentLink: boolean;
    reauth: boolean;
    backCharge: boolean;
  };
}

export interface PolicyDecision {
  caseId: string;
  policy: PolicyName;
  inferredClass: DeclineClass;
  clock: Clock;
  mutation: Mutation;
  reason: string;
  allowed: boolean;
  stopReason?: string;
  scheduledDay?: number;
  /** Day we must send the RBI pre-debit notice, when the debit moves to a new date. */
  preDebitNoticeDay?: number;
  /** Seconds to hold before re-presenting, when the switch is slow rather than down. */
  cooldownSeconds?: number;
  /**
   * NPCI counts mandate debits, not outreach. A payment link or a re-auth
   * request costs nothing from the 1 original + 3 retries budget.
   */
  npciSlotsUsed: number;
  npciSlotsLeftAfter: number;
}

export interface AttemptResult {
  decision: PolicyDecision;
  executed: boolean;
  recovered: boolean;
  retriesUsed: number;
  slotWasted: boolean;
  /** What it cost us to chase this case: messages, notices, outreach. */
  costPaise: number;
  /** Where the subscription lands once this policy is done with it. */
  endedSubscriptionState: SubscriptionState;
  note: string;
}

export interface PolicyScore {
  policy: PolicyName;
  cases: number;
  rupeesAtRisk: number;
  rupeesRecovered: number;
  rupeesCorrectlyStopped: number;
  rupeesSpent: number;
  rupeesNet: number;
  /** Mandate debits presented to NPCI. Outreach is not counted here. */
  retriesUsed: number;
  /** Links, re-auth requests and invoice sweeps: recovery that costs no NPCI slot. */
  outOfBandActions: number;
  slotsWasted: number;
  stopAccuracy: number;
  recoveryRate: number;
  subscriptionsHalted: number;
  /**
   * Halting a revoked mandate is correct. Involuntary churn counts only the
   * subscriptions that were recoverable and were left halted anyway.
   */
  involuntaryChurn: number;
  attempts: AttemptResult[];
}

/**
 * Gross recovery is the number every vendor advertises. It is not the honest one.
 * Incremental lift is the money only this policy got.
 */
export interface Lift {
  bothRecovered: number;
  adaptiveOnly: number;
  baselineOnly: number;
  neitherRecovered: number;
  incrementalRupees: number;
  regressionRupees: number;
}
