import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "../src/db/connection.js";
import { createRepositories } from "../src/db/repositories.js";
import { migrateCommunity } from "../src/db/communityMigrations.js";
import { createMatchingService } from "../src/services/matchingService.js";
import { makeUser, makeParty, makeSeeker } from "./helpers.js";

let db, repos, matching;
const answers = { about: ["supper"], wants: ["singalong"], avoid: [] };
const row = (id) => db.prepare("SELECT * FROM match_proposals WHERE id=?").get(id);
const remaining = () => repos.parties.findById("p1").remaining_capacity;
function offer(user, party = "p1") {
  // Keep each test round focused on the requested open seeker. Already reserved
  // seekers retain their proposal and stay excluded by the common loader.
  for (const other of ["one", "two", "three", "four"]) {
    const seeker = repos.groups.seeker(other, "c1");
    if (other !== user && seeker.status === "open") repos.recommendations.setJoiningMode(other, "c1", "direct");
  }
  repos.recommendations.setJoiningMode(user, "c1", "algorithm");
  repos.groups.addPreference(user, party);
  const result = matching.run("c1", { batchKey: `offer_${user}_${party}_${db.prepare("SELECT COUNT(*) n FROM match_rounds").get().n}` });
  const proposal = db.prepare("SELECT mp.* FROM match_proposals mp JOIN seeker_requests s ON s.id=mp.seeker_request_id WHERE mp.round_id=? AND s.user_id=?")
    .get(result.roundId, user);
  assert.ok(proposal);
  return proposal;
}
function manual(user, party = "p1") {
  repos.recommendations.setJoiningMode(user, "c1", "direct");
  return repos.recommendations.requestJoin(user, party);
}
function approve(proposal) {
  const seeker = repos.seekers.findById(proposal.seeker_request_id);
  const host = repos.parties.findById(proposal.party_id).host_user_id;
  assert.equal(repos.proposals.respond(seeker.user_id, proposal.id, "accept").status, "proposed");
  assert.equal(repos.proposals.respond(host, proposal.id, "accept").status, "confirmed");
}
beforeEach(() => {
  db = createTestDb();
  repos = createRepositories(db);
  matching = createMatchingService({ db, repos });
  for (const user of ["host", "otherHost", "friend", "one", "two", "three", "four"])
    repos.users.create(makeUser(user));
  repos.concerts.create({ id: "c1", artist: "Act", venue: "Venue", city: "Singapore", event_date: "2030-01-01" });
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
});
afterEach(() => db.close());

test("repeat community migrations preserve pending manual requests without inventing algorithm history", () => {
  const request = manual("one");
  const before = db.prepare("SELECT * FROM group_join_requests WHERE id=?").get(request.id);
  migrateCommunity(db); migrateCommunity(db);
  assert.deepEqual(db.prepare("SELECT * FROM group_join_requests WHERE id=?").get(request.id), before);
  assert.equal(before.matching_round_id, null);
  assert.equal(repos.groups.seeker("one", "c1").matching_opt_in, false);
  assert.equal(remaining(), 2);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM match_rounds").get().n, 0);
  assert.throws(() => repos.recommendations.requestJoin("two", "p1", { matchingRoundId: "made-up" }), /direct_joining_mode_required/);
});

test("real algorithm offers and direct members share stranger capacity while hosts and friends do not consume it", () => {
  repos.membership.configure("host", "p1", { strangerPlaces: 3, expectedFriends: 1 });
  repos.membership.acceptInvite("friend", repos.membership.invite("host", "p1").token);
  repos.membership.saveAnswers("friend", "p1", answers);
  repos.membership.publish("host", "p1");
  const request = manual("one");
  assert.equal(remaining(), 2);
  repos.recommendations.respond("host", request.id, "accept");
  assert.equal(remaining(), 2);
  const second = offer("two"), third = offer("three");
  assert.equal(second.party_id, "p1");
  assert.equal(third.party_id, "p1");
  assert.equal(remaining(), 0);
  assert.throws(() => repos.membership.configure("host", "p1", { strangerPlaces: 2, expectedFriends: 1 }), /below_active_reservations/);
  const fourth = offer("four");
  assert.equal(fourth.party_id, "p1");
  assert.equal(repos.proposals.forUser("four")[0].queueStatus, "waiting");
  approve(second); approve(third);
  assert.equal(row(fourth.id).status, "cancelled");
  assert.equal(repos.proposals.declinedPairsForConcert("c1").has("s_four|p1"), false);
  assert.equal(remaining(), 0);
  assert.equal(repos.parties.findById("p1").status, "matched");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM group_memberships WHERE party_id='p1' AND source IN('join','proposal') AND status='active'").get().n, 3);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM group_join_requests WHERE matching_round_id IS NOT NULL").get().n, 0);
});

test("an algorithm offer reserves its full seat while waiting for both host and seeker decisions", () => {
  repos.membership.configure("host", "p1", { strangerPlaces: 1 });
  repos.membership.publish("host", "p1");
  const proposal = offer("one");
  assert.equal(remaining(), 0);
  assert.equal(repos.proposals.respond("host", proposal.id, "accept").status, "proposed");
  assert.equal(repos.membership.active("one", "c1"), undefined);
  assert.equal(remaining(), 0);
  assert.equal(repos.proposals.respond("one", proposal.id, "accept").status, "confirmed");
  assert.equal(row(proposal.id).status, "confirmed");
  assert.equal(remaining(), 0);
  assert.equal(repos.membership.active("one", "c1").party_id, "p1");
});

test("expiry and either participant declining release algorithm seats and preserve pair restrictions", () => {
  const expired = offer("one");
  db.prepare("UPDATE match_proposals SET expires_at=0 WHERE id=?").run(expired.id);
  assert.equal(remaining(), 3);
  assert.equal(repos.proposals.expire(), 1);
  assert.equal(row(expired.id).status, "expired");
  assert.equal(repos.groups.seeker("one", "c1").status, "open");
  const declined = offer("two");
  assert.equal(repos.proposals.respond("host", declined.id, "decline").status, "declined");
  assert.ok(repos.proposals.declinedPairsForConcert("c1").has("s_two|p1"));
  const partial = offer("three");
  assert.equal(repos.proposals.respond("three", partial.id, "accept").status, "proposed");
  assert.equal(repos.proposals.respond("host", partial.id, "decline").status, "declined");
  assert.equal(remaining(), 3);
  assert.equal(repos.membership.active("three", "c1"), undefined);
});

test("the second approval rechecks whole-group eligibility after the first participant agrees", () => {
  const proposal = offer("one");
  assert.equal(repos.proposals.respond("one", proposal.id, "accept").status, "proposed");
  repos.users.block("host", "one");
  assert.equal(repos.proposals.respond("host", proposal.id, "accept").error, "group_unavailable");
  assert.equal(row(proposal.id).status, "proposed");
  assert.equal(row(proposal.id).host_approved_at, null);
  assert.equal(repos.membership.active("one", "c1"), undefined);
});

test("taking a friend place requires explicitly resolving an algorithm offer", () => {
  const proposal = offer("one");
  repos.membership.configure("otherHost", "p2", { strangerPlaces: 3, expectedFriends: 1 });
  const invite = repos.membership.invite("otherHost", "p2");
  assert.throws(() => repos.membership.acceptInvite("one", invite.token), /reserved|proposal|claim/);
  repos.proposals.respond("one", proposal.id, "decline");
  repos.membership.acceptInvite("one", invite.token);
  assert.equal(row(proposal.id).status, "declined");
  assert.equal(remaining(), 3);
  assert.equal(repos.groups.seeker("one", "c1").matching_opt_in, false);
  assert.equal(repos.membership.active("one", "c1").source, "friend");
});

test("group cancellation releases unconfirmed offers and leaving a mutually approved group does not requeue", () => {
  const pending = offer("one");
  repos.membership.cancel("host", "p1");
  assert.equal(row(pending.id).status, "cancelled");
  assert.equal(remaining(), 3);
  const accepted = offer("two", "p2");
  approve(accepted);
  repos.membership.leave("two", "p2");
  assert.equal(row(accepted.id).status, "cancelled");
  assert.equal(repos.groups.seeker("two", "c1").status, "withdrawn");
  assert.equal(repos.groups.seeker("two", "c1").matching_opt_in, false);
  assert.equal(repos.parties.findById("p2").remaining_capacity, 3);
});

test("real round, proposal, claim and notification writes roll back as one transaction", () => {
  const notifications = db.prepare("SELECT COUNT(*) n FROM notifications").get().n;
  assert.throws(() => db.transaction(() => {
    offer("one"); offer("two");
    assert.equal(remaining(), 1);
    throw new Error("abort_batch");
  }).immediate(), /abort_batch/);
  assert.equal(remaining(), 3);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM match_rounds").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM match_proposals").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM active_seat_claims").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM notifications").get().n, notifications);
});

test("final approval failure preserves the first approval and rolls back membership, claim and notifications", () => {
  const proposal = offer("one");
  assert.equal(repos.proposals.respond("host", proposal.id, "accept").status, "proposed");
  const notifications = db.prepare("SELECT * FROM notifications ORDER BY id").all();
  db.exec(`CREATE TRIGGER refuse_join BEFORE INSERT ON group_memberships WHEN NEW.source='proposal'
    BEGIN SELECT RAISE(ABORT,'refuse_join'); END`);
  assert.throws(() => repos.proposals.respond("one", proposal.id, "accept"), /refuse_join/);
  assert.equal(row(proposal.id).status, "proposed");
  assert.ok(row(proposal.id).host_approved_at);
  assert.equal(row(proposal.id).seeker_approved_at, null);
  assert.equal(repos.membership.active("one", "c1"), undefined);
  assert.equal(remaining(), 2);
  assert.equal(db.prepare("SELECT status FROM active_seat_claims WHERE proposal_id=?").get(proposal.id).status, "proposed");
  assert.deepEqual(db.prepare("SELECT * FROM notifications ORDER BY id").all(), notifications);
});

test("both decision makers receive offers and the first approval notifies only the other participant", () => {
  const proposal = offer("one");
  const initialHost = repos.notifications.unread("host");
  const initialSeeker = repos.notifications.unread("one");
  assert.ok(repos.notifications.list("host").some((n) => n.category === "match" && n.title.includes("proposal")));
  assert.ok(repos.notifications.list("one").some((n) => n.category === "match" && n.title.includes("proposal")));
  assert.equal(repos.notifications.unread("friend"), 0);
  assert.equal(repos.proposals.respond("one", proposal.id, "accept").status, "proposed");
  assert.equal(repos.notifications.unread("host"), initialHost + 1);
  assert.equal(repos.notifications.unread("one"), initialSeeker);
  assert.equal(repos.proposals.respond("one", proposal.id, "accept").error, "proposal_already_approved");
  assert.equal(repos.notifications.unread("host"), initialHost + 1);
  assert.equal(repos.proposals.respond("host", proposal.id, "accept").status, "confirmed");
  assert.equal(repos.notifications.unread("host"), initialHost + 2);
  assert.equal(repos.notifications.unread("one"), initialSeeker + 1);
});

test("host-first approval notifications respect category opt-outs and roll back with approval writes", () => {
  repos.notifications.setSettings("host", { match: false });
  const proposal = offer("one");
  assert.equal(repos.notifications.unread("host"), 0);
  const before = repos.notifications.list("one");
  assert.throws(() => db.transaction(() => {
    assert.equal(repos.proposals.respond("host", proposal.id, "accept").status, "proposed");
    assert.equal(repos.notifications.unread("one"), before.length + 1);
    throw new Error("rollback_approval");
  }).immediate(), /rollback_approval/);
  assert.deepEqual(repos.notifications.list("one"), before);
  assert.equal(row(proposal.id).host_approved_at, null);
  repos.proposals.respond("one", proposal.id, "accept");
  assert.equal(repos.notifications.unread("host"), 0);
});
