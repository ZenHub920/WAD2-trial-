/**
 * Gale-Shapley deferred acceptance — Hospital/Residents variant.
 *
 * Seekers ("residents") propose; parties ("hospitals") hold capacity q >= 1 and
 * provisionally accept, evicting their worst current member when a better proposal
 * arrives and they are full.
 *
 * Guarantees, for strict and possibly incomplete preference lists:
 *   - terminates
 *   - produces a STABLE matching (no blocking pair)
 *   - is SEEKER-OPTIMAL: every seeker receives the best party they could obtain in
 *     any stable matching, and simultaneously every party receives its worst
 *     stable assignment
 *   - runs in O(E log q), E = number of acceptable pairs
 *
 * See docs/ALGORITHM.md §5.
 */

import { MaxHeap } from './maxHeap.js';

/**
 * @param {import('./preferences.js').PreferenceProfile} profile
 * @param {object} [options]
 * @param {boolean} [options.trace=false] record every proposal event, for the UI animation
 * @returns {{
 *   assignments: Map<string, string>,     seekerId -> partyId
 *   partyMembers: Map<string, string[]>,  partyId  -> seekerIds in preference order
 *   unmatchedSeekers: string[],
 *   trace: Array,
 *   stats: object
 * }}
 */
export function galeShapley(profile, options = {}) {
  const { trace: wantTrace = false } = options;
  const { seekerPrefs, partyRanks, capacities } = profile;

  /** partyId -> MaxHeap of currently held seekers, keyed by that party's rank. */
  const held = new Map();
  for (const partyId of capacities.keys()) {
    held.set(partyId, new MaxHeap());
  }

  /** seekerId -> index of the next party to propose to. */
  const nextProposal = new Map();

  /** seekerId -> partyId, for seekers currently held somewhere. */
  const assignments = new Map();

  const trace = [];
  let proposals = 0;
  let evictions = 0;
  let rejections = 0;

  // Seekers with a non-empty list start free. Deterministic order: sorted ids,
  // so a re-run on the same data reproduces the same trace. (The RESULT is
  // order-independent — deferred acceptance converges to the same seeker-optimal
  // matching regardless of proposal order — but a stable trace makes the
  // animation and the tests reproducible.)
  const free = [];
  for (const seekerId of [...seekerPrefs.keys()].sort()) {
    nextProposal.set(seekerId, 0);
    if ((seekerPrefs.get(seekerId) ?? []).length > 0) free.push(seekerId);
  }

  while (free.length > 0) {
    const seekerId = free.shift();
    const list = seekerPrefs.get(seekerId) ?? [];
    const cursor = nextProposal.get(seekerId);

    // Exhausted the list without being held anywhere: permanently unmatched.
    if (cursor >= list.length) continue;

    const partyId = list[cursor];
    nextProposal.set(seekerId, cursor + 1);
    proposals += 1;

    const partyHeap = held.get(partyId);
    const capacity = capacities.get(partyId);
    const rank = partyRanks.get(partyId).get(seekerId);

    if (partyHeap.size < capacity) {
      // Free slot: accept provisionally.
      partyHeap.push(seekerId, rank);
      assignments.set(seekerId, partyId);
      if (wantTrace) {
        trace.push({ step: trace.length, type: 'accept', seekerId, partyId, rank });
      }
      continue;
    }

    const worst = partyHeap.peek();

    if (rank < worst.rank) {
      // The party prefers the proposer to its current worst member: swap them.
      partyHeap.pop();
      assignments.delete(worst.id);
      partyHeap.push(seekerId, rank);
      assignments.set(seekerId, partyId);
      free.push(worst.id); // evicted seeker resumes proposing down its own list
      evictions += 1;
      if (wantTrace) {
        trace.push({
          step: trace.length,
          type: 'evict',
          seekerId,
          partyId,
          rank,
          evictedSeekerId: worst.id,
          evictedRank: worst.rank,
        });
      }
    } else {
      // Party is full and prefers everyone it holds: the proposal is rejected and
      // the seeker tries the next party on its list.
      rejections += 1;
      free.push(seekerId);
      if (wantTrace) {
        trace.push({ step: trace.length, type: 'reject', seekerId, partyId, rank });
      }
    }
  }

  const partyMembers = new Map();
  for (const [partyId, heap] of held) {
    partyMembers.set(partyId, heap.sortedIds());
  }

  const unmatchedSeekers = [...seekerPrefs.keys()]
    .filter((id) => !assignments.has(id))
    .sort();

  return {
    assignments,
    partyMembers,
    unmatchedSeekers,
    trace,
    stats: {
      proposals,
      evictions,
      rejections,
      matched: assignments.size,
      unmatched: unmatchedSeekers.length,
    },
  };
}
