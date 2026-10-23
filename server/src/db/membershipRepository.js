import { randomBytes, createHash, randomUUID } from "node:crypto";
import {
  validateAnswers,
  aggregateAnswers,
  withoutRetired,
} from "../services/discoveryPreferences.js";
import { reservedPlacesSql, availableCapacitySql, expireJoinRequests } from "./capacity.js";
import { groupImageUrl } from "../controllers/groupIdentityController.js";
export const communityError = (message, status = 409) =>
  Object.assign(new Error(message), { status });
/**
 * What counts as having answered. The fill-in-the-blank cards count on their
 * own: somebody who taps through the deck has told us more about who they want
 * to stand with than somebody who ticked one concept chip.
 */
const ANSWER_LISTS = ["about", "wants", "avoid", "quiz"];
const hash = (token) => createHash("sha256").update(token).digest("hex");
export function createMembershipRepo(db, repos) {
  const party = (id) => {
    const p = repos.parties.findById(id);
    if (!p) throw communityError("group_not_found", 404);
    return p;
  };
  const owner = (user, id) => {
    const p = party(id);
    if (p.host_user_id !== user) throw communityError("host_required", 403);
    return p;
  };
  const member = (user, id) =>
    db
      .prepare(
        "SELECT * FROM group_memberships WHERE party_id=? AND user_id=? AND status='active'",
      )
      .get(id, user);
  const active = (user, concert) =>
    db
      .prepare(
        "SELECT * FROM group_memberships WHERE user_id=? AND concert_id=? AND status='active'",
      )
      .get(user, concert);
  const ensureFree = (user, concert, id) => {
    const current = active(user, concert);
    const hosted = db
      .prepare(
        "SELECT id FROM parties WHERE host_user_id=? AND concert_id=? AND status<>'cancelled' AND id<>?",
      )
      .get(user, concert, id);
    if ((current && current.party_id !== id) || hosted)
      throw communityError("already_in_concert_group");
    const pending = db
      .prepare(
        `SELECT 1 FROM active_seat_claims sc WHERE sc.user_id=? AND sc.concert_id=? AND sc.party_id<>?
          AND (sc.status='confirmed' OR(sc.status='proposed' AND sc.expires_at>?))`,
      )
      .get(user, concert, id, Date.now());
    if (pending) throw communityError("active_matching_proposal_exists");
  };
  const userAnswersJson = (user) =>
    db.prepare("SELECT answers_json FROM user_group_preferences WHERE user_id=?").get(user)?.answers_json ?? null;
  /** Copies the user's own preferences into one group; true when they changed. */
  const syncGroupAnswers = (partyId, user, json) => {
    const current = db.prepare("SELECT answers_json FROM group_member_preferences WHERE party_id=? AND user_id=?").get(partyId, user)?.answers_json;
    if (current === json) return false;
    db.prepare(
      `INSERT INTO group_member_preferences(party_id,user_id,answers_json) VALUES(?,?,?)
      ON CONFLICT(party_id,user_id) DO UPDATE SET answers_json=excluded.answers_json,updated_at=datetime('now')`,
    ).run(partyId, user, json);
    return true;
  };
  const attach = (p, user, source) => {
    ensureFree(user, p.concert_id, p.id);
    db.prepare(
      `INSERT INTO group_memberships(party_id,user_id,concert_id,source) VALUES(?,?,?,?)
      ON CONFLICT(party_id,user_id) DO UPDATE SET status='active',source=excluded.source,
      joined_at=CASE WHEN group_memberships.status='active' THEN group_memberships.joined_at ELSE datetime('now') END,left_at=NULL`,
    ).run(p.id, user, p.concert_id, source);
    // Members answer once, on their account; every group they join uses it.
    const own = userAnswersJson(user);
    if (own) syncGroupAnswers(p.id, user, own);
    db.prepare(`UPDATE group_join_requests SET status='superseded',responded_at=datetime('now')
      WHERE user_id=? AND status='pending' AND party_id IN(SELECT id FROM parties WHERE concert_id=?)`)
      .run(user, p.concert_id);
    db.prepare("UPDATE seeker_requests SET matching_opt_in=0 WHERE user_id=? AND concert_id=?")
      .run(user, p.concert_id);
    expireJoinRequests(db);
  };
  const settings = (id) =>
    db.prepare("SELECT * FROM group_settings WHERE party_id=?").get(id);
  const profile = (id) => {
    const rows = db
      .prepare(
        `SELECT pref.answers_json FROM group_memberships m JOIN group_member_preferences pref
      ON pref.party_id=m.party_id AND pref.user_id=m.user_id WHERE m.party_id=? AND m.status='active'`,
      )
      .all(id);
    return aggregateAnswers(rows.map((r) => JSON.parse(r.answers_json)));
  };
  return {
    party,
    owner,
    member,
    active,
    ensureFree,
    attach,
    settings,
    profile,
    /** The user's own group preferences, or null before they have saved any. */
    preferences(user) {
      const json = userAnswersJson(user);
      const answers = json ? withoutRetired(JSON.parse(json)) : null;
      return answers && ANSWER_LISTS.some((k) => answers[k]?.length) ? answers : null;
    },
    savePreferences: db.transaction((user, input) => {
      const answers = validateAnswers(input);
      if (!ANSWER_LISTS.some((k) => answers[k]?.length))
        throw communityError("choose_at_least_one_preference", 400);
      const json = JSON.stringify(answers);
      const previous = userAnswersJson(user);
      db.prepare(
        `INSERT INTO user_group_preferences(user_id,answers_json) VALUES(?,?)
        ON CONFLICT(user_id) DO UPDATE SET answers_json=excluded.answers_json,updated_at=datetime('now')`,
      ).run(user, json);
      if (previous !== json) db.prepare(`UPDATE group_join_requests SET group_version=NULL
        WHERE user_id=? AND status='pending' AND matching_round_id IS NULL`).run(user);
      const groups = db.prepare("SELECT party_id FROM group_memberships WHERE user_id=? AND status='active'").all(user);
      for (const { party_id } of groups)
        if (syncGroupAnswers(party_id, user, json))
          db.prepare("UPDATE group_settings SET version=version+1 WHERE party_id=?").run(party_id);
      const concerts = db.prepare("SELECT concert_id FROM seeker_discovery_preferences WHERE user_id=?").all(user);
      for (const { concert_id } of concerts) repos.recommendations.storePersonal(user, concert_id, json);
      return answers;
    }).immediate,
    activeGroups(user) {
      return db
        .prepare(
          `SELECT p.id,p.concert_id AS concertId,c.artist,c.event_date AS eventDate,p.name,p.image_path,m.source FROM group_memberships m
        JOIN parties p ON p.id=m.party_id JOIN concerts c ON c.id=p.concert_id
        WHERE m.user_id=? AND m.status='active' AND p.status<>'cancelled'
          AND NOT EXISTS(SELECT 1 FROM tickets WHERE source_party_id=p.id) ORDER BY c.event_date,p.id`,
        )
        .all(user)
        .map(({ image_path, ...g }) => ({ ...g, imageUrl: groupImageUrl(image_path) }));
    },
    configure: db.transaction((user, id, input = {}) => {
      expireJoinRequests(db);
      const p = owner(user, id);
      if (p.status === "cancelled") throw communityError("group_unavailable");
      ensureFree(user, p.concert_id, id);
      const expected = input.expectedFriends ?? 0;
      if (!Number.isInteger(expected) || expected < 0 || expected > 100)
        throw communityError("invalid_expected_friends", 400);
      const friends = db
        .prepare(
          "SELECT COUNT(*) n FROM group_memberships WHERE party_id=? AND source='friend' AND status='active'",
        )
        .get(id).n;
      if (expected < friends)
        throw communityError("expected_friends_below_current_members");
      const slots = input.strangerPlaces ?? p.capacity;
      if (!Number.isInteger(slots) || slots < 0 || slots > 1000)
        throw communityError("invalid_stranger_places", 400);
      if (
        slots < db.prepare(`SELECT ${reservedPlacesSql("@id")} n`).get({ id }).n
      )
        throw communityError("places_below_active_reservations");
      const conflicts = db
        .prepare("SELECT user_id FROM membership_conflicts WHERE party_id=?")
        .all(id);
      for (const conflict of conflicts) {
        try {
          ensureFree(conflict.user_id, p.concert_id, id);
        } catch {
          throw communityError("legacy_membership_conflict");
        }
        if (
          conflict.user_id !== user &&
          db
            .prepare(
              `SELECT 1 FROM match_proposals mp JOIN seeker_requests s ON s.id=mp.seeker_request_id
          WHERE mp.party_id=? AND s.user_id=? AND mp.status='confirmed'`,
            )
            .get(id, conflict.user_id)
        )
          attach(p, conflict.user_id, "proposal");
      }
      db.prepare("DELETE FROM membership_conflicts WHERE party_id=?").run(id);
      attach(p, user, "host");
      db.prepare(
        `INSERT INTO group_settings(party_id,expected_friends) VALUES(?,?)
        ON CONFLICT(party_id) DO UPDATE SET expected_friends=excluded.expected_friends,published=0,version=version+1`,
      ).run(id, expected);
      db.prepare(
        "UPDATE group_settings SET stranger_slots=? WHERE party_id=?",
      ).run(slots, id);
      if (p.status === "matched" && slots > db.prepare(`SELECT ${reservedPlacesSql("@id")} n`).get({ id }).n)
        repos.parties.setStatus(id, "open");
      return settings(id);
    }).immediate,
    saveAnswers: db.transaction((user, id, input) => {
      if (!member(user, id)) throw communityError("group_member_required", 403);
      const answers = validateAnswers(input);
      db.prepare(
        `INSERT INTO group_member_preferences VALUES(?,?,?,datetime('now'))
        ON CONFLICT(party_id,user_id) DO UPDATE SET answers_json=excluded.answers_json,updated_at=excluded.updated_at`,
      ).run(id, user, JSON.stringify(answers));
      db.prepare(
        "UPDATE group_settings SET version=version+1 WHERE party_id=?",
      ).run(id);
      return profile(id);
    }).immediate,
    detail(user, id) {
      const p = party(id);
      if (p.host_user_id !== user && !member(user, id))
        throw communityError("group_member_required", 403);
      const members = db
        .prepare(
          `SELECT m.user_id AS id,u.display_name AS name,m.source,
        pref.answers_json IS NOT NULL AS answered FROM group_memberships m JOIN users u ON u.id=m.user_id
        LEFT JOIN group_member_preferences pref ON pref.party_id=m.party_id AND pref.user_id=m.user_id
        WHERE m.party_id=? AND m.status='active' ORDER BY m.joined_at,m.user_id`,
        )
        .all(id);
      return {
        partyId: id,
        hostId: p.host_user_id,
        concertId: p.concert_id,
        artist: repos.concerts.findById(p.concert_id)?.artist ?? null,
        status: p.status,
        remainingCapacity: p.remaining_capacity,
        name: p.name,
        imageUrl: groupImageUrl(p.image_path),
        strangerPlaces: p.capacity,
        settings: settings(id),
        members,
        profile: profile(id),
        myAnswers: withoutRetired(JSON.parse(
          db
            .prepare(
              "SELECT answers_json FROM group_member_preferences WHERE party_id=? AND user_id=?",
            )
            .get(id, user)?.answers_json ?? "{}",
        )),
      };
    },
    publish: db.transaction((user, id, input = {}) => {
      const p = owner(user, id),
        s = settings(id);
      if (!s || p.status === "cancelled")
        throw communityError("group_unavailable");
      const detail = repos.membership.detail(user, id);
      const friends = detail.members.filter(
        (m) => m.source === "friend",
      ).length;
      if (
        friends !== s.expected_friends ||
        detail.members.some((m) => !m.answered)
      )
        throw communityError("members_or_preferences_incomplete");
      db.prepare(
        "UPDATE group_settings SET published=1,connect_open=? WHERE party_id=?",
      ).run(input.connectOpen === true ? 1 : 0, id);
      return settings(id);
    }).immediate,
    invite: db.transaction((user, id) => {
      const p = owner(user, id),
        s = settings(id);
      if (!s || p.status === "cancelled")
        throw communityError("configure_group_first");
      const token = randomBytes(32).toString("hex"),
        inviteId = `fi_${randomUUID()}`;
      db.prepare(
        "INSERT INTO group_friend_invites(id,party_id,token_hash,expires_at) VALUES(?,?,?,?)",
      ).run(inviteId, id, hash(token), Date.now() + 7 * 86400000);
      return {
        id: inviteId,
        token,
        path: `/groups/invite/${token}`,
        expiresInDays: 7,
      };
    }).immediate,
    acceptInvite: db.transaction((user, token) => {
      if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token))
        throw communityError("invitation_not_found", 404);
      const invite = db
        .prepare("SELECT * FROM group_friend_invites WHERE token_hash=?")
        .get(hash(token));
      if (!invite || invite.revoked || invite.expires_at <= Date.now())
        throw communityError("invitation_unavailable");
      if (invite.accepted_by) {
        if (invite.accepted_by === user) return { partyId: invite.party_id };
        throw communityError("invitation_used");
      }
      const p = party(invite.party_id),
        s = settings(p.id);
      if (p.status === "cancelled" || !s)
        throw communityError("group_unavailable");
      if (member(user, p.id)) throw communityError("already_group_member");
      // A friend invitation must not bypass an unresolved stranger-place offer,
      // even when both entry paths lead to this same group.
      ensureFree(user, p.concert_id, "");
      const blocks = repos.users.blocklist();
      const members = db.prepare(
        "SELECT user_id FROM group_memberships WHERE party_id=? AND status='active'",
      ).all(p.id);
      if (
        [p.host_user_id, ...members.map((m) => m.user_id)].some((id) =>
          blocks.has(`${user}:${id}`) || blocks.has(`${id}:${user}`),
        )
      )
        throw communityError("blocked_pair", 403);
      const friends = db
        .prepare(
          "SELECT COUNT(*) n FROM group_memberships WHERE party_id=? AND source='friend' AND status='active'",
        )
        .get(p.id).n;
      if (friends >= s.expected_friends)
        throw communityError("friend_places_full");
      attach(p, user, "friend");
      db.prepare(
        "UPDATE group_friend_invites SET accepted_by=?,accepted_at=datetime('now') WHERE id=?",
      ).run(user, invite.id);
      db.prepare(
        "UPDATE group_settings SET published=0,version=version+1 WHERE party_id=?",
      ).run(p.id);
      return { partyId: p.id };
    }).immediate,
    leave: db.transaction((user, id) => {
      const p = party(id);
      if (p.host_user_id === user)
        throw communityError("host_must_cancel_group");
      if (!member(user, id)) throw communityError("group_member_required", 403);
      db.prepare(
        "UPDATE group_memberships SET status='left',left_at=datetime('now') WHERE party_id=? AND user_id=?",
      ).run(id, user);
      db.prepare(
        "UPDATE group_settings SET published=0,version=version+1 WHERE party_id=?",
      ).run(id);
      db.prepare(
        `UPDATE match_proposals SET status='cancelled' WHERE party_id=? AND seeker_request_id IN
        (SELECT id FROM seeker_requests WHERE user_id=?) AND status IN('proposed','confirmed')`,
      ).run(id, user);
      if (p.status === "matched") {
        const capacity = db.prepare(`SELECT ${availableCapacitySql()} n FROM parties p WHERE p.id=?`).get(id).n;
        const reserved = db.prepare(`SELECT ${reservedPlacesSql('@id')} n`).get({ id }).n;
        repos.parties.setStatus(id, reserved >= capacity ? "matched" : "open");
      }
      db.prepare(
        "UPDATE seeker_requests SET status='withdrawn',matching_opt_in=0 WHERE user_id=? AND concert_id=?",
      ).run(user, p.concert_id);
      return { left: true };
    }).immediate,
    cancel: db.transaction((user, id) => {
      const p = owner(user, id);
      db.prepare(
        `UPDATE seeker_requests SET status='open' WHERE concert_id=? AND user_id IN
        (SELECT user_id FROM group_memberships WHERE party_id=? AND source='join' AND status='active')`,
      ).run(p.concert_id, id);
      db.prepare("UPDATE parties SET status='cancelled' WHERE id=?").run(id);
      db.prepare(
        "UPDATE group_memberships SET status='left',left_at=datetime('now') WHERE party_id=? AND status='active'",
      ).run(id);
      db.prepare(
        "UPDATE seeker_requests SET status='open' WHERE id IN(SELECT seeker_request_id FROM match_proposals WHERE party_id=? AND status IN('proposed','confirmed'))",
      ).run(id);
      db.prepare(
        "UPDATE match_proposals SET status='cancelled' WHERE party_id=? AND status IN('proposed','confirmed')",
      ).run(id);
      db.prepare(
        "UPDATE group_join_requests SET status='cancelled',responded_at=datetime('now') WHERE party_id=? AND status IN('pending','accepted')",
      ).run(id);
      db.prepare(
        "UPDATE group_friend_invites SET revoked=1 WHERE party_id=?",
      ).run(id);
      db.prepare(
        "UPDATE group_settings SET published=0,version=version+1 WHERE party_id=?",
      ).run(id);
      return { cancelled: true, concertId: p.concert_id };
    }).immediate,
  };
}
