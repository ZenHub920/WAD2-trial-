/**
 * Evaluation metrics.
 *
 * Everything the write-up needs to compare algorithms on the same instance.
 * See docs/ALGORITHM.md §9.
 */

import { findBlockingPairs } from './stability.js';
import { pairKey } from './preferences.js';

/**
 * @param {import('./preferences.js').PreferenceProfile} profile
 * @param {object} matching  output of galeShapley / greedyMatch / randomMatch
 * @returns {object} metric bundle
 */
export function evaluate(profile, matching) {
  const { seekerPrefs, seekerRanks, partyRanks, capacities, pairScores } = profile;
  const { assignments, partyMembers } = matching;

  const seekerRanksAchieved = [];
  const partyRanksAchieved = [];
  let totalSeekerScore = 0;
  let totalPartyScore = 0;

  for (const [seekerId, partyId] of assignments) {
    const sRank = seekerRanks.get(seekerId)?.get(partyId);
    const pRank = partyRanks.get(partyId)?.get(seekerId);
    if (sRank !== undefined) seekerRanksAchieved.push(sRank + 1); // 1-indexed for humans
    if (pRank !== undefined) partyRanksAchieved.push(pRank + 1);

    const scored = pairScores.get(pairKey(seekerId, partyId));
    if (scored) {
      totalSeekerScore += scored.seekerToParty;
      totalPartyScore += scored.partyToSeeker;
    }
  }

  const eligibleSeekers = [...seekerPrefs.values()].filter((l) => l.length > 0).length;
  const totalCapacity = [...capacities.values()].reduce((a, b) => a + b, 0);
  const usedCapacity = [...partyMembers.values()].reduce((a, m) => a + m.length, 0);

  const stability = findBlockingPairs(profile, matching);

  const firstChoice = seekerRanksAchieved.filter((r) => r === 1).length;
  const topThree = seekerRanksAchieved.filter((r) => r <= 3).length;

  return {
    // --- the correctness metric ---
    blockingPairs: stability.blockingPairs.length,
    stable: stability.stable,

    // --- coverage ---
    matched: assignments.size,
    eligibleSeekers,
    matchRate: eligibleSeekers === 0 ? 0 : round4(assignments.size / eligibleSeekers),
    capacityUtilisation: totalCapacity === 0 ? 0 : round4(usedCapacity / totalCapacity),

    // --- satisfaction ---
    seekerRank: summarise(seekerRanksAchieved),
    partyRank: summarise(partyRanksAchieved),
    firstChoiceRate: assignments.size === 0 ? 0 : round4(firstChoice / assignments.size),
    topThreeRate: assignments.size === 0 ? 0 : round4(topThree / assignments.size),

    // --- aggregate welfare ---
    totalSeekerScore: round4(totalSeekerScore),
    totalPartyScore: round4(totalPartyScore),
    totalCombinedScore: round4(totalSeekerScore + totalPartyScore),
    meanSeekerScore: assignments.size === 0 ? 0 : round4(totalSeekerScore / assignments.size),
    meanPartyScore: assignments.size === 0 ? 0 : round4(totalPartyScore / assignments.size),
  };
}

function summarise(values) {
  if (values.length === 0) return { mean: null, median: null, p90: null, worst: null };
  const sorted = [...values].sort((a, b) => a - b);
  return {
    mean: round4(values.reduce((a, b) => a + b, 0) / values.length),
    median: percentile(sorted, 0.5),
    p90: percentile(sorted, 0.9),
    worst: sorted[sorted.length - 1],
  };
}

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[index];
}

function round4(n) {
  return Math.round(n * 1e4) / 1e4;
}

/**
 * Side-by-side comparison table for the evaluation section of the report.
 * @param {object} results  { [algorithmName]: metricBundle }
 */
export function comparisonTable(results) {
  const rows = Object.entries(results).map(([name, m]) => ({
    algorithm: name,
    blockingPairs: m.blockingPairs,
    matchRate: m.matchRate,
    meanSeekerRank: m.seekerRank.mean,
    worstSeekerRank: m.seekerRank.worst,
    firstChoiceRate: m.firstChoiceRate,
    totalCombinedScore: m.totalCombinedScore,
  }));
  return rows;
}
