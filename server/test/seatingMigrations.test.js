import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { createTestDb } from '../src/db/connection.js';
import { migrateGroups } from '../src/db/groupMigrations.js';
import { migrateCommunity } from '../src/db/communityMigrations.js';
import { migrateSeating } from '../src/db/seatingMigrations.js';

const canonical = ['vip', 'standing_pen', 'category_1', 'category_2', 'category_3', 'category_4', 'category_5', 'category_6'];
const legacy = ['pit', 'ga_standing', 'lower_bowl', 'upper_bowl', 'seated_any'];
const schema = readFileSync(new URL('../src/db/schema.sql', import.meta.url), 'utf8');
const oldSchema = schema.replaceAll([...canonical, ...legacy].map(section => `'${section}'`).join(','), legacy.map(section => `'${section}'`).join(','));

function addSection(db, id, section) {
  db.prepare(`INSERT INTO users (id, display_name, age_band, home_region, gender, vibe_json)
    VALUES (?, 'User', '21-24', 'central', 'f', '{}')`).run(`u_${id}`);
  db.prepare(`INSERT INTO parties (id, host_user_id, concert_id, capacity, section, spend_band, arrival_plan, notes, created_at)
    VALUES (?, ?, 'c', 2, ?, 2, 'mid', 'Keep party notes', '2026-01-01')`).run(`p_${id}`, `u_${id}`, section);
  db.prepare(`INSERT INTO seeker_requests (id, user_id, concert_id, section_pref, spend_band_max, arrival_pref, notes, created_at)
    VALUES (?, ?, 'c', ?, 3, 'doors', 'Keep seeker notes', '2026-01-02')`).run(`s_${id}`, `u_${id}`, section);
  db.prepare(`INSERT INTO concert_participants (user_id, concert_id, section_pref, arrival_pref, joined_at)
    VALUES (?, 'c', ?, 'early_queue', '2026-01-03')`).run(`u_${id}`, section);
}

function snapshot(db) {
  return db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
    .map(({ name }) => [name, db.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}" ORDER BY rowid`).all()]);
}

function schemaObjects(db) {
  return db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE type IN ('index', 'trigger') AND sql IS NOT NULL ORDER BY type, name").all();
}

function addConcert(db) {
  db.exec("INSERT INTO concerts (id, artist, venue, city, event_date) VALUES ('c', 'Act', 'Venue', 'Singapore', '2026-12-01')");
}

test('fresh bootstrap accepts every canonical and legacy section in all three tables', () => {
  const db = createTestDb();
  try {
    addConcert(db);
    for (const [index, section] of [...canonical, ...legacy].entries()) addSection(db, index, section);
    const before = snapshot(db);
    migrateSeating(db);
    migrateSeating(db);
    assert.deepEqual(snapshot(db), before);
    assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
    assert.deepEqual(db.pragma('foreign_key_check'), []);
    for (const [table, column] of [['parties', 'section'], ['seeker_requests', 'section_pref'], ['concert_participants', 'section_pref']]) {
      assert.throws(() => db.exec(`UPDATE ${table} SET ${column} = 'not_a_section'`), /CHECK constraint failed/);
    }
  } finally { db.close(); }
});

test('legacy reconstruction preserves data, references, extra columns, indexes and cross-table triggers', () => {
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON');
    db.exec(oldSchema);
    migrateGroups(db);
    migrateCommunity(db);
    addConcert(db);
    for (const [index, section] of legacy.entries()) addSection(db, index, section);
    assert.throws(() => addSection(db, 'before', 'vip'), /CHECK constraint failed/);
    db.exec(`
      ALTER TABLE parties ADD COLUMN historical_note TEXT DEFAULT 'original party';
      ALTER TABLE seeker_requests ADD COLUMN historical_note TEXT DEFAULT 'original seeker';
      ALTER TABLE concert_participants ADD COLUMN historical_note TEXT DEFAULT 'original participation';
      UPDATE parties SET historical_note = 'custom value' WHERE id = 'p_0';
      UPDATE seeker_requests SET linked_request_id = 's_1' WHERE id = 's_0';
      UPDATE seeker_requests SET linked_request_id = 's_0' WHERE id = 's_1';
      CREATE INDEX historical_seekers_index ON seeker_requests(section_pref) WHERE status = 'open';
      CREATE TABLE seating_links (
        id TEXT PRIMARY KEY,
        party_id TEXT REFERENCES parties(id),
        seeker_id TEXT REFERENCES seeker_requests(id),
        user_id TEXT, concert_id TEXT,
        FOREIGN KEY (user_id, concert_id) REFERENCES concert_participants(user_id, concert_id)
      );
      CREATE TRIGGER seating_links_guard BEFORE INSERT ON seating_links BEGIN
        SELECT RAISE(ABORT, 'seating_reference_missing') WHERE
          NOT EXISTS (SELECT 1 FROM parties WHERE id = NEW.party_id) OR
          NOT EXISTS (SELECT 1 FROM seeker_requests WHERE id = NEW.seeker_id) OR
          NOT EXISTS (SELECT 1 FROM concert_participants WHERE user_id = NEW.user_id AND concert_id = NEW.concert_id);
      END;
      INSERT INTO seating_links VALUES ('l', 'p_0', 's_0', 'u_0', 'c');
      INSERT INTO match_rounds (id, concert_id, is_stable, seeker_count, party_count, total_capacity, feasible_pairs, matched_count, metrics_json, timings_json)
        VALUES ('r', 'c', 1, 1, 1, 2, 1, 1, '{}', '{}');
      INSERT INTO match_results (id, round_id, seeker_request_id, party_id, outcome)
        VALUES ('mr', 'r', 's_0', 'p_0', 'matched');
      INSERT INTO match_proposals (id, round_id, match_result_id, seeker_request_id, party_id, status, expires_at)
        VALUES ('mp', 'r', 'mr', 's_0', 'p_0', 'confirmed', 9999999999999);
      INSERT INTO seeker_party_preferences (seeker_request_id, party_id) VALUES ('s_0', 'p_0');
      INSERT INTO tickets (id, seller_user_id, concert_id, price_cents, quantity, section, source_party_id)
        VALUES ('t', 'u_0', 'c', 1000, 1, 'pit', 'p_0');
    `);
    const before = snapshot(db);
    const objects = schemaObjects(db);
    migrateSeating(db);
    assert.deepEqual(snapshot(db), before);
    assert.deepEqual(schemaObjects(db), objects);
    assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
    assert.deepEqual(db.pragma('foreign_key_check'), []);
    for (const [index, section] of canonical.entries()) addSection(db, `new_${index}`, section);
    for (const [index, section] of legacy.entries()) addSection(db, `legacy_${index}`, section);
    db.exec("INSERT INTO seating_links VALUES ('new_link', 'p_new_0', 's_new_0', 'u_new_0', 'c')");
    assert.throws(() => db.exec("INSERT INTO seating_links VALUES ('bad', 'missing', 's_0', 'u_0', 'c')"), /seating_reference_missing/);
    assert.throws(() => db.exec("INSERT INTO seeker_party_preferences VALUES ('missing', 'p_0', '2026-01-01')"), /FOREIGN KEY/);
    assert.throws(() => db.exec("INSERT INTO seeker_party_preferences VALUES ('s_0', 'p_0', '2026-01-01')"), /UNIQUE/);
    const migrated = snapshot(db);
    migrateSeating(db);
    migrateSeating(db);
    assert.deepEqual(snapshot(db), migrated);
    assert.deepEqual(schemaObjects(db), objects);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name LIKE '%_seating_upgrade'").get().n, 0);
    assert.deepEqual(db.pragma('foreign_key_check'), []);
  } finally { db.close(); }
});

test('failed seating reconstruction rolls back rows, constraints and triggers and restores foreign keys', () => {
  const db = new Database(':memory:');
  try {
    db.exec(oldSchema);
    addConcert(db);
    addSection(db, 'old', 'pit');
    db.pragma('foreign_keys = OFF');
    db.exec(`CREATE TABLE broken_reference (party_id TEXT REFERENCES parties(id));
      INSERT INTO broken_reference VALUES ('missing');
      CREATE TRIGGER broken_reference_trigger AFTER INSERT ON broken_reference BEGIN
        SELECT id FROM parties WHERE id = NEW.party_id;
      END;`);
    db.pragma('foreign_keys = ON');
    const before = snapshot(db);
    const objects = schemaObjects(db);
    assert.throws(() => migrateSeating(db), /seating_migration_foreign_key_failure/);
    assert.deepEqual(snapshot(db), before);
    assert.deepEqual(schemaObjects(db), objects);
    assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name LIKE '%_seating_upgrade'").get().n, 0);
    assert.throws(() => db.exec("UPDATE parties SET section = 'vip'"), /CHECK constraint failed/);
  } finally { db.close(); }
});
