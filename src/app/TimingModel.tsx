import type { EnvelopeSweep } from "@/lib/recovery/benchmark";
import { formatINR } from "@/lib/recovery/taxonomy";
import type { RecoveryCase, ScoredWindow, WindowCategory } from "@/lib/recovery/types";
import type { WindowGrid } from "@/lib/recovery/windows";

/**
 * The pick, shown as a grid rather than asserted as a date.
 *
 * A recovery product that says "we retry at the optimal time" is asking to be
 * taken on faith. Every candidate hour of every candidate day is scored, so the
 * chosen one can be read against the ones it beat, and the terms that moved it
 * are printed underneath with their weights.
 */

interface Props {
  picks: Array<{ caseRow: RecoveryCase; grid: WindowGrid; blurb: string }>;
  sweep: EnvelopeSweep;
  calendarHour: number;
}

const CATEGORY_LABEL: Record<WindowCategory, string> = {
  customer: "Customer",
  merchant: "Merchant",
  payment: "Payment",
  seasonality: "Seasonality",
  rail: "Rail",
};

export function TimingModel({ picks, sweep, calendarHour }: Props) {
  return (
    <section className="mt-12">
      <h2 className="font-display text-lg tracking-tight">When to present</h2>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-[#5a6178]">
        A calendar cycle answers this with an offset: T+1, T+2, T+3, in the {pad(calendarHour)}:00 batch. That is a
        date, and a payday is a date <em>and</em> an hour — present at {pad(calendarHour)}:00 on the morning a salary
        lands at 09:00 and the debit bounces against yesterday&rsquo;s balance. So every hour of every day inside the
        merchant&rsquo;s window gets a score, and the best one wins. Darker is a stronger window; grey ones are refused
        outright. Hover any cell for its odds.
      </p>

      <div className="mt-6 space-y-6">
        {picks.map(({ caseRow, grid, blurb }) => (
          <Case key={caseRow.id} caseRow={caseRow} grid={grid} blurb={blurb} calendarHour={calendarHour} />
        ))}
      </div>

      <Benchmark sweep={sweep} />
    </section>
  );
}

function Case({
  caseRow,
  grid,
  blurb,
  calendarHour,
}: {
  caseRow: RecoveryCase;
  grid: WindowGrid;
  blurb: string;
  calendarHour: number;
}) {
  const days = [...new Set(grid.windows.map((w) => w.day))].sort((a, b) => a - b);
  const hours = [...new Set(grid.windows.map((w) => w.hourIST))].sort((a, b) => a - b);
  const chosen = new Set(grid.chosen.map((c) => `${c.day}-${c.hourIST}`));
  const best = grid.chosen[0];
  const scale = shadeScale(grid.windows);

  const signals: string[] = [];
  if (caseRow.salaryDay) signals.push(`declared payday ${caseRow.salaryDay}`);
  if (caseRow.priorClearedDays?.length) signals.push(`cleared day ${caseRow.priorClearedDays.join(", ")} previously`);
  if (caseRow.promiseToPayDay) signals.push(`promised day ${caseRow.promiseToPayDay}`);
  if (caseRow.liquidity?.atDay) signals.push(`cleared elsewhere day ${caseRow.liquidity.atDay}`);
  if (signals.length === 0) signals.push("no liquidity signal on file");

  return (
    <article className="desk-card overflow-hidden">
      <header className="px-5 py-4">
        <h3 className="text-sm font-medium">
          {caseRow.customerName}{" "}
          <span className="text-neutral-400">
            {formatINR(caseRow.uncollectedInvoicesPaise ?? caseRow.amountPaise)} ·{" "}
            {caseRow.declineCode.replaceAll("_", " ")} · {caseRow.bank}
          </span>
        </h3>
        <p className="mt-1 text-xs leading-5 text-neutral-400">{blurb}</p>
        <p className="mt-2 text-[11px] leading-5 text-neutral-400">
          <span className="text-neutral-500">What the merchant can see:</span> {signals.join(" · ")}
        </p>
      </header>

      <div className="border-t border-neutral-100 px-5 py-5">
        <div className="overflow-x-auto">
          <table className="border-separate border-spacing-[2px] text-[10px] tabular-nums">
            <thead>
              <tr>
                <th className="pr-2 text-right font-normal text-neutral-300">IST</th>
                {days.map((day) => (
                  <th key={day} className="w-7 pb-1 font-normal text-neutral-400">
                    {day}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {hours.map((hour) => (
                <tr key={hour}>
                  <th className="pr-2 text-right font-normal text-neutral-400">{pad(hour)}</th>
                  {days.map((day) => {
                    const window = grid.windows.find((w) => w.day === day && w.hourIST === hour);
                    if (!window) return <td key={day} />;
                    return (
                      <Cell key={day} window={window} chosen={chosen.has(`${day}-${hour}`)} scale={scale} />
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-3 text-[11px] leading-5 text-neutral-400">
          {grid.windows.length} windows scored.{" "}
          {best ? (
            <>
              Best is{" "}
              <span className="font-medium text-[#305eff]">
                day {best.day} at {pad(best.hourIST)}:00
              </span>{" "}
              at {Math.round(best.probability * 100)}%.
            </>
          ) : (
            "None cleared the floor, so no NPCI slot is spent."
          )}{" "}
          {grid.chosen.length > 1
            ? `A reserve window is held for day ${grid.chosen[1].day}, used only if the first one misses.`
            : null}{" "}
          The calendar presents at {pad(calendarHour)}:00 on day {caseRow.billingDay + 1}.
        </p>
      </div>

      {best ? <Factors grid={grid} /> : null}
    </article>
  );
}

/**
 * Shade on log-odds, normalised to this case.
 *
 * Shading on the probability itself would render almost the whole grid one flat
 * colour: past the payday every window is above 95%, and the terms that
 * actually decide the pick — the hour, the drift off the billing date — only
 * separate on the log-odds scale the model works in.
 */
function shadeScale(windows: ScoredWindow[]): (w: ScoredWindow) => number {
  const usable = windows.filter((w) => !w.blocked);
  if (usable.length === 0) return () => 0;
  const values = usable.map((w) => w.logOdds);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  return (w) => (span < 0.01 ? 1 : (w.logOdds - min) / span);
}

function Cell({
  window,
  chosen,
  scale,
}: {
  window: ScoredWindow;
  chosen: boolean;
  scale: (w: ScoredWindow) => number;
}) {
  const blocked = Boolean(window.blocked);
  const title = blocked
    ? `day ${window.day} ${pad(window.hourIST)}:00 — ${window.blocked}`
    : `day ${window.day} ${pad(window.hourIST)}:00 — ${Math.round(window.probability * 100)}%`;

  return (
    <td
      title={title}
      className={`h-5 w-7 rounded-[2px] text-center ${chosen ? "outline outline-2 outline-offset-1 outline-[#305eff]" : ""}`}
      style={{
        background: blocked ? "#f4f4f5" : `rgba(48, 94, 255, ${(0.1 + scale(window) * 0.85).toFixed(3)})`,
      }}
    >
      <span className="sr-only">{title}</span>
    </td>
  );
}

/**
 * Stripe sorts 500-plus features into five families. Ours has five signals in
 * the same five families, and every one is something a merchant already holds.
 */
function Factors({ grid }: { grid: WindowGrid }) {
  const factors = grid.explanation.factors;
  if (factors.length === 0) return null;

  const order: WindowCategory[] = ["customer", "seasonality", "payment", "rail", "merchant"];
  const grouped = order
    .map((category) => ({ category, rows: factors.filter((f) => f.category === category) }))
    .filter((group) => group.rows.length > 0);

  return (
    <div className="border-t border-neutral-100 bg-neutral-50/60 px-5 py-4">
      <p className="text-[11px] font-medium text-neutral-500">Why that window, in log-odds</p>
      <div className="mt-2 grid gap-x-8 gap-y-1 sm:grid-cols-2">
        {grouped.map((group) => (
          <div key={group.category} className="contents">
            {group.rows.map((factor, i) => (
              <p key={`${group.category}-${i}`} className="flex items-baseline gap-2 text-[11px] leading-5">
                <span className="w-16 shrink-0 text-neutral-400">{CATEGORY_LABEL[group.category]}</span>
                <span className="flex-1 text-neutral-600">{factor.label}</span>
                <span
                  className={`shrink-0 tabular-nums ${factor.weight > 0 ? "text-[#305eff]" : "text-orange-700"}`}
                >
                  {factor.weight > 0 ? "+" : ""}
                  {factor.weight.toFixed(2)}
                </span>
              </p>
            ))}
          </div>
        ))}
      </div>
      <p className="mt-3 text-[11px] leading-5 text-neutral-400">
        Envelope: drop-dead day {grid.explanation.envelope.dropDeadDay}, at most{" "}
        {grid.explanation.envelope.maxAttempts} debits, then {grid.explanation.envelope.finalAction.replaceAll("_", " ")}.
        The merchant sets the boundary; the model only picks inside it.
      </p>
    </div>
  );
}

/**
 * The envelope is a real dial, so the cost of turning it should be measured
 * rather than guessed. Each row is the whole batch re-run under that setting.
 */
function Benchmark({ sweep }: { sweep: EnvelopeSweep }) {
  const best = sweep.recommended;

  return (
    <div className="desk-card mt-6 overflow-hidden">
      <header className="px-5 py-4">
        <h3 className="text-sm font-medium">What the drop-dead day is worth</h3>
        <p className="mt-1 max-w-2xl text-xs leading-5 text-neutral-400">
          A merchant asked to pick a retry window has no way to answer well, so the answer is measured: every row is
          all {sweep.results.length > 0 ? "112" : "0"} cases re-run under that envelope. Longer windows recover more and
          give a churning customer more free access; more attempts stop paying before NPCI&rsquo;s cap is even reached.
        </p>
      </header>
      <div className="overflow-x-auto border-t border-neutral-100">
        <table className="w-full text-xs tabular-nums">
          <thead>
            <tr className="text-left text-[11px] text-neutral-400">
              <th className="px-5 py-2 font-normal">Window</th>
              <th className="px-3 py-2 font-normal">Attempts</th>
              <th className="px-3 py-2 text-right font-normal">Recovered</th>
              <th className="px-3 py-2 text-right font-normal">NPCI debits</th>
              <th className="px-5 py-2 text-right font-normal">Churned</th>
            </tr>
          </thead>
          <tbody>
            {sweep.results.map((row) => {
              const isBest = row.dropDeadDay === best.dropDeadDay && row.maxAttempts === best.maxAttempts;
              return (
                <tr
                  key={`${row.dropDeadDay}-${row.maxAttempts}`}
                  className={`border-t border-neutral-100 ${isBest ? "bg-[#305eff]/[0.06]" : ""}`}
                >
                  <td className="px-5 py-1.5">
                    {row.dropDeadDay} days
                    {isBest ? <span className="ml-2 text-[10px] text-[#305eff]">recommended</span> : null}
                  </td>
                  <td className="px-3 py-1.5 text-neutral-500">{row.maxAttempts}</td>
                  <td className="px-3 py-1.5 text-right">{formatINR(Math.round(row.rupeesRecovered * 100))}</td>
                  <td className="px-3 py-1.5 text-right text-neutral-500">{row.npciDebits}</td>
                  <td className="px-5 py-1.5 text-right text-neutral-500">{row.involuntaryChurn}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function pad(hour: number): string {
  return String(hour).padStart(2, "0");
}
