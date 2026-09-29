/**
 * Baseline matchers, for comparison against deferred acceptance.
 *
 * These exist to be BEATEN — specifically, to demonstrate that the naive approach a
 * typical implementation would reach for produces a higher aggregate score and yet
 * an unstable result. See docs/ALGORITHM.md §8.
 */

import { pairKey } from './preferences.js';

/**
 * Greedy global assignment.
 *
 * Sort every feasible pair by combined score descending, then walk the list assigning
 * whenever both sides still have room. This is the obvious implementation, and it is
 * locally sensible at every step: it never passes up the best available pair.
 *
 * It maximises (approximately) the aggregate score, and it is NOT stable — because it
 * never asks whether an agent it placed early would rather be somewhere it looked later.
 */
export function greedyMatch(profile) {
  const { seekerPrefs, capacities, pairScores, partyRanks } = profile;

  const pairs = [];
  for (const [seekerId, list] of seekerPrefs) {
    for (const partyId of list) {
      const scored = pairScores.get(pairKey(seekerId, partyId));
      if (!scored) continue;
      pairs.push({
        seekerId,
        partyId,
        combined: scored.seekerToParty + scored.partyToSeeker,
      });
    }
  }

  pairs.sort(
    (a, b) =>
      (b.combined - a.combined) ||
      (a.seekerId < b.seekerId ? -1 : a.seekerId > b.seekerId ? 1 : 0) ||
      (a.partyId < b.partyId ? -1 : 1),
  );

  const assignments = new Map();
  const partyMembers = new Map();
  for (const partyId of capacities.keys()) partyMembers.set(partyId, []);

  for (const pair of pairs) {
    if (assignments.has(pair.seekerId)) continue;
    const members = partyMembers.get(pair.partyId);
    if (members.length >= capacities.get(pair.partyId)) continue;
    members.push(pair.seekerId);
    assignments.set(pair.seekerId, pair.partyId);
  }

  // Present members in each party's own preference order, matching the GS output shape.
  for (const [partyId, members] of partyMembers) {
    const rankMap = partyRanks.get(partyId);
    members.sort((a, b) => (rankMap.get(a) ?? 0) - (rankMap.get(b) ?? 0));
  }

  return {
    assignments,
    partyMembers,
    unmatchedSeekers: [...seekerPrefs.keys()].filter((id) => !assignments.has(id)).sort(),
    stats: { candidatePairs: pairs.length, matched: assignments.size },
  };
}

/**
 * Random feasible assignment, seeded for reproducibility.
 *
 * A floor, not a serious contender: it shows what "first come, first served" — the
 * behaviour of the forum threads this product replaces — actually produces.
 */
export function randomMatch(profile, seed = 42) {
  const { seekerPrefs, capacities, partyRanks } = profile;
  const rng = mulberry32(seed);

  const seekerIds = [...seekerPrefs.keys()].sort();
  shuffle(seekerIds, rng);

  const assignments = new Map();
  const partyMembers = new Map();
  for (const partyId of capacities.keys()) partyMembers.set(partyId, []);

  for (const seekerId of seekerIds) {
    const options = [...(seekerPrefs.get(seekerId) ?? [])];
    shuffle(options, rng);
    for (const partyId of options) {
      const members = partyMembers.get(partyId);
      if (members.length < capacities.get(partyId)) {
        members.push(seekerId);
        assignments.set(seekerId, partyId);
        break;
      }
    }
  }

  for (const [partyId, members] of partyMembers) {
    const rankMap = partyRanks.get(partyId);
    members.sort((a, b) => (rankMap.get(a) ?? 0) - (rankMap.get(b) ?? 0));
  }

  return {
    assignments,
    partyMembers,
    unmatchedSeekers: [...seekerPrefs.keys()].filter((id) => !assignments.has(id)).sort(),
    stats: { matched: assignments.size },
  };
}

/** Deterministic PRNG so benchmark runs are reproducible. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(array, rng) {
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}
