/** Preferences are answered once per user and flow into every group they join. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "../src/db/connection.js";
import { createRepositories } from "../src/db/repositories.js";
import { migrateUserPreferences } from "../src/db/userPreferencesMigration.js";
import { makeUser, makeParty } from "./helpers.js";

function setup() {
  const db = createTestDb();
  const repos = createRepositories(db);
  for (const id of ["h1", "friend"]) repos.users.create(makeUser(id));
  repos.concerts.create({ id: "c1", artist: "Act", venue: "Venue", city: "Singapore", event_date: "2020-01-01" });
  repos.parties.create(makeParty("p1", makeUser("h1"), { capacity: 2 }));
  return { db, repos };
}
const answers = { about: ["singalong"], wants: [], avoid: [] };

test("joining a group copies the member's saved preferences into it", () => {
  const { db, repos } = setup();
  repos.membership.savePreferences("h1", answers);
  repos.membership.savePreferences("friend", { about: ["supper"], wants: [], avoid: [] });
  repos.membership.configure("h1", "p1", { expectedFriends: 1 });
  repos.membership.acceptInvite("friend", repos.membership.invite("h1", "p1").token);

  const detail = repos.membership.detail("h1", "p1");
  assert.ok(detail.members.every((m) => m.answered), "nobody has to answer again for the group");
  // Publishing needs every member's answers, which they already gave.
  assert.equal(repos.membership.publish("h1", "p1").published, 1);
  db.close();
});

test("changing your preferences updates the groups you are already in", () => {
  const { db, repos } = setup();
  repos.membership.savePreferences("h1", answers);
  repos.membership.configure("h1", "p1", {});
  const before = repos.membership.settings("p1").version;
  repos.membership.savePreferences("h1", { about: ["supper"], wants: [], avoid: [] });
  assert.deepEqual(repos.membership.detail("h1", "p1").myAnswers.about.map((a) => a.key), repos.membership.preferences("h1").about.map((a) => a.key));
  assert.equal(repos.membership.settings("p1").version, before + 1);
  assert.equal(repos.recommendations.answers("h1", "c1").about[0].text, "supper", "discovery falls back to account preferences");
  db.close();
});

test("an empty set of answers does not count as having preferences", () => {
  const { db, repos } = setup();
  assert.throws(() => repos.membership.savePreferences("h1", { about: [], wants: [], avoid: [] }), /choose_at_least_one_preference/);
  // Automatic matching stores an empty set on the user's behalf; it must not unlock groups.
  repos.recommendations.savePersonal("friend", "c1", {});
  db.prepare("INSERT INTO user_group_preferences(user_id,answers_json) VALUES('h1','{\"about\":[],\"wants\":[],\"avoid\":[]}')").run();
  migrateUserPreferences(db);
  assert.equal(repos.membership.preferences("friend"), null);
  assert.equal(repos.membership.preferences("h1"), null);
  assert.equal(db.prepare("SELECT count(*) n FROM user_group_preferences").get().n, 0);
  db.close();
});

test("existing users are seeded from their latest group answers", () => {
  const { db, repos } = setup();
  repos.membership.configure("h1", "p1", {});
  repos.membership.saveAnswers("h1", "p1", answers);
  assert.equal(repos.membership.preferences("h1"), null);
  migrateUserPreferences(db);
  assert.equal(repos.membership.preferences("h1").about[0].text, "singalong");
  db.close();
});
