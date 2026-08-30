# Architecture

Piplup is a **policy-gated recovery agent**, not a chatbot that retries payments.

```
decline event
    → parse inbound reply (Hinglish → typed intent)
    → classify decline (code + mandate state + bank signal, not LLM)
    → hard policy grant
    → clock: sync cascade | async dunning | terminal mutation | stop
    → mutate attempt (cooldown / next rail / wait / link / reauth / none)
    → NPCI budget guard (1 original + 3 retries)
    → RBI pre-debit notice gate
    → bounded ladder (day / hour / channel / price, with a hard stop)
    → executor
    → append-only decision log
    → evaluate vs T+3 baseline (lift, net of cost, refusals)
```

A second, earlier loop runs on next cycle's book before anything is charged:

```
upcoming charge
    → mandate ceiling vs invoice amount
    → mandate / card expiry vs billing date
    → preventive notice, 3 days out, zero NPCI slots
```

## Three ways to act, plus a freeze

| Clock | When | Stripe analog | Piplup on Indian rails |
| --- | --- | --- | --- |
| Sync cascade | Bank-side technical decline | Adaptive Acceptance | Slow switch: hold 8s, re-present same rail. CBS down: cascade to another rail. Either way the customer sees nothing. |
| Async dunning | Financial / instrument / checkout | Smart Retries | Wait for salary day, promise-to-pay, or a liquidity signal. Domestic card means a link, never a silent charge. |
| Terminal mutation | Mandate revoked | — | The debit is over, the customer is not. Ask for a fresh AutoPay. **Costs zero NPCI slots.** |
| Stop | Chargeback / opt-out / already paid | Excessive-retry prevention | No debit and no message. Counts as a correct decision. |

## The NPCI budget guard

NPCI allows **1 original debit + 3 retries** on a mandate. That budget is the scarce resource, so the engine
counts it explicitly (`npciSlotsUsed` on every decision) and only three mutations spend from it:
`same_rail_retry`, `cooldown_retry`, `next_rail`.

Links, re-auth requests and invoice sweeps are **out of band** and cost nothing. Two consequences:

- A revoked mandate is worth chasing, just never with a debit.
- Running out of budget does not end recovery. `allow()` downgrades a debit to a payment link rather than
  stopping, because the mandate is exhausted, not the customer.

Correctness is therefore scored as **"spent no NPCI slot on a case that must not be debited"**, not as
"did nothing".

## Bank, not rail, decides the cascade

A technical decline is a statement about a bank. The seed labels which kind:

| Bank signal | What clears it | What does not |
| --- | --- | --- |
| `latency_spike` | Holding a few seconds and re-presenting the same rail | Cascading — the backup rail sits behind the same slow bank |
| `cbs_down` | Routing to another rail | Holding — core banking is not coming back in 8 seconds |

Both branches are load-bearing on the batch: a policy that always cascades loses the latency cases, and one
that always waits loses the CBS cases.

## The ladder is the cost model

A grant says what to do once. [`ladder.ts`](src/lib/recovery/ladder.ts) expands it into the whole cycle: each step
carries a day, an hour, a channel, a price in paise, and the NPCI slots it spends. Guardrails are enforced in the
builder rather than documented as intent — contact only at 10:00 IST, quiet hours 21:00–09:00, a 3-message cap per
cycle, and a terminal `stop` step on a known day.

Both policies are priced off the steps they actually ran, so `costPaise` on an attempt is the sum of its ladder.
Steps planned but skipped — because the money landed earlier, or a cap blocked them — cost zero and stay visible.
The baseline gets its own builder that deliberately does **not** apply our guardrails; capping the calendar's
messages would flatter its cost.

## Prevention

[`prevent.ts`](src/lib/recovery/prevent.ts) is the only part of the system that runs before a failure. It does not
predict: a UPI AutoPay mandate is approved up to a ceiling, so an invoice above that ceiling is a debit that
mathematically cannot clear, and a mandate or card that lapses before the billing date is a failure with a date on
it. Each finding becomes a notice three days ahead, priced at one message and zero NPCI slots, against the four
slots the calendar would spend discovering the same fact on the billing day.

## Analytics

[`analytics.ts`](src/lib/recovery/analytics.ts) derives from the same batch the scoreboard scores — no second
pipeline. It reproduces Stripe's published KPI set (failure rate, recovery rate by volume, recovered / in recovery
/ not recovered, recovered volume by method, failed volume by decline reason, top customers in recovery) and adds
NPCI slots per method, a by-bank breakdown, and paise spent per rupee recovered.

"In recovery" is defined against an `asOfDay` cursor: a case whose next unskipped ladder step falls after that day
has not failed, it simply has not been tried yet.

## What the LLM may do

Write Hinglish customer copy **after** the policy grant, and extract structured intent from an inbound reply. Extraction below 0.6 confidence is discarded.

## What the LLM may not do

Move money. Pick a clock. Override a stop. Spend an NPCI retry.

## Measurement

Three numbers no competitor publishes:

| Metric | Why it exists |
| --- | --- |
| Incremental lift | Cases the baseline would have won anyway are not our win |
| Net of chase cost | Messages and notices cost money; gross recovery hides it |
| Correct refusals | Money we deliberately did not chase, and NPCI slots saved |
| NPCI debits vs out-of-band | Recovering with a link is not the same as spending a mandate retry, so they are counted separately |

## What we refuse to fake

- ISO 8583 payload mutation
- Visa / Mastercard Card Account Updater
- A real cross-merchant card graph
- 3DS exemption

The seed file includes a **synthetic** “instrument succeeded elsewhere” signal so the *method* is testable. The README says it is synthetic.

## Baseline

`t3_calendar` retries the same rail on T+1, T+2, T+3. That is the control that looks like Razorpay Subscriptions’ public retry model. Adaptive Recovery has to beat it on recovery **and** retry count.

## Not built

Live silent UPI debit, a real phone rail (Twilio / Exotel), the WhatsApp Business API, and B2B receivables
ageing. Channel cost is modelled for WhatsApp and SMS; only email is actually sent.
