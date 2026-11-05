import { createHash, randomUUID } from "node:crypto";
import { communityError } from "./membershipRepository.js";
import { meetupRankingContext, rankMeetupOptions, SLOT_MS } from "../services/meetupPlanning.js";
import { meetupDatePolicy, parseMeetupTimestamp } from '../../../shared/meetupDates.mjs';
import { meetupActionError, meetupCapabilities, requiredMeetupApprovers } from '../services/meetupPolicy.js';
import { normalizeMeetupAvailability, normalizeMeetupPlace, normalizeMeetupTitle, requireMeetupWindow } from '../services/meetupValidation.js';
import { migrateMeetupParticipation } from './meetupParticipationMigrations.js';
export { coordinates } from '../services/meetupValidation.js';
export function migrateMeetups(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS meetups(
  id TEXT PRIMARY KEY,creator_id TEXT NOT NULL REFERENCES users(id),party_id TEXT REFERENCES parties(id),
  connection_id TEXT REFERENCES group_connections(id),kaki_conversation_id TEXT REFERENCES conversations(id),
  title TEXT NOT NULL,starts_at INTEGER NOT NULL,ends_at INTEGER NOT NULL,version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'planning' CHECK(status IN('planning','proposed','confirmed','cancelled')),
  selected_place_id TEXT,selected_start INTEGER,
  CHECK((party_id IS NOT NULL)+(connection_id IS NOT NULL)+(kaki_conversation_id IS NOT NULL)=1));
  CREATE TABLE IF NOT EXISTS meetup_creation_requests(
    request_key TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    meetup_id TEXT NOT NULL REFERENCES meetups(id) ON DELETE CASCADE,payload_fingerprint TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS meetup_places(id TEXT PRIMARY KEY,meetup_id TEXT NOT NULL REFERENCES meetups(id),
    proposed_by TEXT NOT NULL REFERENCES users(id),label TEXT NOT NULL,latitude REAL NOT NULL,longitude REAL NOT NULL,sheltered INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS meetup_availability(meetup_id TEXT NOT NULL REFERENCES meetups(id),user_id TEXT NOT NULL REFERENCES users(id),
    starts_at INTEGER NOT NULL,ends_at INTEGER NOT NULL,latitude REAL,longitude REAL,label TEXT,
    PRIMARY KEY(meetup_id,user_id,starts_at));
  CREATE TABLE IF NOT EXISTS meetup_votes(meetup_id TEXT NOT NULL REFERENCES meetups(id),place_id TEXT NOT NULL REFERENCES meetup_places(id),
    user_id TEXT NOT NULL REFERENCES users(id),PRIMARY KEY(meetup_id,user_id));
  CREATE TABLE IF NOT EXISTS meetup_comments(id TEXT PRIMARY KEY,meetup_id TEXT NOT NULL REFERENCES meetups(id),user_id TEXT NOT NULL REFERENCES users(id),body TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT(datetime('now')));
  CREATE TABLE IF NOT EXISTS meetup_approvals(meetup_id TEXT NOT NULL REFERENCES meetups(id),version INTEGER NOT NULL,user_id TEXT NOT NULL REFERENCES users(id),PRIMARY KEY(meetup_id,version,user_id));
  CREATE INDEX IF NOT EXISTS idx_meetup_party ON meetups(party_id);
  CREATE INDEX IF NOT EXISTS idx_meetup_connection ON meetups(connection_id);
  CREATE INDEX IF NOT EXISTS idx_meetup_creator ON meetups(creator_id);
  CREATE INDEX IF NOT EXISTS idx_meetup_kaki ON meetups(kaki_conversation_id);`);
  if (!db.prepare("PRAGMA table_info(meetup_availability)").all().some((column) => column.name === "travel_mode"))
    db.exec("ALTER TABLE meetup_availability ADD COLUMN travel_mode TEXT NOT NULL DEFAULT 'transit' CHECK(travel_mode IN ('transit','drive'))");
  migrateMeetupParticipation(db);
}
const timestamp = parseMeetupTimestamp;
const scopeFields = { partyId: 'party_id', connectionId: 'connection_id', kakiConversationId: 'kaki_conversation_id' };
export function createMeetupRepo(db, repos) {
  const row = (id) => {
    const m = db.prepare("SELECT * FROM meetups WHERE id=?").get(id);
    if (!m) throw communityError("meetup_not_found", 404);
    return m;
  };
  const groupMembers = (id) => {
    const p = repos.parties.findById(id);
    if (!p || p.status === "cancelled") return [];
    if (db.prepare("SELECT 1 FROM tickets WHERE source_party_id=?").get(id)) return [];
    return [
      ...new Set([
        p.host_user_id,
        ...db
          .prepare(
            "SELECT user_id FROM group_memberships WHERE party_id=? AND status='active'",
          )
          .all(id)
          .map((x) => x.user_id),
        ...db
          .prepare(
            "SELECT s.user_id FROM match_proposals mp JOIN seeker_requests s ON s.id=mp.seeker_request_id WHERE mp.party_id=? AND mp.status='confirmed' AND NOT EXISTS(SELECT 1 FROM group_memberships gm WHERE gm.party_id=mp.party_id AND gm.user_id=s.user_id)",
          )
          .all(id)
          .map((x) => x.user_id),
      ]),
    ];
  };
  const participants = (m) => {
    let ids = [];
    if (m.party_id) ids = groupMembers(m.party_id);
    if (m.connection_id) {
      const c = db
        .prepare(
          "SELECT * FROM group_connections WHERE id=? AND status='accepted'",
        )
        .get(m.connection_id);
      if (c) {
        const a = groupMembers(c.party_a_id), b = groupMembers(c.party_b_id);
        if (a.length && b.length) ids = [...a, ...b];
      }
    }
    if (m.kaki_conversation_id) {
      const c = db
        .prepare("SELECT * FROM conversations WHERE id=?")
        .get(m.kaki_conversation_id);
      if (c && repos.kakiChat.canChat(c.user_a_id, c.user_b_id, c.concert_id))
        ids = [c.user_a_id, c.user_b_id];
    }
    ids = [...new Set(ids)];
    const blocks = repos.users.blocklist();
    // A newly blocked pair must not share private coordination data.
    if (ids.some((a) => ids.some((b) => blocks.has(`${a}:${b}`)))) return [];
    return ids;
  };
  const access = (user, id) => {
    const m = row(id);
    if (!participants(m).includes(user))
      throw communityError("meetup_not_found", 404);
    return m;
  };
  const notify = (m, actor, event, title) => {
    const stage = /^(?:place|vote):/.test(event) ? 'places'
      : /^(?:proposal|confirmed|cancelled|comment):/.test(event) ? 'review' : 'availability';
    for (const user of participants(m).filter((u) => u !== actor))
      if (
        db
          .prepare(
            "SELECT enabled FROM notification_preferences WHERE user_id=? AND category='meetup'",
          )
          .get(user)?.enabled !== 0
      )
        db.prepare(
          "INSERT OR IGNORE INTO notifications(id,user_id,category,event_key,title,resource_path) VALUES(?,?,'meetup',?,?,?)",
        ).run(
          randomUUID(),
          user,
          `meetup:${m.id}:${event}`,
          title,
          `/meetups/${encodeURIComponent(m.id)}#meetup-${stage}`,
        );
  };
  const enforcePolicy = (action, m, isOrganizer = true) => {
    const error = meetupActionError(action, m.status, isOrganizer);
    if (error) throw communityError(error.code, error.status);
  };
  const writable = m => enforcePolicy('contribute', m);
  const checkVersion = (m, version) => {
    if (version !== undefined && m.version !== version) throw communityError('stale_meetup_version');
  };
  const requireVersion = (m, version) => {
    if (!Number.isInteger(version) || m.version !== version) throw communityError('stale_meetup_version');
  };
  const ownedPlace = (user, id, placeId) => {
    const place = typeof placeId === 'string' ? db.prepare('SELECT * FROM meetup_places WHERE id=? AND meetup_id=?').get(placeId, id) : null;
    if (!place) throw communityError('place_not_found', 404);
    if (place.proposed_by !== user) throw communityError('place_owner_required', 403);
    return place;
  };
  const revision = (m, user, event) => {
    writable(m);
    db.prepare(
      "UPDATE meetups SET version=version+1 WHERE id=?",
    ).run(m.id);
    notify(m, user, `${event}:${m.version + 1}`, "Meetup planning was updated");
  };
  const approvers = (m) => {
    if (m.party_id) return requiredMeetupApprovers(m, [repos.parties.findById(m.party_id).host_user_id]);
    if (m.connection_id) {
      const c = db
        .prepare("SELECT * FROM group_connections WHERE id=?")
        .get(m.connection_id);
      return requiredMeetupApprovers(m, [
        repos.parties.findById(c.party_a_id).host_user_id,
        repos.parties.findById(c.party_b_id).host_user_id,
      ]);
    }
    return requiredMeetupApprovers(m, [], participants(m));
  };
  const organizer = (m, user) => {
    enforcePolicy('create', m, approvers(m).includes(user));
  };
  const capabilities = (m, user) => {
    return meetupCapabilities(m.status, approvers(m), user);
  };
  const scopeFor = input => {
    const scope = Object.fromEntries(Object.entries(scopeFields).map(([key, field]) => [field, input?.[key] ?? null]));
    if (Object.values(scope).filter(Boolean).length !== 1
      || Object.values(scope).some(value => value !== null && (typeof value !== 'string' || !value)))
      throw communityError('one_meetup_scope_required', 400);
    return scope;
  };
  const scopedAccess = (user, input) => {
    const scope = scopeFor(input);
    if (!participants(scope).includes(user)) throw communityError('scope_membership_required', 403);
    return scope;
  };
  const concertFor = m => {
    const concertId = m.party_id ? repos.parties.findById(m.party_id)?.concert_id
      : m.connection_id ? db.prepare('SELECT p.concert_id FROM group_connections c JOIN parties p ON p.id=c.party_a_id WHERE c.id=?').get(m.connection_id)?.concert_id
      : db.prepare('SELECT concert_id FROM conversations WHERE id=?').get(m.kaki_conversation_id)?.concert_id;
    const concert = concertId ? repos.concerts.findById(concertId) : null;
    return concert ? { id: concert.id, artist: concert.artist, venue: concert.venue, city: concert.city,
      event_date: concert.event_date, event_time: concert.event_time ?? null,
      event_timezone: concert.event_timezone ?? null, doors_time: concert.doors_time ?? null } : null;
  };
  const planningData = (id, ids) => ({
    availability: db.prepare('SELECT * FROM meetup_availability WHERE meetup_id=?')
      .all(id).filter((a) => ids.includes(a.user_id)),
    places: db.prepare(`SELECT p.*,(SELECT COUNT(*) FROM meetup_votes v WHERE v.meetup_id=p.meetup_id AND v.place_id=p.id
      AND v.user_id IN(SELECT value FROM json_each(?))) AS votes FROM meetup_places p WHERE p.meetup_id=? ORDER BY p.rowid`)
      .all(JSON.stringify(ids), id),
  });
  const scopeMetadata = (m, user) => {
    if (m.party_id) {
      const party = repos.parties.findById(m.party_id);
      return { scope: { partyId: m.party_id }, scopeLabel: party.name || `${party.host?.display_name || 'Your host'}'s group`,
        returnPath: `/groups/${encodeURIComponent(m.party_id)}/channel` };
    }
    if (m.connection_id) {
      const connection = db.prepare('SELECT party_a_id,party_b_id FROM group_connections WHERE id=?').get(m.connection_id);
      const names = [connection.party_a_id, connection.party_b_id].map(id => {
        const party = repos.parties.findById(id);
        return party.name || `${party.host?.display_name || 'Host'}'s group`;
      });
      return { scope: { connectionId: m.connection_id }, scopeLabel: names.join(' + '),
        returnPath: `/groups/connections/${encodeURIComponent(m.connection_id)}/channel` };
    }
    const conversation = db.prepare(`SELECT a.display_name AS a,b.display_name AS b,c.user_a_id
      FROM conversations c JOIN users a ON a.id=c.user_a_id JOIN users b ON b.id=c.user_b_id WHERE c.id=?`).get(m.kaki_conversation_id);
    return { scope: { kakiConversationId: m.kaki_conversation_id },
      scopeLabel: `Kaki conversation with ${conversation.user_a_id === user ? conversation.b : conversation.a}`,
      returnPath: `/kaki/chat/${encodeURIComponent(m.kaki_conversation_id)}` };
  };
  const participationRevision = (m, ids = participants(m)) => createHash('sha256')
    .update(JSON.stringify([m.id, [...ids].sort()])).digest('hex');
  const responseSummary = (m, ids, user) => {
    const available = new Set(db.prepare('SELECT DISTINCT user_id FROM meetup_availability WHERE meetup_id=?')
      .all(m.id).map(row => row.user_id));
    const responses = new Map(db.prepare('SELECT user_id,status FROM meetup_availability_responses WHERE meetup_id=?')
      .all(m.id).map(row => [row.user_id, row.status]));
    const statusOf = id => responses.get(id) ?? (available.has(id) ? 'available' : 'unanswered');
    const availabilityResponses = { respondedCount: 0, availableCount: 0, unavailableCount: 0, unansweredCount: 0 };
    for (const id of ids) {
      const status = statusOf(id);
      availabilityResponses[`${status}Count`]++;
      if (status !== 'unanswered') availabilityResponses.respondedCount++;
    }
    return { availabilityResponse: statusOf(user), hasResponded: statusOf(user) !== 'unanswered', availabilityResponses,
      hasAvailability: available.has(user), availabilityParticipantCount: ids.filter(id => available.has(id)).length };
  };
  const rememberConfirmation = (m, version) => db.prepare(`INSERT INTO meetup_confirmation_context(meetup_id,version,confirmed_at,participant_ids_json)
    VALUES(?,?,?,?) ON CONFLICT(meetup_id) DO UPDATE SET version=excluded.version,confirmed_at=excluded.confirmed_at,
    participant_ids_json=excluded.participant_ids_json`).run(m.id, version, Date.now(), JSON.stringify(participants(m)));
  const confirmationContext = (m, user) => {
    if (m.status !== 'confirmed') return null;
    const context = db.prepare('SELECT * FROM meetup_confirmation_context WHERE meetup_id=? AND version=?').get(m.id, m.version);
    if (!context) return null; // The confirmation time of legacy plans is unknown.
    let joinedAfter = !JSON.parse(context.participant_ids_json).includes(user);
    if (!joinedAfter && !m.kaki_conversation_id) {
      const parties = m.party_id ? [m.party_id] : Object.values(db.prepare('SELECT party_a_id,party_b_id FROM group_connections WHERE id=?').get(m.connection_id));
      const memberships = db.prepare(`SELECT joined_at FROM group_memberships WHERE user_id=? AND status='active'
        AND party_id IN(SELECT value FROM json_each(?))`).all(user, JSON.stringify(parties));
      joinedAfter = memberships.some(row => Date.parse(`${row.joined_at.replace(' ', 'T')}Z`) > context.confirmed_at);
    }
    return { confirmedAt: context.confirmed_at, confirmedBeforeJoined: joinedAfter };
  };
  const currentApprovals = m => {
    const requiredApprovers = approvers(m);
    const approvals = db.prepare('SELECT user_id FROM meetup_approvals WHERE meetup_id=? AND version=?')
      .all(m.id, m.version).map(a => a.user_id).filter(id => requiredApprovers.includes(id));
    return { requiredApprovers, approvals };
  };
  const isHistorical = m => m.status === 'cancelled'
    || (m.selected_start == null ? m.ends_at : m.selected_start + SLOT_MS) <= Date.now();
  // Summaries intentionally avoid loading origins, raw availability, discussion or
  // route recommendations. The shared overview/chat cache needs only public plan
  // details and the caller's own participation/approval state.
  const summary = (m, user) => {
    const ids = participants(m), { requiredApprovers, approvals } = currentApprovals(m);
    const response = responseSummary(m, ids, user);
    const hasApproved = approvals.includes(user);
    const permissions = capabilities(m, user);
    const selectedPlace = m.selected_place_id ? db.prepare('SELECT id,label FROM meetup_places WHERE id=? AND meetup_id=?')
      .get(m.selected_place_id, m.id) ?? null : null;
    return {
      id: m.id, title: m.title, status: m.status, version: m.version,
      startsAt: m.starts_at, endsAt: m.ends_at,
      ...scopeMetadata(m, user), concert: concertFor(m),
      participantCount: ids.length, ...response, confirmationContext: confirmationContext(m, user),
      selectedStart: m.selected_start, selectedPlace,
      requiredApprovers, approvals, approvalCount: approvals.length, requiredApprovalCount: requiredApprovers.length, hasApproved,
      capabilities: { ...permissions, canApprove: permissions.canApprove && !hasApproved },
      nextStage: m.status !== 'planning' || permissions.canPropose && response.availabilityParticipantCount > 0
        && Boolean(db.prepare('SELECT 1 FROM meetup_places WHERE meetup_id=? LIMIT 1').get(m.id))
        ? 'review' : response.hasResponded ? 'places' : 'availability',
      isHistorical: isHistorical(m),
    };
  };
  const scopedBoards = scope => {
    const field = Object.values(scopeFields).find(key => scope[key]);
    return db.prepare(`SELECT * FROM meetups WHERE ${field}=? ORDER BY rowid DESC`).all(scope[field]);
  };
  return {
    access,
    participants,
    context(user, input = {}) {
      const scope = scopedAccess(user, input), concert = concertFor(scope);
      return { concert, policy: meetupDatePolicy(concert), ...scopeMetadata(scope, user),
        capabilities: scope.kaki_conversation_id
          ? { ...capabilities({ ...scope, status: 'planning' }, user), canCreate: false }
          : capabilities({ ...scope, status: 'planning' }, user),
        participantCount: participants(scope).length, requiredApprovers: approvers(scope),
        meetups: scopedBoards(scope).map(m => summary(m, user)) };
    },
    list(user, scope = {}) {
      const fields = scopeFields;
      const selected = Object.keys(fields).filter(key => scope[key] !== undefined);
      if (selected.length > 1 || selected.some(key => typeof scope[key] !== 'string' || !scope[key]))
        throw communityError('one_meetup_scope_required', 400);
      return db
        .prepare(`WITH relevant_parties(id) AS(
          SELECT id FROM parties WHERE host_user_id=?
          UNION SELECT party_id FROM group_memberships WHERE user_id=? AND status='active'
          UNION SELECT mp.party_id FROM match_proposals mp JOIN seeker_requests s ON s.id=mp.seeker_request_id WHERE mp.status='confirmed' AND s.user_id=?
        ) SELECT m.* FROM meetups m WHERE
          m.creator_id=? OR
          m.party_id IN (SELECT id FROM relevant_parties) OR
          m.connection_id IN (SELECT id FROM group_connections WHERE party_a_id IN(SELECT id FROM relevant_parties) OR party_b_id IN(SELECT id FROM relevant_parties)) OR
          m.kaki_conversation_id IN(SELECT id FROM conversations WHERE user_a_id=? OR user_b_id=?)
          ORDER BY m.rowid DESC`)
        .all(user,user,user,user,user,user)
        .filter((m) => participants(m).includes(user) && selected.every(key => m[fields[key]] === scope[key]))
        .map((m) => summary(m, user));
    },
    // Server-internal input. Public detail deliberately returns only the caller's origins.
    planningInput(user, id) {
      const m = access(user, id), ids = participants(m);
      return {
        ...m,
        participantCount: ids.length,
        participantIds: [...ids].sort(), participationRevision: participationRevision(m, ids),
        ...planningData(id, ids),
      };
    },
    create: db.transaction((user, input = {}) => {
      const scope = scopedAccess(user, input);
      // 1-to-1 companion pairs coordinate in their chat; meetup boards are for groups only.
      if (scope.kaki_conversation_id) throw communityError('pair_meetups_disabled', 403);
      organizer(scope, user);
      const { starts, ends } = requireMeetupWindow(input.startsAt, input.endsAt, concertFor(scope));
      const title = normalizeMeetupTitle(input.title);
      if (input.createAnother !== undefined && typeof input.createAnother !== 'boolean')
        throw communityError('invalid_meetup_creation_options', 400);
      const requestId = input.creationRequestId;
      if (requestId !== undefined && (typeof requestId !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(requestId)))
        throw communityError('invalid_meetup_creation_options', 400);
      // Scope and account bind each opaque request ID. Persist even a reused
      // board: a lost response must not create another if that board is cancelled
      // before the original request is retried.
      const id = requestId === undefined ? `meet_${randomUUID()}`
        : `meet_${createHash('sha256').update(JSON.stringify([user, scope, requestId])).digest('hex')}`;
      const fingerprint = createHash('sha256').update(JSON.stringify([title, starts, ends, input.createAnother === true])).digest('hex');
      const attempt = requestId === undefined ? null : db.prepare('SELECT meetup_id,payload_fingerprint FROM meetup_creation_requests WHERE request_key=? AND user_id=?').get(id, user);
      if (attempt) {
        if (attempt.payload_fingerprint !== fingerprint) throw communityError('meetup_creation_conflict', 409);
        return { id: attempt.meetup_id, reused: true };
      }
      const rememberAttempt = meetupId => {
        if (requestId !== undefined) db.prepare('INSERT INTO meetup_creation_requests(request_key,user_id,meetup_id,payload_fingerprint) VALUES(?,?,?,?)')
          .run(id, user, meetupId, fingerprint);
      };
      // Retain compatibility with an existing deterministic board from before
      // the additive request ledger was installed.
      const previousAttempt = db.prepare('SELECT * FROM meetups WHERE id=?').get(id);
      if (previousAttempt) {
        if (previousAttempt.title !== title || previousAttempt.starts_at !== starts || previousAttempt.ends_at !== ends)
          throw communityError('meetup_creation_conflict', 409);
        rememberAttempt(id);
        return { id, reused: true };
      }
      const existing = scopedBoards(scope).filter(m => !isHistorical(m));
      // Opening a scope normally resumes its latest active board. An organizer
      // can explicitly create another genuine plan; tokened retries still reuse it.
      const reusable = input.createAnother !== true ? existing[0]
        : requestId === undefined ? existing.find(m => m.title === title && m.starts_at === starts && m.ends_at === ends) : null;
      if (reusable) {
        rememberAttempt(reusable.id);
        return { id: reusable.id, reused: true };
      }
      db.prepare(
        "INSERT INTO meetups(id,creator_id,party_id,connection_id,kaki_conversation_id,title,starts_at,ends_at) VALUES(?,?,?,?,?,?,?,?)",
      ).run(
        id,
        user,
        scope.party_id,
        scope.connection_id,
        scope.kaki_conversation_id,
        title,
        starts,
        ends,
      );
      rememberAttempt(id);
      notify(row(id), user, "created", "A meetup planning board was created");
      return { id };
    }).immediate,
    detail(user, id, { shelteredOnly = false } = {}) {
      if (typeof shelteredOnly !== 'boolean') throw communityError('invalid_travel_options', 400);
      const m = access(user, id),
        ids = participants(m);
      const { availability, places } = planningData(id, ids);
      const { requiredApprovers, approvals } = currentApprovals(m), hasApproved = approvals.includes(user);
      const permissions = capabilities(m, user);
      const suggestions = rankMeetupOptions({ startsAt: m.starts_at, endsAt: m.ends_at,
        availability, places, participantCount: ids.length, shelteredOnly });
      return {
        ...m,
        ...scopeMetadata(m, user),
        concert: concertFor(m),
        policy: meetupDatePolicy(concertFor(m)),
        capabilities: { ...permissions, canApprove: permissions.canApprove && !hasApproved },
        participantCount: ids.length,
        ...responseSummary(m, ids, user), participationRevision: participationRevision(m, ids),
        confirmationContext: confirmationContext(m, user),
        requiredApprovers, approvals, hasApproved,
        places: places.map(place => ({ ...place,
          canEdit: permissions.canContribute && place.proposed_by === user,
          canRemove: permissions.canContribute && place.proposed_by === user })),
        currentVotePlaceId: db.prepare('SELECT place_id FROM meetup_votes WHERE meetup_id=? AND user_id=?').get(id, user)?.place_id ?? null,
        availability: availability.filter((a) => a.user_id === user),
        grid: Array.from(
          { length: (m.ends_at - m.starts_at) / SLOT_MS },
          (_, i) => {
            const start = m.starts_at + i * SLOT_MS;
            return {
              startsAt: start,
              availableCount: new Set(
                availability
                  .filter(
                    (a) => a.starts_at <= start && a.ends_at >= start + SLOT_MS,
                  )
                  .map((a) => a.user_id),
              ).size,
            };
          },
        ),
        suggestions, suggestionsShelteredOnly: shelteredOnly, ...meetupRankingContext(suggestions),
        comments: db
          .prepare(
            `SELECT c.id,c.body,c.created_at AS createdAt,u.display_name AS name FROM meetup_comments c JOIN users u ON u.id=c.user_id WHERE meetup_id=? ORDER BY c.rowid LIMIT 500`,
          )
          .all(id),
      };
    },
    availability: db.transaction((user, id, input, expectedVersion, responseStatus) => {
      const m = access(user, id);
      checkVersion(m, expectedVersion);
      enforcePolicy('retryContribution', m);
      const rows = normalizeMeetupAvailability(input, m.starts_at, m.ends_at);
      const status = responseStatus === undefined ? rows.length ? 'available' : 'unanswered' : responseStatus;
      if (!['available', 'unavailable', 'unanswered'].includes(status) || (status === 'available') !== Boolean(rows.length))
        throw communityError('invalid_availability_response', 400);
      const savedStatus = db.prepare('SELECT status FROM meetup_availability_responses WHERE meetup_id=? AND user_id=?').get(id, user)?.status;
      const saved = db.prepare('SELECT starts_at AS start,ends_at AS end,latitude,longitude,label,travel_mode AS travelMode FROM meetup_availability WHERE meetup_id=? AND user_id=? ORDER BY starts_at').all(id, user);
      if (JSON.stringify(rows) === JSON.stringify(saved) && status === (savedStatus ?? (saved.length ? 'available' : 'unanswered')))
        return { saved: true, unchanged: true, version: m.version, responseStatus: status };
      revision(m, user, "availability");
      db.prepare(`INSERT INTO meetup_availability_responses(meetup_id,user_id,status,responded_at) VALUES(?,?,?,?)
        ON CONFLICT(meetup_id,user_id) DO UPDATE SET status=excluded.status,responded_at=excluded.responded_at`)
        .run(id, user, status, status === 'unanswered' ? null : Date.now());
      db.prepare(
        "DELETE FROM meetup_availability WHERE meetup_id=? AND user_id=?",
      ).run(id, user);
      const insert = db.prepare("INSERT INTO meetup_availability(meetup_id,user_id,starts_at,ends_at,latitude,longitude,label,travel_mode) VALUES(?,?,?,?,?,?,?,?)");
      for (const r of rows)
        insert.run(
          id,
          user,
          r.start,
          r.end,
          r.latitude,
          r.longitude,
          r.label,
          r.travelMode,
        );
      return { saved: true, version: m.version + 1, responseStatus: status };
    }).immediate,
    place: db.transaction((user, id, input = {}) => {
      const m = access(user, id);
      checkVersion(m, input?.version);
      enforcePolicy('retryContribution', m);
      const place = normalizeMeetupPlace(input);
      const duplicate = db.prepare('SELECT id FROM meetup_places WHERE meetup_id=? AND lower(trim(label))=lower(?) AND latitude=? AND longitude=? AND sheltered=?')
        .get(id, place.label, place.latitude, place.longitude, place.sheltered);
      if (duplicate) return { id: duplicate.id, unchanged: true };
      if (
        db
          .prepare("SELECT COUNT(*) n FROM meetup_places WHERE meetup_id=?")
          .get(id).n >= 50
      )
        throw communityError("place_limit_reached");
      revision(m, user, "place");
      const placeId = `place_${randomUUID()}`;
      db.prepare("INSERT INTO meetup_places VALUES(?,?,?,?,?,?,?)").run(
        placeId,
        id,
        user,
        place.label,
        place.latitude,
        place.longitude,
        place.sheltered,
      );
      return { id: placeId, version: m.version + 1 };
    }).immediate,
    vote: db.transaction((user, id, place, expectedVersion) => {
      const m = access(user, id);
      checkVersion(m, expectedVersion);
      enforcePolicy('retryContribution', m);
      if (
        typeof place !== "string" ||
        !db
          .prepare("SELECT 1 FROM meetup_places WHERE id=? AND meetup_id=?")
          .get(place, id)
      )
        throw communityError("place_not_found", 404);
      if (db.prepare('SELECT place_id FROM meetup_votes WHERE meetup_id=? AND user_id=?').get(id, user)?.place_id === place)
        return { voted: true, unchanged: true, version: m.version };
      revision(m, user, "vote");
      db.prepare(
        "INSERT INTO meetup_votes VALUES(?,?,?) ON CONFLICT(meetup_id,user_id) DO UPDATE SET place_id=excluded.place_id",
      ).run(id, place, user);
      return { voted: true, version: m.version + 1 };
    }).immediate,
    removeVote: db.transaction((user, id, expectedVersion) => {
      const m = access(user, id);
      requireVersion(m, expectedVersion);
      writable(m);
      if (!db.prepare('SELECT 1 FROM meetup_votes WHERE meetup_id=? AND user_id=?').get(id, user))
        return { voted: false, unchanged: true, version: m.version };
      revision(m, user, 'vote');
      db.prepare('DELETE FROM meetup_votes WHERE meetup_id=? AND user_id=?').run(id, user);
      return { voted: false, version: m.version + 1 };
    }).immediate,
    updatePlace: db.transaction((user, id, placeId, input = {}) => {
      const m = access(user, id);
      requireVersion(m, input?.version);
      writable(m);
      const saved = ownedPlace(user, id, placeId), place = normalizeMeetupPlace(input);
      if (['label', 'latitude', 'longitude', 'sheltered'].every(key => saved[key] === place[key]))
        return { id: placeId, unchanged: true, version: m.version, votesCleared: 0 };
      if (db.prepare('SELECT 1 FROM meetup_places WHERE meetup_id=? AND id<>? AND lower(trim(label))=lower(?) AND latitude=? AND longitude=? AND sheltered=?')
        .get(id, placeId, place.label, place.latitude, place.longitude, place.sheltered)) throw communityError('place_already_suggested');
      revision(m, user, 'place');
      // Votes expressed support for the saved destination. A corrected input
      // must be reviewed rather than silently inheriting that support.
      const votesCleared = db.prepare('DELETE FROM meetup_votes WHERE meetup_id=? AND place_id=?').run(id, placeId).changes;
      db.prepare('UPDATE meetup_places SET label=?,latitude=?,longitude=?,sheltered=? WHERE id=? AND meetup_id=?')
        .run(place.label, place.latitude, place.longitude, place.sheltered, placeId, id);
      return { id: placeId, version: m.version + 1, votesCleared };
    }).immediate,
    removePlace: db.transaction((user, id, placeId, expectedVersion) => {
      const m = access(user, id);
      requireVersion(m, expectedVersion);
      writable(m);
      ownedPlace(user, id, placeId);
      if (m.selected_place_id === placeId) throw communityError('meetup_reopen_required');
      revision(m, user, 'place');
      const votesCleared = db.prepare('DELETE FROM meetup_votes WHERE meetup_id=? AND place_id=?').run(id, placeId).changes;
      db.prepare('DELETE FROM meetup_places WHERE id=? AND meetup_id=?').run(placeId, id);
      return { removed: true, id: placeId, version: m.version + 1, votesCleared };
    }).immediate,
    comment: db.transaction((user, id, body) => {
      const m = access(user, id);
      enforcePolicy('discuss', m);
      if (typeof body !== "string" || !body.trim() || body.length > 2000)
        throw communityError("invalid_comment", 400);
      const cid = randomUUID();
      db.prepare(
        "INSERT INTO meetup_comments(id,meetup_id,user_id,body) VALUES(?,?,?,?)",
      ).run(cid, id, user, body.trim());
      notify(m, user, `comment:${cid}`, "New meetup discussion message");
      return { id: cid };
    }).immediate,
    propose: db.transaction((user, id, input = {}) => {
      const m = access(user, id);
      organizer(m, user);
      if (m.version !== input.version)
        throw communityError("stale_meetup_version");
      const ids = participants(m);
      if (input.participationRevision !== undefined && input.participationRevision !== participationRevision(m, ids))
        throw communityError('stale_meetup_membership');
      if (input.acknowledgeNoAvailability !== undefined && typeof input.acknowledgeNoAvailability !== 'boolean')
        throw communityError('invalid_meetup_acknowledgement', 400);
      const start = timestamp(input.startsAt);
      if (
        !Number.isFinite(start) ||
        start < m.starts_at ||
        start + SLOT_MS > m.ends_at ||
        start % SLOT_MS ||
        typeof input.placeId !== "string" ||
        !db
          .prepare("SELECT 1 FROM meetup_places WHERE id=? AND meetup_id=?")
          .get(input.placeId, id)
      )
        throw communityError("invalid_meetup_choice", 400);
      writable(m);
      requireMeetupWindow(input.startsAt, new Date(start + SLOT_MS).toISOString(), concertFor(m));
      const availableCount = db.prepare(`SELECT COUNT(DISTINCT user_id) AS n FROM meetup_availability
        WHERE meetup_id=? AND starts_at<=? AND ends_at>=? AND user_id IN(SELECT value FROM json_each(?))`)
        .get(id, start, start + SLOT_MS, JSON.stringify(ids)).n;
      if (!availableCount && input.acknowledgeNoAvailability !== true)
        throw communityError('meetup_no_availability_acknowledgement_required', 400);
      const required = approvers(m), confirmed = required.length === 1 && required[0] === user;
      const version = m.version + 1;
      db.prepare(
        'UPDATE meetups SET selected_place_id=?,selected_start=?,status=?,version=version+1 WHERE id=?',
      ).run(input.placeId, start, confirmed ? 'confirmed' : 'proposed', id);
      // Deliberately submitting the final plan is the sole organizer's approval.
      // Multiple organizers must still each use their own explicit approval.
      if (confirmed) {
        db.prepare('INSERT INTO meetup_approvals VALUES(?,?,?)').run(id, version, user);
        rememberConfirmation(m, version);
      }
      notify(
        m,
        user,
        `${confirmed ? 'confirmed' : 'proposal'}:${version}`,
        confirmed ? 'Meetup time and place confirmed' : 'A meetup time and place need approval',
      );
      return { version, confirmed };
    }).immediate,
    approve: db.transaction((user, id, version) => {
      const m = access(user, id);
      if (m.version !== version || m.status !== "proposed")
        throw communityError("stale_meetup_version");
      const required = approvers(m);
      enforcePolicy('approve', m, required.includes(user));
      requireMeetupWindow(new Date(m.selected_start).toISOString(),
        new Date(m.selected_start + SLOT_MS).toISOString(), concertFor(m));
      db.prepare("INSERT OR IGNORE INTO meetup_approvals VALUES(?,?,?)").run(
        id,
        version,
        user,
      );
      const approved = db
        .prepare(
          "SELECT user_id FROM meetup_approvals WHERE meetup_id=? AND version=?",
        )
        .all(id, version)
        .map((a) => a.user_id);
      const confirmed = required.every((u) => approved.includes(u));
      if (confirmed) {
        db.prepare("UPDATE meetups SET status='confirmed' WHERE id=?").run(id);
        rememberConfirmation(m, version);
        notify(
          m,
          user,
          `confirmed:${version}`,
          "Meetup time and place confirmed",
        );
      }
      return { confirmed, version, approvals: approved, requiredApprovers: required };
    }).immediate,
    reopen: db.transaction((user, id, version) => {
      const m = access(user, id);
      organizer(m, user);
      if (m.version !== version) throw communityError('stale_meetup_version');
      enforcePolicy('reopen', m);
      db.prepare("UPDATE meetups SET status='planning',selected_place_id=NULL,selected_start=NULL,version=version+1 WHERE id=? AND version=?")
        .run(id, version);
      notify(m, user, `reopened:${version + 1}`, 'An organizer reopened meetup planning; previous approvals no longer apply');
      return { reopened: true, version: version + 1 };
    }).immediate,
    cancel: db.transaction((user, id, version) => {
      const m = access(user, id);
      if (m.version !== version) throw communityError("stale_meetup_version");
      organizer(m, user);
      if (m.status === 'cancelled') return { cancelled: true, unchanged: true };
      db.prepare(
        "UPDATE meetups SET status='cancelled',version=version+1 WHERE id=?",
      ).run(id);
      notify(m, user, `cancelled:${version + 1}`, "A meetup was cancelled");
      return { cancelled: true };
    }).immediate,
  };
}
