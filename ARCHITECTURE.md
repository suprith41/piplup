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
    → executor
    → append-only decision log
    → evaluate vs T+3 baseline (lift, net of cost, refusals)
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
