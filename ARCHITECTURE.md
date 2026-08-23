# Architecture

Piplup is a **policy-gated recovery agent**, not a chatbot that retries payments.

```
decline event
    → parse inbound reply (Hinglish → typed intent)
    → classify decline (code, not LLM)
    → hard policy grant
    → clock: sync cascade | async dunning | stop
    → mutate attempt (next rail / wait / link / reauth / none)
    → RBI pre-debit notice gate
    → executor
    → append-only decision log
    → evaluate vs T+3 baseline (lift, net of cost, refusals)
```

## Two clocks

| Clock | When | Stripe analog | Piplup analog |
| --- | --- | --- | --- |
| Sync cascade | Technical / false decline | Adaptive Acceptance | Immediately try the next rail. Customer should not see this fail. |
| Async dunning | Financial / instrument | Smart Retries | Wait for salary day, promise-to-pay, or a synthetic liquidity signal. |
| Stop | Terminal / opt-out / budget 0 | Excessive-retry prevention | Do not touch the mandate. Count as a correct decision. |

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

## What we refuse to fake

- ISO 8583 payload mutation
- Visa / Mastercard Card Account Updater
- A real cross-merchant card graph
- 3DS exemption

The seed file includes a **synthetic** “instrument succeeded elsewhere” signal so the *method* is testable. The README says it is synthetic.

## Baseline

`t3_calendar` retries the same rail on T+1, T+2, T+3. That is the control that looks like Razorpay Subscriptions’ public retry model. Adaptive Recovery has to beat it on recovery **and** retry count.

## Next slice

Razorpay test-mode Payment Links for the `payment_link` and `mandate_reauth` mutations. Keys stay in `.env.local`.
