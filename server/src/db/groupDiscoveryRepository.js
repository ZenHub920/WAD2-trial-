import { randomUUID } from 'node:crypto';
import { checkFeasibility, scorePair } from '../matching/compatibility.js';
import { groupImageUrl } from '../controllers/groupIdentityController.js';
import { preferenceEligibility } from '../services/preferenceEligibility.js';

const fail = (error, status = 409) => ({ error, status });

export function createGroupDiscoveryRepo(db, repos) {
  const seeker = (userId, concertId) => {
    const row = db.prepare('SELECT id FROM seeker_requests WHERE user_id = ? AND concert_id = ?').get(userId, concertId);
    return row ? repos.seekers.findById(row.id) : null;
  };
  const isTicket = id => Boolean(db.prepare('SELECT 1 FROM tickets WHERE source_party_id = ?').get(id));
  const blocked = (a, b, blocklist) =>
    blocklist.has(`${a}:${b}`) || blocklist.has(`${b}:${a}`);
  const card = party => {
    const concert = repos.concerts.findById(party.concert_id);
    return {
      id: party.id, concertId: party.concert_id, artist: concert.artist,
      name: party.name, imageUrl: groupImageUrl(party.image_path),
      tourName: concert.tour_name, eventDate: concert.event_date,
      hostName: party.host.display_name, capacity: party.capacity,
      memberCount: db.prepare(`SELECT COUNT(*) n FROM (SELECT host_user_id AS user_id FROM parties WHERE id=@id
        UNION SELECT user_id FROM group_memberships WHERE party_id=@id AND status='active')`).get({id:party.id}).n,
      remainingCapacity: party.remaining_capacity, section: party.section,
      queueablePlaces: party.queueable_places ?? 0,
      queueLength: db.prepare(`SELECT COUNT(*) n FROM active_seat_claims WHERE party_id=?
        AND status='proposed' AND expires_at>unixepoch('subsec')*1000`).get(party.id).n,
      canJoinQueue: party.status !== 'cancelled' && (party.queueable_places ?? 0)>0,
      spendBand: party.spend_band, arrivalPlan: party.arrival_plan,
      plans: party.plans, vibe: party.host.vibe, notes: party.notes, status: party.status,
    };
  };
  const validConnectionPair = (userId, fromId, toId) => {
    const from = repos.parties.findById(fromId);
    const to = repos.parties.findById(toId);
    if (!from || !to) return fail('group_not_found', 404);
    if (from.host_user_id !== userId) return fail('group_owner_required', 403);
    if (from.id === to.id || from.host_user_id === to.host_user_id) return fail('cannot_connect_own_groups', 400);
    if (from.concert_id !== to.concert_id) return fail('different_concert', 400);
    if ([from, to].some(p => p.status === 'cancelled' || isTicket(p.id))) return fail('group_unavailable');
    const blocklist = repos.users.blocklist();
    if (blocked(from.host_user_id, to.host_user_id, blocklist)) return fail('blocked_pair', 403);
    for(const p of [from,to]) {
      const settings=repos.membership.settings(p.id);
      if(!settings||!settings.published||!settings.connect_open)return fail('group_not_open_to_connections');
    }
    const members = p => [p.host_user_id, ...db.prepare("SELECT user_id FROM group_memberships WHERE party_id=? AND status='active'").all(p.id).map(r => r.user_id)];
    const fromMembers = members(from), toMembers = members(to);
    if (fromMembers.some(a => toMembers.some(b => blocked(a, b, blocklist)))) return fail('blocked_pair', 403);
    if (!preferenceEligibility(repos.membership.profile(from.id), repos.membership.profile(to.id)).eligible)
      return fail('incompatible_group_preferences');
    return { from, to };
  };
  const connectionRow = id => db.prepare('SELECT * FROM group_connections WHERE id = ?').get(id);
  const connectionDetails = (row, userId) => {
    const a = repos.parties.findById(row.party_a_id);
    const b = repos.parties.findById(row.party_b_id);
    const destination = row.initiator_party_id === a.id ? b : a;
    return { id: row.id, status: row.status, initiatorPartyId: row.initiator_party_id,
      createdAt: row.created_at, respondedAt: row.responded_at,
      incoming: destination.host_user_id === userId, partyA: card(a), partyB: card(b) };
  };
  return {
    seeker,
    automaticPlacementEligible(userId, party) {
      const request = seeker(userId, party.concert_id);
      if (!repos.recommendations.visible(party) || !['open','matched'].includes(party.status) || party.queueable_places < 1
        || !request || request.status !== 'open' || isTicket(party.id)) return false;
      try {
        repos.membership.ensureFree(userId, party.concert_id, '');
      } catch (error) {
        if (['already_in_concert_group', 'active_matching_proposal_exists', 'active_seat_claim_exists'].includes(error.message)) return false;
        throw error;
      }
      if (db.prepare(`SELECT 1 FROM group_join_requests j JOIN parties p ON p.id=j.party_id
        WHERE j.user_id=? AND p.concert_id=? AND j.status='pending' AND j.expires_at>?`)
        .get(userId, party.concert_id, Date.now())) return false;
      return !repos.proposals.declinedPairsForConcert(party.concert_id).has(`${request.id}|${party.id}`)
        && repos.recommendations.feasible(userId, party);
    },
    preferredPairs(concertId) {
      return new Set(db.prepare(`SELECT pref.seeker_request_id, pref.party_id
        FROM seeker_party_preferences pref JOIN seeker_requests s ON s.id = pref.seeker_request_id
        WHERE s.concert_id = ?`).all(concertId).map(r => `${r.seeker_request_id}|${r.party_id}`));
    },
    preferences(userId, concertId) {
      return db.prepare(`SELECT pref.party_id, pref.created_at, p.status, p.section, u.display_name AS host_name
        FROM seeker_party_preferences pref JOIN seeker_requests s ON s.id = pref.seeker_request_id
        JOIN parties p ON p.id = pref.party_id JOIN users u ON u.id = p.host_user_id
        WHERE s.user_id = ? AND s.concert_id = ? ORDER BY pref.created_at, pref.party_id`)
        .all(userId, concertId).map(r => ({ partyId: r.party_id, hostName: r.host_name,
          section: r.section, status: r.status, createdAt: r.created_at }));
    },
    discover(userId, concertId) {
      repos.proposals.expire();
      const request = seeker(userId, concertId);
      const blocklist = repos.users.blocklist();
      const declines = repos.proposals.declinedPairsForConcert(concertId);
      const preferred = this.preferredPairs(concertId);
      return repos.parties.queueableForConcert(concertId).filter(p => {
        if (p.host_user_id === userId || blocked(userId, p.host_user_id, blocklist)) return false;
        return !request || (!declines.has(`${request.id}|${p.id}`)
          && checkFeasibility(request, p, { blocklist }).feasible);
      }).map(p => ({ ...card(p), preferred: request ? preferred.has(`${request.id}|${p.id}`) : false,
        compatibility: request ? scorePair(request, p).seekerToParty : null }));
    },
    addPreference: db.transaction((userId, partyId) => {
      repos.proposals.expire();
      const party = repos.parties.findById(partyId);
      if (!party) return fail('group_not_found', 404);
      const request = seeker(userId, party.concert_id);
      if (!request || request.status !== 'open') return fail('open_seeker_request_required');
      const available = repos.parties.queueableForConcert(party.concert_id).find(p => p.id === partyId);
      if (!available) return fail('group_unavailable');
      if (repos.proposals.declinedPairsForConcert(party.concert_id).has(`${request.id}|${partyId}`)) return fail('previously_declined');
      const verdict = checkFeasibility(request, party, { blocklist: repos.users.blocklist() });
      if (!verdict.feasible) return fail(verdict.reason, 400);
      if (!repos.recommendations.visible(party) || !repos.recommendations.feasible(userId, party)) return fail('group_unavailable');
      try {
        repos.membership.ensureFree(userId, party.concert_id, '');
      } catch (error) {
        if (['already_in_concert_group', 'active_matching_proposal_exists', 'active_seat_claim_exists'].includes(error.message)) return fail(error.message);
        throw error;
      }
      db.prepare('INSERT OR IGNORE INTO seeker_party_preferences (seeker_request_id, party_id) VALUES (?, ?)').run(request.id, partyId);
      return { partyId, preferred: true };
    }).immediate,
    removePreference(userId, partyId) {
      db.prepare(`DELETE FROM seeker_party_preferences WHERE party_id = ? AND seeker_request_id IN
        (SELECT id FROM seeker_requests WHERE user_id = ?)`).run(partyId, userId);
      return { partyId, preferred: false };
    },
    reopen: db.transaction((userId, concertId) => {
      repos.proposals.expire();
      const request = seeker(userId, concertId);
      if (!request) return fail('seeker_request_not_found', 404);
      if (request.status !== 'withdrawn') return fail('request_not_withdrawn');
      if (db.prepare("SELECT 1 FROM match_proposals WHERE seeker_request_id = ? AND status IN ('proposed','confirmed')").get(request.id)) return fail('active_proposal_exists');
      try {
        repos.membership.ensureFree(userId, concertId, '');
      } catch (error) {
        if (['already_in_concert_group', 'active_matching_proposal_exists', 'active_seat_claim_exists'].includes(error.message)) return fail(error.message);
        throw error;
      }
      repos.seekers.setStatus(request.id, 'open');
      return { ...request, user: undefined, status: 'open' };
    }).immediate,
    hosted(userId) {
      repos.proposals.expire();
      return db.prepare(`SELECT id FROM parties p WHERE host_user_id = ?
        AND NOT EXISTS (SELECT 1 FROM tickets t WHERE t.source_party_id = p.id) ORDER BY created_at, id`)
        .all(userId).map(r => card(repos.parties.findById(r.id)));
    },
    connectionCandidates(userId, concertId, fromId) {
      const from = repos.parties.findById(fromId);
      if (!from) return fail('group_not_found', 404);
      if (from.host_user_id !== userId) return fail('group_owner_required', 403);
      if (from.concert_id !== concertId) return fail('different_concert', 400);
      if (from.status === 'cancelled' || isTicket(from.id)) return fail('group_unavailable');
      const settings = repos.membership.settings(fromId);
      if (!settings || !settings.published || !settings.connect_open) return [];
      return db.prepare("SELECT id FROM parties WHERE concert_id = ? AND status <> 'cancelled' AND host_user_id <> ? ORDER BY id")
        .all(concertId, userId).filter(r => !isTicket(r.id)).map(r => repos.parties.findById(r.id))
        .filter(p => !validConnectionPair(userId, fromId, p.id).error).map(p => {
          const [a, b] = [fromId, p.id].sort();
          const invitation = db.prepare('SELECT id, status FROM group_connections WHERE party_a_id = ? AND party_b_id = ?').get(a, b);
          return { ...card(p), invitation: invitation ?? null };
        });
    },
    invite: db.transaction((userId, fromId, toId) => {
      const pair = validConnectionPair(userId, fromId, toId);
      if (pair.error) return pair;
      const [a, b] = [fromId, toId].sort();
      const id = `gc_${randomUUID()}`;
      const result = db.prepare(`INSERT INTO group_connections (id, party_a_id, party_b_id, initiator_party_id)
        VALUES (?, ?, ?, ?) ON CONFLICT (party_a_id, party_b_id) DO NOTHING`).run(id, a, b, fromId);
      if (!result.changes) return fail('invitation_already_exists');
      return connectionDetails(connectionRow(id), userId);
    }).immediate,
    connections(userId) {
      return db.prepare(`SELECT gc.* FROM group_connections gc
        JOIN parties a ON a.id = gc.party_a_id JOIN parties b ON b.id = gc.party_b_id
        WHERE a.host_user_id = ? OR b.host_user_id = ? ORDER BY gc.created_at DESC, gc.id`)
        .all(userId, userId).map(r => connectionDetails(r, userId));
    },
    /**
     * Withdraw an invitation you sent.
     *
     * `respond` is the receiving host's door and refuses anybody else, so the
     * sender had no way to take an invitation back. The row is deleted rather
     * than marked: a withdrawn invitation is not a decision either host should
     * keep seeing, and deleting frees the (party_a_id, party_b_id) unique pair
     * so the same two groups can be introduced again later. A DECLINE still
     * writes its status and stays — that one is a record.
     */
    cancel: db.transaction((userId, id) => {
      const row = connectionRow(id);
      if (!row) return fail('invitation_not_found', 404);
      const initiator = repos.parties.findById(row.initiator_party_id);
      if (!initiator || initiator.host_user_id !== userId) return fail('sending_host_required', 403);
      if (row.status !== 'pending') return fail('invitation_already_answered');
      const removed = db.prepare("DELETE FROM group_connections WHERE id = ? AND status = 'pending'").run(id);
      if (!removed.changes) return fail('invitation_already_answered');
      return { id, status: 'cancelled' };
    }).immediate,
    respond: db.transaction((userId, id, action) => {
      if (!['accept', 'decline'].includes(action)) return fail('invalid_decision', 400);
      const row = connectionRow(id);
      if (!row) return fail('invitation_not_found', 404);
      const destinationId = row.initiator_party_id === row.party_a_id ? row.party_b_id : row.party_a_id;
      const destination = repos.parties.findById(destinationId);
      if (destination.host_user_id !== userId) return fail('receiving_host_required', 403);
      if (row.status !== 'pending') return fail('invitation_already_answered');
      // Recheck cancellation and blocks at response time, including stale inboxes.
      if (action === 'accept') {
        const pair = validConnectionPair(userId, destinationId, row.initiator_party_id);
        if (pair.error) return pair;
      }
      const changed = db.prepare(`UPDATE group_connections SET status = ?, responded_at = datetime('now')
        WHERE id = ? AND status = 'pending'`).run(action === 'accept' ? 'accepted' : 'declined', id);
      if (!changed.changes) return fail('invitation_already_answered');
      return connectionDetails(connectionRow(id), userId);
    }).immediate,
  };
}
