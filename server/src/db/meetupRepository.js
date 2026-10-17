import { randomUUID } from "node:crypto";
import { communityError } from "./membershipRepository.js";
import { rankMeetupOptions, SLOT_MS } from "../services/meetupPlanning.js";
export function migrateMeetups(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS meetups(
  id TEXT PRIMARY KEY,creator_id TEXT NOT NULL REFERENCES users(id),party_id TEXT REFERENCES parties(id),
  connection_id TEXT REFERENCES group_connections(id),kaki_conversation_id TEXT REFERENCES conversations(id),
  title TEXT NOT NULL,starts_at INTEGER NOT NULL,ends_at INTEGER NOT NULL,version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'planning' CHECK(status IN('planning','proposed','confirmed','cancelled')),
  selected_place_id TEXT,selected_start INTEGER,
  CHECK((party_id IS NOT NULL)+(connection_id IS NOT NULL)+(kaki_conversation_id IS NOT NULL)=1));
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
  CREATE INDEX IF NOT EXISTS idx_meetup_connection ON meetups(connection_id);`);
}
export const coordinates = (lat, lon) =>
  Number.isFinite(lat) &&
  Math.abs(lat) <= 90 &&
  Number.isFinite(lon) &&
  Math.abs(lon) <= 180;
const timestamp = (value) =>
  typeof value === "string" && /(Z|[+-]\d{2}:\d{2})$/.test(value)
    ? Date.parse(value)
    : NaN;
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
          `/meetups/${m.id}`,
        );
  };
  const revision = (m, user, event) => {
    if (m.status === "cancelled") throw communityError("meetup_cancelled");
    db.prepare(
      "UPDATE meetups SET version=version+1,status='planning',selected_place_id=NULL,selected_start=NULL WHERE id=?",
    ).run(m.id);
    notify(m, user, `${event}:${m.version + 1}`, "Meetup planning was updated");
  };
  const approvers = (m) => {
    if (m.party_id) return [repos.parties.findById(m.party_id).host_user_id];
    if (m.connection_id) {
      const c = db
        .prepare("SELECT * FROM group_connections WHERE id=?")
        .get(m.connection_id);
      return [
        repos.parties.findById(c.party_a_id).host_user_id,
        repos.parties.findById(c.party_b_id).host_user_id,
      ];
    }
    return participants(m);
  };
  return {
    access,
    participants,
    list(user) {
      return db
        .prepare("SELECT * FROM meetups ORDER BY rowid DESC")
        .all()
        .filter((m) => participants(m).includes(user))
        .map((m) => ({
          id: m.id,
          title: m.title,
          status: m.status,
          version: m.version,
        }));
    },
    create: db.transaction((user, input = {}) => {
      const starts = timestamp(input.startsAt),
        ends = timestamp(input.endsAt);
      if (
        !Number.isFinite(starts) ||
        !Number.isFinite(ends) ||
        ends - starts < SLOT_MS ||
        ends - starts > 7 * 86400000 ||
        starts % SLOT_MS ||
        ends % SLOT_MS
      )
        throw communityError("invalid_meetup_window", 400);
      const title = typeof input.title === "string" ? input.title.trim() : "";
      if (!title || title.length > 120)
        throw communityError("invalid_title", 400);
      const scope = {
        party_id: input.partyId ?? null,
        connection_id: input.connectionId ?? null,
        kaki_conversation_id: input.kakiConversationId ?? null,
      };
      if (
        Object.values(scope).filter(Boolean).length !== 1 ||
        Object.values(scope).some((v) => v !== null && typeof v !== "string")
      )
        throw communityError("one_meetup_scope_required", 400);
      if (!participants(scope).includes(user))
        throw communityError("scope_membership_required", 403);
      const id = `meet_${randomUUID()}`;
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
      notify(row(id), user, "created", "A meetup planning board was created");
      return { id };
    }).immediate,
    detail(user, id) {
      const m = access(user, id),
        ids = participants(m);
      const availability = db
        .prepare(`SELECT a.* FROM meetup_availability a WHERE meetup_id=?`)
        .all(id)
        .filter((a) => ids.includes(a.user_id));
      const places = db
        .prepare("SELECT * FROM meetup_places WHERE meetup_id=? ORDER BY rowid")
        .all(id)
        .map((p) => ({
          ...p,
          votes: db.prepare(
            "SELECT user_id FROM meetup_votes WHERE meetup_id=? AND place_id=?",
          ).all(id, p.id).filter((v) => ids.includes(v.user_id)).length,
        }));
      return {
        ...m,
        participantCount: ids.length,
        requiredApprovers: approvers(m),
        approvals: db
          .prepare(
            "SELECT user_id FROM meetup_approvals WHERE meetup_id=? AND version=?",
          )
          .all(id, m.version)
          .map((a) => a.user_id),
        places,
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
        suggestions: rankMeetupOptions({
          startsAt: m.starts_at,
          endsAt: m.ends_at,
          availability,
          places,
          participantCount: ids.length,
        }),
        comments: db
          .prepare(
            `SELECT c.id,c.body,c.created_at AS createdAt,u.display_name AS name FROM meetup_comments c JOIN users u ON u.id=c.user_id WHERE meetup_id=? ORDER BY c.rowid LIMIT 500`,
          )
          .all(id),
      };
    },
    availability: db.transaction((user, id, input) => {
      const m = access(user, id);
      if (!Array.isArray(input) || input.length > 96)
        throw communityError("invalid_availability", 400);
      const rows = input.map((r) => {
        if (!r || typeof r !== "object" || Array.isArray(r))
          throw communityError("invalid_availability", 400);
        const start = timestamp(r.startsAt),
          end = timestamp(r.endsAt);
        const hasCoordinates =
          r.latitude !== undefined || r.longitude !== undefined;
        if (
          !Number.isFinite(start) ||
          !Number.isFinite(end) ||
          start < m.starts_at ||
          end > m.ends_at ||
          end <= start ||
          start % SLOT_MS ||
          end % SLOT_MS ||
          (hasCoordinates && !coordinates(r.latitude, r.longitude))
        )
          throw communityError("invalid_availability", 400);
        return {
          start,
          end,
          latitude: hasCoordinates ? r.latitude : null,
          longitude: hasCoordinates ? r.longitude : null,
          label: typeof r.label === "string" ? r.label.slice(0, 100) : null,
        };
      });
      rows.sort((a, b) => a.start - b.start);
      if (rows.some((r, i) => i && r.start < rows[i - 1].end))
        throw communityError("overlapping_availability", 400);
      revision(m, user, "availability");
      db.prepare(
        "DELETE FROM meetup_availability WHERE meetup_id=? AND user_id=?",
      ).run(id, user);
      const insert = db.prepare("INSERT INTO meetup_availability VALUES(?,?,?,?,?,?,?)");
      for (const r of rows)
        insert.run(
          id,
          user,
          r.start,
          r.end,
          r.latitude,
          r.longitude,
          r.label,
        );
      return { saved: true };
    }).immediate,
    place: db.transaction((user, id, input = {}) => {
      const m = access(user, id);
      if (
        !coordinates(input.latitude, input.longitude) ||
        typeof input.label !== "string" ||
        !input.label.trim() ||
        input.label.length > 150
      )
        throw communityError("invalid_place", 400);
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
        input.label.trim(),
        input.latitude,
        input.longitude,
        input.sheltered === true ? 1 : 0,
      );
      return { id: placeId };
    }).immediate,
    vote: db.transaction((user, id, place) => {
      const m = access(user, id);
      if (
        typeof place !== "string" ||
        !db
          .prepare("SELECT 1 FROM meetup_places WHERE id=? AND meetup_id=?")
          .get(place, id)
      )
        throw communityError("place_not_found", 404);
      revision(m, user, "vote");
      db.prepare(
        "INSERT INTO meetup_votes VALUES(?,?,?) ON CONFLICT(meetup_id,user_id) DO UPDATE SET place_id=excluded.place_id",
      ).run(id, place, user);
      return { voted: true };
    }).immediate,
    comment: db.transaction((user, id, body) => {
      const m = access(user, id);
      if (m.status === "cancelled") throw communityError("meetup_cancelled");
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
      if (m.version !== input.version)
        throw communityError("stale_meetup_version");
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
      if (m.status === "cancelled") throw communityError("meetup_cancelled");
      db.prepare(
        "UPDATE meetups SET selected_place_id=?,selected_start=?,status='proposed',version=version+1 WHERE id=?",
      ).run(input.placeId, start, id);
      notify(
        m,
        user,
        `proposal:${m.version + 1}`,
        "A meetup time and place need approval",
      );
      return { version: m.version + 1 };
    }).immediate,
    approve: db.transaction((user, id, version) => {
      const m = access(user, id);
      if (m.version !== version || m.status !== "proposed")
        throw communityError("stale_meetup_version");
      const required = approvers(m);
      if (!required.includes(user))
        throw communityError("meetup_approver_required", 403);
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
        notify(
          m,
          user,
          `confirmed:${version}`,
          "Meetup time and place confirmed",
        );
      }
      return { confirmed, version };
    }).immediate,
    cancel: db.transaction((user, id, version) => {
      const m = access(user, id);
      if (m.version !== version) throw communityError("stale_meetup_version");
      if (m.creator_id !== user && !approvers(m).includes(user))
        throw communityError("meetup_organizer_required", 403);
      db.prepare(
        "UPDATE meetups SET status='cancelled',version=version+1 WHERE id=?",
      ).run(id);
      notify(m, user, `cancelled:${version + 1}`, "A meetup was cancelled");
      return { cancelled: true };
    }).immediate,
  };
}
