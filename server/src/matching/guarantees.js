/**
 * The vocabulary of guarantees, and the verification that enforces them.
 *
 * With a single solver, "verify stability and throw if it fails" is correct:
 * deferred acceptance on a Hospital/Residents instance ALWAYS produces a stable
 * matching, so a blocking pair means a bug.
 *
 * That stops being true the moment a second solver exists. Hospital/Residents
 * with Couples is NP-hard and a stable matching MAY NOT EXIST for a given
 * instance — a blocking pair there is a property of the input, not a defect.
 * Asserting would crash on a correct result; loosening the assertion globally
 * would strip the protection from the solvers that genuinely do guarantee
 * stability, and let the UI claim "verified" for rounds nothing verified.
 *
 * So the solver declares what it can promise, and the promise decides how the
 * result is checked:
 *
 *   stability: 'guaranteed'  -> ASSERT. A blocking pair is a bug. Throw.
 *   anything weaker          -> MEASURE. Record the count and carry on.
 *
 * See docs/ALGORITHM.md §6 and §9.
 */

import { findBlockingPairs } from './stability.js';

/** What a solver can promise about stability. */
export const STABILITY = {
  /** Theory says a stable matching always exists, and this solver finds one. */
  GUARANTEED: 'guaranteed',
  /** A stable matching may exist; the solver looks for one but cannot promise. */
  BEST_EFFORT: 'best_effort',
  /** The instance class admits instances with no stable matching at all. */
  NOT_GUARANTEED: 'not_guaranteed',
};

/** What a solver can promise about the quality of the matching it returns. */
export const OPTIMALITY = {
  /** Every seeker gets the best party obtainable in ANY stable matching. */
  SEEKER_OPTIMAL: 'seeker_optimal',
  /** The mirror image: every party gets its best stable assignment. */
  PARTY_OPTIMAL: 'party_optimal',
  /** Minimises total rank across both sides, among stable matchings. */
  EGALITARIAN: 'egalitarian',
  /** Maximises total compatibility, ignoring stability entirely. */
  MAX_WELFARE: 'max_welfare',
  NONE: 'none',
};

/** Whether the solver is known to terminate on every input it accepts. */
export const TERMINATION = {
  GUARANTEED: 'guaranteed',
  BOUNDED: 'bounded', // terminates, but only because of an explicit iteration cap
};

/**
 * Rank the stability promises so a downgrade is a comparison rather than a
 * chain of if-statements. Higher is a stronger promise.
 */
const STABILITY_RANK = {
  [STABILITY.GUARANTEED]: 2,
  [STABILITY.BEST_EFFORT]: 1,
  [STABILITY.NOT_GUARANTEED]: 0,
};

/** The weaker of two stability promises. */
export function weakerStability(a, b) {
  return STABILITY_RANK[a] <= STABILITY_RANK[b] ? a : b;
}

/**
 * Check a matching in the manner its solver's promise requires.
 *
 * @param {object} profile
 * @param {object} matching  { assignments, partyMembers }
 * @param {string} stabilityPromise  one of STABILITY
 * @param {string} label             used in the thrown message
 * @returns {{ mode: 'assert'|'measure', passed: boolean, blockingPairs: number,
 *            pairsChecked: number, examples: Array }}
 * @throws when the promise is GUARANTEED and the matching is not stable
 */
export function verifyUnderGuarantee(profile, matching, stabilityPromise, label = 'matching') {
  const assertMode = stabilityPromise === STABILITY.GUARANTEED;

  // Under assert mode we only need to know THAT it failed, plus a few examples
  // for the error message, so the search can stop early. Under measure mode the
  // count is the output, so every pair has to be checked.
  const check = findBlockingPairs(profile, matching, assertMode ? { limit: 5 } : {});

  if (assertMode && !check.stable) {
    const sample = check.blockingPairs.map((bp) => `(${bp.seekerId} ↔ ${bp.partyId})`).join(', ');
    throw new Error(
      `${label} promised a stable matching but produced ${check.blockingPairs.length}+ ` +
        `blocking pairs, e.g. ${sample}. This is a bug in the solver, not a property ` +
        `of the instance.`,
    );
  }

  return {
    mode: assertMode ? 'assert' : 'measure',
    passed: check.stable,
    blockingPairs: check.blockingPairs.length,
    pairsChecked: check.checked,
    examples: check.blockingPairs.slice(0, 5),
  };
}
