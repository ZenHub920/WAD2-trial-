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
export { classifyInstance, CLASS, FEATURE } from './classify.js';
export { SOLVERS, listSolvers, getSolver, selectSolver } from './registry.js';
export {
  STABILITY,
  OPTIMALITY,
  TERMINATION,
  verifyUnderGuarantee,
  weakerStability,
} from './guarantees.js';
export { solveInstance } from './solve.js';
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
import { greedyMatch, randomMatch } from './baselines.js';
import { evaluate } from './metrics.js';
import { solveInstance } from './solve.js';

/**
 * Run a complete match round: build preferences, classify, solve, verify, evaluate.
 *
 * Verification is not optional, but its SEVERITY is chosen by the solver that
 * ran. Where stability is guaranteed, a blocking pair is a bug and throws; where
 * the problem class does not admit that promise, it is measured and recorded.
 * `output.ledger` says which happened and why.
 *
 * @param {Array} seekers
 * @param {Array} parties
 * @param {object} [options]
 * @param {boolean} [options.trace=false]         record the proposal sequence
 * @param {boolean} [options.withBaselines=false] also run greedy and random
 * @param {Set<string>} [options.blocklist]
 * @param {string} [options.force]                solver id, bypassing selection
 */
export function runMatchRound(seekers, parties, options = {}) {
  const { trace = false, withBaselines = false, blocklist, force } = options;

  const t0 = performance.now();
  const profile = buildPreferences(seekers, parties, { blocklist });
  const tPrefs = performance.now();

  const { result, ledger, classification } = solveInstance({
    profile,
    seekers,
    parties,
    options: { trace, force },
  });
  const tSolve = performance.now();

  const metrics = evaluate(profile, result);
  const tEval = performance.now();

  const output = {
    profile,
    result,
    metrics,
    ledger,
    classification,
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
