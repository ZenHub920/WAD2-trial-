import { randomUUID } from 'node:crypto';
import { reservedPlacesSql,availableCapacitySql,queueablePlacesSql,expireJoinRequests } from './capacity.js';
import { queueInfo } from './admissionQueue.js';
import { groupImageUrl } from '../presentation/groupIdentity.js';

/**
 * Operational offers are separate from immutable matching history. The shared FIFO
 * queue reserves places for confirmed claims and the earliest eligible pending claims.
 * Releasing a held place advances the queue within the same database transaction.
 */
export function createProposalRepo(db, repos = null) {
  // Match reasons come from the saved score snapshot, not edited profiles.
  const details = (p, saved = p.score_breakdown_json ? JSON.parse(p.score_breakdown_json) : null) => {
    return {
      id: p.id,
      roundId: p.round_id,
      concertId: p.concert_id,

      seekerRequestId: p.seeker_request_id,
      partyId: p.party_id,
      seekerUserId: p.seeker_user_id,

      artist: p.artist,
      eventDate: p.event_date,
      section: p.section,
      groupName: p.group_name ?? null,
      imageUrl: groupImageUrl(p.group_image_path),
      reasons: Array.isArray(saved?.discovery?.reasons) ? saved.discovery.reasons.slice(0, 3) : [],
      confidence: saved?.discovery?.confidence ?? null,

      hostName: p.host_name,
      hostUserId: p.host_user_id,
      seekerName: p.seeker_name,

      status: p.status,
      resolutionReason: p.resolution_reason ?? null,
      expiresAt: p.expires_at,

      seekerScore: p.seeker_score,
      partyScore: p.party_score,
      seekerApproved: Boolean(p.seeker_approved_at),
      hostApproved: Boolean(p.host_approved_at),
      seekerApprovedAt: p.seeker_approved_at ?? null,
      hostApprovedAt: p.host_approved_at ?? null,
      approvalPolicy: p.approval_policy ?? 'mutual',
      ...queueInfo(db, { proposalId: p.id }),
    };
  };

  const JOINED = `
    SELECT
      mp.*,
      c.artist,
      c.event_date,
      p.section,
      p.name AS group_name,
      p.image_path AS group_image_path,
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

  const reserved = db.prepare(`SELECT ${reservedPlacesSql('@id')} AS n`);

  const refresh = (partyId, seekerId) => {
    const stillActive = db.prepare(`
      SELECT 1
      FROM active_seat_claims
      WHERE seeker_request_id = ? AND
        (status='confirmed' OR(status='proposed' AND expires_at>unixepoch('subsec')*1000))
    `).get(seekerId);

    if (!stillActive) {
      db.prepare(`
        UPDATE seeker_requests
        SET status = 'open'
        WHERE id = ?
          AND status = 'matched'
      `).run(seekerId);
    }

    const party = db.prepare(`
      SELECT ${availableCapacitySql('parties')} AS capacity, status
      FROM parties
      WHERE id = ?
    `).get(partyId);

    if (!party || party.status === 'cancelled') {
      return;
    }

    const reservedCount = reserved.get({ id: partyId }).n;

    const fullyReserved = reservedCount >= party.capacity;

    db.prepare(`
      UPDATE parties
      SET status = ?
      WHERE id = ?
    `).run(
      fullyReserved ? 'matched' : 'open',
      partyId
    );
  };

  /** Expire elapsed offers and direct requests before reallocating their held places. */
  const expire = db.transaction(() => {
    expireJoinRequests(db);

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
  }).immediate;

  return {
    /** Keep offer creation inside the outer matching transaction so all writes roll back. */
    createFromRound: db.transaction((roundId) => {
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
        const party = db.prepare(`SELECT ${queueablePlacesSql('p.id')} queueable_places,p.status FROM parties p WHERE p.id = ?`).get(match.party_id);
        if (!party || party.status === 'cancelled' || party.queueable_places < 1) {
          throw new Error('party_capacity_exceeded');
        }
        const request = db.prepare('SELECT joining_mode,status,user_id FROM seeker_requests WHERE id=?').get(match.seeker_request_id);
        if (request?.joining_mode !== 'algorithm' || request.status === 'withdrawn') throw new Error('algorithm_mode_required');
        const settings = db.prepare('SELECT published FROM group_settings WHERE party_id=?').get(match.party_id);
        if (settings && !settings.published) throw new Error('group_unavailable');
        if (repos?.recommendations && !repos.recommendations.feasible(request.user_id, repos.parties.findById(match.party_id)))
          throw new Error('group_unavailable');

        const proposalId = `mp_${randomUUID()}`;

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
    }).immediate,

    expire,

    /** A decline excludes only this exact seeker/group pair from later rounds. */
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

    /** Seeker/host-scoped inbox, optionally filtered by concert and status. */
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

    /** Authorize the owning seeker or host before returning the original score breakdown. */
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

      const breakdown = proposal.score_breakdown_json ? JSON.parse(proposal.score_breakdown_json) : null;
      return { ...details(proposal, breakdown), breakdown };
    },

    /** Both approvals convert the existing held claim; a decline releases it. */
    respond: db.transaction((userId, proposalId, decision) => {
      if (!['accept', 'decline'].includes(decision)) return { error: 'invalid_decision', status: 400 };
      const proposal = db.prepare(`${JOINED} WHERE mp.id=?`).get(proposalId);
      if (!proposal || (proposal.seeker_user_id !== userId && proposal.host_user_id !== userId))
        return { error: 'proposal_not_found', status: 404 };
      if (proposal.status !== 'proposed') return { error: 'proposal_not_pending', status: 409 };
      if (proposal.expires_at <= Date.now()) {
        db.prepare("UPDATE match_proposals SET status='expired' WHERE id=?").run(proposalId);
        refresh(proposal.party_id,proposal.seeker_request_id);
        return { error: 'proposal_expired', status: 409 };
      }
      // Sweep both sources before FIFO checks, including an expired earlier direct request.
      expire();
      repos?.recommendations?.expire();
      const role = proposal.seeker_user_id === userId ? 'seeker' : 'host';
      const queue = queueInfo(db, { proposalId });
      // Hosts process the queue in order; seekers can withdraw from any position.
      if ((decision === 'accept' || role === 'host') && (!queue.canHostRespond || !queue.seatReserved))
        return { error: 'request_waiting_in_queue', status: 409 };
      if (decision === 'decline') {
        db.prepare("UPDATE match_proposals SET status='declined' WHERE id=?").run(proposalId);
        db.prepare('INSERT OR IGNORE INTO match_declines(seeker_request_id,party_id) VALUES(?,?)')
          .run(proposal.seeker_request_id,proposal.party_id);
        refresh(proposal.party_id,proposal.seeker_request_id);
        return { proposalId,status: 'declined' };
      }
      const seekerId = proposal.seeker_user_id;
      const approvalColumn = role === 'seeker' ? 'seeker_approved_at' : 'host_approved_at';
      if (proposal[approvalColumn]) return { error: 'proposal_already_approved',status:409 };
      const party = db.prepare(`SELECT p.status,${availableCapacitySql()} capacity FROM parties p WHERE p.id=?`).get(proposal.party_id);
      const request = db.prepare('SELECT status,joining_mode FROM seeker_requests WHERE id=?').get(proposal.seeker_request_id);
      if (!party || party.status === 'cancelled' || request?.status === 'withdrawn' ||
          db.prepare('SELECT 1 FROM tickets WHERE source_party_id=?').get(proposal.party_id))
        return { error:'group_unavailable',status:409 };
      if (request?.joining_mode !== 'algorithm') return { error:'algorithm_mode_required',status:409 };
      const settings = db.prepare('SELECT published FROM group_settings WHERE party_id=?').get(proposal.party_id);
      if (settings && !settings.published) return { error:'group_unavailable',status:409 };
      if (reserved.get({id:proposal.party_id}).n > party.capacity) return {error:'party_capacity_exceeded',status:409};
      const claim = db.prepare("SELECT 1 FROM active_seat_claims WHERE proposal_id=? AND status='proposed' AND seat_held=1 AND expires_at>?")
        .get(proposalId,Date.now());
      if (!claim) return {error:'claim_source_invalid',status:409};
      if (repos?.recommendations && !repos.recommendations.feasible(seekerId,repos.parties.findById(proposal.party_id)))
        return {error:'group_unavailable',status:409};
      if (db.prepare(`SELECT 1 FROM blocks WHERE (blocker_user_id=? AND blocked_user_id=?) OR
          (blocker_user_id=? AND blocked_user_id=?)`).get(seekerId,proposal.host_user_id,proposal.host_user_id,seekerId))
        return {error:'group_unavailable',status:409};
      if (db.prepare("SELECT 1 FROM group_memberships WHERE user_id=? AND concert_id=? AND status='active' AND party_id<>?")
          .get(seekerId,proposal.concert_id,proposal.party_id) ||
          db.prepare("SELECT 1 FROM parties WHERE host_user_id=? AND concert_id=? AND status<>'cancelled'").get(seekerId,proposal.concert_id))
        return {error:'already_in_concert_group',status:409};
      db.prepare(`UPDATE match_proposals SET ${approvalColumn}=datetime('now') WHERE id=?`).run(proposalId);
      const approvals = db.prepare('SELECT seeker_approved_at,host_approved_at FROM match_proposals WHERE id=?').get(proposalId);
      if (!approvals.seeker_approved_at || !approvals.host_approved_at) {
        return {proposalId,status:'proposed',seekerApproved:Boolean(approvals.seeker_approved_at),hostApproved:Boolean(approvals.host_approved_at),
          ...queueInfo(db, { proposalId })};
      }
      db.prepare("UPDATE match_proposals SET status='confirmed' WHERE id=?").run(proposalId);
      if (repos?.membership) repos.membership.attach(repos.parties.findById(proposal.party_id),seekerId,'proposal');
      else db.prepare(`INSERT INTO group_memberships(party_id,user_id,concert_id,source) VALUES(?,?,?,'proposal')
        ON CONFLICT(party_id,user_id) DO UPDATE SET status='active',source='proposal',joined_at=datetime('now'),left_at=NULL`)
        .run(proposal.party_id,seekerId,proposal.concert_id);
      db.prepare(`INSERT INTO group_member_preferences(party_id,user_id,answers_json) VALUES(?,?,?)
        ON CONFLICT(party_id,user_id) DO UPDATE SET answers_json=excluded.answers_json`).run(proposal.party_id,seekerId,
        repos?.recommendations
          ? JSON.stringify(repos.recommendations.answers(seekerId,proposal.concert_id))
          : db.prepare('SELECT answers_json FROM seeker_discovery_preferences WHERE user_id=? AND concert_id=?')
            .get(seekerId,proposal.concert_id)?.answers_json ?? '{"about":[],"wants":[],"avoid":[]}');
      db.prepare('UPDATE seeker_requests SET matching_opt_in=0 WHERE id=?').run(proposal.seeker_request_id);
      return {proposalId,status:'confirmed',seekerApproved:true,hostApproved:true,...queueInfo(db, { proposalId })};
    }).immediate
  };
}
