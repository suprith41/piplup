# Piplup

Policy-gated **AI revenue recovery** for Indian recurring payments.

Built for [Razorpay AI Buildathon](https://razorpay.com/buildathon/) Track 03. Demo merchant: **Eureka Labs** — monthly AI/ML course AutoPays in Hyderabad. Book: **112 labeled failures** out of 1,240 billed seats.

A failed AutoPay is not one problem. Razorpay’s public retry model treats most of them as “try again tomorrow” (T+1, T+2, T+3). Piplup reads *why* it bounced, then changes the next move — or correctly refuses to debit.

```bash
npm install
npm run evaluate
npm run dev
```

`npm run evaluate` runs Adaptive Recovery and two T+3 baselines on the same 112 cases. Open [http://localhost:3000](http://localhost:3000) for the desk, [`/lab`](http://localhost:3000/lab) for the timing grid, [`/architecture`](http://localhost:3000/architecture) for the system map.

---

## What we built

A recovery **agent**, not a chatbot and not a retry cron.

| Surface | What it is |
| --- | --- |
| **Policy engine** | Classifies the decline, grants one clock (cascade / dunning / re-auth / stop), and will not spend an NPCI slot unless the debit can work. |
| **Window model** | Scores every day × hour inside a merchant envelope and picks when to present — Stripe Smart Retries, on a 112-case book. |
| **Ladder** | Expands the grant into a priced cycle: day, hour, channel, quiet hours, 3-message cap, hard stop. |
| **A/B harness** | Same batch through Adaptive and T+3. Reports incremental lift, chase cost, NPCI spend, and correct refusals. |
| **Revenue desk** | Payments, Customers, Settlements, Disputes, Reports, Smart Prevent — what Ada sees on the night the book lands. |
| **Prevention** | Next cycle, scanned *before* anything is charged. Invoice above mandate ceiling, or a card that lapses before billing day — arithmetic, not a prediction. |

Live action is **test-mode Payment Links and email** only. Live Razorpay keys are refused.

---

## What we took from Stripe — and what we had to rebuild

Stripe’s [Smart Retries](https://stripe.com/blog/how-we-built-it-smart-retries) replaced a fixed dunning calendar with a model that scores candidate retry windows. The merchant sets the envelope (drop-dead day, max attempts, final action). The model picks the time *inside* it. Default on cards: **8 tries in 2 weeks**.

We ported that **split**, not Stripe’s model.

| Stripe | What we implemented |
| --- | --- |
| Fixed schedule → scored windows | Exhaustive search over the day × hour grid (`src/lib/recovery/windows.ts`) |
| 500+ features in five families | Five signals a Razorpay merchant already holds: payday, promise-to-pay, prior clear days, decline-code base rate, rail + hour |
| Heavy network model | Additive log-odds on 112 labeled cases, leave-one-out base rates so a case never scores itself |
| Retry until the budget runs out | Spend a slot only if expected value clears a floor |
| Merchant envelope, model interior | Same — except **NPCI already capped a mandate at 1 original + 3 retries**, so `maxAttempts` can only go lower than four |
| Published default | `sweepEnvelopes()` ranks 15 envelopes; this book’s best is **14 days × 2 attempts** |

The hour is the India-specific load-bearing signal. Indian payroll posts in the morning clearing batch. A debit presented at **02:00 on payday** is presented against yesterday’s balance — the right date, the wrong time. A T+3 calendar presents at 02:00 every time.

We did not fake Visa/Mastercard Adaptive Acceptance, a card account updater, or a cross-merchant graph. Those need issuer pipes. The method is what ports; the rails are Indian.

---

## How a decision is made

```
fail → parse reply → classify → grant → mutate → spend an NPCI slot only if it can work → log → score vs T+3
```

1. **Read the text.** `parseReply` turns Hinglish / English into `promise_to_pay`, `dispute`, `already_paid`, `opt_out`, or `unclear`. Confidence below 0.6 is ignored. This is the only AI-shaped slot; it never classifies the decline and never grants money.
2. **Name the why.** Six classes: technical, financial, instrument, terminal, behavioral, uncollected. Rules, not a model.
3. **Grant one clock.** `grantAdaptive` in [`src/lib/recovery/policy.ts`](src/lib/recovery/policy.ts) is the only door a debit can walk through.
4. **Change the next attempt.** Hold 8s on a slow switch; cascade if core banking is down; wait for payday *and* the hour if it is money; send a link if the instrument is dead; ask for a fresh AutoPay if the mandate is revoked; freeze on dispute / opt-out / already paid.
5. **Prove it.** Incremental lift vs T+3, net of chase cost, NPCI slots saved, refusals counted as correct decisions.

A revoked mandate spends **zero** slots. The debit is dead; the customer is not. Exhausting the NPCI budget downgrades to a Payment Link rather than ending recovery.

---

## Indian constraints the engine is built around

| Constraint | What the engine does |
| --- | --- |
| **NPCI** — 1 original + 3 retries | `npciSlotsUsed` on every decision. Links, re-auth, and invoice sweeps are out of band. |
| **Bank ≠ rail** | Latency spike → hold and re-present the same rail. CBS down → switch rail. Always cascading loses one group; always waiting loses the other. |
| **RBI 24h pre-debit notice** | Moving a debit to a new date can push it a day later (`applyPreDebitNotice`). |
| **Domestic cards** | Razorpay does not allow a merchant-initiated charge. Those cases only ever get a customer-completed link. |

---

## What `npm run evaluate` prints

Same 112 cases. Adaptive has to beat **T+3 all** (retries every class, including revoked mandates) *and* **T+3 charitable** (stops after one hard decline). Lift that only exists against the harsher reading is not real.

On this book:

| | T+3 | Adaptive |
| --- | --- | --- |
| Recovered | ₹17,178 | **₹69,105** |
| Recovery rate | 20% | **78%** |
| NPCI debits | 270 | **45** |
| Incremental lift | — | **₹51,927** (65 cases the calendar does not win) |
| Slots wasted on dead mandates | 31 | **0** |

A third attempt recovers nothing more and costs a slot, which is why the shipped envelope is 14 days × 2 — Stripe’s two-week window, at a fraction of the attempts, because NPCI granted four and card rails grant eight.

Uncollected invoices on *revived* subscriptions (Razorpay will not auto-charge them) are reported as their own share of lift, because the calendar has no path to that money.

---

## Product

| Route | What a reviewer is looking at |
| --- | --- |
| `/` | Night desk — incoming tape, decisions, lift vs T+3 |
| Settlements / Disputes | Inbound promises and cases we left alone on purpose |
| Reports | Recovered / in recovery / not recovered, by method, decline, bank, cost |
| Smart Prevent | Next cycle, flagged three days out, zero slots |
| `/lab` | Scored timing grid + Adaptive ladder next to T+3 |
| `/architecture` | The two loops and the grant gate |

---

## Run

```bash
npm install
npm run evaluate   # A/B harness — clone and verify the numbers
npm run dev        # desk on :3000
```

Optional, **test-mode** keys only (`rzp_test_…`). Copy `.env.example` to `.env.local`.

```bash
npm run recover:demo   # three Payment Links after the policy grant
```

Test accounts allow 30 links. We never mint one per batch row.

---

## Repository

```
src/lib/recovery/        engine — grant, windows, ladder, evaluate
src/lib/razorpay/        test-mode Payment Links + webhook ledger
src/lib/autopilot/       night queue that drives the desk
src/lib/email/           reminder copy + send
src/components/desk/     dashboard (one file per tab)
src/components/insights/ Reports + Smart Prevent
src/components/lab/      timing grid and live mint
src/app/                 routes and APIs only
scripts/evaluate.ts      the proof
```

Start at [`src/lib/recovery/policy.ts`](src/lib/recovery/policy.ts) and [`scripts/evaluate.ts`](scripts/evaluate.ts). The file table in [ARCHITECTURE.md](./ARCHITECTURE.md) maps each box to a path.

**Stack:** Next.js 15, TypeScript, Razorpay Test Mode, Nodemailer.
