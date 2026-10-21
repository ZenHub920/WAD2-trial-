import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "../src/db/connection.js";
import { createRepositories } from "../src/db/repositories.js";
import { migrateCommunity } from "../src/db/communityMigrations.js";
import { makeUser, makeParty, makeSeeker } from "./helpers.js";

let db, repos;
const answers = { about: ["supper"], wants: ["singalong"], avoid: [] };
function optIn(user) {
  db.prepare("UPDATE seeker_requests SET matching_opt_in=1 WHERE user_id=?").run(user);
}
function automatic(user, party = "p1", round = "r1") {
  optIn(user);
  return repos.recommendations.requestJoin(user, party, { matchingRoundId: round });
}
function row(id) {
  return db.prepare("SELECT * FROM group_join_requests WHERE id=?").get(id);
}
function remaining() {
  return repos.parties.findById("p1").remaining_capacity;
}
beforeEach(() => {
  db = createTestDb();
  repos = createRepositories(db);
  for (const user of ["host", "otherHost", "friend", "one", "two", "three", "four"])
    repos.users.create(makeUser(user));
  repos.concerts.create({
    id: "c1", artist: "Act", venue: "Venue", city: "Singapore", event_date: "2030-01-01",
  });
  for (const [party, host] of [["p1", "host"], ["p2", "otherHost"]]) {
    repos.parties.create(makeParty(party, makeUser(host), { capacity: 3 }));
    repos.membership.configure(host, party, { strangerPlaces: 3 });
    repos.membership.saveAnswers(host, party, answers);
    repos.membership.publish(host, party);
  }
  for (const user of ["one", "two", "three", "four"]) {
    repos.seekers.create(makeSeeker(`s_${user}`, makeUser(user)));
    repos.recommendations.savePersonal(user, "c1", answers);
  }
  db.exec(`INSERT INTO match_rounds(id,concert_id,is_stable,seeker_count,party_count,total_capacity,
    feasible_pairs,matched_count,metrics_json,timings_json)
    VALUES('r1','c1',1,4,2,6,8,4,'{}','{}'),('r2','c1',1,4,2,6,8,4,'{}','{}')`);
});
afterEach(() => db.close());

test("migration preserves manual requests and never infers automatic matching consent", () => {
  const manual = repos.recommendations.requestJoin("one", "p1");
  const before = row(manual.id);
  migrateCommunity(db);
  migrateCommunity(db);
  assert.deepEqual(row(manual.id), before);
  assert.equal(before.matching_round_id, null);
  assert.equal(repos.groups.seeker("one", "c1").matching_opt_in, false);
  assert.equal(remaining(), 3);
  assert.throws(() => repos.recommendations.requestJoin("two", "p1", { matchingRoundId: "r1" }), /consent_required/);
  assert.equal(db.prepare("PRAGMA foreign_key_list(group_join_requests)").all()
    .some((fk) => fk.from === "matching_round_id" && fk.table === "match_rounds"), true);
});

test("pending algorithm assignments reserve stranger slots alongside direct members, not hosts or friends", () => {
  repos.membership.configure("host", "p1", { strangerPlaces: 3, expectedFriends: 1 });
  const invite = repos.membership.invite("host", "p1");
  repos.membership.acceptInvite("friend", invite.token);
  repos.membership.saveAnswers("friend", "p1", answers);
  repos.membership.publish("host", "p1");
  assert.equal(remaining(), 3);
  optIn("one");
  const manual = repos.recommendations.requestJoin("one", "p1");
  assert.equal(repos.groups.seeker("one", "c1").matching_opt_in, false);
  assert.equal(remaining(), 3);
  repos.recommendations.respond("host", manual.id, "accept");
  assert.equal(remaining(), 2);
  const second = automatic("two"), third = automatic("three");
  assert.equal(remaining(), 0);
  assert.throws(() => automatic("four"), /group_unavailable/);
  assert.throws(() => repos.membership.configure("host", "p1", { strangerPlaces: 2, expectedFriends: 1 }), /below_active_reservations/);
  const version = repos.membership.settings("p1").version;
  repos.recommendations.respond("host", second.id, "accept");
  assert.equal(remaining(), 0);
  assert.equal(row(third.id).group_version, version);
  repos.recommendations.respond("host", third.id, "accept");
  assert.equal(remaining(), 0);
  assert.equal(repos.membership.settings("p1").version, version);
  assert.equal(repos.parties.findById("p1").status, "matched");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM group_memberships WHERE party_id='p1' AND source='join' AND status='active'").get().n, 3);
  assert.throws(() => repos.recommendations.respond("host", second.id, "accept"), /not_pending/);
  assert.equal(repos.groups.seeker("two", "c1").matching_opt_in, false);
  const details = repos.recommendations.requests("three").find((r) => r.id === third.id);
  assert.equal(details.matchingRoundId, "r1");
  assert.equal(details.hostName, "User host");
  assert.equal(details.section, "ga_standing");
});

test("an assigned request can be approved against its own full reservation", () => {
  repos.membership.configure("host", "p1", { strangerPlaces: 1 });
  repos.membership.publish("host", "p1");
  const request = automatic("one");
  repos.parties.setStatus("p1", "matched");
  assert.equal(remaining(), 0);
  repos.recommendations.respond("host", request.id, "accept");
  assert.equal(row(request.id).status, "accepted");
  assert.equal(remaining(), 0);
  assert.equal(repos.membership.active("one", "c1").party_id, "p1");
});

test("expiry, withdrawal and rejection release reservations with correct consent and decline history", () => {
  const first = automatic("one");
  db.prepare("UPDATE group_join_requests SET expires_at=0 WHERE id=?").run(first.id);
  repos.parties.setStatus("p1", "matched");
  assert.equal(remaining(), 3);
  assert.equal(repos.recommendations.expire(), 1);
  assert.equal(row(first.id).status, "expired");
  assert.equal(repos.parties.findById("p1").status, "open");
  assert.equal(repos.groups.seeker("one", "c1").matching_opt_in, true);
  const renewed = automatic("one", "p1", "r2");
  assert.equal(renewed.id, first.id);
  assert.equal(row(first.id).matching_round_id, "r2");
  repos.recommendations.respond("one", renewed.id, "withdraw");
  assert.equal(remaining(), 3);
  assert.equal(repos.groups.seeker("one", "c1").matching_opt_in, false);
  const declined = automatic("two");
  repos.recommendations.respond("host", declined.id, "reject");
  assert.equal(remaining(), 3);
  assert.equal(repos.groups.seeker("two", "c1").matching_opt_in, true);
  assert.equal(repos.proposals.declinedPairsForConcert("c1").has("s_two|p1"), true);
  assert.throws(() => automatic("two"), /previously_declined/);
  const other = automatic("two", "p2");
  assert.equal(row(other.id).status, "pending");
});

test("actual preference changes still invalidate consent and cannot be bypassed by algorithm origin", () => {
  const request = automatic("one");
  repos.recommendations.savePersonal("one", "c1", { about: ["quiet"], wants: [], avoid: [] });
  assert.throws(() => repos.recommendations.respond("host", request.id, "accept"), /preferences_changed/);
  assert.equal(row(request.id).status, "pending");
  repos.recommendations.respond("one", request.id, "withdraw");
  const renewed = automatic("one", "p1", "r2");
  repos.membership.saveAnswers("host", "p1", { about: ["quiet"], wants: [], avoid: [] });
  assert.throws(() => repos.recommendations.respond("host", renewed.id, "accept"), /group_changed/);
  assert.equal(repos.membership.active("one", "c1"), undefined);
});

test("taking a friend place releases the seeker's old reservation and stops automatic consent", () => {
  const request = automatic("one");
  repos.membership.configure("otherHost", "p2", { strangerPlaces: 3, expectedFriends: 1 });
  const invite = repos.membership.invite("otherHost", "p2");
  repos.membership.acceptInvite("one", invite.token);
  assert.equal(row(request.id).status, "withdrawn");
  assert.equal(remaining(), 3);
  assert.equal(repos.groups.seeker("one", "c1").matching_opt_in, false);
  assert.equal(repos.membership.active("one", "c1").source, "friend");
});

test("cancelled groups release pending requests; leaving an approved group does not requeue the seeker", () => {
  const pending = automatic("one");
  repos.membership.cancel("host", "p1");
  assert.equal(row(pending.id).status, "rejected");
  assert.equal(remaining(), 3);
  const accepted = automatic("two", "p2");
  repos.recommendations.respond("otherHost", accepted.id, "accept");
  repos.membership.leave("two", "p2");
  assert.equal(repos.groups.seeker("two", "c1").status, "withdrawn");
  assert.equal(repos.groups.seeker("two", "c1").matching_opt_in, false);
  assert.equal(repos.parties.findById("p2").remaining_capacity, 3);
});

test("round-linked inserts, reservations, audit records and notifications roll back together", () => {
  const notifications = db.prepare("SELECT COUNT(*) n FROM notifications").get().n;
  assert.throws(() => db.transaction(() => {
    automatic("one");
    automatic("two");
    assert.equal(remaining(), 1);
    throw new Error("abort_batch");
  }).immediate(), /abort_batch/);
  assert.equal(remaining(), 3);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM group_join_requests").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM group_join_request_events").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM notifications").get().n, notifications);
  assert.equal(repos.groups.seeker("one", "c1").matching_opt_in, false);
});

test("approval failure restores the pending reservation, membership, consent and notifications", () => {
  const request = automatic("one");
  const notifications = db.prepare("SELECT COUNT(*) n FROM notifications").get().n;
  db.exec(`CREATE TRIGGER refuse_join BEFORE INSERT ON group_memberships WHEN NEW.source='join'
    BEGIN SELECT RAISE(ABORT,'refuse_join'); END`);
  assert.throws(() => repos.recommendations.respond("host", request.id, "accept"), /refuse_join/);
  assert.equal(row(request.id).status, "pending");
  assert.equal(repos.membership.active("one", "c1"), undefined);
  assert.equal(repos.groups.seeker("one", "c1").matching_opt_in, true);
  assert.equal(remaining(), 2);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM notifications").get().n, notifications);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM group_join_request_events WHERE request_id=? AND status='accepted'").get(request.id).n, 0);
});
