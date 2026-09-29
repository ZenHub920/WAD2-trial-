/**
 * Preference list construction.
 *
 * Builds the two-sided preference structure that the matching algorithms consume,
 * from raw seeker requests and party listings. Both orderings are TOTAL and
 * DETERMINISTIC (ties broken by ascending id), which keeps us in the strict-preference
 * regime where the Hospital/Residents guarantees hold without weak/strong/super
 * stability complications.
 *
 * See docs/ALGORITHM.md §4.
 */

import { checkFeasibility, scorePair } from './compatibility.js';

/**
 * @typedef {object} PreferenceProfile
 * @property {Map<string, string[]>}            seekerPrefs  seekerId -> ordered partyIds
 * @property {Map<string, string[]>}            partyPrefs   partyId  -> ordered seekerIds
 * @property {Map<string, Map<string, number>>} seekerRanks  seekerId -> partyId  -> rank
 * @property {Map<string, Map<string, number>>} partyRanks   partyId  -> seekerId -> rank
 * @property {Map<string, number>}              capacities   partyId  -> capacity
 * @property {Map<string, object>}              pairScores   "s|p"    -> score detail
 * @property {object}                           stats
 */

/**
 * @param {Array} seekers  seeker requests, each with a hydrated `.user`
 * @param {Array} parties  party listings, each with a hydrated `.host`
 * @param {object} [options]
 * @param {Set<string>} [options.blocklist] "userA:userB" pairs that may never match
 * @returns {PreferenceProfile}
 */
export function buildPreferences(seekers, parties, options = {}) {
  const seekerPrefs = new Map();
  const partyPrefs = new Map();
  const capacities = new Map();
  const pairScores = new Map();
  const rejectionReasons = new Map();

  // Scored candidate lists, accumulated before sorting.
  const seekerCandidates = new Map();
  const partyCandidates = new Map();

  for (const seeker of seekers) {
    seekerCandidates.set(seeker.id, []);
  }
  for (const party of parties) {
    partyCandidates.set(party.id, []);
    capacities.set(party.id, party.capacity);
  }

  let feasiblePairs = 0;
  let evaluatedPairs = 0;

  // Group by concert so we never evaluate cross-event pairs. Without this the
  // pair enumeration is |seekers| x |parties|; with it, it is the sum over
  // concerts of the local product, which is what keeps large instances tractable.
  const partiesByConcert = new Map();
  for (const party of parties) {
    if (!partiesByConcert.has(party.concert_id)) partiesByConcert.set(party.concert_id, []);
    partiesByConcert.get(party.concert_id).push(party);
  }

  for (const seeker of seekers) {
    const candidateParties = partiesByConcert.get(seeker.concert_id) ?? [];

    for (const party of candidateParties) {
      evaluatedPairs += 1;

      const verdict = checkFeasibility(seeker, party, options);
      if (!verdict.feasible) {
        const count = rejectionReasons.get(verdict.reason) ?? 0;
        rejectionReasons.set(verdict.reason, count + 1);
        continue;
      }

      const scored = scorePair(seeker, party);
      feasiblePairs += 1;

      pairScores.set(pairKey(seeker.id, party.id), scored);
      seekerCandidates.get(seeker.id).push({ id: party.id, score: scored.seekerToParty });
      partyCandidates.get(party.id).push({ id: seeker.id, score: scored.partyToSeeker });
    }
  }

  for (const [seekerId, candidates] of seekerCandidates) {
    seekerPrefs.set(seekerId, sortCandidates(candidates));
  }
  for (const [partyId, candidates] of partyCandidates) {
    partyPrefs.set(partyId, sortCandidates(candidates));
  }

  return {
    seekerPrefs,
    partyPrefs,
    seekerRanks: buildRankMaps(seekerPrefs),
    partyRanks: buildRankMaps(partyPrefs),
    capacities,
    pairScores,
    stats: {
      seekers: seekers.length,
      parties: parties.length,
      totalCapacity: [...capacities.values()].reduce((a, b) => a + b, 0),
      evaluatedPairs,
      feasiblePairs,
      rejectionReasons: Object.fromEntries(rejectionReasons),
      seekersWithNoOptions: [...seekerPrefs.values()].filter((l) => l.length === 0).length,
      partiesWithNoOptions: [...partyPrefs.values()].filter((l) => l.length === 0).length,
    },
  };
}

/**
 * Descending by score, ties broken by ascending id.
 *
 * The tie-break is what makes the ordering total rather than partial. Without it,
 * two candidates with identical scores would have an implementation-defined order
 * and runs would not be reproducible.
 */
function sortCandidates(candidates) {
  return candidates
    .sort((a, b) => (b.score - a.score) || compareIds(a.id, b.id))
    .map((c) => c.id);
}

function compareIds(a, b) {
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

/**
 * Invert each ordered list into id -> position.
 *
 * This is the single most important performance decision in the implementation.
 * The inner loop of deferred acceptance asks "does p prefer s to w?" once per
 * proposal; answering it by scanning the list is O(n) and drags the whole
 * algorithm to O(n^2 q). With rank maps it is O(1) and the algorithm runs in
 * time linear in the number of acceptable pairs.
 */
export function buildRankMaps(prefs) {
  const ranks = new Map();
  for (const [ownerId, list] of prefs) {
    const rankMap = new Map();
    list.forEach((candidateId, index) => rankMap.set(candidateId, index));
    ranks.set(ownerId, rankMap);
  }
  return ranks;
}

export function pairKey(seekerId, partyId) {
  return `${seekerId}|${partyId}`;
}
