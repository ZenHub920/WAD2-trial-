/**
 * Match round orchestration.
 *
 * Loads the two sides of the instance for one concert, runs deferred acceptance,
 * verifies stability, persists the round, and flips the affected listings to
 * 'matched'. The stability assertion sits INSIDE the transaction boundary so an
 * unstable result can never be committed.
 */

import {
  buildPreferences,
  galeShapley,
  greedyMatch,
  randomMatch,
  evaluate,
  findBlockingPairs,
  comparisonTable,
  solveInstance,
  getSolver,
} from '../matching/index.js';

export function createMatchingService({ db, repos }) {
  return {
    /**
     * Preview a round without writing anything. Used by the "what would happen"
     * view and by the admin dashboard before committing.
     */
    preview(concertId, { trace = false, withBaselines = false } = {}) {
      const { seekers, parties, blocklist } = loadInstance(repos, concertId);
      if (seekers.length === 0 || parties.length === 0) {
        return { empty: true, seekers: seekers.length, parties: parties.length };
      }

      const t0 = performance.now();
      const profile = buildPreferences(seekers, parties, { blocklist });
      const t1 = performance.now();

      // Classification, solver selection and verification all happen here. The
      // severity of the stability check is decided by what the selected solver
      // promised, not fixed in advance — see matching/guarantees.js.
      const { result, ledger, classification } = solveInstance({
        profile,
        seekers,
        parties,
        options: { trace },
      });
      const t2 = performance.now();

      const metrics = evaluate(profile, result);
      const t3 = performance.now();

      const output = {
        empty: false,
        profile,
        result,
        metrics,
        ledger,
        classification,
        timings: {
          preferencesMs: round2(t1 - t0),
          solveMs: round2(t2 - t1),
          evaluateMs: round2(t3 - t2),
          totalMs: round2(t3 - t0),
        },
      };

      if (withBaselines) {
        const greedy = greedyMatch(profile);
        const random = randomMatch(profile);
        const greedyMetrics = evaluate(profile, greedy);
        const randomMetrics = evaluate(profile, random);
        output.comparison = comparisonTable({
          'gale-shapley': metrics,
          greedy: greedyMetrics,
          random: randomMetrics,
        });
        output.baselines = { greedy: greedyMetrics, random: randomMetrics };
      }

      return output;
    },

    /** Run a round for real: solve, verify, persist, and update listing statuses. */
    run(concertId, { trace = true } = {}) {
      const preview = this.preview(concertId, { trace, withBaselines: false });
      if (preview.empty) return preview;

      const { profile, result, metrics, timings, ledger } = preview;

      const roundId = repos.rounds.save({
        concertId,
        profile,
        result,
        metrics,
        timings,
        ledger,
        algorithm: ledger?.solver ?? 'gale_shapley_hr',
        trace: result.trace,
      });

      // Mark what was placed. Parties keeping spare capacity stay open so a later
      // round can still fill them.
      const markMatched = db.transaction(() => {
        for (const [seekerId] of result.assignments) {
          repos.seekers.setStatus(seekerId, 'matched');
        }
        for (const [partyId, members] of result.partyMembers) {
          if (members.length >= profile.capacities.get(partyId)) {
            repos.parties.setStatus(partyId, 'matched');
          }
        }
      });
      markMatched();

      return { empty: false, roundId, metrics, timings, ledger };
    },

    /**
     * Re-verify a stored round against its own preference snapshot.
     *
     * This is what makes the stability claim auditable rather than merely asserted
     * at write time: any historical round can be re-checked, even after every
     * underlying profile has changed.
     */
    reverify(roundId) {
      const round = repos.rounds.findById(roundId);
      if (!round) return null;

      const snapshot = JSON.parse(round.preference_snapshot_json ?? '{}');
      if (!snapshot.seekerPrefs) {
        return { roundId, verified: false, reason: 'no_snapshot_stored' };
      }

      const seekerPrefs = new Map(Object.entries(snapshot.seekerPrefs));
      const partyPrefs = new Map(Object.entries(snapshot.partyPrefs));
      const capacities = new Map(Object.entries(snapshot.capacities));

      const profile = {
        seekerPrefs,
        partyPrefs,
        capacities,
        seekerRanks: invert(seekerPrefs),
        partyRanks: invert(partyPrefs),
        pairScores: new Map(),
      };

      const rows = repos.rounds.resultsForRound(roundId);
      const assignments = new Map();
      const partyMembers = new Map([...capacities.keys()].map((id) => [id, []]));
      for (const row of rows) {
        if (row.outcome !== 'matched' || !row.party_id) continue;
        assignments.set(row.seeker_request_id, row.party_id);
        partyMembers.get(row.party_id)?.push(row.seeker_request_id);
      }

      const check = findBlockingPairs(profile, { assignments, partyMembers });

      const ledger = round.ledger_json ? JSON.parse(round.ledger_json) : null;
      const solver = round.solver_id ? getSolver(round.solver_id) : null;

      return {
        roundId,
        verified: check.stable,
        blockingPairCount: check.blockingPairs.length,
        blockingPairs: check.blockingPairs.slice(0, 20),
        pairsChecked: check.checked,
        storedClaim: { isStable: round.is_stable === 1, count: round.blocking_pair_count },
        agreesWithStoredClaim:
          (check.stable ? 1 : 0) === round.is_stable &&
          check.blockingPairs.length === round.blocking_pair_count,

        // What this round was entitled to claim, as recorded when it ran.
        // A measured zero under a weak promise means "none found on this
        // instance", which is a smaller claim than "guaranteed none exist" —
        // re-verification has to preserve that distinction or it quietly
        // upgrades every round to the strongest wording.
        ledger: ledger
          ? {
              solver: ledger.solver,
              solverName: ledger.solverName ?? solver?.name ?? null,
              instanceClass: ledger.instanceClass,
              promised: ledger.promised,
              relaxations: ledger.relaxations ?? [],
              headline: ledger.headline,
            }
          : null,
      };
    },

    /**
     * Explain one seeker's outcome: where their match sat on their list, what they
     * were rejected by, and why. This is what the UI shows instead of a bare result.
     */
    explain(concertId, seekerRequestId) {
      const { seekers, parties, blocklist } = loadInstance(repos, concertId);
      const profile = buildPreferences(seekers, parties, { blocklist });
      const result = galeShapley(profile, { trace: true });

      const list = profile.seekerPrefs.get(seekerRequestId) ?? [];
      const assigned = result.assignments.get(seekerRequestId) ?? null;
      const events = result.trace.filter(
        (e) => e.seekerId === seekerRequestId || e.evictedSeekerId === seekerRequestId,
      );

      return {
        seekerRequestId,
        assignedPartyId: assigned,
        rankAchieved: assigned ? profile.seekerRanks.get(seekerRequestId).get(assigned) + 1 : null,
        listLength: list.length,
        preferenceList: list.map((partyId, index) => ({
          rank: index + 1,
          partyId,
          score: profile.pairScores.get(`${seekerRequestId}|${partyId}`)?.seekerToParty ?? null,
          partyRankOfMe: (profile.partyRanks.get(partyId)?.get(seekerRequestId) ?? -1) + 1 || null,
          outcome:
            partyId === assigned
              ? 'matched'
              : events.some((e) => e.partyId === partyId && e.type === 'reject')
                ? 'rejected'
                : events.some((e) => e.partyId === partyId && e.type === 'evict' && e.evictedSeekerId === seekerRequestId)
                  ? 'displaced'
                  : index < (assigned ? profile.seekerRanks.get(seekerRequestId).get(assigned) : list.length)
                    ? 'tried'
                    : 'not_reached',
        })),
        events,
      };
    },
  };
}

function loadInstance(repos, concertId) {

  const parties = repos.parties.openForConcert(concertId);

  const availableParties = parties.map(party => ({

    ...party,

    totalCapacity: party.capacity,

    capacity: party.remaining_capacity

  }));

  return {

    seekers: repos.seekers.openForConcert(concertId),

    parties: availableParties,

    blocklist: repos.users.blocklist()

  };
}

function invert(prefs) {
  const ranks = new Map();
  for (const [ownerId, list] of prefs) {
    const map = new Map();
    list.forEach((id, index) => map.set(id, index));
    ranks.set(ownerId, map);
  }
  return ranks;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}
