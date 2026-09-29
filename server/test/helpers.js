/**
 * Test helpers: build preference profiles directly from literal lists, so algorithm
 * tests are independent of the scoring layer.
 */

import { buildRankMaps } from '../src/matching/preferences.js';

/**
 * @param {object} seekerPrefsObj  { s1: ['p1','p2'], ... }
 * @param {object} partyPrefsObj   { p1: ['s2','s1'], ... }
 * @param {object} capacitiesObj   { p1: 1, ... }  defaults to 1
 */
export function makeProfile(seekerPrefsObj, partyPrefsObj, capacitiesObj = {}) {
  const seekerPrefs = new Map(Object.entries(seekerPrefsObj));
  const partyPrefs = new Map(Object.entries(partyPrefsObj));
  const capacities = new Map(
    Object.keys(partyPrefsObj).map((id) => [id, capacitiesObj[id] ?? 1]),
  );

  // Synthetic scores consistent with the given orderings, so metrics still work.
  const pairScores = new Map();
  for (const [seekerId, list] of seekerPrefs) {
    list.forEach((partyId, index) => {
      const partyList = partyPrefs.get(partyId) ?? [];
      const partyIndex = partyList.indexOf(seekerId);
      pairScores.set(`${seekerId}|${partyId}`, {
        seekerToParty: 1 - index / Math.max(1, list.length),
        partyToSeeker: partyIndex === -1 ? 0 : 1 - partyIndex / Math.max(1, partyList.length),
        components: {},
      });
    });
  }

  return {
    seekerPrefs,
    partyPrefs,
    seekerRanks: buildRankMaps(seekerPrefs),
    partyRanks: buildRankMaps(partyPrefs),
    capacities,
    pairScores,
    stats: {},
  };
}

/**
 * Brute force: enumerate EVERY possible matching of seekers to unit-capacity parties
 * and return the ones with no blocking pair.
 *
 * Only usable for tiny instances (n <= 5), which is exactly what we want for
 * verifying the algorithm against ground truth rather than against itself.
 */
export function allStableMatchings(profile) {
  const seekerIds = [...profile.seekerPrefs.keys()].sort();
  const partyIds = [...profile.partyPrefs.keys()].sort();
  const stable = [];

  const assign = (index, used, current) => {
    if (index === seekerIds.length) {
      const matching = toMatching(current, partyIds);
      if (isStableUnitCapacity(profile, matching)) {
        stable.push(new Map(current));
      }
      return;
    }
    const seekerId = seekerIds[index];

    // Option: leave this seeker unmatched.
    assign(index + 1, used, current);

    for (const partyId of profile.seekerPrefs.get(seekerId) ?? []) {
      if (used.has(partyId)) continue;
      used.add(partyId);
      current.set(seekerId, partyId);
      assign(index + 1, used, current);
      current.delete(seekerId);
      used.delete(partyId);
    }
  };

  assign(0, new Set(), new Map());
  return stable;
}

function toMatching(assignments, partyIds) {
  const partyMembers = new Map(partyIds.map((id) => [id, []]));
  for (const [seekerId, partyId] of assignments) {
    partyMembers.get(partyId).push(seekerId);
  }
  return { assignments: new Map(assignments), partyMembers };
}

function isStableUnitCapacity(profile, matching) {
  const { seekerRanks, partyRanks, seekerPrefs } = profile;
  const { assignments, partyMembers } = matching;

  for (const [seekerId, list] of seekerPrefs) {
    const current = assignments.get(seekerId);
    const currentRank = current === undefined ? Infinity : seekerRanks.get(seekerId).get(current);

    for (const partyId of list) {
      const candidateRank = seekerRanks.get(seekerId).get(partyId);
      if (candidateRank >= currentRank) break;

      const members = partyMembers.get(partyId) ?? [];
      if (members.length === 0) return false; // party free, seeker prefers it
      const held = members[0];
      const heldRank = partyRanks.get(partyId).get(held);
      const proposerRank = partyRanks.get(partyId).get(seekerId);
      if (proposerRank !== undefined && proposerRank < heldRank) return false;
    }
  }
  return true;
}

/** Minimal user/seeker/party fixtures for testing the scoring layer. */
export function makeUser(id, overrides = {}) {
  return {
    id,
    display_name: `User ${id}`,
    age_band: '21-24',
    home_region: 'central',
    languages: ['en'],
    gender: 'f',
    companion_gender_pref: 'any',
    vibe: { singalong: 3, photography: 3, dancing: 3, quiet: 3, queue_early: 3, merch: 3 },
    reliability: 0.8,
    verified: 1,
    ...overrides,
  };
}

export function makeSeeker(id, user, overrides = {}) {
  return {
    id,
    user_id: user.id,
    user,
    concert_id: 'c1',
    section_pref: 'ga_standing',
    spend_band_max: 3,
    arrival_pref: 'mid',
    plans_wanted: { pre_meetup: true, post_supper: false, merch_run: false, transport_share: true },
    strict_age_policy: 0,
    ...overrides,
  };
}

export function makeParty(id, host, overrides = {}) {
  return {
    id,
    host_user_id: host.id,
    host,
    concert_id: 'c1',
    capacity: 1,
    section: 'ga_standing',
    spend_band: 2,
    arrival_plan: 'mid',
    plans: { pre_meetup: true, post_supper: false, merch_run: false, transport_share: true },
    strict_age_policy: 0,
    min_age_band: '18-20',
    ...overrides,
  };
}
