import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { migrateGenderPref } from '../src/db/genderPrefMigration.js';

test('legacy same_only preferences become the user\'s own gender, or any', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      gender TEXT NOT NULL,
      companion_gender_pref TEXT NOT NULL DEFAULT 'any' CHECK (companion_gender_pref IN ('any','same_only'))
    );
    CREATE TABLE sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE);
    CREATE VIEW user_genders AS SELECT id, gender FROM users;
    INSERT INTO users VALUES ('f1','f','same_only'), ('m1','m','same_only'), ('nb1','nb','same_only'), ('a1','f','any');
    INSERT INTO sessions VALUES ('t','f1');
  `);
  db.pragma('foreign_keys = ON');

  migrateGenderPref(db);

  const prefs = Object.fromEntries(db.prepare('SELECT id, companion_gender_pref p FROM users').all().map(r => [r.id, r.p]));
  assert.deepEqual(prefs, { f1: 'female', m1: 'male', nb1: 'any', a1: 'any' });
  assert.equal(db.prepare('SELECT count(*) n FROM user_genders').get().n, 4);
  assert.equal(db.prepare('SELECT user_id FROM sessions').get().user_id, 'f1');
  assert.throws(() => db.prepare("UPDATE users SET companion_gender_pref='same_only' WHERE id='a1'").run(), /CHECK/);
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1);

  migrateGenderPref(db); // already upgraded: no-op
});
