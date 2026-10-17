
import { randomUUID } from 'node:crypto';
import { reservedPlacesSql,availableCapacitySql } from './capacity.js';

/**
 * ============================================================
 * ENCORE — MATCH PROPOSAL REPOSITORY
 * Improvements #5, #6 and #12
 * ============================================================
 *
 * PURPOSE:
 *
 * Manage the operational lifecycle of Gale-Shapley assignments.
 *
 * IMPORTANT DISTINCTION:
 *
 * match_results:
 *   Immutable historical algorithm results.
 *
 * match_proposals:
 *   Current operational assignment status.
 *
 * Only proposals with status:
 *
 *   - proposed
 *   - confirmed
 *
 * reserve party capacity.
 *
 * Declined, expired and cancelled proposals release capacity.
 *
 * Database writes that change multiple related records are
 * wrapped in better-sqlite3 transactions.
 */

export function createProposalRepo(db) {

  const ACTIVE = "('proposed','confirmed')";

  // ============================================================
  // HELPER: CONVERT DATABASE ROW INTO API RESPONSE
  // ============================================================

  const details = (p) => ({
    id: p.id,
    roundId: p.round_id,
    concertId: p.concert_id,

    seekerRequestId: p.seeker_request_id,
    partyId: p.party_id,
    seekerUserId: p.seeker_user_id,

    artist: p.artist,
    eventDate: p.event_date,
    section: p.section,

    hostName: p.host_name,
    hostUserId: p.host_user_id,
    seekerName: p.seeker_name,

    status: p.status,
    expiresAt: p.expires_at,

    seekerScore: p.seeker_score,
    partyScore: p.party_score
  });

  // ============================================================
  // SHARED SQL: HYDRATE PROPOSALS WITH CONCERT AND USER DATA
  // ============================================================
  //
  // This prevents frontend components from making separate
  // requests to load the concert, host and seeker.

  const JOINED = `
    SELECT
      mp.*,
      c.artist,
      c.event_date,
      p.section,
      p.host_user_id,
      h.display_name AS host_name,
      su.display_name AS seeker_name,
      sr.user_id AS seeker_user_id,
      p.concert_id,
      mr.seeker_score,
      mr.party_score,
      mr.score_breakdown_json

    FROM match_proposals mp

    JOIN seeker_requests sr
      ON sr.id = mp.seeker_request_id

    JOIN parties p
      ON p.id = mp.party_id

    JOIN users h
      ON h.id = p.host_user_id

    JOIN users su
      ON su.id = sr.user_id

    JOIN concerts c
      ON c.id = p.concert_id

    JOIN match_results mr
      ON mr.id = mp.match_result_id
  `;

  // ============================================================
  // HELPER: COUNT RESERVED PARTY CAPACITY
  // ============================================================

  const reservedQuery = db.prepare(`SELECT ${reservedPlacesSql('@id')} AS n`);
  const reserved = { get: id => reservedQuery.get({id}) };

  // ============================================================
  // HELPER: REOPEN SEEKER AND PARTY AFTER CAPACITY RELEASE
  // ============================================================

  const refresh = (partyId, seekerId) => {

    // STEP 1:
    // Check whether this seeker still has an active proposal.

    const stillActive = db.prepare(`
      SELECT 1
      FROM match_proposals
      WHERE seeker_request_id = ?
        AND status IN ${ACTIVE}
    `).get(seekerId);

    // STEP 2:
    // If no active proposal exists, reopen the seeker request.

    if (!stillActive) {

      db.prepare(`
        UPDATE seeker_requests
        SET status = 'open'
        WHERE id = ?
          AND status = 'matched'
      `).run(seekerId);

    }

    // STEP 3:
    // Load the associated party.

    const party = db.prepare(`
      SELECT ${availableCapacitySql('parties')} AS capacity, status
      FROM parties
      WHERE id = ?
    `).get(partyId);

    if (!party || party.status === 'cancelled') {
      return;
    }

    // STEP 4:
    // Calculate how many seats remain reserved.

    const reservedCount = reserved.get(partyId).n;

    const fullyReserved = reservedCount >= party.capacity;

    // STEP 5:
    // Reopen the party if it has spare capacity.

    db.prepare(`
      UPDATE parties
      SET status = ?
      WHERE id = ?
    `).run(
      fullyReserved ? 'matched' : 'open',
      partyId
    );
  };

  // ============================================================
  // EXPIRE OLD PROPOSALS
  // ============================================================
  //
  // Each proposal has a 48-hour response deadline.
  //
  // Once expired:
  //   - It no longer reserves a seat.
  //   - The seeker's request can reopen.
  //   - The party can reopen if capacity exists.
  //
  // All operations are atomic.

  const expire = db.transaction(() => {

    const expired = db.prepare(`
      SELECT
        id,
        party_id,
        seeker_request_id

      FROM match_proposals

      WHERE status = 'proposed'
        AND expires_at <= ?
    `).all(Date.now());

    const update = db.prepare(`
      UPDATE match_proposals
      SET status = 'expired'
      WHERE id = ?
    `);

    for (const proposal of expired) {

      update.run(proposal.id);

      refresh(
        proposal.party_id,
        proposal.seeker_request_id
      );
    }

    return expired.length;
  });

  // ============================================================
  // EXPORTED REPOSITORY METHODS
  // ============================================================

  return {

    /**
     * CREATE OPERATIONAL PROPOSALS FROM A MATCHING ROUND
     *
     * Called inside matchingService.run().
     *
     * IMPORTANT:
     * Must execute inside the outer matching transaction.
     *
     * If proposal creation fails, historical matching results
     * must also roll back.
     */

    createFromRound(roundId) {

      const matches = db.prepare(`
        SELECT
          id,
          seeker_request_id,
          party_id

        FROM match_results

        WHERE round_id = ?
          AND outcome = 'matched'
          AND party_id IS NOT NULL
      `).all(roundId);

      const insert = db.prepare(`
        INSERT INTO match_proposals (
          id,
          round_id,
          match_result_id,
          seeker_request_id,
          party_id,
          status,
          expires_at
        )
        VALUES (?, ?, ?, ?, ?, 'proposed', ?)
      `);

      for (const match of matches) {
        const party = db.prepare(`SELECT ${availableCapacitySql()} capacity,p.status FROM parties p WHERE p.id = ?`).get(match.party_id);
        if (!party || party.status === 'cancelled' || reserved.get(match.party_id).n >= party.capacity) {
          throw new Error('party_capacity_exceeded');
        }
        if (db.prepare('SELECT 1 FROM group_settings WHERE party_id=?').get(match.party_id)) {
          throw new Error('managed_group_requires_host_approval');
        }

        const proposalId = `mp_${randomUUID()}`;

        // Proposal expires 48 hours after creation.
        const expiresAt =
          Date.now() + 48 * 60 * 60 * 1000;

        insert.run(
          proposalId,
          roundId,
          match.id,
          match.seeker_request_id,
          match.party_id,
          expiresAt
        );
      }
    },

    // Expose the transaction defined above.
    expire,

    /**
     * RETURN PREVIOUSLY DECLINED REQUEST-PARTY PAIRS
     *
     * A seeker who declined Party A must not automatically
     * receive another proposal for Party A.
     *
     * This restriction applies to the exact pair, not
     * every group or every concert associated with the host.
     */

    declinedPairsForConcert(concertId) {

      const rows = db.prepare(`
        SELECT
          md.seeker_request_id,
          md.party_id

        FROM match_declines md

        JOIN seeker_requests sr
          ON sr.id = md.seeker_request_id

        WHERE sr.concert_id = ?
      `).all(concertId);

      return new Set(
        rows.map(row =>
          `${row.seeker_request_id}|${row.party_id}`
        )
      );
    },

    /**
     * RETRIEVE CURRENT OR HISTORICAL PROPOSALS FOR A USER
     *
     * A seeker sees their own proposals.
     * A host sees proposals involving their hosted group.
     *
     * Optional filters:
     * concertId = specific concert
     * statuses  = proposed, confirmed, declined, etc.
     */

    forUser(userId, concertId = null, statuses = null) {

      let sql = `
        ${JOINED}

        WHERE (
          sr.user_id = ?
          OR p.host_user_id = ?
        )
      `;

      const args = [userId, userId];

      if (concertId !== null) {

        sql += `
          AND p.concert_id = ?
        `;

        args.push(concertId);
      }

      if (statuses?.length) {

        sql += `
          AND mp.status IN (
            ${statuses.map(() => '?').join(',')}
          )
        `;

        args.push(...statuses);
      }

      sql += `
        ORDER BY mp.created_at DESC, mp.id DESC
      `;

      return db.prepare(sql)
        .all(...args)
        .map(proposal => ({
          ...details(proposal),

          role: proposal.seeker_user_id === userId
            ? 'seeker'
            : 'host'
        }));
    },

    /**
     * HISTORICAL MATCH EXPLANATION
     *
     * Read the score breakdown saved at matching time.
     *
     * Do not recalculate using the user's latest profile.
     *
     * Both the seeker and the party host may access
     * the explanation for their own assignment.
     */

    explain(userId, proposalId) {

      const proposal = db.prepare(`
        ${JOINED}

        WHERE (
          sr.user_id = ?
          OR p.host_user_id = ?
        )

        AND mp.id = ?
      `).get(
        userId,
        userId,
        proposalId
      );

      if (!proposal) {
        return null;
      }

      return {
        ...details(proposal),

        breakdown: proposal.score_breakdown_json
          ? JSON.parse(proposal.score_breakdown_json)
          : null
      };
    },

    /**
     * ACCEPT OR DECLINE A PROPOSAL
     *
     * Only the seeker who owns the proposal may respond.
     *
     * The proposal must still be pending.
     *
     * Confirming preserves the capacity reservation.
     *
     * Declining releases it and records the declined pair.
     */

    respond: db.transaction((userId, proposalId, decision) => {

      // STEP 1: Validate the requested action.

      if (!['accept', 'decline'].includes(decision)) {

        return {
          error: 'invalid_decision',
          status: 400
        };
      }

      // STEP 2: Load the proposal.

      const proposal = db.prepare(`
        ${JOINED}

        WHERE mp.id = ?
      `).get(proposalId);

      // STEP 3: Verify ownership.
      //
      // A host cannot accept an offer on behalf of a seeker.

      if (!proposal || proposal.seeker_user_id !== userId) {

        return {
          error: 'proposal_not_found',
          status: 404
        };
      }

      // STEP 4: Only pending offers can be changed.

      if (proposal.status !== 'proposed') {

        return {
          error: 'proposal_not_pending',
          status: 409
        };
      }

      // STEP 5: Check expiration.
      //
      // An expired offer cannot be accepted.

      if (proposal.expires_at <= Date.now()) {

        db.prepare(`
          UPDATE match_proposals
          SET status = 'expired'
          WHERE id = ?
        `).run(proposalId);

        refresh(
          proposal.party_id,
          proposal.seeker_request_id
        );

        return {
          error: 'proposal_expired',
          status: 409
        };
      }

      // STEP 6: Determine the next status.

      const nextStatus = decision === 'accept'
        ? 'confirmed'
        : 'declined';
      if(nextStatus==='confirmed') {
        const party = db.prepare(`SELECT p.status, ${availableCapacitySql()} AS capacity
          FROM parties p WHERE p.id=?`).get(proposal.party_id);
        const request = db.prepare('SELECT status FROM seeker_requests WHERE id=?').get(proposal.seeker_request_id);
        if (!party || party.status === 'cancelled' || request?.status === 'withdrawn'
          || db.prepare('SELECT 1 FROM tickets WHERE source_party_id=?').get(proposal.party_id)) {
          return { error: 'group_unavailable', status: 409 };
        }
        if (db.prepare('SELECT 1 FROM group_settings WHERE party_id=?').get(proposal.party_id)) {
          return { error: 'managed_group_requires_host_approval', status: 409 };
        }
        if (reserved.get(proposal.party_id).n > party.capacity) {
          return { error: 'party_capacity_exceeded', status: 409 };
        }
        if (db.prepare(`SELECT 1 FROM blocks WHERE
          (blocker_user_id=? AND blocked_user_id=?) OR (blocker_user_id=? AND blocked_user_id=?)`)
          .get(userId, proposal.host_user_id, proposal.host_user_id, userId)) {
          return { error: 'group_unavailable', status: 409 };
        }
        const other=db.prepare("SELECT 1 FROM group_memberships WHERE user_id=? AND concert_id=? AND status='active' AND party_id<>?").get(userId,proposal.concert_id,proposal.party_id);
        const hosted=db.prepare("SELECT 1 FROM parties WHERE host_user_id=? AND concert_id=? AND status<>'cancelled' AND id<>?").get(userId,proposal.concert_id,proposal.party_id);
        if(other||hosted)return {error:'already_in_concert_group',status:409};
        db.prepare(`INSERT INTO group_memberships(party_id,user_id,concert_id,source) VALUES(?,?,?,'proposal')
          ON CONFLICT(party_id,user_id) DO UPDATE SET status='active',source='proposal',joined_at=datetime('now'),left_at=NULL`).run(proposal.party_id,userId,proposal.concert_id);
      }

      // STEP 7: Persist the response.

      db.prepare(`
        UPDATE match_proposals
        SET status = ?
        WHERE id = ?
      `).run(
        nextStatus,
        proposalId
      );

      // STEP 8:
      // Declining releases capacity and prevents the
      // same request-party pair from being proposed again.

      if (nextStatus === 'declined') {

        db.prepare(`
          INSERT OR IGNORE INTO match_declines (
            seeker_request_id,
            party_id
          )
          VALUES (?, ?)
        `).run(
          proposal.seeker_request_id,
          proposal.party_id
        );

        refresh(
          proposal.party_id,
          proposal.seeker_request_id
        );
      }

      // STEP 9: Return the updated state.

      return {
        proposalId,
        status: nextStatus
      };
    })
  };
}
