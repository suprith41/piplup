# Piplup

Track 03 — AI Revenue Recovery for the [Razorpay AI Buildathon](https://razorpay.com/buildathon/).

Stripe-grade recovery intelligence on **Razorpay's Indian rails**, demoed as the recovery desk for **Eureka Labs** — an online AI/ML course subscription. Not a retry bot.

- Type the decline first.
- Mutate the next attempt. Do not replay the same debit.
- Cascade *now* if the bank is down; hold a few seconds if the bank is merely slow.
- Dunning *later* if it is money. Wait for salary day, not T+1.
- Treat the **NPCI budget (1 original + 3 retries)** as the scarce resource. A revoked mandate gets a re-auth ask, not a retry.
- Score it against a Razorpay-style **T+3 calendar** on the same 112 labeled cases.

We do **not** fake ISO 8583 Adaptive Acceptance or a global card graph. Those need issuer pipes. The method is what we port; the rails are Indian.

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
- spend fewer NPCI debits doing it
- waste zero slots on revoked / chargeback / opt-out cases

That is Stripe’s published shape (more recovery, fewer attempts), implemented as an India-rail agent.

## The three Indian constraints the engine is built around

| Constraint | What the engine does |
| --- | --- |
| **NPCI caps mandate debits** at 1 original + 3 retries | Every decision carries `npciSlotsUsed`. Only same-rail retry, cooldown retry and rail cascade spend from it. A revoked mandate spends **zero** and gets a re-auth ask instead, because the debit is dead but the customer is not. Exhausting the budget downgrades to a link rather than ending recovery. |
| **Bank downtime is not one thing** | A slow switch clears if you hold ~8s and re-present the same rail; the backup rail is behind the same bank and is just as slow. Core banking being down is the reverse. The seed labels both, so a policy that always cascades loses the first group and one that always waits loses the second. |
| **RBI and domestic-card rules** | A debit moved to a new date needs a fresh 24h pre-debit notice, which can push the debit a day later. Indian domestic cards cannot be manually charged at all, so those cases only ever get a customer-completed link. |

## The bounded workflow

A policy decides once. A workflow runs for days and has to know when to stop.

Every case gets an explicit ladder — day, hour, action, channel, price — generated from the grant and shown on `/lab` next to the calendar's ladder for the same customer. Guardrails are part of the object, not a promise in a README: contact only at 10:00 IST, quiet hours 21:00–09:00, at most 3 outbound messages per cycle, and a hard stop with a date on it.

The ladder is also the **cost model**. Both policies are priced off the steps they actually ran, so the outreach spend in the scoreboard is the sum of the steps you can read on screen. Steps the ladder planned and never sent — because the money landed on step one — are greyed out and cost nothing. There is no second source of truth to reconcile.

## Recovery analytics

Stripe publishes a [recovery dashboard](https://docs.stripe.com/billing/revenue-recovery/recovery-analytics); the **Analytics** tab is that dashboard on Indian rails. Failure rate, recovery rate by volume, and the recovered / **in recovery** / not-recovered split, where "in recovery" is money whose next scheduled action has not come round yet — counting it as lost would flatter the recovery rate, counting it as won would be a lie.

Two things Stripe reports differently and two it does not report at all:

- **Recovered volume by method.** Stripe buckets this three ways (retries, emails, other). Ours splits into the six moves the policy can actually make, each with the NPCI slots it consumed. Half the recovered volume comes from methods that spend **zero** slots.
- **Failed volume by decline reason**, with the recovery rate per reason, so a policy that is good at timeouts and bad at revoked mandates cannot hide behind an average.
- **By sponsor bank** — not a Stripe concept, but the one that matters when a bank's core banking system decides your Tuesday.
- **Cost of the chase**, in paise spent per rupee recovered. Nobody publishes this, because gross recovery reads better.

## Prevention: the debit that never fails

Stripe emails a customer a month before their card expires. India has no card account updater, so the same idea has to work harder — and it turns out it can work with certainty rather than prediction.

A UPI AutoPay mandate is approved **up to a ceiling**. If this cycle's invoice is larger than that ceiling, the debit *cannot* clear. That is arithmetic, not a model. Same for a mandate or card that lapses before the billing date. The **Prevent** tab scans next cycle's book before anything is charged and flags every debit that is already guaranteed to fail, three days out, for the price of a WhatsApp message and zero NPCI slots.

The calendar finds these on the billing day and then spends its entire retry budget rediscovering that one number is bigger than another.

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

1. **A reproducible A/B harness.** One command runs the same 112 labeled cases through a calendar T+3 baseline and through Adaptive Recovery, and prints both. Clone it and verify the numbers yourself.
2. **Incremental lift, not gross recovery.** Cases the calendar would have won anyway do not count as ours. The harness reports adaptive-only wins, cases neither policy could save, and regressions where the baseline beat us.
3. **Net of chase cost.** Every message, notice and retry has a price. Gross recovery ignores it; we subtract it. Calendar retries look cheap until you count the failure emails they trigger.
4. **Recovery that happens before the failure.** Every product on that list starts working after a debit has already failed and a slot is already gone. The prevention scan works the cycle before, on failures that are arithmetically certain rather than predicted.
5. **Refusal as a reported metric.** Recovery tools sell upside. None of them report the money they correctly *declined* to chase, even though burning NPCI retry slots on revoked mandates is the real failure mode. Here, a correct refusal scores as a win — and it is scored as *"spent no NPCI slot on a case that must not be debited"*, not as "did nothing", because refusing the debit and refusing the customer are different decisions.

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
