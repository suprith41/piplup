import { MAX_CONTACTS_PER_CYCLE, QUIET_HOURS_IST } from "@/lib/recovery/ladder";
import { formatINR } from "@/lib/recovery/taxonomy";
import type { AttemptResult, LadderStep, RecoveryCase } from "@/lib/recovery/types";

/**
 * The workflow, not the summary. Both policies ran a plan; these are the plans,
 * side by side, priced. Every rupee in the scoreboard is the sum of the steps
 * shown here, so there is nothing behind the number to take on trust.
 */

interface Props {
  cases: RecoveryCase[];
  adaptive: AttemptResult[];
  baseline: AttemptResult[];
}

/** One representative case per failure family, so the contrast is visible in three rows. */
const SHOWCASE: Array<{ declineCode: string; blurb: string }> = [
  {
    declineCode: "insufficient_funds",
    blurb: "The money is not there yet. Retrying tomorrow burns a slot to learn that again.",
  },
  {
    declineCode: "mandate_revoked",
    blurb: "The mandate is dead. Every debit against it is guaranteed to fail.",
  },
  {
    declineCode: "bank_downtime",
    blurb: "Nothing is wrong with the customer. Do not tell them anything.",
  },
];

export function LadderCompare({ cases, adaptive, baseline }: Props) {
  const picks = SHOWCASE.map((s) => {
    const i = cases.findIndex((c) => c.declineCode === s.declineCode);
    return i === -1 ? null : { i, blurb: s.blurb };
  }).filter((p): p is { i: number; blurb: string } => p !== null);

  return (
    <section className="mt-12">
      <h2 className="text-base font-medium">The bounded workflow</h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-500">
        A policy decides once; a workflow runs for days and has to know when to stop. Guardrails on every case: contact
        only at 10:00 IST, quiet hours {QUIET_HOURS_IST}, at most {MAX_CONTACTS_PER_CYCLE} messages per cycle, and a
        hard stop with a date on it. Greyed steps were planned and never sent, because the money had already landed.
      </p>

      <div className="mt-6 space-y-6">
        {picks.map(({ i, blurb }) => (
          <article key={cases[i].id} className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
            <header className="px-5 py-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-sm font-medium">
                  {cases[i].customerName}{" "}
                  <span className="text-neutral-400">
                    {formatINR(cases[i].uncollectedInvoicesPaise ?? cases[i].amountPaise)} ·{" "}
                    {cases[i].declineCode.replaceAll("_", " ")} · {cases[i].bank}
                  </span>
                </h3>
              </div>
              <p className="mt-1 text-xs leading-5 text-neutral-400">{blurb}</p>
            </header>
            <div className="grid gap-px border-t border-neutral-100 bg-neutral-100 lg:grid-cols-2">
              <Plan title="Piplup" attempt={adaptive[i]} accent />
              <Plan title="T+3 calendar" attempt={baseline[i]} />
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function Plan({ title, attempt, accent = false }: { title: string; attempt: AttemptResult; accent?: boolean }) {
  const slots = attempt.ladder.reduce((n, s) => n + s.npciSlotsUsed, 0);

  return (
    <div className="bg-white p-5">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-medium">{title}</p>
        <p className="text-[11px] text-neutral-400">
          {slots} NPCI · {attempt.contactsUsed} contacts · {money(attempt.costPaise)}
        </p>
      </div>
      <ol className="mt-3 space-y-2.5">
        {attempt.ladder.map((step, n) => (
          <Step key={n} step={step} />
        ))}
      </ol>
      <p className={`mt-4 text-xs ${attempt.recovered ? (accent ? "text-emerald-700" : "text-neutral-500") : "text-neutral-400"}`}>
        {attempt.recovered ? "Recovered." : "Not recovered."} {attempt.note}
      </p>
    </div>
  );
}

function Step({ step }: { step: LadderStep }) {
  const muted = step.skipped;

  return (
    <li className={`flex gap-3 text-xs leading-5 ${muted ? "text-neutral-300" : "text-neutral-600"}`}>
      <span className={`w-14 shrink-0 tabular-nums ${muted ? "text-neutral-300" : "text-neutral-400"}`}>
        {step.action === "stop" ? `day ${step.day}` : `d${step.day} ${pad(step.hourIST)}:00`}
      </span>
      <span className="flex-1">
        <span className={muted ? "" : "text-neutral-900"}>{step.action.replaceAll("_", " ")}</span>
        <span className="text-neutral-400"> · {step.channel}</span>
        {step.npciSlotsUsed ? <span className="text-orange-700"> · 1 slot</span> : null}
        {step.costPaise ? <span className="text-neutral-400"> · {money(step.costPaise)}</span> : null}
        <span className="block text-neutral-400">{step.note}</span>
      </span>
    </li>
  );
}

function pad(hour: number): string {
  return String(hour).padStart(2, "0");
}

/** Messages cost paise, not rupees. Rounding them to ₹0 hides the whole point. */
function money(paise: number): string {
  return paise < 100 ? `${paise}p` : formatINR(paise);
}
