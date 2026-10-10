/**
 * Solve an instance, and record what the answer is worth.
 *
 * classify -> select -> solve -> verify under the selected solver's promise
 *          -> emit a ledger entry
 *
 * The ledger is the point. A matching on its own does not say whether it is
 * guaranteed stable, whether a constraint was quietly dropped to produce it, or
 * which of several algorithms made it. With one solver all of that was implicit
 * and safe to leave unsaid; with a registry it has to be written down, or the
 * interface ends up claiming "verified stable" for rounds where nothing of the
 * sort was established.
 *
 * Every entry separates what was PROMISED before the run (theory, from the
 * solver's declaration) from what was MEASURED after it (this instance, from
 * the verifier). Those are different claims and conflating them is how a
 * system starts overstating its results.
 *
 * See docs/ALGORITHM.md §9.
 */

import { classifyInstance } from './classify.js';
import { selectSolver } from './registry.js';
import { verifyUnderGuarantee } from './guarantees.js';
import { assertIndividuallyRational } from './stability.js';

/**
 * @param {object} args
 * @param {object} args.profile      preference profile from buildPreferences
 * @param {Array}  args.seekers      raw seeker requests, for classification
 * @param {Array}  args.parties      raw party listings, for classification
 * @param {object} [args.options]
 * @param {boolean} [args.options.trace=false]
 * @param {string}  [args.options.force]  solver id, bypassing selection
 * @returns {{ result: object, ledger: object, classification: object, solver: object }}
 */
export function solveInstance({ profile, seekers, parties, options = {} }) {
  const { trace = false, force } = options;

  const classification = classifyInstance({ seekers, parties });
  const { solver, relaxations, effectiveGuarantees, reason } = selectSolver(
    classification,
    { force },
  );

  if (solver.resultShape !== 'bipartite') {
    throw new Error(
      `Solver "${solver.id}" returns ${solver.resultShape} results and cannot be ` +
        `used on a two-sided instance. Route peer-to-peer instances through ` +
        `stableRoommates() directly.`,
    );
  }

  const t0 = performance.now();
  const result = solver.solve(profile, { trace });
  const solveMs = performance.now() - t0;

  // This one holds for every solver: nobody may be assigned to a party absent
  // from their list, and no party may exceed its capacity. A violation is a bug
  // regardless of what the solver promised about stability.
  assertIndividuallyRational(profile, result);

  const t1 = performance.now();
  const verification = verifyUnderGuarantee(
    profile,
    result,
    effectiveGuarantees.stability,
    `${solver.id} on ${classification.class}`,
  );
  const verifyMs = performance.now() - t1;

  const ledger = {
    solver: solver.id,
    solverName: solver.name,
    instanceClass: classification.class,
    selectedBecause: reason,
    features: classification.features,
    counts: classification.counts,

    /** What theory entitled this solver to claim, before it ran. */
    promised: effectiveGuarantees,
    /** Constraints present in the instance that the solver could not represent. */
    relaxations,

    /** What verification actually established, on this instance. */
    verification: {
      mode: verification.mode,
      stable: verification.passed,
      blockingPairs: verification.blockingPairs,
      pairsChecked: verification.pairsChecked,
      examples: verification.examples,
    },

    timings: { solveMs: round2(solveMs), verifyMs: round2(verifyMs) },

    /** One line the interface can show without having to interpret the rest. */
    headline: headlineFor(effectiveGuarantees, verification, relaxations),
  };

  return { result, ledger, classification, solver };
}

/**
 * The sentence the UI shows. Deliberately refuses to say "verified stable"
 * unless stability was both promised and measured — a measured zero under a
 * weak promise means "none found on this instance", which is a different and
 * smaller claim than "guaranteed none exist".
 */
function headlineFor(guarantees, verification, relaxations) {
  if (relaxations.length > 0) {
    const dropped = relaxations.join(', ');
    return `Solved with ${dropped} ignored — this is not a solution to the full problem. ` +
      `${verification.blockingPairs} blocking ${plural(verification.blockingPairs, 'pair')} ` +
      `in the relaxed instance.`;
  }

  if (guarantees.stability === 'guaranteed') {
    return `Stable — verified over ${verification.pairsChecked.toLocaleString('en-SG')} pairs.`;
  }

  if (verification.blockingPairs === 0) {
    return `No blocking pairs found on this instance, though stability is not guaranteed ` +
      `for this problem class.`;
  }

  return `Stability not guaranteed for this problem class: ` +
    `${verification.blockingPairs} blocking ${plural(verification.blockingPairs, 'pair')} remain.`;
}

function plural(n, word) {
  return n === 1 ? word : `${word}s`;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}
