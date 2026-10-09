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

  return db;
}

/** For tests: an isolated in-memory database with the schema applied. */
export function createTestDb() {
  const testDb = new Database(':memory:');
  testDb.pragma('foreign_keys = ON');
  testDb.exec(readFileSync(join(here, 'schema.sql'), 'utf8'));
  return testDb;
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}
