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
  buildRankMaps,
  galeShapley,
  greedyMatch,
  randomMatch,
  evaluate,
  findBlockingPairs,
  comparisonTable,
  solveInstance,
  getSolver,
  assertStable,
} from '../matching/index.js';
import { scorePair } from '../matching/compatibility.js';
import { compareProfiles } from './discoveryPreferences.js';
import { communityError } from '../db/membershipRepository.js';

export function createMatchingService({ db, repos }) {
  return {
    managedState(concertId, userId) {
      if (!repos.concerts.findById(concertId)) throw communityError('concert_not_found', 404);
      repos.proposals.expire();
      repos.recommendations.expire();
      const seeker = repos.groups.seeker(userId, concertId);
      const membership = repos.membership.active(userId, concertId);
      const active = membership && repos.parties.findById(membership.party_id)?.status !== 'cancelled';
      const requests = repos.recommendations.requests(userId).filter(r =>
        r.userId === userId && r.concertId === concertId && r.matchingRoundId
        && repos.parties.findById(r.partyId)?.status !== 'cancelled');
      const request = requests.find(r => r.status === 'pending' && r.expiresAt > Date.now())
        ?? (active ? requests.find(r => r.status === 'accepted' && r.partyId === membership.party_id) : null);
      return { matching: {
        optedIn: Boolean(seeker?.matching_opt_in),
        state: active ? 'accepted' : request?.status === 'pending' ? 'pending'
          : seeker?.status === 'open' && seeker.matching_opt_in ? 'queued' : 'idle',
        request: request ? {
          id: request.id, partyId: request.partyId, concertId: request.concertId,
          artist: request.artist, hostName: request.hostName, section: request.section,
          status: request.status, expiresAt: request.expiresAt, matchingRoundId: request.matchingRoundId,
        } : null,
      } };
    },

    matchManaged(concertId, userId, { batchKey } = {}) {
      if (!batchKey) throw communityError('invalid_idempotency_key', 400);
      const key = `managed:${userId}:${batchKey}`;
      return db.transaction(() => {
        const current = this.managedState(concertId, userId);
        // A retry must not re-enrol someone who has since withdrawn or left.
        if (repos.rounds.findByBatch(concertId, key)
          || ['pending', 'accepted'].includes(current.matching.state)) return current;
        repos.membership.ensureFree(userId, concertId, '');
        const caller = repos.groups.seeker(userId, concertId);
        if (!caller || caller.status !== 'open') throw communityError('open_seeker_request_required');
        if (db.prepare(`SELECT 1 FROM group_join_requests j JOIN parties p ON p.id=j.party_id
          WHERE j.user_id=? AND p.concert_id=? AND j.status='pending' AND j.expires_at>?`)
          .get(userId, concertId, Date.now())) throw communityError('withdraw_current_join_request_first');
        // This explicit action consents to saved answers, or empty defaults if none were saved.
        if (!db.prepare('SELECT 1 FROM seeker_discovery_preferences WHERE user_id=? AND concert_id=?')
          .get(userId, concertId)) repos.recommendations.savePersonal(userId, concertId, {});
        db.prepare('UPDATE seeker_requests SET matching_opt_in=1 WHERE id=?').run(caller.id);

        const seekers = repos.seekers.openForConcert(concertId).filter(s => {
          if (!s.matching_opt_in) return false;
          if (db.prepare(`SELECT 1 FROM group_join_requests j JOIN parties p ON p.id=j.party_id
            WHERE j.user_id=? AND p.concert_id=? AND j.status='pending' AND j.expires_at>?`)
            .get(s.user_id, concertId, Date.now())) return false;
          try {
            repos.membership.ensureFree(s.user_id, concertId, '');
            return true;
          } catch (error) {
            if (['already_in_concert_group', 'active_matching_proposal_exists'].includes(error.message)) return false;
            throw error;
          }
        });
        const parties = repos.parties.openForConcert(concertId)
          .filter(p => repos.membership.settings(p.id)?.published)
          .map(p => ({ ...p, capacity: p.remaining_capacity }));
        if (!seekers.length || !parties.length) return this.managedState(concertId, userId);

        const start = performance.now();
        const personal = new Map(seekers.map(s => [s.id, repos.recommendations.personal(s.user_id, concertId)]));
        const groupProfiles = new Map(parties.map(p => [p.id, repos.membership.profile(p.id)]));
        const aggregates = new Map(parties.map(p => [p.id, repos.recommendations.aggregateParty(p)]));
        const profile = buildPreferences(seekers, parties, {
          blocklist: repos.users.blocklist(),
          declinedPairs: repos.proposals.declinedPairsForConcert(concertId),
          preferredPairs: repos.groups.preferredPairs(concertId),
          isEligible: (s, p) => repos.recommendations.feasible(s.user_id, p),
          scorePair: (s, p) => {
            const base = scorePair(s, aggregates.get(p.id));
            const concepts = compareProfiles(personal.get(s.id), groupProfiles.get(p.id));
            return {
              ...base,
              seekerToParty: 0.6 * base.seekerToParty + 0.4 * concepts.seekerScore,
              partyToSeeker: 0.6 * base.partyToSeeker + 0.4 * concepts.groupScore,
              discovery: concepts,
            };
          },
        });
        const preferencesAt = performance.now();
        const { result, ledger } = solveInstance({ profile, seekers, parties, options: { trace: true } });
        if (ledger.relaxations.length) throw communityError('unsupported_matching_constraints', 409);
        assertStable(profile, result);
        const solvedAt = performance.now();
        // Queued users stay opted in, but no fabricated empty round is persisted.
        if (!result.assignments.size) return this.managedState(concertId, userId);
        const metrics = evaluate(profile, result);
        const timings = {
          preferencesMs: round2(preferencesAt - start), solveMs: round2(solvedAt - preferencesAt),
          evaluateMs: round2(performance.now() - solvedAt), totalMs: round2(performance.now() - start),
        };
        const roundId = repos.rounds.save({
          concertId, batchKey: key, profile, result, metrics, timings, ledger,
          algorithm: ledger.solver, trace: result.trace,
        });
        const byId = new Map(seekers.map(s => [s.id, s]));
        for (const [seekerId, partyId] of result.assignments) {
          repos.recommendations.requestJoin(byId.get(seekerId).user_id, partyId, { matchingRoundId: roundId });
        }
        return this.managedState(concertId, userId);
      }).immediate();
    },

    leaveManaged(concertId, userId) {
      return db.transaction(() => {
        const current = this.managedState(concertId, userId);
        db.prepare('UPDATE seeker_requests SET matching_opt_in=0 WHERE user_id=? AND concert_id=?')
          .run(userId, concertId);
        if (current.matching.state === 'pending') {
          repos.recommendations.respond(userId, current.matching.request.id, 'withdraw');
        }
        return this.managedState(concertId, userId);
      }).immediate();
    },

    /**
     * Preview a round without writing anything. Used by the "what would happen"
     * view and by the admin dashboard before committing.
     */
    preview(concertId, { trace = false, withBaselines = false } = {}) {
      const { seekers, parties, blocklist } = loadInstance(repos, concertId);
      // Declined request/party pairs must not be proposed again.
      const declinedPairs = repos.proposals.declinedPairsForConcert(concertId);
      if (seekers.length === 0 || parties.length === 0) {
        return { empty: true, seekers: seekers.length, parties: parties.length };
      }

      const t0 = performance.now();
      const profile = buildPreferences(seekers, parties, { blocklist, declinedPairs,
        preferredPairs: repos.groups.preferredPairs(concertId) });
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

    /**
 * Run an official matching round atomically.
 *
 * The matching calculation, verification, round persistence,
 * and listing status updates are performed inside one
 * database transaction.
 *
 * If any operation fails, all database changes are rolled back.
* previous implementation had a logical error where if the second transaction failed, the the match results are saved but statuses remain unchanged
    */

/**
 * PURPOSE:
 * Execute an official Gale-Shapley matching round.
 *
 * This method handles three important guarantees:
 *
 * 1. IDEMPOTENCY:
 *    Repeated requests with the same batchKey must not
 *    create duplicate matching rounds.
 *
 * 2. CAPACITY MANAGEMENT:
 *    Expired proposals release their reserved spaces
 *    before the next matching round begins.
 *
 * 3. ATOMICITY:
 *    The round, historical results, proposals and status
 *    updates must either all commit or all roll back.
 *
 * @param {string} concertId
 * @param {object} options
 * @param {boolean} options.trace
 * @param {string} options.batchKey
 */
run(concertId, { trace = true, batchKey } = {}) {

  // STEP 1:
  // Every official matching operation must have a batch key.
  // The frontend supplies this key through the controller.
  if (!batchKey) {
    throw new Error('batch_key_required');
  }

  // STEP 2:
  // Create ONE database transaction for the entire round.
  //
  // All changes are committed together.
  // If an operation fails, SQLite rolls them all back.
  const commitRound = db.transaction(() => {

    // --------------------------------------------------
    // STEP 3: IDEMPOTENCY CHECK
    // --------------------------------------------------
    //
    // Check whether this exact matching operation has
    // already been completed.
    //
    // If it has, return the existing result rather than
    // running Gale-Shapley again.

    const earlier = repos.rounds.findByBatch(
      concertId,
      batchKey
    );

    if (earlier) {
      return {
        empty: false,
        roundId: earlier.id,
        metrics: earlier.metrics,
        timings: earlier.timings,
        ledger: earlier.ledger_json
          ? JSON.parse(earlier.ledger_json)
          : null,
        replayed: true
      };
    }

    // --------------------------------------------------
    // STEP 4: EXPIRE OLD PROPOSALS
    // --------------------------------------------------
    //
    // A pending proposal reserves one party slot.
    //
    // If the user does not respond before its deadline,
    // the proposal expires and the reserved slot must
    // become available again.
    //
    // This must happen BEFORE loading matching inputs.

    repos.proposals.expire();
        // ============================================================
    // LEGACY DATA SAFETY CHECK
    // ============================================================
    //
    // Old match results may exist without corresponding
    // active proposal records.
    //
    // These must be reviewed before switching to
    // proposal-based capacity accounting.
    //
    // Never assume every historical assignment is confirmed.

    if (
      repos.rounds.hasUnreconciledLegacyAssignments(concertId)
    ) {

      throw new Error(
        'legacy_matches_require_reconciliation'
      );

    }

    // --------------------------------------------------
    // STEP 5: CALCULATE AND VERIFY MATCHING
    // --------------------------------------------------
    //
    // preview() loads eligible seekers and parties,
    // constructs preferences, runs Gale-Shapley and
    // verifies the algorithm's matching result.
    //
    // The earlier remaining-capacity modification in
    // loadInstance() is still used here.

    const preview = this.preview(concertId, {
      trace,
      withBaselines: false
    });

    // Nothing eligible to match.
    // Do not create an empty matching round.
    if (preview.empty) {
      return preview;
    }

    // Extract matching results and metadata.
    const {
      profile,
      result,
      metrics,
      timings,
      ledger
    } = preview;

    // --------------------------------------------------
    // STEP 6: SAVE HISTORICAL MATCHING RESULTS
    // --------------------------------------------------
    //
    // Save the matching round and its algorithm results.
    //
    // match_rounds:
    //   Stores information about this execution.
    //
    // match_results:
    //   Stores historical Gale-Shapley assignments.
    //
    // match_trace:
    //   Stores algorithm events for debugging/explanation.
    //
    // batchKey:
    //   Links this round to its idempotency key.

    const roundId = repos.rounds.save({
      concertId,
      batchKey,
      profile,
      result,
      metrics,
      timings,
      ledger,
      algorithm: ledger?.solver ?? 'gale_shapley_hr',
      trace: result.trace
    });

    // --------------------------------------------------
    // STEP 7: CREATE MATCH PROPOSALS (NEW - #5 AND #6)
    // --------------------------------------------------
    //
    // A Gale-Shapley assignment is not yet a confirmed
    // real-world match.
    //
    // For every matched seeker, create a proposal in
    // match_proposals with status 'proposed'.
    //
    // The proposal can later become:
    //   - confirmed
    //   - declined
    //   - expired
    //   - cancelled
    //
    // IMPORTANT:
    // This happens inside the SAME database transaction
    // as rounds.save(). A failure here rolls back the
    // historical round as well.

    repos.proposals.createFromRound(roundId);

    // --------------------------------------------------
    // STEP 8: UPDATE MATCHED SEEKER STATUSES
    // --------------------------------------------------
    //
    // Mark seekers who received proposals as 'matched'
    // in the existing request-status model.
    //
    // This prevents them from joining another round while
    // their current proposal is active.
    //
    // If they later decline or their proposal expires,
    // proposalRepository must reopen their request.

    for (const [seekerId] of result.assignments) {
      repos.seekers.setStatus(
        seekerId,
        'matched'
      );
    }

    // --------------------------------------------------
    // STEP 9: UPDATE PARTY STATUSES
    // --------------------------------------------------
    //
    // Compare newly reserved places against the capacity
    // available at the start of this matching round.
    //
    // The capacity map should contain REMAINING capacity,
    // not the party's original total capacity.
    //
    // If all available slots were filled by proposals,
    // mark the party as 'matched' (fully reserved).
    //
    // Otherwise, leave the party open for a future round.

    for (const [partyId, members] of result.partyMembers) {

      const availableCapacity =
        profile.capacities.get(partyId);

      if (members.length >= availableCapacity) {
        repos.parties.setStatus(
          partyId,
          'matched'
        );
      }
    }

    // --------------------------------------------------
    // STEP 10: RETURN THE NEW ROUND'S RESULT
    // --------------------------------------------------
    //
    // replayed: false means this transaction created
    // a new matching round.

    return {
      empty: false,
      roundId,
      metrics,
      timings,
      ledger,
      replayed: false
    };

  });

  // ----------------------------------------------------
  // STEP 11: EXECUTE THE TRANSACTION
  // ----------------------------------------------------
  //
  // IMMEDIATE acquires SQLite's write reservation before
  // reading the current matching state.
  //
  // This helps prevent concurrent matching requests
  // from allocating the same available capacity.
  //
  // Any error thrown within the transaction causes
  // SQLite to roll back its database modifications.

  return commitRound.immediate();

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
        seekerRanks: buildRankMaps(seekerPrefs),
        partyRanks: buildRankMaps(partyPrefs),
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
      const profile = buildPreferences(seekers, parties, { blocklist,
        declinedPairs: repos.proposals.declinedPairsForConcert(concertId),
        preferredPairs: repos.groups.preferredPairs(concertId) });
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
  repos.proposals.expire();
  repos.recommendations.expire();

  // Managed groups have their own consented batch and host-approval lifecycle.
  const parties = repos.parties.openForConcert(concertId).filter(p=>!repos.membership.settings(p.id));

  const availableParties = parties.map(party => ({

    ...party,

    capacity: party.remaining_capacity

  }));

  return {

    seekers: repos.seekers.openForConcert(concertId).filter(s=>{
      if (repos.recommendations.requests(s.user_id).some(r => r.userId === s.user_id
        && r.concertId === concertId && r.status === 'pending' && r.expiresAt > Date.now())) return false;
      try {
        repos.membership.ensureFree(s.user_id, concertId, '');
        return true;
      } catch (error) {
        if (['already_in_concert_group', 'active_matching_proposal_exists'].includes(error.message)) return false;
        throw error;
      }
    }),

    parties: availableParties,

    blocklist: repos.users.blocklist()

  };
}


function round2(n) {
  return Math.round(n * 100) / 100;
}
