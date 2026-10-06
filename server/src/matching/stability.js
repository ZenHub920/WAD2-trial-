/**
 * Stability verification.
 *
 * A matching is only meaningful if no pair of agents would both rather abandon it.
 * This module enumerates every acceptable pair and tests the blocking conditions,
 * so every matching we store carries a proof of its own stability.
 *
 * See docs/ALGORITHM.md §6.
 */

/**
 * A pair (s, p) BLOCKS matching M when all three hold:
 *   1. s and p are mutually acceptable and are not already matched to each other
 *   2. s is unmatched, OR s strictly prefers p to M(s)
 *   3. p has spare capacity, OR p strictly prefers s to its worst current member
 *
 * @param {import('./preferences.js').PreferenceProfile} profile
 * @param {{assignments: Map<string,string>, partyMembers: Map<string,string[]>}} matching
 * @param {object} [options]
 * @param {number} [options.limit=Infinity] stop after this many blocking pairs
 * @returns {{ stable: boolean, blockingPairs: Array, checked: number }}
 */
export function findBlockingPairs(profile, matching, options = {}) {
  const { limit = Infinity } = options;
  const { seekerPrefs, seekerRanks, partyRanks, capacities } = profile;
  const { assignments, partyMembers } = matching;

  // Precompute each party's worst held rank so condition 3 is O(1) per pair.
  const worstRankHeld = new Map();
  for (const [partyId, members] of partyMembers) {
    const rankMap = partyRanks.get(partyId);
    let worst = -1;
    for (const seekerId of members) {
      const r = rankMap?.get(seekerId);
      if (r !== undefined && r > worst) worst = r;
    }
    worstRankHeld.set(partyId, worst);
  }

  const blockingPairs = [];
  let checked = 0;

  for (const [seekerId, list] of seekerPrefs) {
    const currentPartyId = assignments.get(seekerId);
    const seekerRankMap = seekerRanks.get(seekerId);
    const currentRank = currentPartyId === undefined
      ? Infinity                                   // unmatched: prefers ANY acceptable party
      : seekerRankMap.get(currentPartyId);

    for (const partyId of list) {
      checked += 1;
      if (partyId === currentPartyId) continue;

      // Condition 2 — the seeker must strictly prefer this party.
      // Because `list` is in descending preference order, once we reach the
      // seeker's current assignment everything after it is worse, so we can stop.
      const candidateRank = seekerRankMap.get(partyId);
      if (candidateRank >= currentRank) break;

      // Condition 3 — the party must be willing.
      const members = partyMembers.get(partyId) ?? [];
      const capacity = capacities.get(partyId) ?? 0;
      const partyWilling = members.length < capacity
        || partyRanks.get(partyId).get(seekerId) < worstRankHeld.get(partyId);

      if (partyWilling) {
        blockingPairs.push({
          seekerId,
          partyId,
          seekerCurrentPartyId: currentPartyId ?? null,
          seekerRankOfCandidate: candidateRank,
          seekerRankOfCurrent: currentRank === Infinity ? null : currentRank,
          partyRankOfSeeker: partyRanks.get(partyId).get(seekerId),
          partyWorstHeldRank: worstRankHeld.get(partyId),
          partyHasSpareCapacity: members.length < capacity,
        });
        if (blockingPairs.length >= limit) {
          return { stable: false, blockingPairs, checked };
        }
      }
    }
  }

  return { stable: blockingPairs.length === 0, blockingPairs, checked };
}

/**
 * Assertion wrapper: throws if the matching is not stable.
 * Used after every round so an unstable result can never reach the database.
 */
export function assertStable(profile, matching, label = 'matching') {
  const result = findBlockingPairs(profile, matching, { limit: 5 });
  if (!result.stable) {
    const sample = result.blockingPairs
      .map((bp) => `(${bp.seekerId} ↔ ${bp.partyId})`)
      .join(', ');
    throw new Error(
      `${label} is NOT stable: ${result.blockingPairs.length}+ blocking pairs, e.g. ${sample}`,
    );
  }
  return true;
}

/**
 * Check that no seeker or party could improve by being matched to someone they
 * find UNACCEPTABLE being absent — i.e. that the matching respects the feasibility
 * gate. A cheap invariant, but it catches a whole class of bugs where an
 * infeasible pair leaks into the result.
 */
export function assertIndividuallyRational(profile, matching) {
  const { seekerRanks, capacities } = profile;
  const violations = [];

  for (const [seekerId, partyId] of matching.assignments) {
    if (seekerRanks.get(seekerId)?.get(partyId) === undefined) {
      violations.push({ seekerId, partyId, reason: 'party_not_on_seeker_list' });
    }
  }

  for (const [partyId, members] of matching.partyMembers) {
    const capacity = capacities.get(partyId) ?? 0;
    if (members.length > capacity) {
      violations.push({ partyId, reason: 'over_capacity', size: members.length, capacity });
    }
  }

  if (violations.length > 0) {
    throw new Error(`Matching violates individual rationality: ${JSON.stringify(violations.slice(0, 3))}`);
  }
  return true;
}
