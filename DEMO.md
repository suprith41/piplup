# Recording the 5-minute pitch

Not a script. Shot list, tab order, and what must appear on screen so the video hits the Track 03 bar.

Official ask: a public repo, this architecture, and a **5-minute** pitch. Track 03 bar: measured money recovered across a batch, compliant escalation, stopping rules, audit trail.

## What a winning 5 minutes looks like here

Judges watch many videos. They decide in the first half-minute whether this is a real recovery agent or a retry bot with a dashboard.

Do **not** open on a cold architecture lecture. Give the diagram 20 seconds of *why it exists*, then use the diagram as the map, then walk the product **along those boxes**. That is your plan, in the order that keeps people watching.

| Time | On screen | What this beat is for |
| --- | --- | --- |
| 0:00–0:20 | `/architecture` fullscreen (F11) | One sentence: a payment failed, we read why, we do one right thing. |
| 0:20–1:20 | Same page, four clocks fill the screen | Point: bounced → **AI reads the text** → we name the why → we decide. Then the four colours. Footer: AI never touches money. |
| 1:20–2:20 | `/` Payments, night already running or just Replay | Build quality. Incoming tape vs Piplup tape. Four KPIs, especially Lift vs T+3. |
| 2:20–2:50 | Settlements, then Disputes | Stopping rules + inbound. One promise. One freeze. Say revoked AutoPay is **not** on Disputes. |
| 2:50–3:20 | Reports, “Where the money stands” then “How the money came back” | Measured volume. Green / blue / red. Then silent rails vs zero-slot methods. |
| 3:20–3:40 | Smart Prevent | Dawn loop. Arithmetic, not a guess. |
| 3:40–4:30 | `/lab` numbers + one timing grid + one ladder vs T+3 | Proof. Same 112, two baselines. Hover one payday hour. |
| 4:30–5:00 | Back to `/architecture` tools strip, or terminal `npm run evaluate` | AI judgment + one failure you handled. Then stop talking. |

If you run long, cut Customers and the year toggle on Reports. Do not cut Disputes, lift, or the grant box.

## Tabs to have open before you hit record

1. `http://localhost:3000/architecture` — first frame
2. `http://localhost:3000/` — desk, night already played once so the tapes are full (or be ready to hit Replay)
3. `http://localhost:3000/lab` — scrolled to the three stats
4. Optional: a terminal that has already run `npm run evaluate`, scrolled to the lift block

Browser: one window, 1280×720 or 1920×1080, bookmarks hidden, notifications off. Zoom the desk to ~110% if the four KPIs feel small.

## Click path on the desk (do not wander)

Payments → (one live card or one decision on the Piplup tape) → Settlements (one row) → Disputes (one freeze) → Reports (two graphs only) → Smart Prevent (queue, not every row) → Lab.

Never open Customers unless you have spare time. It is a roster, not a new idea.

## What must appear (Track 03 checklist)

A reviewer who only watches the video should still see:

- [ ] A batch, not one cherry-picked student (112 / Cycle 47 / lift vs T+3)
- [ ] A stop (Disputes: no debit, no message)
- [ ] An audit line (a decision with a reason on the Piplup tape)
- [ ] Compliant path (RBI notice or domestic-card link, spoken while pointing at Grant or Standing orders)
- [ ] Architecture as a gate, not a chatbot (Grant box + “LLM never classifies”)

## How to record, practically

- Record the screen. Face-in-corner is optional and only useful in the first 20 seconds. After that they need the UI.
- One take per beat is fine. Stitch. Do not restart a perfect 4-minute take because beat 5 wobbles.
- Mouse moves slowly. Hover, pause, then talk. Do not circle the pointer.
- No intro logo, no music, no “hi my name is” beyond one clause.
- If a teammate clicks, you only talk. If you are alone, pause the voice while you switch tabs.
- When the night is mid-stream, let two or three decisions land, then pause or wait until Closed so the numbers hold still.

## What not to do

- Do not start inside `policy.ts`. The file map is for the repo, not the first minute.
- Do not demo every tab equally. Disputes and Reports carry the bar. Payments proves it runs.
- Do not claim an LLM you did not ship. The win is **where you did not put one**.
- Do not pretend 112 live UPI debits. Say test-mode links, seeded book, same policy.
- Do not end on “future work.” End on the evaluate lift or the grant gate.

## After the cut

Watch it once with the official four questions in your head: problem taste, build quality, AI judgment, failure recovery. If a beat does not answer one of those, it is B-roll. Cut it.
