/**
 * Instance classification.
 *
 * Decides what KIND of matching problem an instance actually is, before any
 * solver touches it. The classes are not peers — they form a hierarchy of
 * generality:
 *
 *     Stable Marriage  ⊂  Hospital/Residents  ⊂  HR with Couples
 *
 * One-to-one is not a different problem from one-to-many; it is the special
 * case where every capacity is 1, and deferred acceptance already handles it
 * unchanged. The reason to tell them apart is not coverage — it is that the
 * more structure an instance has, the STRONGER the promise a solver can make
 * about the answer. Detecting the narrowest class an instance belongs to is
 * what lets the registry pick the strongest available guarantee.
 *
 * Stable Roommates sits on a different axis: non-bipartite, one pool of people
 * who may pair with each other, where a stable matching need not exist.
 *
 * A NOTE ON DECOMPOSITION. It is tempting to split a mixed instance — solve the
 * single seekers with Hospital/Residents, the linked pairs separately, and union
 * the results. That silently destroys stability: a single and a member of a
 * linked pair can form a blocking pair across the partition, and neither
 * sub-solve would ever look at it. An instance may only be split where the
 * feasibility graph is DISCONNECTED, i.e. where no cross-pair could be
 * acceptable in the first place. Partitioning by concert is sound for exactly
 * that reason (see preferences.js); partitioning by couples or by capacity is
 * not. The classifier therefore describes the whole instance and never splits it.
 *
 * See docs/ALGORITHM.md §9.
 */

/** Structural classes, narrowest first. */
export const CLASS = {
  /** Nothing to solve: one side is empty. */
  EMPTY: 'empty',
  /** Two-sided, every party takes exactly one seeker. Stable Marriage. */
  ONE_TO_ONE: 'one_to_one',
  /** Two-sided, parties have capacity q >= 1. Hospital/Residents. */
  ONE_TO_MANY: 'one_to_many',
  /** Two-sided, with seekers linked so both are placed or neither is. HRC. */
  WITH_COUPLES: 'with_couples',
  /** Two-sided, with parties that only run if they reach a minimum size. HRLQ. */
  WITH_LOWER_QUOTAS: 'with_lower_quotas',
  /** One pool, anyone may pair with anyone. Stable Roommates. */
  PEER_TO_PEER: 'peer_to_peer',
};

/**
 * Features that change which solvers can represent the instance faithfully.
 * A feature being present does not mean a solver exists for it — that is the
 * registry's problem, and the gap is what the ledger records as a relaxation.
 */
export const FEATURE = {
  LINKED_PAIRS: 'linked_pairs',
  LOWER_QUOTAS: 'lower_quotas',
  CAPACITY_ABOVE_ONE: 'capacity_above_one',
};

/**
 * @param {object} instance
 * @param {Array} [instance.seekers]  seeker requests (bipartite instances)
 * @param {Array} [instance.parties]  party listings (bipartite instances)
 * @param {Array} [instance.people]   one pool (peer-to-peer instances)
 * @returns {{
 *   class: string,
 *   features: string[],
 *   twoSided: boolean,
 *   counts: object,
 *   describe: string
 * }}
 */
export function classifyInstance({ seekers = [], parties = [], people = null } = {}) {
  // Peer-to-peer is signalled by the shape of the input, not by a flag: one
  // pool and no parties means there is no second side to propose to.
  if (people !== null) {
    return {
      class: people.length === 0 ? CLASS.EMPTY : CLASS.PEER_TO_PEER,
      features: [],
      twoSided: false,
      counts: { people: people.length },
      describe:
        people.length === 0
          ? 'empty pool'
          : `one pool of ${people.length} people, no distinct sides`,
    };
  }

  const counts = {
    seekers: seekers.length,
    parties: parties.length,
    totalCapacity: parties.reduce((sum, p) => sum + (p.capacity ?? 0), 0),
    maxCapacity: parties.reduce((max, p) => Math.max(max, p.capacity ?? 0), 0),
    linkedPairs: 0,
    partiesWithLowerQuota: 0,
  };

  if (seekers.length === 0 || parties.length === 0) {
    return {
      class: CLASS.EMPTY,
      features: [],
      twoSided: true,
      counts,
      describe: `nothing to solve: ${counts.seekers} seekers, ${counts.parties} parties`,
    };
  }

  // --- linked pairs ------------------------------------------------------
  // Two seekers who must both be placed or neither. Counted as pairs, not as
  // participants, and only when the link is RECIPROCATED — a one-sided link is
  // malformed data rather than a couple, and treating it as one would quietly
  // change the problem being solved.
  const byId = new Map(seekers.map((s) => [s.id, s]));
  const seenInPair = new Set();
  for (const seeker of seekers) {
    const partnerId = seeker.linked_request_id ?? seeker.linkedRequestId ?? null;
    if (!partnerId || seenInPair.has(seeker.id)) continue;

    const partner = byId.get(partnerId);
    if (!partner) continue; // partner not in this round; treated as a single

    const back = partner.linked_request_id ?? partner.linkedRequestId ?? null;
    if (back !== seeker.id) continue; // not reciprocated

    counts.linkedPairs += 1;
    seenInPair.add(seeker.id);
    seenInPair.add(partner.id);
  }

  // --- lower quotas ------------------------------------------------------
  // A party that only goes ahead if it reaches a minimum size. A minimum of 0
  // or 1 is not a constraint: one member is what any non-empty assignment gives.
  for (const party of parties) {
    const min = party.min_size ?? party.minSize ?? 0;
    if (min > 1) counts.partiesWithLowerQuota += 1;
  }

  const features = [];
  if (counts.linkedPairs > 0) features.push(FEATURE.LINKED_PAIRS);
  if (counts.partiesWithLowerQuota > 0) features.push(FEATURE.LOWER_QUOTAS);
  if (counts.maxCapacity > 1) features.push(FEATURE.CAPACITY_ABOVE_ONE);

  // The class is the NARROWEST description that still fits, because narrower
  // classes carry stronger guarantees. Extra constraints widen it.
  let cls;
  if (counts.linkedPairs > 0) {
    cls = CLASS.WITH_COUPLES;
  } else if (counts.partiesWithLowerQuota > 0) {
    cls = CLASS.WITH_LOWER_QUOTAS;
  } else if (counts.maxCapacity <= 1) {
    cls = CLASS.ONE_TO_ONE;
  } else {
    cls = CLASS.ONE_TO_MANY;
  }

  return { class: cls, features, twoSided: true, counts, describe: describe(cls, counts) };
}

function describe(cls, c) {
  const base = `${c.seekers} seekers, ${c.parties} parties, ${c.totalCapacity} slots`;
  switch (cls) {
    case CLASS.WITH_COUPLES:
      return `${base}; ${c.linkedPairs} linked ${c.linkedPairs === 1 ? 'pair' : 'pairs'} that must be placed together or not at all`;
    case CLASS.WITH_LOWER_QUOTAS:
      return `${base}; ${c.partiesWithLowerQuota} ${c.partiesWithLowerQuota === 1 ? 'party' : 'parties'} with a minimum group size`;
    case CLASS.ONE_TO_ONE:
      return `${base}; every party takes exactly one seeker`;
    default:
      return `${base}; parties take up to ${c.maxCapacity}`;
  }
}
