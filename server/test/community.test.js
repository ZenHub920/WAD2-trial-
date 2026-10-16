import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "../src/db/connection.js";
import { createRepositories } from "../src/db/repositories.js";
import { createMatchingService } from "../src/services/matchingService.js";
import { makeUser, makeParty, makeSeeker } from "./helpers.js";
import {
  validateAnswers,
  aggregateAnswers,
  compareProfiles,
} from "../src/services/discoveryPreferences.js";
import { createMeetupWeather } from "../src/services/meetupWeather.js";
import { migrateCommunity } from "../src/db/communityMigrations.js";
import { migrateNotifications } from "../src/db/notificationRepository.js";
import { migrateMeetups } from "../src/db/meetupRepository.js";
import { migrateFeedback } from "../src/db/feedbackRepository.js";
let db, repos;
beforeEach(() => {
  db = createTestDb();
  repos = createRepositories(db);
  for (const id of ["h1", "h2", "friend", "seeker", "outsider"])
    repos.users.create(makeUser(id));
  repos.concerts.create({
    id: "c1",
    artist: "Act",
    venue: "Venue",
    city: "Singapore",
    event_date: "2020-01-01",
  });
  repos.parties.create(makeParty("p1", makeUser("h1"), { capacity: 2 }));
  repos.parties.create(makeParty("p2", makeUser("h2"), { capacity: 2 }));
  repos.seekers.create(makeSeeker("s1", makeUser("seeker")));
});
afterEach(() => db.close());
const answers = {
  about: ["supper", "singalong"],
  wants: ["post concert food"],
  avoid: [],
};
test("one host per concert and one active membership are enforced without removing history", () => {
  assert.throws(
    () => repos.parties.create(makeParty("duplicate", makeUser("h1"))),
    /already_in_concert_group/,
  );
  repos.membership.configure("h1", "p1", { expectedFriends: 1 });
  const invite = repos.membership.invite("h1", "p1");
  repos.membership.acceptInvite("friend", invite.token);
  assert.throws(
    () => repos.membership.configure("friend", "p2"),
    /host_required/,
  );
  assert.throws(
    () => repos.parties.create(makeParty("friendHosted", makeUser("friend"))),
    /already_in_concert_group/,
  );
  assert.equal(repos.membership.detail("friend", "p1").members.length, 2);
  repos.membership.leave("friend", "p1");
  assert.equal(
    db
      .prepare("SELECT status FROM group_memberships WHERE user_id='friend'")
      .get().status,
    "left",
  );
});
test("friend links are single use, expiring and hashed; publication waits for all responses", () => {
  repos.membership.configure("h1", "p1", { expectedFriends: 1 });
  const invite = repos.membership.invite("h1", "p1");
  assert.notEqual(
    db.prepare("SELECT token_hash FROM group_friend_invites").get().token_hash,
    invite.token,
  );
  assert.throws(() => repos.membership.publish("h1", "p1"), /incomplete/);
  repos.membership.acceptInvite("friend", invite.token);
  assert.throws(
    () => repos.membership.acceptInvite("outsider", invite.token),
    /used/,
  );
  repos.membership.saveAnswers("h1", "p1", answers);
  repos.membership.saveAnswers("friend", "p1", {
    about: ["quiet"],
    wants: ["supper"],
    avoid: [],
  });
  assert.equal(
    repos.membership.publish("h1", "p1", { connectOpen: true }).published,
    1,
  );
  const profile = repos.membership.profile("p1");
  assert.equal(profile.about.post_supper, 0.5);
  assert.equal(profile.wants.post_supper, 1);
  assert.throws(
    () => repos.membership.saveAnswers("outsider", "p1", answers),
    /member_required/,
  );
});
test("custom terms keep originals, aliases deduplicate and unknown terms never become hard constraints", () => {
  const parsed = validateAnswers({
    about: ["supper", "late-night makan", "Rare custom interest"],
    wants: ["supper"],
    avoid: [],
  });
  assert.equal(parsed.about.length, 2);
  assert.equal(parsed.about[0].key, "post_supper");
  assert.equal(parsed.about[1].recognized, false);
  const result = compareProfiles(
    aggregateAnswers([parsed]),
    aggregateAnswers([parsed]),
  );
  assert.equal(result.score, 1);
  assert.ok(result.reasons.some((r) => r.concept === "post_supper"));
  assert.throws(
    () => validateAnswers({ about: [{ text: "x", conceptId: "invented" }] }),
    /unknown_concept/,
  );
});
test("recommendations use member answers, preserve opposite intent, and publish only completed groups", () => {
  repos.membership.configure("h1", "p1", { expectedFriends: 0 });
  repos.membership.saveAnswers("h1", "p1", answers);
  repos.recommendations.savePersonal("seeker", "c1", answers);
  assert.ok(
    !repos.recommendations
      .individual("seeker", "c1")
      .some((g) => g.id === "p1"),
  );
  repos.membership.publish("h1", "p1", { connectOpen: true });
  assert.equal(
    createMatchingService({ db, repos })
      .preview("c1")
      .profile.capacities.has("p1"),
    false,
  );
  const g = repos.recommendations
    .individual("seeker", "c1")
    .find((g) => g.id === "p1");
  assert.ok(g.reasons.some((r) => r.concept === "post_supper"));
  const negative = compareProfiles(
    aggregateAnswers([
      validateAnswers({ about: ["singalong"], avoid: ["supper"] }),
    ]),
    repos.membership.profile("p1"),
  );
  assert.ok(negative.score < 1);
});
test("seeker chooses once and receiving host approves atomically without a second seeker response", () => {
  repos.membership.configure("h1", "p1", { expectedFriends: 0 });
  repos.membership.saveAnswers("h1", "p1", answers);
  repos.membership.publish("h1", "p1");
  repos.recommendations.savePersonal("seeker", "c1", answers);
  const request = repos.recommendations.requestJoin("seeker", "p1");
  assert.equal(repos.parties.findById("p1").remaining_capacity, 2);
  assert.throws(
    () => repos.recommendations.respond("seeker", request.id, "accept"),
    /request_not_found/,
  );
  assert.equal(
    repos.recommendations.respond("h1", request.id, "accept").status,
    "accepted",
  );
  assert.equal(repos.membership.active("seeker", "c1").party_id, "p1");
  assert.equal(repos.parties.findById("p1").remaining_capacity, 1);
  assert.throws(
    () => repos.recommendations.respond("h1", request.id, "accept"),
    /not_pending/,
  );
  assert.throws(
    () => repos.recommendations.requestJoin("seeker", "p2"),
    /already_in_concert_group/,
  );
  assert.deepEqual(db.pragma("foreign_key_check"), []);
});
test("notification hooks are persistent, recipient scoped, deduplicated and obey preferences", () => {
  repos.notifications.chatMessage({
    messageId: "m1",
    conversationPath: "/groups/p1/members",
    senderId: "h1",
    recipientIds: ["h1", "friend", "friend"],
  });
  repos.notifications.chatMessage({
    messageId: "m1",
    conversationPath: "/groups/p1/members",
    senderId: "h1",
    recipientIds: ["friend"],
  });
  assert.equal(repos.notifications.unread("friend"), 1);
  assert.equal(repos.notifications.unread("h1"), 0);
  const n = repos.notifications.list("friend")[0];
  assert.throws(() => repos.notifications.read("outsider", n.id), /not_found/);
  repos.notifications.read("friend", n.id);
  assert.equal(repos.notifications.unread("friend"), 0);
  repos.notifications.setSettings("friend", { chat: false });
  repos.notifications.chatMessage({
    messageId: "m2",
    conversationPath: "/groups/p1/members",
    senderId: "h1",
    recipientIds: ["friend"],
  });
  assert.equal(repos.notifications.list("friend").length, 1);
  assert.throws(
    () => repos.notifications.setSettings("friend", { chat: "yes" }),
    /invalid/,
  );
});
test("join request notifications and business writes share transaction rollback", () => {
  const operation = db.transaction(() => {
    repos.recommendations.requestJoin("seeker", "p1");
    throw new Error("rollback");
  });
  assert.throws(operation, /rollback/);
  assert.equal(repos.notifications.unread("h1"), 0);
  repos.recommendations.requestJoin("seeker", "p1");
  assert.equal(repos.notifications.unread("h1"), 1);
});
const windowInput = {
  title: "Meet before show",
  partyId: "p1",
  startsAt: "2030-01-01T10:00:00+08:00",
  endsAt: "2030-01-01T12:00:00+08:00",
};
test("meetup availability and private locations produce real-place recommendations with versioned approval", () => {
  repos.membership.configure("h1", "p1", { expectedFriends: 1 });
  const link = repos.membership.invite("h1", "p1");
  repos.membership.acceptInvite("friend", link.token);
  const { id } = repos.meetups.create("h1", windowInput);
  repos.meetups.availability("h1", id, [
    {
      startsAt: windowInput.startsAt,
      endsAt: windowInput.endsAt,
      latitude: 1.3,
      longitude: 103.8,
    },
  ]);
  repos.meetups.availability("friend", id, [
    {
      startsAt: windowInput.startsAt,
      endsAt: "2030-01-01T11:00:00+08:00",
      latitude: 1.31,
      longitude: 103.81,
    },
  ]);
  const place = repos.meetups.place("friend", id, {
    label: "MRT entrance",
    latitude: 1.305,
    longitude: 103.805,
    sheltered: true,
  });
  const detail = repos.meetups.detail("h1", id);
  assert.equal(detail.suggestions[0].availableCount, 2);
  assert.equal(detail.availability.length, 1);
  assert.ok(detail.availability.every((a) => a.user_id === "h1"));
  assert.throws(() => repos.meetups.detail("outsider", id), /not_found/);
  const proposed = repos.meetups.propose("friend", id, {
    version: detail.version,
    placeId: place.id,
    startsAt: windowInput.startsAt,
  });
  assert.throws(
    () => repos.meetups.approve("friend", id, proposed.version),
    /approver_required/,
  );
  assert.equal(
    repos.meetups.approve("h1", id, proposed.version).confirmed,
    true,
  );
  repos.meetups.comment("friend", id, "Can we meet by the lift?");
  assert.equal(repos.meetups.detail("h1", id).comments.length, 1);
  repos.meetups.vote("friend", id, place.id);
  assert.throws(
    () => repos.meetups.approve("h1", id, proposed.version),
    /stale/,
  );
  repos.membership.leave("friend", "p1");
  assert.throws(() => repos.meetups.detail("friend", id), /not_found/);
});
test("connected groups require both hosts to approve and never expose locations to unrelated users", () => {
  const c = repos.groups.invite("h1", "p1", "p2");
  repos.groups.respond("h2", c.id, "accept");
  const { id } = repos.meetups.create("h1", {
    ...windowInput,
    partyId: undefined,
    connectionId: c.id,
  });
  const place = repos.meetups.place("h1", id, {
    label: "Cafe",
    latitude: 1.3,
    longitude: 103.8,
  });
  const m = repos.meetups.detail("h1", id);
  const p = repos.meetups.propose("h1", id, {
    version: m.version,
    placeId: place.id,
    startsAt: windowInput.startsAt,
  });
  assert.equal(repos.meetups.approve("h1", id, p.version).confirmed, false);
  assert.equal(repos.meetups.approve("h2", id, p.version).confirmed, true);
  repos.users.block("h1", "h2");
  assert.throws(() => repos.meetups.detail("h2", id), /not_found/);
});
test("weather warns only for the covered time and degrades safely on errors", async () => {
  const now = Date.parse("2030-01-01T10:00:00+08:00");
  let calls = 0;
  const weather = createMeetupWeather({
    now: () => now,
    fetchImpl: async () => {
      calls++;
      return {
        ok: true,
        json: async () => ({
          code: 0,
          data: {
            area_metadata: [
              {
                name: "City",
                label_location: { latitude: 1.3, longitude: 103.8 },
              },
            ],
            items: [
              {
                valid_period: {
                  start: "2030-01-01T10:00:00+08:00",
                  end: "2030-01-01T12:00:00+08:00",
                },
                forecasts: [{ area: "City", forecast: "Thundery Showers" }],
              },
            ],
          },
        }),
      };
    },
  });
  assert.equal(
    (await weather.forecast({ latitude: 1.3, longitude: 103.8, startsAt: now }))
      .rainWarning,
    true,
  );
  await weather.forecast({ latitude: 1.3, longitude: 103.8, startsAt: now });
  assert.equal(calls, 1);
  assert.equal(
    (
      await weather.forecast({
        latitude: 1.3,
        longitude: 103.8,
        startsAt: now + 86400000,
      })
    ).status,
    "unavailable",
  );
  const offline = createMeetupWeather({
    now: () => now,
    fetchImpl: async () => {
      throw new Error("offline");
    },
  });
  assert.equal(
    (await offline.forecast({ latitude: 1.3, longitude: 103.8, startsAt: now }))
      .status,
    "unavailable",
  );
});
test("post-event feedback requires genuine co-membership, rejects duplicates and refreshes reliability", () => {
  repos.membership.configure("h1", "p1", { expectedFriends: 1 });
  const link = repos.membership.invite("h1", "p1");
  repos.membership.acceptInvite("friend", link.token);
  db.prepare(
    "UPDATE parties SET created_at='2019-12-01 00:00:00' WHERE id='p1'",
  ).run();
  db.prepare(
    "UPDATE group_memberships SET joined_at='2019-12-01 00:00:00' WHERE party_id='p1'",
  ).run();
  const input = {
    partyId: "p1",
    ratedUserId: "friend",
    showedUp: true,
    rating: 5,
    comment: "Great communication",
  };
  assert.throws(
    () => repos.feedback.submit("outsider", input),
    /participants_required/,
  );
  assert.equal(repos.feedback.submit("h1", input).submitted, true);
  assert.ok(repos.users.findById("friend").reliability > 0.75);
  assert.throws(() => repos.feedback.submit("h1", input), /already_submitted/);
  assert.equal(repos.feedback.mine("outsider").length, 0);
  assert.equal(repos.feedback.mine("friend").length, 1);
  assert.throws(
    () => repos.feedback.submit("friend", { ...input, ratedUserId: "friend" }),
    /invalid_feedback/,
  );
});
test("feedback cannot be manufactured by joining after a concert", () => {
  repos.membership.configure("h1", "p1", { expectedFriends: 1 });
  const link = repos.membership.invite("h1", "p1");
  repos.membership.acceptInvite("friend", link.token);
  assert.throws(
    () =>
      repos.feedback.submit("h1", {
        partyId: "p1",
        ratedUserId: "friend",
        showedUp: true,
        rating: 5,
      }),
    /participants_required/,
  );
});
test("friends-only groups allow zero stranger places and still connect socially", () => {
  for (const [host, party] of [
    ["h1", "p1"],
    ["h2", "p2"],
  ]) {
    repos.membership.configure(host, party, {
      expectedFriends: 0,
      strangerPlaces: 0,
    });
    repos.membership.saveAnswers(host, party, answers);
    repos.membership.publish(host, party, { connectOpen: true });
  }
  assert.equal(repos.parties.findById("p1").capacity, 0);
  assert.equal(repos.parties.findById("p1").remaining_capacity, 0);
  assert.equal(repos.recommendations.individual("seeker", "c1").length, 0);
  assert.equal(repos.recommendations.groups("h1", "c1", "p1").length, 1);
  assert.equal(repos.groups.invite("h1", "p1", "p2").status, "pending");
});
test("member blocks cannot be bypassed by posting a connection invitation directly", () => {
  repos.membership.configure("h1", "p1", { expectedFriends: 1 });
  const invitation = repos.membership.invite("h1", "p1");
  repos.membership.acceptInvite("friend", invitation.token);
  for (const u of ["h1", "friend"])
    repos.membership.saveAnswers(u, "p1", answers);
  repos.membership.publish("h1", "p1", { connectOpen: true });
  repos.membership.configure("h2", "p2", { expectedFriends: 0 });
  repos.membership.saveAnswers("h2", "p2", answers);
  repos.membership.publish("h2", "p2", { connectOpen: true });
  repos.users.block("friend", "h2");
  assert.equal(repos.groups.invite("h1", "p1", "p2").error, "blocked_pair");
  assert.equal(repos.recommendations.groups("h1", "c1", "p1").length, 0);
});
test("all community migrations repeat without discarding preferences, members or feedback", () => {
  repos.membership.configure("h1", "p1", { expectedFriends: 0 });
  repos.membership.saveAnswers("h1", "p1", answers);
  const before = db.prepare("SELECT * FROM group_member_preferences").all();
  for (let i = 0; i < 2; i++) {
    migrateCommunity(db);
    migrateNotifications(db);
    migrateMeetups(db);
    migrateFeedback(db);
  }
  assert.deepEqual(
    db.prepare("SELECT * FROM group_member_preferences").all(),
    before,
  );
  assert.equal(repos.membership.active("h1", "c1").party_id, "p1");
  assert.deepEqual(db.pragma("foreign_key_check"), []);
});
test("only one pending choice per concert is permitted; withdrawal can reopen and rejection remains final", () => {
  const first = repos.recommendations.requestJoin("seeker", "p1");
  assert.throws(
    () => repos.recommendations.requestJoin("seeker", "p2"),
    /withdraw_current/,
  );
  repos.recommendations.respond("seeker", first.id, "withdraw");
  const reopened = repos.recommendations.requestJoin("seeker", "p1");
  assert.equal(reopened.id, first.id);
  assert.equal(
    db
      .prepare(
        "SELECT COUNT(*) n FROM group_join_request_events WHERE request_id=?",
      )
      .get(first.id).n,
    3,
  );
  repos.recommendations.respond("h1", first.id, "reject");
  assert.ok(repos.proposals.declinedPairsForConcert("c1").has("s1|p1"));
  assert.throws(
    () => repos.recommendations.requestJoin("seeker", "p1"),
    /previously_declined/,
  );
});
test("changed group preferences require renewed seeker choice before host approval", () => {
  repos.membership.configure("h1", "p1", { expectedFriends: 0 });
  repos.membership.saveAnswers("h1", "p1", answers);
  repos.membership.publish("h1", "p1");
  repos.recommendations.savePersonal("seeker", "c1", answers);
  const request = repos.recommendations.requestJoin("seeker", "p1");
  repos.membership.saveAnswers("h1", "p1", {
    about: ["quiet"],
    wants: ["quiet"],
    avoid: [],
  });
  assert.throws(
    () => repos.recommendations.respond("h1", request.id, "accept"),
    /group_changed/,
  );
  assert.ok(
    repos.notifications.list("seeker").some((n) => n.title.includes("changed")),
  );
  repos.recommendations.respond("seeker", request.id, "withdraw");
  repos.recommendations.requestJoin("seeker", "p1");
  assert.equal(
    repos.recommendations.respond("h1", request.id, "accept").status,
    "accepted",
  );
});
test("legacy duplicate groups remain intact and can be explicitly reconciled by cancellation", () => {
  db.exec("DROP TRIGGER one_host_group_insert");
  repos.parties.create(makeParty("legacyDuplicate", makeUser("h1")));
  migrateCommunity(db);
  assert.equal(
    db.prepare("SELECT COUNT(*) n FROM parties WHERE host_user_id='h1'").get()
      .n,
    2,
  );
  assert.ok(
    db
      .prepare("SELECT COUNT(*) n FROM membership_conflicts WHERE user_id='h1'")
      .get().n > 0,
  );
  assert.throws(
    () => repos.membership.configure("h1", "p1", { expectedFriends: 0 }),
    /already_in_concert_group/,
  );
  repos.membership.cancel("h1", "legacyDuplicate");
  repos.membership.configure("h1", "p1", { expectedFriends: 0 });
  assert.equal(repos.membership.active("h1", "c1").party_id, "p1");
  assert.deepEqual(db.pragma("foreign_key_check"), []);
});
