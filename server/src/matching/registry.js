/**
 * Solver registry.
 *
 * One place that knows every algorithm in the engine, which instances each can
 * represent faithfully, and what each is entitled to claim about its output.
 *
 * Selection is not "pick the solver for this class". It is: of the solvers that
 * can run on this instance, take the one offering the STRONGEST guarantee, and
 * record honestly which constraints — if any — it could not represent.
 *
 * That last part is what keeps the design truthful while the engine is still
 * growing. An instance containing linked pairs has no exact solver here yet.
 * Rather than refuse it or silently pretend, selection falls back to deferred
 * acceptance on the RELAXED instance (the link ignored), marks the relaxation,
 * and downgrades the stability promise accordingly. The result is still useful;
 * it just no longer claims to be a stable solution to the problem that was
 * actually asked.
 *
 * See docs/ALGORITHM.md §9.
 */

import { CLASS, FEATURE } from './classify.js';
import { STABILITY, OPTIMALITY, TERMINATION, weakerStability } from './guarantees.js';
import { galeShapley } from './galeShapley.js';
import { greedyMatch, randomMatch } from './baselines.js';
import { stableRoommates } from './stableRoommates.js';

/**
 * @typedef {object} Solver
 * @property {string} id
 * @property {string} name
 * @property {string[]} handles     structural classes it can run on
 * @property {string[]} cannotModel features it is unable to represent
 * @property {object} guarantees    { stability, optimality, termination }
 * @property {number} strength      higher wins when several are eligible
 * @property {boolean} selectable   false = comparison only, never auto-chosen
 * @property {'bipartite'|'pairs'} resultShape  what solve() returns
 * @property {Function} solve
 * @property {string} complexity    for the method page and the report
 *
 * `resultShape` matters because the two families are not interchangeable.
 * Bipartite solvers return { assignments, partyMembers } and are checked with
 * the Hospital/Residents blocking-pair conditions. Stable Roommates returns
 * { pairs, unmatched } over a single pool and needs its own verifier. Marking
 * the shape keeps a caller from feeding one into the other's checker and
 * getting a meaningless answer.
 */

/** @type {Solver[]} */
export const SOLVERS = [
  {
    id: 'hospital-residents',
    name: 'Deferred acceptance (Hospital/Residents)',
    handles: [CLASS.ONE_TO_MANY, CLASS.ONE_TO_ONE, CLASS.WITH_COUPLES, CLASS.WITH_LOWER_QUOTAS],
    // It can RUN on couples and lower-quota instances, but only by ignoring
    // those constraints — which is exactly what cannotModel records.
    cannotModel: [FEATURE.LINKED_PAIRS, FEATURE.LOWER_QUOTAS],
    guarantees: {
      stability: STABILITY.GUARANTEED,
      optimality: OPTIMALITY.SEEKER_OPTIMAL,
      termination: TERMINATION.GUARANTEED,
    },
    strength: 100,
    selectable: true,
    resultShape: 'bipartite',
    complexity: 'O(E log q), E = acceptable pairs',
    solve: (profile, options = {}) => galeShapley(profile, options),
    /**
     * The Rural Hospitals Theorem: in Hospital/Residents, the SET of unmatched
     * residents is identical in every stable matching, as is the number each
     * hospital fills. So a seeker who goes unmatched here would go unmatched
     * under any stable method — it is not an artefact of this solver or of
     * which side proposes. Worth stating to anyone the system turns away.
     */
    notes: [
      'Seeker-optimal, and therefore simultaneously party-pessimal.',
      'Rural Hospitals Theorem: the set of unmatched seekers is the same in every stable matching.',
    ],
  },

  {
    id: 'stable-roommates',
    name: "Irving's algorithm (Stable Roommates)",
    handles: [CLASS.PEER_TO_PEER],
    cannotModel: [],
    guarantees: {
      // Non-bipartite instances can admit NO stable matching at all — the
      // classic three-person cycle. Irving's algorithm detects that case
      // rather than returning something unstable, but it cannot promise one
      // exists, so the promise is weaker than Hospital/Residents.
      stability: STABILITY.NOT_GUARANTEED,
      optimality: OPTIMALITY.NONE,
      termination: TERMINATION.GUARANTEED,
    },
    strength: 90,
    selectable: true,
    // Takes a Map<personId, rankedPersonIds> and returns { pairs, unmatched } —
    // not the bipartite { assignments, partyMembers }.
    resultShape: 'pairs',
    complexity: 'O(n²)',
    solve: (preferences) => stableRoommates(preferences),
    notes: [
      'Returns a stable matching, or a proof that none exists for this instance.',
    ],
  },

  // --- comparison only ----------------------------------------------------
  // Never auto-selected. Registered so that every algorithm in the engine has
  // exactly one place describing what it is worth, and so the benchmark can
  // read guarantees from the same source the solver path uses.
  {
    id: 'greedy-welfare',
    name: 'Greedy (best pair first)',
    handles: [CLASS.ONE_TO_MANY, CLASS.ONE_TO_ONE],
    cannotModel: [FEATURE.LINKED_PAIRS, FEATURE.LOWER_QUOTAS],
    guarantees: {
      stability: STABILITY.NOT_GUARANTEED,
      optimality: OPTIMALITY.NONE, // scores well, but is NOT the welfare optimum
      termination: TERMINATION.GUARANTEED,
    },
    strength: 20,
    selectable: false,
    resultShape: 'bipartite',
    complexity: 'O(E log E)',
    solve: (profile) => greedyMatch(profile),
    notes: [
      'Usually beats deferred acceptance on aggregate score, always at the cost of blocking pairs.',
      'A high total across a matching nobody honours is worth less than a lower one that holds.',
    ],
  },

  {
    id: 'random-fcfs',
    name: 'Random (first-come-first-served)',
    handles: [CLASS.ONE_TO_MANY, CLASS.ONE_TO_ONE],
    cannotModel: [FEATURE.LINKED_PAIRS, FEATURE.LOWER_QUOTAS],
    guarantees: {
      stability: STABILITY.NOT_GUARANTEED,
      optimality: OPTIMALITY.NONE,
      termination: TERMINATION.GUARANTEED,
    },
    strength: 10,
    selectable: false,
    resultShape: 'bipartite',
    complexity: 'O(E)',
    // randomMatch takes a numeric seed, not an options bag. Passing the bag
    // through would seed it with an object and silently lose reproducibility.
    solve: (profile, options = {}) => randomMatch(profile, options.seed ?? 42),
    notes: ['Stands in for the forum thread this project exists to replace.'],
  },
];

const BY_ID = new Map(SOLVERS.map((s) => [s.id, s]));

export function getSolver(id) {
  return BY_ID.get(id) ?? null;
}

/** Everything registered, for the method page and the docs. */
export function listSolvers() {
  return SOLVERS.map(({ solve, ...rest }) => rest);
}

/**
 * Choose a solver for a classified instance.
 *
 * @param {ReturnType<import('./classify.js').classifyInstance>} classification
 * @param {object} [options]
 * @param {string} [options.force]  solver id, overriding selection (for comparison runs)
 * @returns {{
 *   solver: Solver,
 *   relaxations: string[],
 *   effectiveGuarantees: object,
 *   reason: string
 * }}
 */
export function selectSolver(classification, options = {}) {
  const { force } = options;

  if (force) {
    const forced = getSolver(force);
    if (!forced) throw new Error(`Unknown solver: ${force}`);
    return finalise(forced, classification, `explicitly requested (${force})`);
  }

  const eligible = SOLVERS.filter(
    (s) => s.selectable && s.handles.includes(classification.class),
  ).sort((a, b) => b.strength - a.strength);

  if (eligible.length === 0) {
    throw new Error(
      `No solver can run on instance class "${classification.class}". ` +
        `Registered classes: ${[...new Set(SOLVERS.flatMap((s) => s.handles))].join(', ')}.`,
    );
  }

  // Prefer a solver that can represent every feature present. Only if none can
  // do we fall back to the strongest partial solver and record what it ignored.
  const exact = eligible.find(
    (s) => !classification.features.some((f) => s.cannotModel.includes(f)),
  );

  const chosen = exact ?? eligible[0];
  const reason = exact
    ? `${classification.describe}; ${chosen.id} models this instance exactly`
    : `${classification.describe}; no registered solver models every constraint, ` +
      `so ${chosen.id} runs on the relaxed instance`;

  return finalise(chosen, classification, reason);
}

function finalise(solver, classification, reason) {
  const relaxations = classification.features.filter((f) => solver.cannotModel.includes(f));

  // A solver that ignored a constraint did not solve the problem it was given,
  // so whatever it guarantees about ITS problem cannot be claimed about THIS
  // one. The promise is downgraded rather than quietly carried over.
  const effectiveGuarantees = {
    ...solver.guarantees,
    stability:
      relaxations.length > 0
        ? weakerStability(solver.guarantees.stability, STABILITY.NOT_GUARANTEED)
        : solver.guarantees.stability,
    optimality: relaxations.length > 0 ? OPTIMALITY.NONE : solver.guarantees.optimality,
  };

  return { solver, relaxations, effectiveGuarantees, reason };
}
