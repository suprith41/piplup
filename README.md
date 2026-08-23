# Piplup

Track 03 — AI Revenue Recovery for the [Razorpay AI Buildathon](https://razorpay.com/buildathon/).

Stripe-style **two-clock recovery** on Indian rails, demoed as the recovery desk for **Eureka Labs** — an online AI/ML course subscription. Not a retry bot.

- Type the decline first.
- Mutate the next attempt. Do not replay the same debit.
- Cascade *now* if it is technical. Dunning *later* if it is money.
- Stop when a retry burns an NPCI slot.
- Score Adaptive Recovery against a Razorpay-style **T+3 calendar** on the same 100 labeled cases.

We do **not** fake ISO 8583 Adaptive Acceptance or a global card graph. Those need issuer pipes. The method is what we port.

## Run

```bash
npm install
npm run evaluate
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## What `npm run evaluate` proves

On the seeded batch, Adaptive Recovery should:

- recover more rupees than T+3
- use fewer retries
- waste zero NPCI slots on revoked / chargeback / opt-out cases

That is Stripe’s published shape (more recovery, fewer attempts), implemented as an India-rail agent.

## Prior art

Failed-payment recovery is an established category. This project does not claim to invent it.

| Product | What it does |
| --- | --- |
| [SubsShield](https://subsshield.com/) | India-only dunning for Razorpay and Cashfree. Reads the decline reason and matches the WhatsApp message to the cause. |
| [RecurringIQ](https://www.recurringiq.com/) | Deterministic scoring engine with failure-type-specific retry windows (24h network, 48h NSF, 72h bank decline). |
| [DemandPay](https://demandpay.in/) | Collections agent across WhatsApp, RCS and voice, with promise-to-pay tracking. |
| [Churnkey](https://churnkey.co/) / Butter Payments | US equivalents. ML retries plus outreach; Butter adds human callers. |
| Razorpay Intelligent Retry Engine | Razorpay's own configurable retry cadence and WhatsApp recovery links (beta, FTX 2026). |

**What Piplup adds.** Every product above advertises a recovery rate — 89%, 72%, 55-70% — and none publishes the method behind it. There is no baseline, no batch, no way to check the arithmetic.

Piplup ships the measurement instead of the claim:

1. **A reproducible A/B harness.** One command runs the same 100 labeled cases through a calendar T+3 baseline and through Adaptive Recovery, and prints both. Clone it and verify the numbers yourself.
2. **Incremental lift, not gross recovery.** Cases the calendar would have won anyway do not count as ours. The harness reports adaptive-only wins, cases neither policy could save, and regressions where the baseline beat us.
3. **Net of chase cost.** Every message, notice and retry has a price. Gross recovery ignores it; we subtract it. Calendar retries look cheap until you count the failure emails they trigger.
4. **Refusal as a reported metric.** Recovery tools sell upside. None of them report the money they correctly *declined* to chase, even though burning NPCI retry slots on revoked mandates is the real failure mode. Here, a correct stop scores as a win.

## Baseline assumptions

The comparison is only worth anything if the control is fair, so both readings are scored.

| Baseline | Assumption |
| --- | --- |
| `t3_calendar` | Retries every failure class on T+1, T+2, T+3, including revoked mandates. Razorpay's [Payment Retries doc](https://razorpay.com/docs/payments/subscriptions/payment-retries/) lists mandate cancellation as a failure reason and describes automatic retries with no carve-out. |
| `t3_hard_decline_aware` | Charitable reading: the cycle stops after one hard decline. |

Reported lift has to survive both. If it only existed against the harsher reading, it would not be real.

Involuntary churn counts only subscriptions that were **recoverable** and ended halted anyway. Halting a revoked mandate is correct behaviour, not churn, and both policies are scored with the same rule.

## Uncollected invoices on revived subscriptions

From the same doc:

> If the customer successfully changes the card details when a Subscription is in the halted state, it moves to the active state. Invoices for such Subscriptions are still created. However, **we will not charge these invoices. You will have to charge them manually.**

So a customer comes back, fixes their card, the subscription revives — and the unpaid invoices from the halted window sit there until a human notices. Piplup treats this as its own decline class (`uncollected`) with its own intervention (`back_charge_invoices`).

This money is invisible to the retry cycle, which inflates our lift in a way that deserves calling out rather than hiding, so `npm run evaluate` reports the sweep separately and as a share of total incremental lift.

## Compliance

RBI requires the customer to be notified 24 hours before an auto-debit. The original billing-day attempt is covered by its own notice, but moving a debit to a new date needs a fresh one — which can push the debit itself a day later. The policy engine models this: see `applyPreDebitNotice` in [src/lib/recovery/policy.ts](src/lib/recovery/policy.ts).

Razorpay also does not permit manual charge on an Indian domestic card. For those cases the policy engine will not schedule a retry at all; the only compliant path is a link the customer completes themselves.

## Inbound replies

Customers answer in Hinglish. `parseReply` turns a free-text message into a typed intent — promise to pay, dispute, opt-out, already paid, or unclear — with a confidence score. Anything below 0.6 confidence is ignored rather than acted on.

Two cases in the batch look like ordinary insufficient-funds failures and are only revealed as do-not-touch by their reply (`"ye charge galat hai"` and `"stop karo, mat bhejo"`). A policy that ignores inbound text retries both.

The parser is rule-based today; the LLM slice replaces the extraction, never the decision.

## Env

Copy `.env.example` to `.env.local` with **test-mode** keys (`rzp_test_…`). Live keys are refused.

```bash
npm run recover:demo
```

That mints three Test Mode Payment Links (expired card, paused mandate, checkout drop) after the policy grant. Test accounts allow 30 links total, so we never create one per batch row. Links also appear from the dashboard button on [http://localhost:3000](http://localhost:3000). Check them under Payment Links in the Razorpay dashboard.

## Docs

[ARCHITECTURE.md](./ARCHITECTURE.md)
