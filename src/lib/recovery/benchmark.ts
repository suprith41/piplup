import { enrichWithReply } from "./reply.ts";
import { seedBatch } from "./seed.ts";
import { runPolicy } from "./simulate.ts";
import type { RecoveryCase, RetryEnvelope } from "./types.ts";
import { DEFAULT_ENVELOPE } from "./windows.ts";

/**
 * What the envelope should default to.
 *
 * Stripe's fourth lesson is that a merchant asked to pick a drop-dead day and a
 * max-attempt count has no way to answer well, so Stripe measures it across the
 * network and ships a recommended default. We have one book rather than a
 * network, but the same question has to be answered with data instead of taste,
 * and on Indian rails it answers differently: attempts are not a free dial when
 * NPCI only grants four of them.
 *
 * The sweep is the argument. Every row is the whole batch re-run under one
 * envelope, so a merchant can see what a shorter window actually costs.
 */

const DROP_DEAD_DAYS = [7, 10, 14, 21, 28];
const MAX_ATTEMPTS = [1, 2, 3];

export interface EnvelopeResult {
  dropDeadDay: number;
  maxAttempts: number;
  rupeesRecovered: number;
  rupeesNet: number;
  recoveryRate: number;
  npciDebits: number;
  involuntaryChurn: number;
  /** Days of free access a churning customer gets before the window closes. */
  freeAccessDays: number;
}

export interface EnvelopeSweep {
  results: EnvelopeResult[];
  recommended: EnvelopeResult;
  current: EnvelopeResult;
  /** Rupees the shipped default leaves on the table against the best row. */
  gapToBest: number;
}

function runEnvelope(cases: RecoveryCase[], dropDeadDay: number, maxAttempts: number): EnvelopeResult {
  const envelope: Partial<RetryEnvelope> = { dropDeadDay, maxAttempts };
  const score = runPolicy(cases, "adaptive", envelope);
  return {
    dropDeadDay,
    maxAttempts,
    rupeesRecovered: score.rupeesRecovered,
    rupeesNet: score.rupeesNet,
    recoveryRate: score.recoveryRate,
    npciDebits: score.retriesUsed,
    involuntaryChurn: score.involuntaryChurn,
    freeAccessDays: dropDeadDay,
  };
}

/**
 * Ranked by rupees net of what the chase cost, then by NPCI debits.
 *
 * The tie-break is the part that is not Stripe's: two envelopes that recover the
 * same money are not equivalent here, because the one that spends fewer mandate
 * slots leaves more room for the cycles after this one.
 */
export function sweepEnvelopes(rawCases: RecoveryCase[] = seedBatch()): EnvelopeSweep {
  const cases = rawCases.map(enrichWithReply);

  const results: EnvelopeResult[] = [];
  for (const dropDeadDay of DROP_DEAD_DAYS) {
    for (const maxAttempts of MAX_ATTEMPTS) {
      results.push(runEnvelope(cases, dropDeadDay, maxAttempts));
    }
  }

  const ranked = [...results].sort(
    (a, b) => b.rupeesNet - a.rupeesNet || a.npciDebits - b.npciDebits || a.dropDeadDay - b.dropDeadDay,
  );
  const recommended = ranked[0];

  const current =
    results.find(
      (r) => r.dropDeadDay === DEFAULT_ENVELOPE.dropDeadDay && r.maxAttempts === DEFAULT_ENVELOPE.maxAttempts,
    ) ?? recommended;

  return {
    results,
    recommended,
    current,
    gapToBest: Math.round((recommended.rupeesNet - current.rupeesNet) * 100) / 100,
  };
}
