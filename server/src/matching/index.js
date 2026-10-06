/**
 * Matching engine — public surface.
 *
 * Everything the API and the benchmarks need, in one place.
 */

export { buildPreferences, buildRankMaps, pairKey } from './preferences.js';
export { galeShapley } from './galeShapley.js';
export { greedyMatch, randomMatch, mulberry32 } from './baselines.js';
export { findBlockingPairs, assertStable, assertIndividuallyRational } from './stability.js';
export { evaluate, comparisonTable } from './metrics.js';
export { stableRoommates, findRoommateBlockingPairs } from './stableRoommates.js';
export { MaxHeap } from './maxHeap.js';
export {
  checkFeasibility,
  scorePair,
  WEIGHTS,
  SECTIONS,
  ARRIVAL_PLANS,
  AGE_BANDS,
  VIBE_DIMENSIONS,
  PLAN_KEYS,
} from './compatibility.js';

import { buildPreferences } from './preferences.js';
import { galeShapley } from './galeShapley.js';
import { greedyMatch, randomMatch } from './baselines.js';
import { assertStable, assertIndividuallyRational } from './stability.js';
import { evaluate } from './metrics.js';

/**
 * Run a complete match round: build preferences, solve, verify, evaluate.
 *
 * The stability assertion is deliberately not optional in the default path — an
 * unstable matching is a bug, and it should never reach the database.
 *
 * @param {Array} seekers
 * @param {Array} parties
 * @param {object} [options]
 * @param {boolean} [options.trace=false]         record the proposal sequence
 * @param {boolean} [options.withBaselines=false] also run greedy and random
 * @param {Set<string>} [options.blocklist]
 */
export function runMatchRound(seekers, parties, options = {}) {
  const { trace = false, withBaselines = false, blocklist } = options;

  const t0 = performance.now();
  const profile = buildPreferences(seekers, parties, { blocklist });
  const tPrefs = performance.now();

  const result = galeShapley(profile, { trace });
  const tSolve = performance.now();

  assertIndividuallyRational(profile, result);
  assertStable(profile, result, 'gale-shapley');

  const metrics = evaluate(profile, result);
  const tEval = performance.now();

  const output = {
    profile,
    result,
    metrics,
    timings: {
      preferencesMs: round2(tPrefs - t0),
      solveMs: round2(tSolve - tPrefs),
      evaluateMs: round2(tEval - tSolve),
      totalMs: round2(tEval - t0),
    },
  };

  if (withBaselines) {
    const greedy = greedyMatch(profile);
    const random = randomMatch(profile);
    output.baselines = {
      greedy: { result: greedy, metrics: evaluate(profile, greedy) },
      random: { result: random, metrics: evaluate(profile, random) },
    };
  }

  return output;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}
