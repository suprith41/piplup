import { CHANNEL_COST_PAISE } from "./cost.ts";
import { seedBatch } from "./seed.ts";
import { classifyDecline } from "./taxonomy.ts";
import type {
  RecoveryCase,
  RetryEnvelope,
  ScheduledAttempt,
  ScoredWindow,
  TimingExplanation,
  WindowFactor,
} from "./types.ts";

/**
 * When to present the next debit.
 *
 * Stripe replaced its fixed dunning schedule with a model that scores every
 * candidate retry window and picks the best one, and published the shape of it:
 * 500+ features in five families, a heavy model because a retry days out has no
 * latency budget to protect, and a merchant-set envelope the model works inside.
 *
 * We cannot train on billions of payments and will not pretend to. What ports
 * is the method, not the model:
 *
 *   fixed schedule            → score the whole day × hour grid, take the argmax
 *   one signal wins           → every signal contributes, additively, in log-odds
 *   opaque score              → each term is labelled and readable off the decision
 *   retry until budget is out → spend a slot only when expected value clears
 *   merchant picks the times  → merchant picks the boundary, the model picks inside it
 *
 * The base rate is measured on the labelled batch, leave-one-out, so a case
 * never contributes to its own prior. Everything else is Indian-rail mechanics
 * we can state and defend.
 */

/**
 * Presentment hours, IST.
 *
 * 02:00 is the nightly subscription batch — the hour a calendar retry uses, and
 * the hour a salary credit has not posted yet. The rest bracket the working day.
 */
const CANDIDATE_HOURS = [2, 9, 11, 14, 19] as const;

/**
 * Indian payroll credits post in the morning clearing batch. A debit presented
 * at 02:00 on payday is presented against yesterday's balance.
 */
const CREDIT_POSTED_BY_HOUR = 11;

/** Below this we do not spend an NPCI slot, whatever the rupees say. */
export const MIN_CLEAR_PROBABILITY = 0.2;

/** No window is ever reported as a certainty. */
const CONFIDENCE_CEILING = 0.97;

/** The two days most Indian payrolls land on. Only breaks ties. */
const PAYROLL_CLUSTER_DAYS = new Set([1, 7]);

export const DEFAULT_ENVELOPE: RetryEnvelope = {
  dropDeadDay: 14,
  maxAttempts: 2,
  finalAction: "link",
};

function exposurePaise(c: RecoveryCase): number {
  return c.uncollectedInvoicesPaise ?? c.amountPaise;
}

function logit(p: number): number {
  const clamped = Math.min(0.995, Math.max(0.005, p));
  return Math.log(clamped / (1 - clamped));
}

function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z));
}

/**
 * Base rate per decline code, measured on the labelled batch.
 *
 * This is the aggregate a merchant already has — "how often did a debit against
 * this decline code ever clear" — not per-case truth. Computed leave-one-out so
 * the case being scored is never part of its own prior, and Laplace-smoothed so
 * a thin bucket cannot produce a 0 or a 1.
 */
interface Bucket {
  cleared: number;
  total: number;
}

let bucketCache: Map<string, Bucket> | null = null;

function everCleared(c: RecoveryCase): boolean {
  const w = c.willSucceedOn;
  return w.sameRailImmediate || w.sameRailAfterCooldown || w.nextRailImmediate || w.sameRailOnSalaryDay;
}

function buckets(): Map<string, Bucket> {
  if (bucketCache) return bucketCache;
  const map = new Map<string, Bucket>();
  for (const row of seedBatch()) {
    const bucket = map.get(row.declineCode) ?? { cleared: 0, total: 0 };
    bucket.total += 1;
    if (everCleared(row)) bucket.cleared += 1;
    map.set(row.declineCode, bucket);
  }
  bucketCache = map;
  return map;
}

function baseRate(c: RecoveryCase): number {
  const bucket = buckets().get(c.declineCode) ?? { cleared: 0, total: 0 };
  // Leave-one-out: pull this case back out of its own bucket.
  const cleared = bucket.cleared - (everCleared(c) ? 1 : 0);
  const total = bucket.total - 1;
  return (cleared + 1) / (total + 2);
}

/** A day the merchant has some reason to believe money will be there. */
interface LiquidityRead {
  day: number;
  label: string;
  /** How much the score leans on it. */
  strength: number;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Every liquidity signal the merchant holds, not just the first one that hits.
 *
 * The cascade this replaced read promise, then liquidity, then payday, then a
 * constant, and stopped at the first match. When a customer declares the 1st and
 * has cleared on the 7th for three cycles running, stopping at the declaration
 * is how you present a debit into an empty account.
 */
export function liquidityReads(c: RecoveryCase): LiquidityRead[] {
  const reads: LiquidityRead[] = [];

  const parsed = c.parsedReply;
  const promised = c.promiseToPayDay;
  if (promised && (!parsed || parsed.confidence >= 0.6)) {
    reads.push({
      day: promised,
      label: `promised day ${promised}`,
      strength: parsed ? Math.min(1, parsed.confidence + 0.2) : 0.9,
    });
  }

  if (c.salaryDay) {
    reads.push({ day: c.salaryDay, label: `declared payday ${c.salaryDay}`, strength: 0.85 });
  }

  if (c.liquidity?.instrumentSucceededElsewhere && c.liquidity.atDay) {
    reads.push({
      day: c.liquidity.atDay,
      label: `instrument cleared elsewhere on day ${c.liquidity.atDay}`,
      strength: 0.8,
    });
  }

  const history = c.priorClearedDays ?? [];
  if (history.length > 0) {
    // The day it has always cleared by, not the average of the days it cleared on.
    const settledBy = Math.max(...history);
    const spread = settledBy - Math.min(...history);
    const consistency = Math.max(0.35, 1 - spread / 7);
    reads.push({
      day: settledBy,
      label: `cleared by day ${settledBy} in ${history.length} prior cycle${history.length === 1 ? "" : "s"}`,
      strength: 0.6 + 0.35 * consistency,
    });
    if (history.length >= 3) {
      const centre = median(history);
      if (centre !== settledBy) {
        reads.push({
          day: centre,
          label: `usual clearing day ${centre}`,
          strength: 0.5 * consistency,
        });
      }
    }
  }

  return reads;
}

function attemptCostPaise(c: RecoveryCase, day: number): number {
  // A debit on a new date needs a fresh RBI notice, and we warn before we debit.
  const movedDate = day > c.billingDay + 1;
  return CHANNEL_COST_PAISE.whatsapp + (movedDate ? CHANNEL_COST_PAISE.preDebitNotice : 0);
}

function hourFactor(hour: number): WindowFactor {
  if (hour <= 2) {
    return {
      category: "seasonality",
      label: "02:00 batch — presented against yesterday's balance",
      weight: -0.4,
    };
  }
  if (hour <= 9) {
    return { category: "seasonality", label: "09:00 — clearing batch still running", weight: -0.1 };
  }
  if (hour <= 11) {
    return { category: "seasonality", label: "11:00 — morning credits have posted", weight: 0.25 };
  }
  if (hour <= 14) {
    return { category: "seasonality", label: "14:00 — balance settled", weight: 0.15 };
  }
  return { category: "seasonality", label: "19:00 — late, but same-day", weight: 0 };
}

function railFactor(c: RecoveryCase): WindowFactor | null {
  if (c.rail === "upi_autopay") {
    return { category: "rail", label: "UPI AutoPay presents 24×7", weight: 0.2 };
  }
  if (c.rail === "enach") {
    return { category: "rail", label: "eNACH settles in batches", weight: -0.15 };
  }
  return null;
}

/** Score one slot of the grid. */
function scoreWindow(
  c: RecoveryCase,
  day: number,
  hourIST: number,
  envelope: RetryEnvelope,
  reads: LiquidityRead[],
): ScoredWindow {
  const factors: WindowFactor[] = [];
  const base = baseRate(c);

  // The starting point is a measured rate, not a constant we chose, so it is a
  // term like any other and carries its own weight.
  factors.push({
    category: "payment",
    label: `${c.declineCode.replaceAll("_", " ")} has cleared ${Math.round(base * 100)}% of the time`,
    weight: logit(base),
  });

  if (reads.length === 0) {
    // Nothing declared, nothing observed. Lean on the population instead of a constant.
    factors.push({
      category: "customer",
      label: "no liquidity signal on file",
      weight: -0.5,
    });
    if (PAYROLL_CLUSTER_DAYS.has(day)) {
      factors.push({ category: "seasonality", label: `day ${day} is a payroll cluster day`, weight: 0.55 });
    }
  }

  for (const read of reads) {
    const after = day >= read.day;
    const weight = after ? 2.4 * read.strength : -2.6 * read.strength;
    factors.push({
      category: "customer",
      label: after ? `on or after ${read.label}` : `before ${read.label}`,
      weight,
    });

    // Payday is a day, not a time. Landing on it before the credit posts is a miss.
    if (day === read.day) {
      factors.push(
        hourIST >= CREDIT_POSTED_BY_HOUR
          ? {
              category: "seasonality",
              label: `after the ${CREDIT_POSTED_BY_HOUR}:00 credit window on the day itself`,
              weight: 0.9 * read.strength,
            }
          : {
              category: "seasonality",
              label: `before the ${CREDIT_POSTED_BY_HOUR}:00 credit window on the day itself`,
              weight: -1.1 * read.strength,
            },
      );
    }
  }

  factors.push(hourFactor(hourIST));

  const rail = railFactor(c);
  if (rail) factors.push(rail);

  // Money later is worth less than money now, and every extra day is churn risk.
  const drift = day - c.billingDay;
  if (drift > 0) {
    factors.push({
      category: "merchant",
      label: `${drift} day${drift === 1 ? "" : "s"} past the billing date`,
      weight: -0.05 * drift,
    });
  }

  if (exposurePaise(c) >= 99900) {
    factors.push({
      category: "merchant",
      label: "high-value debit needs more headroom in the account",
      weight: -0.25,
    });
  }

  let z = 0;
  for (const factor of factors) z += factor.weight;

  // A timing model fitted on 112 cases has no business reporting a certainty.
  // Scaled rather than clipped, so the ceiling never flattens two windows into
  // a tie and hands the pick to whichever one the grid happened to build first.
  const probability = CONFIDENCE_CEILING * sigmoid(z);
  const cost = attemptCostPaise(c, day);
  const evPaise = probability * exposurePaise(c) - cost;

  let blocked: string | undefined;
  if (day > envelope.dropDeadDay) blocked = `past drop-dead day ${envelope.dropDeadDay}`;
  else if (day < c.billingDay) blocked = "before the billing day";
  else if (probability < MIN_CLEAR_PROBABILITY) {
    blocked = `below the ${Math.round(MIN_CLEAR_PROBABILITY * 100)}% floor for spending an NPCI slot`;
  } else if (evPaise <= 0) blocked = "expected value does not cover the attempt";

  return { day, hourIST, probability, logOdds: z, evPaise, factors, blocked };
}

export interface WindowGrid {
  caseId: string;
  windows: ScoredWindow[];
  chosen: ScheduledAttempt[];
  explanation: TimingExplanation;
}

/**
 * Score the whole grid, then take attempts greedily by expected value.
 *
 * A second debit on the same day is not a second chance — the balance has not
 * moved and NPCI counts it all the same — so attempts are held a day apart.
 */
export function planWindows(
  c: RecoveryCase,
  envelope: RetryEnvelope = DEFAULT_ENVELOPE,
  slotsAvailable = c.retryBudgetLeft,
): WindowGrid {
  const reads = liquidityReads(c);
  const windows: ScoredWindow[] = [];

  for (let day = c.billingDay; day <= envelope.dropDeadDay; day += 1) {
    for (const hour of CANDIDATE_HOURS) {
      windows.push(scoreWindow(c, day, hour, envelope, reads));
    }
  }

  const usable = windows.filter((w) => !w.blocked).sort((a, b) => b.evPaise - a.evPaise);
  const budget = Math.max(0, Math.min(envelope.maxAttempts, slotsAvailable));

  const chosen: ScheduledAttempt[] = [];
  for (const window of usable) {
    if (chosen.length >= budget) break;
    if (chosen.some((picked) => Math.abs(picked.day - window.day) < 1)) continue;
    chosen.push({
      day: window.day,
      hourIST: window.hourIST,
      probability: window.probability,
      evPaise: window.evPaise,
    });
  }
  chosen.sort((a, b) => a.day - b.day || a.hourIST - b.hourIST);

  const best = usable[0];
  const explanation: TimingExplanation = {
    considered: windows.length,
    refusedOnEv: windows.filter((w) => w.blocked && w.day <= envelope.dropDeadDay).length,
    chosen,
    factors: best ? best.factors.filter((f) => f.weight !== 0) : [],
    envelope,
  };

  return { caseId: c.id, windows, chosen, explanation };
}

/** The single best slot, or null when nothing in the envelope is worth a debit. */
export function bestWindow(
  c: RecoveryCase,
  envelope: RetryEnvelope = DEFAULT_ENVELOPE,
  slotsAvailable = c.retryBudgetLeft,
): ScheduledAttempt | null {
  return planWindows(c, envelope, slotsAvailable).chosen[0] ?? null;
}

/**
 * Timing for an out-of-band ask — a link or a re-auth request.
 *
 * Same reasoning about when the customer has money, none of the NPCI arithmetic,
 * and the hour is the ladder's contact hour rather than a presentment slot.
 */
export function bestContactDay(c: RecoveryCase, envelope: RetryEnvelope = DEFAULT_ENVELOPE): number {
  const reads = liquidityReads(c);
  if (reads.length === 0) return c.billingDay;
  const strongest = reads.reduce((top, read) => (read.strength > top.strength ? read : top));
  return Math.min(Math.max(strongest.day, c.billingDay), envelope.dropDeadDay);
}

/** Only used by the grid view, which wants the case's own class label. */
export function windowClass(c: RecoveryCase): string {
  return classifyDecline(c);
}
