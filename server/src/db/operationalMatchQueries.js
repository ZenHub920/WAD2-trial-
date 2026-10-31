import { mapUser } from './rowMappers.js';

/** Current proposal state returned by the existing per-concert result endpoint. */
export function getOperationalMatchResult(db, concertId, userId) {
  const findUser = (id) => mapUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id));
  const seekerProposal = db.prepare(`
    SELECT
      mp.id AS proposal_id,
      mp.status AS proposal_status,
      mp.round_id,
      r.ran_at,
      p.id AS party_id,
      p.section,
      p.host_user_id
    FROM match_proposals mp
    JOIN match_rounds r
      ON r.id = mp.round_id
    JOIN seeker_requests sr
      ON sr.id = mp.seeker_request_id
    JOIN parties p
      ON p.id = mp.party_id
    WHERE sr.user_id = ?
      AND p.concert_id = ?
      AND mp.status IN (
        'proposed',
        'confirmed'
      )
    ORDER BY
      CASE mp.status
        WHEN 'confirmed' THEN 0
        ELSE 1
      END,
      mp.created_at DESC
    LIMIT 1
  `).get(userId, concertId);

  if (seekerProposal) {
    const host = findUser(seekerProposal.host_user_id);

    return {
      role: 'seeker',

      outcome: seekerProposal.proposal_status,

      proposalId: seekerProposal.proposal_id,

      round: {
        id: seekerProposal.round_id,
        ranAt: seekerProposal.ran_at
      },

      group: {
        id: seekerProposal.party_id,
        section: seekerProposal.section,
        host
      }
    };
  }

  const party = db.prepare(`
    SELECT *
    FROM parties
    WHERE concert_id = ?
      AND host_user_id = ?
  `).get(concertId, userId);

  if (!party) {
    return null;
  }

  const members = db.prepare(`
    SELECT u.*
    FROM match_proposals mp
    JOIN seeker_requests sr
      ON sr.id = mp.seeker_request_id
    JOIN users u
      ON u.id = sr.user_id
    WHERE mp.party_id = ?
      AND mp.status IN (
        'proposed',
        'confirmed'
      )
    ORDER BY
      mp.created_at ASC,
      mp.id ASC
  `).all(party.id).map(mapUser);

  return {
    role: 'host',

    outcome: members.length > 0
      ? 'matched'
      : 'no_members',

    round: null,

    group: {
      id: party.id,
      section: party.section,

      host: findUser(userId)
    },

    members
  };
}
