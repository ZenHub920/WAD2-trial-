import { randomUUID } from 'node:crypto';
import { getOperationalMatchResult } from './operationalMatchQueries.js';

const mapRound = (round) => round ? {
  ...round,
  metrics: JSON.parse(round.metrics_json),
  timings: JSON.parse(round.timings_json),
} : null;

export function createRoundRepo(db) {
  return {
    /** Save the history, score snapshots and trace atomically with the matching round. */
    save({
      concertId,
      profile,
      result,
      metrics,
      timings,
      trace = [],
      algorithm = 'gale_shapley_hr',
      ledger = null,
      batchKey = null,
    }) {
      const roundId = `r_${randomUUID().slice(0, 8)}`;

      const insertRound = db.prepare(`
        INSERT INTO match_rounds (id, concert_id, algorithm, is_stable, blocking_pair_count,
                                  seeker_count, party_count, total_capacity, feasible_pairs,
                                  matched_count, metrics_json, timings_json,
                                  preference_snapshot_json,
                                  solver_id, instance_class, stability_promise,
                                  relaxations_json, ledger_json, batch_key)
        VALUES (@id, @concert_id, @algorithm, @is_stable, @blocking_pair_count,
                @seeker_count, @party_count, @total_capacity, @feasible_pairs,
                @matched_count, @metrics_json, @timings_json, @preference_snapshot_json,
                @solver_id, @instance_class, @stability_promise,
                @relaxations_json, @ledger_json, @batch_key)
      `);

      const insertResult = db.prepare(`
        INSERT INTO match_results (
          id,
          round_id,
          seeker_request_id,
          party_id,
          seeker_rank,
          party_rank,
          seeker_score,
          party_score,
          outcome,
          score_breakdown_json
        )
        VALUES (
          @id,
          @round_id,
          @seeker_request_id,
          @party_id,
          @seeker_rank,
          @party_rank,
          @seeker_score,
          @party_score,
          @outcome,
          @score_breakdown_json
        )
      `);

      const insertTrace = db.prepare(`
        INSERT INTO match_trace (round_id, step, event_type, seeker_request_id, party_id,
                                 rank, evicted_seeker_id)
        VALUES (@round_id, @step, @event_type, @seeker_request_id, @party_id,
                @rank, @evicted_seeker_id)
      `);

      const tx = db.transaction(() => {
        insertRound.run({
          id: roundId,
          concert_id: concertId,
          batch_key : batchKey,
          algorithm,
          is_stable: metrics.stable ? 1 : 0,
          blocking_pair_count: metrics.blockingPairs,
          seeker_count: profile.stats.seekers,
          party_count: profile.stats.parties,
          total_capacity: profile.stats.totalCapacity,
          feasible_pairs: profile.stats.feasiblePairs,
          matched_count: metrics.matched,
          metrics_json: JSON.stringify(metrics),
          timings_json: JSON.stringify(timings),
          preference_snapshot_json: JSON.stringify({
            seekerPrefs: Object.fromEntries(profile.seekerPrefs),
            partyPrefs: Object.fromEntries(profile.partyPrefs),
            capacities: Object.fromEntries(profile.capacities),
          }),
          solver_id: ledger?.solver ?? null,
          instance_class: ledger?.instanceClass ?? null,
          stability_promise: ledger?.promised?.stability ?? null,
          relaxations_json: ledger ? JSON.stringify(ledger.relaxations ?? []) : null,
          ledger_json: ledger ? JSON.stringify(ledger) : null,
        });

        for (const seekerId of profile.seekerPrefs.keys()) {
          const partyId = result.assignments.get(seekerId) ?? null;
          const scored = partyId
            ? profile.pairScores.get(`${seekerId}|${partyId}`)
            : null;
          insertResult.run({
            id: `mr_${randomUUID().slice(0, 8)}`,
            round_id: roundId,
            seeker_request_id: seekerId,
            party_id: partyId,
            seeker_rank: partyId ? profile.seekerRanks.get(seekerId).get(partyId) + 1 : null,
            party_rank: partyId ? profile.partyRanks.get(partyId).get(seekerId) + 1 : null,
            seeker_score: scored?.seekerToParty ?? null,
            party_score: scored?.partyToSeeker ?? null,
            outcome: partyId ? 'matched' : 'unmatched',

            score_breakdown_json: scored
              ? JSON.stringify(scored)
              : null,
          });
        }

        for (const event of trace) {
          insertTrace.run({
            round_id: roundId,
            step: event.step,
            event_type: event.type,
            seeker_request_id: event.seekerId,
            party_id: event.partyId,
            rank: event.rank ?? null,
            evicted_seeker_id: event.evictedSeekerId ?? null,
          });
        }
      });

      tx();
      return roundId;
    },

    /** Guard occupied legacy seats before changing to proposal-based accounting. */
    hasUnreconciledLegacyAssignments(concertId) {
      const oldSeekers = db.prepare(`
        SELECT COUNT(*) AS n
        FROM seeker_requests s
        WHERE s.concert_id = ?
          AND s.status = 'matched'
          AND NOT EXISTS (
            SELECT 1
            FROM active_seat_claims sc
            WHERE sc.seeker_request_id=s.id AND
              (sc.status='confirmed' OR(sc.status='proposed' AND sc.expires_at>unixepoch('subsec')*1000))
          )
          AND NOT EXISTS (
            SELECT 1 FROM group_memberships gm JOIN parties p ON p.id=gm.party_id
            WHERE gm.user_id=s.user_id AND gm.concert_id=s.concert_id
              AND gm.status='active' AND p.status<>'cancelled'
          )
      `).get(concertId).n;

      const oldParties = db.prepare(`
        SELECT COUNT(*) AS n
        FROM parties p
        WHERE p.concert_id = ?
          AND p.status = 'matched'
          AND NOT EXISTS (SELECT 1 FROM group_settings gs WHERE gs.party_id = p.id)
          AND NOT EXISTS (
            SELECT 1
            FROM active_seat_claims sc
            WHERE sc.party_id=p.id AND
              (sc.status='confirmed' OR(sc.status='proposed' AND sc.expires_at>unixepoch('subsec')*1000))
          )
      `).get(concertId).n;

      return oldSeekers > 0 || oldParties > 0;
    },

    findById(roundId) {
      const round = db.prepare('SELECT * FROM match_rounds WHERE id = ?').get(roundId);
      return mapRound(round);
    },

    /** Reuse a completed operator round when its idempotency key is retried. */
    findByBatch(concertId, batchKey) {
      const row = db.prepare(`
        SELECT id
        FROM match_rounds
        WHERE concert_id = ?
          AND batch_key = ?
      `).get(concertId, batchKey);

      return row ? this.findById(row.id) : null;
    },

    latestForConcert(concertId) {
      const round = db.prepare(`
        SELECT * FROM match_rounds WHERE concert_id = ? ORDER BY ran_at DESC, rowid DESC LIMIT 1
      `).get(concertId);
      return mapRound(round);
    },

    /** Preserve the public compatibility endpoint while keeping its query separate. */
    resultForUser(concertId, userId) {
      return getOperationalMatchResult(db, concertId, userId);
    },

    resultsForRound(roundId) {
      return db.prepare(`
        SELECT
          mr.*,
          su.display_name AS seeker_name,
          su.id           AS seeker_user_id,
          hu.display_name AS host_name,
          hu.id           AS host_user_id,
          p.section, p.spend_band, p.arrival_plan, p.capacity
        FROM match_results mr
        JOIN seeker_requests s ON s.id = mr.seeker_request_id
        JOIN users su          ON su.id = s.user_id
        LEFT JOIN parties p    ON p.id = mr.party_id
        LEFT JOIN users hu     ON hu.id = p.host_user_id
        WHERE mr.round_id = ?
        -- matched first (CASE, not alphabetical: 'unmatched' sorts after 'matched'),
        -- then best rank achieved first
        ORDER BY CASE mr.outcome WHEN 'matched' THEN 0 ELSE 1 END,
                 mr.seeker_rank ASC
      `).all(roundId);
    },

    traceForRound(roundId, limit = 2000) {
      return db.prepare(`
        SELECT * FROM match_trace WHERE round_id = ? ORDER BY step ASC LIMIT ?
      `).all(roundId, limit);
    },

    partyRoster(roundId, partyId) {
      return db.prepare(`
        SELECT mr.seeker_request_id, mr.seeker_rank, mr.party_rank,
               u.id AS user_id, u.display_name, u.age_band, u.home_region, u.vibe_json
        FROM match_results mr
        JOIN seeker_requests s ON s.id = mr.seeker_request_id
        JOIN users u           ON u.id = s.user_id
        WHERE mr.round_id = ? AND mr.party_id = ?
        ORDER BY mr.party_rank ASC
      `).all(roundId, partyId);
    },
  };
}
