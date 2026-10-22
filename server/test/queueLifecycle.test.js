import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "../src/db/connection.js";
import { createRepositories } from "../src/db/repositories.js";
import { createMatchingService } from "../src/services/matchingService.js";
import { makeUser, makeParty, makeSeeker } from "./helpers.js";

let db, repos;
const answers = { about: ["singalong"], wants: ["supper"], avoid: [] };
beforeEach(() => {
  db = createTestDb();
  repos = createRepositories(db);
  for (const id of ["host", "first", "second", "third"])
    repos.users.create(makeUser(id));
  repos.concerts.create({ id: "c1", artist: "Show", venue: "Hall", city: "Singapore", event_date: "2030-01-01" });
  repos.parties.create(makeParty("p1", makeUser("host"), { capacity: 1 }));
  for (const id of ["first", "second", "third"])
    repos.seekers.create(makeSeeker(`s_${id}`, makeUser(id), { joining_mode: "direct" }));
});
afterEach(() => db.close());
const claims = () => db.prepare("SELECT user_id,seat_held,queue_order FROM active_seat_claims WHERE status='proposed' ORDER BY queue_order").all();

test("increasing legacy capacity promotes older waiters before admitting a new arrival", () => {
  repos.recommendations.requestJoin("first", "p1");
  repos.recommendations.requestJoin("second", "p1");
  assert.deepEqual(claims().map((c) => c.seat_held), [1, 0]);
  db.prepare("UPDATE parties SET capacity=2 WHERE id='p1'").run();
  assert.deepEqual(claims().map((c) => c.seat_held), [1, 1]);
  assert.equal(repos.parties.findById("p1").remaining_capacity, 0);
  const newcomer = repos.recommendations.requestJoin("third", "p1");
  assert.equal(newcomer.queuePosition, 3);
  assert.equal(newcomer.queueStatus, "waiting");
  assert.equal(newcomer.seatReserved, false);
  assert.deepEqual(claims().map((c) => c.seat_held), [1, 1, 0]);
});

test("increasing managed stranger places promotes the existing queue before another request arrives", () => {
  repos.membership.configure("host", "p1", { strangerPlaces: 1 });
  repos.membership.saveAnswers("host", "p1", answers);
  repos.membership.publish("host", "p1");
  for (const user of ["first", "second", "third"])
    repos.recommendations.savePersonal(user, "c1", answers);
  repos.recommendations.requestJoin("first", "p1");
  repos.recommendations.requestJoin("second", "p1");
  repos.membership.configure("host", "p1", { strangerPlaces: 2 });
  repos.membership.publish("host", "p1");
  assert.deepEqual(claims().map((c) => c.seat_held), [1, 1]);
  assert.equal(repos.parties.findById("p1").remaining_capacity, 0);
  const newcomer = repos.recommendations.requestJoin("third", "p1");
  assert.equal(newcomer.queuePosition, 3);
  assert.equal(newcomer.seatReserved, false);
  assert.equal(repos.parties.findById("p1").remaining_capacity, 0);
});

test("natural algorithm-head expiry never advertises a free queued seat and a direct host action promotes its successor", async () => {
  repos.recommendations.setJoiningMode("first", "c1", "algorithm");
  const round = createMatchingService({ db, repos }).run("c1", { batchKey: "elapsed-head-action" });
  const proposal = repos.proposals.forUser("first")[0];
  const direct = repos.recommendations.requestJoin("second", "p1");
  const history = db.prepare("SELECT * FROM match_results WHERE round_id=?").all(round.roundId);
  db.prepare("UPDATE match_proposals SET expires_at=? WHERE id=?").run(Date.now() + 150, proposal.id);
  await new Promise((resolve) => setTimeout(resolve, 180));
  assert.equal(db.prepare("SELECT status FROM match_proposals WHERE id=?").get(proposal.id).status, "proposed");
  assert.equal(db.prepare("SELECT seat_held FROM active_seat_claims WHERE join_request_id=?").get(direct.id).seat_held, 0);
  assert.equal(repos.parties.findById("p1").remaining_capacity, 0);
  assert.equal(repos.recommendations.respond("host", direct.id, "accept").status, "accepted");
  assert.equal(db.prepare("SELECT status FROM match_proposals WHERE id=?").get(proposal.id).status, "expired");
  assert.equal(repos.membership.active("second", "c1").party_id, "p1");
  assert.equal(repos.parties.findById("p1").remaining_capacity, 0);
  assert.deepEqual(db.prepare("SELECT * FROM match_results WHERE round_id=?").all(round.roundId), history);
  assert.equal(repos.proposals.declinedPairsForConcert("c1").size, 0);
});

test("refreshing proposals advances past a naturally elapsed direct head before returning approval controls", async () => {
  const direct=repos.recommendations.requestJoin("first","p1");
  repos.recommendations.setJoiningMode("second","c1","algorithm");
  createMatchingService({db,repos}).run("c1",{batchKey:"elapsed-direct-inbox"});
  const automatic=repos.proposals.forUser("second")[0];
  assert.equal(automatic.queueStatus,"waiting");
  db.prepare("UPDATE group_join_requests SET expires_at=? WHERE id=?").run(Date.now()+150,direct.id);
  await new Promise(resolve=>setTimeout(resolve,180));
  assert.equal(repos.parties.findById("p1").remaining_capacity,0);
  repos.proposals.expire();
  const refreshed=repos.proposals.forUser("second")[0];
  assert.equal(refreshed.queuePosition,1);
  assert.equal(refreshed.seatReserved,true);
  assert.equal(refreshed.canHostRespond,true);
  assert.equal(db.prepare("SELECT status FROM group_join_requests WHERE id=?").get(direct.id).status,"expired");
  assert.equal(repos.proposals.respond("second",automatic.id,"accept").status,"proposed");
  assert.equal(repos.proposals.respond("host",automatic.id,"accept").status,"confirmed");
});
