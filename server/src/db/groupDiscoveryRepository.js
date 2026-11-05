import { checkFeasibility, scorePair } from '../matching/compatibility.js';
import { groupImageUrl } from '../presentation/groupIdentity.js';
import { concertParticipationEligibility } from '../../../shared/concertEligibility.mjs';

const fail = (error, status = 409) => ({ error, status });

export function createGroupDiscoveryRepo(db, repos) {
  const coordinationError = concertId => {
    const eligibility = concertParticipationEligibility(repos.concerts.findById(concertId));
    return eligibility.eligible ? null : fail(eligibility.reason,
      eligibility.reason === 'concert_date_unavailable' ? 400 : 409);
  };
  const seeker = (userId, concertId) => {
    const row = db.prepare('SELECT id FROM seeker_requests WHERE user_id = ? AND concert_id = ?').get(userId, concertId);
    return row ? repos.seekers.findById(row.id) : null;
  };
  const isTicket = id => Boolean(db.prepare('SELECT 1 FROM tickets WHERE source_party_id = ?').get(id));
  const blocked = (a, b, blocklist) =>
    blocklist.has(`${a}:${b}`) || blocklist.has(`${b}:${a}`);
  // The empty-state summary must not reveal unpublished or blocked groups.
  const visibleTo = (userId, party, blocklist = repos.users.blocklist()) => {
    if (!party || !['open', 'matched'].includes(party.status) || isTicket(party.id)
      || party.host_user_id === userId || !repos.recommendations.visible(party)
      || blocked(userId, party.host_user_id, blocklist)) return false;
    return !db.prepare("SELECT user_id FROM group_memberships WHERE party_id=? AND status='active'")
      .all(party.id).some(member => blocked(userId, member.user_id, blocklist));
  };
  const card = party => {
    const concert = repos.concerts.findById(party.concert_id);
    return {
      id: party.id, concertId: party.concert_id, artist: concert.artist,
      name: party.name, imageUrl: groupImageUrl(party.image_path),
      tourName: concert.tour_name, eventDate: concert.event_date, eventTimezone: concert.event_timezone, eventTime: concert.event_time,
      hostName: party.host.display_name, capacity: party.capacity,
      memberCount: db.prepare(`SELECT COUNT(*) n FROM (SELECT host_user_id AS user_id FROM parties WHERE id=@id
        UNION SELECT user_id FROM group_memberships WHERE party_id=@id AND status='active')`).get({id:party.id}).n,
      remainingCapacity: party.remaining_capacity, section: party.section,
      queueablePlaces: party.queueable_places ?? 0,
      queueLength: db.prepare(`SELECT COUNT(*) n FROM active_seat_claims WHERE party_id=?
        AND status='proposed' AND expires_at>unixepoch('subsec')*1000`).get(party.id).n,
      canJoinQueue: concertParticipationEligibility(concert).eligible && party.status !== 'cancelled' && (party.queueable_places ?? 0)>0,
      spendBand: party.spend_band, arrivalPlan: party.arrival_plan,
      plans: party.plans, vibe: party.host.vibe, notes: party.notes, status: party.status,
    };
  };
  return {
    seeker,
    automaticPlacementEligible(userId, party) {
      if (coordinationError(party.concert_id)) return false;
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
      const blocklist = repos.users.blocklist();
      return db.prepare(`SELECT pref.party_id, pref.created_at, p.status, p.section, p.name, u.display_name AS host_name
        FROM seeker_party_preferences pref JOIN seeker_requests s ON s.id = pref.seeker_request_id
        JOIN parties p ON p.id = pref.party_id JOIN users u ON u.id = p.host_user_id
        WHERE s.user_id = ? AND s.concert_id = ? ORDER BY pref.created_at, pref.party_id`)
        .all(userId, concertId).map(r => {
          const party = repos.parties.findById(r.party_id), readable = visibleTo(userId, party, blocklist);
          return { partyId: r.party_id, groupName: readable ? r.name : null,
            hostName: readable ? r.host_name : null, section: readable ? r.section : null,
            status: readable ? r.status : 'unavailable', available: readable && party.queueable_places > 0,
            createdAt: r.created_at };
        });
    },
    hasVisibleGroups(userId, concertId) {
      const blocklist = repos.users.blocklist();
      return db.prepare("SELECT id FROM parties WHERE concert_id=? AND status IN('open','matched')")
        .all(concertId).some(row => visibleTo(userId, repos.parties.findById(row.id), blocklist));
    },
    discover(userId, concertId) {
      if (coordinationError(concertId)) return [];
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
      const historical = coordinationError(party.concert_id);
      if (historical) return historical;
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
      const historical = coordinationError(concertId);
      if (historical) return historical;
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
  };
}
