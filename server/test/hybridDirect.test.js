import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "../src/db/connection.js";
import { createRepositories } from "../src/db/repositories.js";
import { createMatchingService } from "../src/services/matchingService.js";
import { makeUser, makeParty, makeSeeker } from "./helpers.js";

let db, repos;
const answers = { about: ["supper", "singalong"], wants: ["supper"], avoid: [] };
beforeEach(() => {
  db = createTestDb();
  repos = createRepositories(db);
  for (const id of ["h1", "h2", "h3", "h4", "one", "two", "outsider"])
    repos.users.create(makeUser(id));
  for (const id of ["c1", "c2"])
    repos.concerts.create({ id, artist: id, venue: "Venue", city: "Singapore", event_date: "2030-01-01" });
  for (let i = 1; i <= 4; i++)
    repos.parties.create(makeParty(`p${i}`, makeUser(`h${i}`), { capacity: 2 }));
  for (const id of ["one", "two"])
    repos.seekers.create(makeSeeker(`s_${id}`, makeUser(id)));
});
afterEach(() => db.close());
const direct = (user = "one") => repos.recommendations.setJoiningMode(user, "c1", "direct");
const row = (id) => db.prepare("SELECT * FROM group_join_requests WHERE id=?").get(id);
const remaining = (id = "p1") => repos.parties.findById(id).remaining_capacity;
const activeClaims = () => db.prepare("SELECT * FROM active_seat_claims WHERE status IN('proposed','confirmed')").all();

test("legacy enrollment defaults to algorithm and direct applications require explicit mode selection", () => {
  assert.equal(repos.groups.seeker("one", "c1").joining_mode, "algorithm");
  assert.throws(() => repos.recommendations.requestJoin("one", "p1"), /direct_joining_mode_required/);
  const seeker = direct();
  assert.equal(seeker.joining_mode, "direct");
  assert.equal(seeker.matching_opt_in, false);
  assert.equal(seeker.user, undefined);
  assert.equal(seeker.maxPendingDirectApplications, 1);
  assert.throws(() => repos.recommendations.setJoiningMode("one", "c1", "unknown"), /invalid_joining_mode/);
  assert.throws(() => repos.recommendations.setJoiningMode("outsider", "c1", "direct"), /seeker_request_not_found/);
});

test("one pending direct application holds one seat without confirming membership", () => {
  direct();
  const first = repos.recommendations.requestJoin("one", "p1");
  assert.equal(activeClaims().length, 1);
  assert.equal(activeClaims()[0].source, "direct");
  assert.equal(activeClaims()[0].status, "proposed");
  assert.equal(remaining(), 1);
  assert.equal(repos.groups.seeker("one", "c1").status, "matched");
  assert.equal(repos.membership.active("one", "c1"), undefined);
  assert.deepEqual(repos.recommendations.currentMemberships("one"), []);
  assert.equal(repos.recommendations.requests("one", { scope: "own" }).length, 1);
  assert.throws(() => repos.recommendations.requestJoin("one", "p1"), /already_exists/);
  assert.throws(() => repos.recommendations.requestJoin("one", "p2"), /pending_application_limit_reached/);
  repos.recommendations.respond("one", first.id, "withdraw");
  assert.equal(remaining(), 2);
  assert.equal(repos.groups.seeker("one", "c1").status, "open");
  assert.equal(repos.recommendations.requestJoin("one", "p2").status, "pending");
});

test("database constraints also prevent two pending applications for the same seeker", () => {
  direct();
  repos.recommendations.requestJoin("one", "p1");
  assert.throws(() => db.prepare(`INSERT INTO group_join_requests(id,party_id,user_id,seeker_request_id,status,expires_at)
    VALUES('duplicate_pending','p2','one','s_one','pending',?)`).run(Date.now() + 3600000), /UNIQUE/);
  assert.equal(remaining(), 1);
  assert.equal(repos.recommendations.maxPendingDirectApplications, 1);
});

test("withdrawal keeps the original record and reapplication creates a separate history entry", () => {
  direct();
  const first = repos.recommendations.requestJoin("one", "p1", { note: "First application" });
  repos.recommendations.respond("one", first.id, "withdraw");
  const second = repos.recommendations.requestJoin("one", "p1", { note: "New application" });
  assert.notEqual(first.id, second.id);
  assert.equal(row(first.id).status, "withdrawn");
  assert.equal(row(first.id).application_note, "First application");
  assert.equal(row(second.id).application_note, "New application");
  assert.equal(repos.recommendations.requests("one", { scope: "own" }).length, 2);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM group_join_request_events WHERE request_id=?").get(first.id).n, 2);
});

test("applications require enrollment, the correct concert and an eligible non-host pair", () => {
  direct();
  assert.throws(() => repos.recommendations.requestJoin("outsider", "p1"), /open_seeker_request_required/);
  assert.throws(() => repos.recommendations.requestJoin("h1", "p1"), /already_group_member/);
  repos.parties.create(makeParty("otherConcert", makeUser("h1"), { concert_id: "c2" }));
  assert.throws(() => repos.recommendations.requestJoin("one", "otherConcert"), /open_seeker_request_required/);
  db.prepare("UPDATE seeker_requests SET spend_band_max=1 WHERE id='s_one'").run();
  assert.throws(() => repos.recommendations.requestJoin("one", "p1"), /group_unavailable/);
  db.prepare("UPDATE seeker_requests SET spend_band_max=4 WHERE id='s_one'").run();
  repos.users.block("h1", "one");
  assert.throws(() => repos.recommendations.requestJoin("one", "p1"), /group_unavailable/);
  db.exec("DELETE FROM blocks");
  db.prepare("INSERT INTO match_declines(seeker_request_id,party_id) VALUES('s_one','p1')").run();
  assert.throws(() => repos.recommendations.requestJoin("one", "p1"), /previously_declined/);
});

test("public notes are validated and inboxes never expose unrelated applications or private profiles", () => {
  direct();
  assert.throws(() => repos.recommendations.requestJoin("one", "p1", { note: "x".repeat(501) }), /invalid_application_note/);
  const request = repos.recommendations.requestJoin("one", "p1", { note: "  Happy to meet early.  " });
  assert.equal(row(request.id).application_note, "Happy to meet early.");
  const inbox = repos.recommendations.requests("h1", { scope: "hosted" });
  assert.equal(inbox.length, 1);
  assert.equal(inbox[0].seeker.id, "one");
  assert.equal(typeof inbox[0].compatibility, "number");
  assert.equal(inbox[0].remainingCapacity, 1);
  assert.equal(inbox[0].seeker.email, undefined);
  assert.deepEqual(repos.recommendations.requests("h2", { scope: "hosted" }), []);
  assert.deepEqual(repos.recommendations.requests("outsider"), []);
  assert.throws(() => repos.recommendations.respond("two", request.id, "withdraw"), /request_not_found/);
  assert.throws(() => repos.recommendations.respond("h2", request.id, "accept"), /request_not_found/);
  assert.throws(() => repos.recommendations.respond("one", request.id, "accept"), /request_not_found/);
});

test("direct acceptance confirms one seat with host approval alone and creates no algorithm history", () => {
  direct();
  const withdrawn = repos.recommendations.requestJoin("one", "p2");
  repos.recommendations.respond("one", withdrawn.id, "withdraw");
  const application = repos.recommendations.requestJoin("one", "p1");
  const claimBefore = activeClaims()[0].id;
  assert.equal(remaining(), 1);
  repos.recommendations.respond("h1", application.id, "accept");
  assert.equal(row(application.id).status, "accepted");
  assert.equal(row(application.id).responded_by, "h1");
  assert.equal(row(withdrawn.id).status, "withdrawn");
  assert.equal(remaining(), 1);
  assert.equal(activeClaims().length, 1);
  assert.equal(activeClaims()[0].source, "direct");
  assert.equal(activeClaims()[0].status, "confirmed");
  assert.equal(activeClaims()[0].id, claimBefore);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM match_rounds").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM match_results").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM match_proposals").get().n, 0);
  assert.throws(() => repos.recommendations.respond("h1", application.id, "accept"), /request_not_pending/);
  assert.throws(() => repos.recommendations.requestJoin("one", "p4"), /already_in_concert_group/);
  const membership = repos.recommendations.currentMemberships("one")[0];
  assert.equal(membership.partyId, "p1");
  assert.equal(membership.assignmentOrigin, "direct");
  assert.equal(membership.assignmentStatus, "confirmed");
  assert.equal(membership.host.id, "h1");
  assert.equal(membership.remainingCapacity, 1);
  assert.ok(membership.members.some((member) => member.id === "one"));
});

test("host decline records a pair exclusion; voluntary withdrawal does not", () => {
  direct();
  const declined = repos.recommendations.requestJoin("one", "p1");
  repos.recommendations.respond("h1", declined.id, "decline");
  assert.equal(row(declined.id).status, "rejected");
  assert.ok(repos.proposals.declinedPairsForConcert("c1").has("s_one|p1"));
  assert.equal(remaining(), 2);
  assert.equal(activeClaims().length, 0);
  const withdrawn = repos.recommendations.requestJoin("one", "p2");
  repos.recommendations.respond("one", withdrawn.id, "withdraw");
  assert.equal(repos.proposals.declinedPairsForConcert("c1").has("s_one|p2"), false);
  assert.equal(remaining("p2"), 2);
  assert.equal(activeClaims().length, 0);
});

test("mode switches require explicit application resolution and preserve histories and preferences", () => {
  direct();
  repos.groups.addPreference("one", "p1");
  const request = repos.recommendations.requestJoin("one", "p1");
  assert.throws(() => repos.recommendations.setJoiningMode("one", "c1", "algorithm"), /withdraw_pending_applications_first/);
  assert.equal(row(request.id).status, "pending");
  repos.recommendations.respond("one", request.id, "withdraw");
  const updated = repos.recommendations.setJoiningMode("one", "c1", "algorithm");
  assert.equal(updated.matching_opt_in, true);
  assert.equal(updated.joining_mode, "algorithm");
  assert.equal(row(request.id).status, "withdrawn");
  assert.equal(repos.groups.preferences("one", "c1").length, 1);
});

test("a real proposed algorithm offer prevents mode changes until explicitly resolved", () => {
  // Keep only this seeker in the algorithmic subproblem.
  direct("two");
  const matching = createMatchingService({ db, repos });
  const round = matching.run("c1", { batchKey: "direct-mode-proposal-conflict" });
  const proposal = db.prepare("SELECT * FROM match_proposals WHERE round_id=?").get(round.roundId);
  assert.ok(proposal);
  assert.throws(() => repos.recommendations.setJoiningMode("one", "c1", "direct"), /active_seat_claim_exists/);
  assert.equal(db.prepare("SELECT status FROM match_proposals WHERE id=?").get(proposal.id).status, "proposed");
  assert.equal(repos.groups.seeker("one", "c1").joining_mode, "algorithm");
});

test("applicants share a FIFO queue for the last seat and hosts cannot skip the head", () => {
  db.prepare("UPDATE parties SET capacity=1 WHERE id='p1'").run();
  direct("one"); direct("two");
  const first = repos.recommendations.requestJoin("one", "p1");
  assert.equal(remaining(), 0);
  assert.equal(repos.parties.findById("p1").status, "matched");
  const second = repos.recommendations.requestJoin("two", "p1");
  assert.equal(first.queuePosition, 1);
  assert.equal(first.seatReserved, true);
  assert.equal(second.queuePosition, 2);
  assert.equal(second.queueStatus, "waiting");
  assert.equal(second.seatReserved, false);
  assert.equal(second.canHostRespond, false);
  assert.throws(() => repos.recommendations.respond("h1", second.id, "accept"), /request_waiting_in_queue/);
  assert.throws(() => repos.recommendations.respond("h1", second.id, "reject"), /request_waiting_in_queue/);
  assert.equal(remaining(), 0);
  repos.recommendations.respond("h1", first.id, "accept");
  assert.equal(row(first.id).status, "accepted");
  assert.equal(row(second.id).status, "superseded");
  assert.equal(row(second.id).resolution_reason, "group_full");
  assert.equal(remaining(), 0);
  assert.equal(activeClaims().length, 1);
  assert.equal(repos.proposals.declinedPairsForConcert("c1").has("s_two|p1"), false);
});

test("rejecting the queue head atomically passes its held seat to the next applicant", () => {
  db.prepare("UPDATE parties SET capacity=1 WHERE id='p1'").run();
  direct("one"); direct("two");
  const first = repos.recommendations.requestJoin("one", "p1");
  const second = repos.recommendations.requestJoin("two", "p1");
  const originalExpiry = row(second.id).expires_at;
  repos.recommendations.respond("h1", first.id, "reject");
  const promoted = repos.recommendations.requests("two", { scope: "own" })[0];
  assert.equal(promoted.queuePosition, 1);
  assert.equal(promoted.queueStatus, "held");
  assert.equal(promoted.seatReserved, true);
  assert.equal(promoted.canHostRespond, true);
  assert.equal(row(second.id).expires_at, originalExpiry);
  assert.equal(remaining(), 0);
  assert.equal(activeClaims().length, 1);
  assert.ok(repos.proposals.declinedPairsForConcert("c1").has("s_one|p1"));
  assert.equal(repos.proposals.declinedPairsForConcert("c1").has("s_two|p1"), false);
  repos.recommendations.respond("h1", second.id, "accept");
  assert.equal(repos.membership.active("two", "c1").party_id, "p1");
});

test("waiting applicants can withdraw and head withdrawal preserves the next applicant's held seat", () => {
  db.prepare("UPDATE parties SET capacity=1 WHERE id='p1'").run();
  direct("one"); direct("two");
  const first = repos.recommendations.requestJoin("one", "p1");
  const waiting = repos.recommendations.requestJoin("two", "p1");
  repos.recommendations.respond("two", waiting.id, "withdraw");
  assert.equal(remaining(), 0);
  assert.equal(repos.groups.seeker("two", "c1").status, "open");
  const replacement = repos.recommendations.requestJoin("two", "p1");
  repos.recommendations.respond("one", first.id, "withdraw");
  const promoted = repos.recommendations.requests("two", { scope: "own" }).find((r) => r.id === replacement.id);
  assert.equal(promoted.queuePosition, 1);
  assert.equal(promoted.seatReserved, true);
  assert.equal(remaining(), 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM match_declines").get().n, 0);
});

test("admitting an earlier applicant does not invalidate the next applicant's agreed group policy", () => {
  repos.membership.configure("h1", "p1", { expectedFriends: 0 });
  repos.membership.saveAnswers("h1", "p1", answers);
  repos.membership.publish("h1", "p1");
  for (const user of ["one", "two"]) {
    repos.recommendations.savePersonal(user, "c1", answers);
    direct(user);
  }
  const first = repos.recommendations.requestJoin("one", "p1");
  const second = repos.recommendations.requestJoin("two", "p1");
  const policyVersion = row(second.id).group_version;
  repos.recommendations.respond("h1", first.id, "accept");
  assert.equal(repos.membership.settings("p1").version, policyVersion);
  assert.equal(repos.recommendations.respond("h1", second.id, "accept").status, "accepted");
  assert.equal(remaining(), 0);
  assert.equal(activeClaims().filter((claim) => claim.status === "confirmed").length, 2);
});

test("membership failure rolls back the accepted state, seat claim, audit and notification", () => {
  db.prepare("UPDATE parties SET capacity=1 WHERE id='p1'").run();
  direct("one"); direct("two");
  const request = repos.recommendations.requestJoin("one", "p1");
  const waiting = repos.recommendations.requestJoin("two", "p1");
  const claimsBefore = activeClaims();
  const before = db.prepare("SELECT * FROM notifications ORDER BY id").all();
  db.exec(`CREATE TRIGGER reject_direct_member BEFORE INSERT ON group_memberships WHEN NEW.source='join'
    BEGIN SELECT RAISE(ABORT,'test_membership_failure'); END`);
  assert.throws(() => repos.recommendations.respond("h1", request.id, "accept"), /test_membership_failure/);
  assert.equal(row(request.id).status, "pending");
  assert.equal(row(waiting.id).status, "pending");
  assert.deepEqual(activeClaims(), claimsBefore);
  assert.equal(remaining(), 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM group_join_request_events WHERE request_id=? AND status='accepted'").get(request.id).n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM group_join_request_events WHERE request_id=? AND status='superseded'").get(waiting.id).n, 0);
  assert.deepEqual(db.prepare("SELECT * FROM notifications ORDER BY id").all(), before);
});

test("leaving a direct membership preserves its cancellation history and releases exactly one seat", () => {
  direct();
  const request = repos.recommendations.requestJoin("one", "p1");
  repos.recommendations.respond("h1", request.id, "accept");
  repos.membership.leave("one", "p1");
  assert.equal(row(request.id).status, "cancelled");
  assert.equal(repos.groups.seeker("one", "c1").status, "withdrawn");
  assert.equal(activeClaims().length, 0);
  assert.equal(remaining(), 2);
  assert.deepEqual(repos.recommendations.currentMemberships("one"), []);
  assert.equal(repos.membership.active("one", "c1"), undefined);
  assert.deepEqual(db.pragma("foreign_key_check"), []);
});

test("host cancellation closes applications without manufacturing permanent declines", () => {
  direct();
  const request = repos.recommendations.requestJoin("one", "p1");
  repos.membership.cancel("h1", "p1");
  assert.equal(row(request.id).status, "cancelled");
  assert.equal(repos.proposals.declinedPairsForConcert("c1").has("s_one|p1"), false);
  assert.equal(activeClaims().length, 0);
  assert.equal(remaining(), 2);
  assert.equal(repos.groups.seeker("one", "c1").status, "open");
  assert.equal(repos.recommendations.requests("one", { scope: "own" })[0].status, "cancelled");
});

test("whole-group blocks apply to direct joining and the shared directional scorer", () => {
  repos.membership.configure("h1", "p1", { expectedFriends: 1 });
  repos.membership.acceptInvite("outsider", repos.membership.invite("h1", "p1").token);
  for (const user of ["h1", "outsider"]) repos.membership.saveAnswers(user, "p1", answers);
  repos.membership.publish("h1", "p1");
  repos.recommendations.savePersonal("one", "c1", answers);
  direct();
  const seeker = repos.groups.seeker("one", "c1");
  const party = repos.parties.findById("p1");
  const scores = repos.recommendations.pairScore(seeker, party);
  const card = repos.recommendations.individual("one", "c1").find((g) => g.id === "p1");
  assert.equal(card.compatibility, Math.round((scores.seekerToParty + scores.partyToSeeker) * 5000) / 10000);
  repos.users.block("outsider", "one");
  assert.throws(() => repos.recommendations.requestJoin("one", "p1"), /group_unavailable/);
  assert.equal(repos.recommendations.individual("one", "c1").some((g) => g.id === "p1"), false);
});

test("saved account preferences support direct admission and retain the group's upstream name and picture", () => {
  repos.membership.savePreferences("h1", answers);
  repos.membership.savePreferences("one", answers);
  repos.membership.configure("h1", "p1", { expectedFriends: 0 });
  repos.membership.publish("h1", "p1");
  repos.parties.setName("p1", "Supper after the show");
  repos.parties.setImage("p1", "group-picture.png");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM seeker_discovery_preferences WHERE user_id='one'").get().n, 0);
  assert.equal(repos.recommendations.hasAnswers("one", "c1"), true);
  direct();
  const request = repos.recommendations.requestJoin("one", "p1");
  const inbox = repos.recommendations.requests("h1", { scope: "hosted" })[0];
  assert.equal(inbox.groupName, "Supper after the show");
  assert.equal(inbox.imageUrl, "/api/avatars/group-picture.png");
  repos.recommendations.respond("h1", request.id, "accept");
  assert.ok(repos.membership.detail("one", "p1").myAnswers.about.some((a) => a.key === "post_supper"));
  const membership = repos.recommendations.currentMemberships("one")[0];
  assert.equal(membership.assignmentOrigin, "direct");
  assert.equal(membership.group.name, "Supper after the show");
  assert.equal(membership.group.imageUrl, "/api/avatars/group-picture.png");
  assert.equal(remaining(), 1);
});

test("account preference changes require renewed direct consent even after restoring the original answers", () => {
  repos.membership.savePreferences("h1", answers);
  repos.membership.savePreferences("one", answers);
  repos.membership.configure("h1", "p1", { expectedFriends: 0 });
  repos.membership.publish("h1", "p1");
  direct();
  const application = repos.recommendations.requestJoin("one", "p1");
  const submitted = row(application.id).preferences_json;
  repos.membership.savePreferences("one", { about: ["dancing"], wants: [], avoid: [] });
  repos.membership.savePreferences("one", answers);
  assert.equal(row(application.id).preferences_json, submitted);
  assert.equal(row(application.id).group_version, null);
  assert.throws(() => repos.recommendations.respond("h1", application.id, "accept"), /preferences_changed_withdraw_and_resubmit/);
  assert.equal(activeClaims().length, 1);
  assert.equal(activeClaims()[0].status, "proposed");
});

test("a direct application's expiry releases its hold and permits another application without a decline", () => {
  direct();
  const application = repos.recommendations.requestJoin("one", "p1");
  assert.equal(remaining(), 1);
  db.prepare("UPDATE group_join_requests SET expires_at=0 WHERE id=?").run(application.id);
  assert.equal(remaining(), 2);
  assert.equal(repos.recommendations.expire(), 1);
  assert.equal(row(application.id).status, "expired");
  assert.equal(repos.groups.seeker("one", "c1").status, "open");
  assert.equal(activeClaims().length, 0);
  assert.equal(repos.proposals.declinedPairsForConcert("c1").has("s_one|p1"), false);
  const replacement = repos.recommendations.requestJoin("one", "p2");
  assert.equal(replacement.status, "pending");
  assert.equal(remaining("p2"), 1);
});

test("a failed pending reservation rolls back its application, events and notifications", () => {
  direct();
  const before = db.prepare("SELECT * FROM notifications ORDER BY id").all();
  db.exec(`CREATE TRIGGER fail_direct_hold AFTER INSERT ON active_seat_claims WHEN NEW.source='direct'
    BEGIN SELECT RAISE(ABORT,'direct_hold_failed'); END`);
  assert.throws(() => repos.recommendations.requestJoin("one", "p1"), /direct_hold_failed/);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM group_join_requests").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM group_join_request_events").get().n, 0);
  assert.equal(activeClaims().length, 0);
  assert.equal(repos.groups.seeker("one", "c1").status, "open");
  assert.equal(remaining(), 2);
  assert.deepEqual(db.prepare("SELECT * FROM notifications ORDER BY id").all(), before);
});

test("Gale-Shapley joins the same FIFO queue and cannot take a direct applicant's held seat", () => {
  db.prepare("UPDATE parties SET capacity=1 WHERE id='p1'").run();
  repos.groups.addPreference("two", "p1");
  direct();
  const application = repos.recommendations.requestJoin("one", "p1");
  const heldClaim = activeClaims()[0].id;
  assert.equal(db.prepare("SELECT COUNT(*) n FROM match_rounds").get().n, 0);
  const result = createMatchingService({ db, repos }).run("c1", { batchKey: "algorithm-after-direct-hold" });
  const proposal = db.prepare("SELECT * FROM match_proposals WHERE round_id=?").get(result.roundId);
  assert.ok(proposal);
  assert.equal(proposal.party_id, "p1");
  assert.equal(proposal.seeker_request_id, "s_two");
  const automatic = repos.proposals.forUser("two")[0];
  assert.equal(automatic.queuePosition, 2);
  assert.equal(automatic.queueStatus, "waiting");
  assert.equal(automatic.seatReserved, false);
  assert.equal(repos.proposals.respond("h1", proposal.id, "accept").status, 409);
  assert.equal(row(application.id).status, "pending");
  assert.equal(db.prepare("SELECT status FROM active_seat_claims WHERE id=?").get(heldClaim).status, "proposed");
  assert.equal(repos.membership.active("one", "c1"), undefined);
  assert.equal(remaining(), 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM match_results WHERE seeker_request_id='s_one'").get().n, 0);
  repos.recommendations.respond("h1", application.id, "reject");
  assert.equal(repos.proposals.forUser("two")[0].queuePosition, 1);
  assert.equal(repos.proposals.forUser("two")[0].seatReserved, true);
  assert.equal(remaining(), 0);
  assert.equal(repos.proposals.respond("two", proposal.id, "accept").status, "proposed");
  assert.equal(repos.proposals.respond("h1", proposal.id, "accept").status, "confirmed");
  assert.equal(repos.membership.active("two", "c1").party_id, "p1");
});
