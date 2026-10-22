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
} from '../matching/index.js';
import { communityError } from '../db/membershipRepository.js';

export function createMatchingService({ db, repos }) {
  return {
    // Keep the existing user-facing queue API; only an operator runs a round.
    managedState(concertId, userId) {
      if (!repos.concerts.findById(concertId)) throw communityError('concert_not_found', 404);
      repos.proposals.expire();
      repos.recommendations.expire();
      const seeker = repos.groups.seeker(userId, concertId);
      const membership = repos.membership.active(userId, concertId);
      const active = membership && repos.parties.findById(membership.party_id)?.status !== 'cancelled';
      const proposal = repos.proposals.forUser(userId, concertId, ['proposed', 'confirmed'])
        .find(p => p.role === 'seeker' && repos.parties.findById(p.partyId)?.status !== 'cancelled'
          && (p.status === 'confirmed' || p.expiresAt > Date.now())) ?? null;
      // Old host-reviewed automatic applications remain visible and resolvable.
      // New algorithm assignments always use match_proposals instead.
      const requests = repos.recommendations.requests(userId).filter(r =>
        r.userId === userId && r.concertId === concertId && r.matchingRoundId
        && repos.parties.findById(r.partyId)?.status !== 'cancelled');
      const legacy = requests.find(r => r.status === 'pending' && r.expiresAt > Date.now()) ?? null;
      const optedIn = seeker?.joining_mode === 'algorithm' && seeker?.status === 'open';
      return { matching: {
        optedIn: Boolean(optedIn),
        state: active || proposal?.status === 'confirmed' ? 'accepted'
          : proposal || legacy ? 'pending' : optedIn ? 'queued' : 'idle',
        request: legacy ? {
          id: legacy.id, partyId: legacy.partyId, concertId: legacy.concertId,
          artist: legacy.artist, hostName: legacy.hostName, section: legacy.section,
          status: legacy.status, expiresAt: legacy.expiresAt, matchingRoundId: legacy.matchingRoundId,
        } : null,
        proposal,
      } };
    },

    matchManaged(concertId, userId, { batchKey } = {}) {
      if (!batchKey) throw communityError('invalid_idempotency_key', 400);
      return db.transaction(() => {
        const current = this.managedState(concertId, userId);
        if (['pending', 'accepted'].includes(current.matching.state)) return current;
        const seeker = repos.groups.seeker(userId, concertId);
        if (!seeker || seeker.status !== 'open') throw communityError('open_seeker_request_required');
        repos.membership.ensureFree(userId, concertId, '');
        repos.recommendations.setJoiningMode(userId, concertId, 'algorithm');
        return this.managedState(concertId, userId);
      }).immediate();
    },

    leaveManaged(concertId, userId) {
      return db.transaction(() => {
        // Mode validation rejects active offers and memberships. Stopping the
        // queue must never silently decline an offer or withdraw an application.
        repos.recommendations.setJoiningMode(userId, concertId, 'direct');
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
      const profile = buildProfile(repos, concertId, seekers, parties, blocklist, declinedPairs);
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
 *    Expired proposals leave the shared admission queue before
 *    the next matching round begins. Waiting requests inherit held places.
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
    // The earliest eligible proposals hold party places. Later requests wait.
    // Expiry removes the entry and transfers its held place to the next request;
    // a place becomes free only when no eligible queue entry remains.
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
    // loadInstance() uses unconfirmed places as this batch's capacity.
    // Older pending requests retain priority in the operational queue.

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

    if (ledger?.relaxations?.length) {
      throw communityError('unsupported_matching_constraints');
    }
    if (!result.assignments.size) {
      return { empty: true, seekers: profile.stats.seekers, parties: profile.stats.parties };
    }

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
    // Mark seekers who received proposals as 'matched' in the request-status
    // model, including offers waiting behind older queue entries.
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
    // The database triggers update physical reservations across the whole queue.
    // Filling every unconfirmed place in this batch also makes the party fully
    // reserved, even when some of these new offers wait behind earlier entries.

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
      const profile = buildProfile(repos, concertId, seekers, parties, blocklist,
        repos.proposals.declinedPairsForConcert(concertId));
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

  // Every batch matches against places that do not yet have confirmed members.
  // Existing pending entries keep their earlier FIFO positions; new offers may
  // wait behind them. The saved stability guarantee describes this batch's
  // preference snapshot, rather than the final combined admission queue.
  const parties = repos.parties.queueableForConcert(concertId).filter(p => repos.recommendations.visible(p));

  const availableParties = parties.map(party => ({

    ...party,

    capacity: party.queueable_places

  }));

  return {

    seekers: repos.seekers.openForConcert(concertId).filter(s=>{
      if (s.joining_mode !== 'algorithm') return false;
      if (repos.recommendations.requests(s.user_id).some(r => r.userId === s.user_id
        && r.concertId === concertId && r.status === 'pending' && r.expiresAt > Date.now())) return false;
      try {
        repos.membership.ensureFree(s.user_id, concertId, '');
        return true;
      } catch (error) {
        if (['already_in_concert_group', 'active_matching_proposal_exists', 'active_seat_claim_exists'].includes(error.message)) return false;
        throw error;
      }
    }),

    parties: availableParties,

    blocklist: repos.users.blocklist()

  };
}


function buildProfile(repos, concertId, seekers, parties, blocklist, declinedPairs) {
  return buildPreferences(seekers, parties, {
    blocklist,
    declinedPairs,
    preferredPairs: repos.groups.preferredPairs(concertId),
    isEligible: (seeker, party) => repos.recommendations.feasible(seeker.user_id, party),
    scorePair: (seeker, party) => repos.recommendations.pairScore(seeker, party),
  });
}


function round2(n) {
  return Math.round(n * 100) / 100;
}
