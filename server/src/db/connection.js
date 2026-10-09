/**
 * Database connection and schema bootstrap.
 *
 * SQLite is used because it needs no server process, which keeps the project
 * runnable from a clone. The data access is confined to repositories.js, so
 * swapping in MySQL or Postgres means rewriting one file, not the application.
 */

import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

let db = null;

export function getDb() {
  if (db) return db;

  const file = process.env.ENCORE_DB ?? join(here, '../../data/encore.db');
  db = new Database(file === ':memory:' ? ':memory:' : file);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const schema = readFileSync(join(here, 'schema.sql'), 'utf8');
  db.exec(schema);
  const userColumns = db.prepare('PRAGMA table_info(users)').all();
  if (!userColumns.some((column) => column.name === 'password_hash')) {
    db.exec('ALTER TABLE users ADD COLUMN password_hash TEXT');
  }
  const partyColumns = db.prepare('PRAGMA table_info(parties)').all();
  if (!partyColumns.some((column) => column.name === 'price_cents')) {
    db.exec('ALTER TABLE parties ADD COLUMN price_cents INTEGER');
  }
  if (!partyColumns.some((column) => column.name === 'image_data')) {
    db.exec('ALTER TABLE parties ADD COLUMN image_data TEXT');
  }
  migrate(db);

  return db;
}

/**
 * Add columns introduced after a database was first created.
 *
 * Every CREATE in schema.sql is `IF NOT EXISTS`, which means an existing file
 * keeps whatever shape it had — new columns in the CREATE statement are simply
 * never applied. Without this, anyone with a database from before the guarantee
 * ledger lands gets "no such column" on their next round instead of a migration.
 *
 * Deliberately minimal: additive, nullable columns only. Anything needing a
 * table rewrite belongs in a real migration tool, not here.
 */
const ADDED_COLUMNS = [
  ['parties', 'min_size', 'INTEGER'],
  ['seeker_requests', 'linked_request_id', 'TEXT'],
  ['match_rounds', 'solver_id', 'TEXT'],
  ['match_rounds', 'instance_class', 'TEXT'],
  ['match_rounds', 'stability_promise', 'TEXT'],
  ['match_rounds', 'relaxations_json', 'TEXT'],
  ['match_rounds', 'ledger_json', 'TEXT'],
];

function migrate(target) {
  for (const [table, column, type] of ADDED_COLUMNS) {
    const existing = target.prepare(`PRAGMA table_info(${table})`).all();
    if (existing.length === 0) continue; // table not created yet
    if (existing.some((c) => c.name === column)) continue;
    target.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

/** For tests: an isolated in-memory database with the schema applied. */
export function createTestDb() {
  const testDb = new Database(':memory:');
  testDb.pragma('foreign_keys = ON');
  testDb.exec(readFileSync(join(here, 'schema.sql'), 'utf8'));
  migrate(testDb);
  return testDb;
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}
