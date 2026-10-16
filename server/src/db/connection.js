/**
 * Database connection and schema bootstrap.
 *
 * SQLite is used because it needs no server process, which keeps the project
 * runnable from a clone. The data access is confined to repositories.js, so
 * swapping in MySQL or Postgres means rewriting one file, not the application.
 */

import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTicketImages, decodeTicketImage } from '../services/ticketImages.js';
import { migrateGroups } from './groupMigrations.js';
import { migrateCommunity } from './communityMigrations.js';
import { migrateNotifications } from './notificationRepository.js';
const here = dirname(fileURLToPath(import.meta.url));

let db = null;

export function getDb() {
  if (db) return db;

  const file = process.env.ENCORE_DB ?? join(here, '../../data/encore.db');
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  db = new Database(file === ':memory:' ? ':memory:' : file);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const schema = readFileSync(join(here, 'schema.sql'), 'utf8');
  db.exec(schema);
  const userColumns = db.prepare('PRAGMA table_info(users)').all();
  if (!userColumns.some((column) => column.name === 'password_hash')) {
    db.exec('ALTER TABLE users ADD COLUMN password_hash TEXT');
  }
  migrate(db);
  migrateGroups(db);
  migrateLegacyTickets(db);
  migrateCommunity(db);
  migrateNotifications(db);
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
 * Additive migrations only. Columns with defaults preserve existing rows
 * without rebuilding their tables.
 */
const ADDED_COLUMNS = [
  ['users', 'is_operator', 'INTEGER NOT NULL DEFAULT 0 CHECK (is_operator IN (0,1))'],
  ['concerts', 'source', 'TEXT'],
  ['concerts', 'source_event_id', 'TEXT'],
  ['concerts', 'official_url', 'TEXT'],
  ['concerts', 'image_attribution', 'TEXT'],
  ['parties', 'min_size', 'INTEGER'],
  ['seeker_requests', 'linked_request_id', 'TEXT'],
  ['match_rounds', 'solver_id', 'TEXT'],
  ['match_rounds', 'instance_class', 'TEXT'],
  ['match_rounds', 'stability_promise', 'TEXT'],
  ['match_rounds', 'relaxations_json', 'TEXT'],
  ['match_rounds', 'ledger_json', 'TEXT'],
  ['tickets', 'verified', 'INTEGER NOT NULL DEFAULT 0 CHECK (verified IN (0,1))'],
  ['tickets', 'verification_status', 'TEXT'],
  ['tickets', 'verification_method', 'TEXT'],
  ['tickets', 'proof_data', 'TEXT'],
  ['tickets', 'review_note', 'TEXT'],
  ['tickets', 'reviewed_by', 'TEXT'],
  ['tickets', 'reviewed_at', 'TEXT'],
  
  // #4: A committed matching round can be identified by its batch key.
  ['match_rounds', 'batch_key', 'TEXT'],

  // ============================================================
// PROFILE ONBOARDING - Improvement #11
// ============================================================
//
// Records when the user completed their initial preference
// setup.
//
// NULL means the user has not yet completed onboarding.
//
// We store an explicit timestamp instead of inferring
// completion from preference scores because a zero score
// can be a valid user preference.

  ['users', 'onboarding_completed_at', 'TEXT'],
// ============================================================
// HISTORICAL MATCH EXPLANATIONS - Improvement #12
// ============================================================
//
// Stores the compatibility components used when the original
// Gale-Shapley matching round was executed.
//
// WHY STORE THEM?
// User profiles can change after matching.
//
// Without preserving the original values, an explanation
// recalculated next week could show different scores from
// those actually used during the matching round.
//
// JSON is stored as TEXT because SQLite does not require
// a separate native JSON column type.

  ['match_results', 'score_breakdown_json', 'TEXT'],

  // ============================================================
  // KAKI CHAT — reply, edit, soft delete, and report evidence
  // ============================================================
  // Added to `messages` and `reports` after both tables shipped, so existing
  // databases need them applied here as well as in schema.sql.
  //
  // SQLite cannot add a column with a REFERENCES clause via ALTER TABLE, so
  // these arrive untyped by foreign key on an existing database. Fresh
  // databases get the full constraints from schema.sql. The application
  // enforces the same rules either way.
  ['messages', 'reply_to_message_id', 'TEXT'],
  ['messages', 'edited_at', 'TEXT'],
  ['messages', 'deleted_at', 'TEXT'],
  ['reports', 'conversation_id', 'TEXT'],
  ['reports', 'message_id', 'TEXT'],

  // Optional profile picture. Existing accounts keep NULL, which the UI shows
  // as a grey silhouette, so nobody is forced to upload one.
  ['users', 'avatar_path', 'TEXT'],
];

function migrate(target) {
  for (const [table, column, type] of ADDED_COLUMNS) {
    const existing = target.prepare(`PRAGMA table_info(${table})`).all();
    if (existing.length === 0) continue; // table not created yet
    if (existing.some((c) => c.name === column)) continue;
    target.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
  target.exec('CREATE INDEX IF NOT EXISTS idx_tickets_verification ON tickets(verification_status)');
  target.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_concerts_source_event
    ON concerts(source, source_event_id)`);
  // ============================================================
  // IMPROVEMENT #4: IDEMPOTENCY INDEX
  // ============================================================
  //
  // PURPOSE:
  // Prevent two matching rounds from being committed with
  // the same idempotency key for the same concert.
  //
  // WHY IS THIS NECESSARY?
  //
  // The service already checks for an existing batchKey.
  // However, we also want SQLite itself to enforce this rule.
  //
  // This creates a database-level guarantee even if application
  // logic changes in the future.
  //
  // IMPORTANT:
  // This index must be created AFTER the migration loop above.
  // Otherwise, an older database without batch_key would fail.

  target.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_rounds_batch
    ON match_rounds(concert_id, batch_key)
    WHERE batch_key IS NOT NULL
  `);
}

/** Preserve historical parties (and their match-result foreign keys) while
 * moving sale inventory into its own table. The unique source id makes this
 * safe to repeat after a process restart. */
export function migrateLegacyTickets(target, imageDir = process.env.ENCORE_TICKET_IMAGE_DIR ?? join(here, '../../data/ticket-images')) {
  const columns = target.prepare('PRAGMA table_info(parties)').all();
  if (!columns.some((column) => column.name === 'price_cents')) return;
  const images = createTicketImages(imageDir);
  const hasImage = columns.some((column) => column.name === 'image_data');
  const rows = target.prepare(`
    SELECT p.*, t.id AS ticket_id FROM parties p
    LEFT JOIN tickets t ON t.source_party_id = p.id
    WHERE p.price_cents IS NOT NULL AND (t.id IS NULL OR p.status = 'open')
  `).all();
  for (const row of rows) {
    let imagePath = null;
    if (!row.ticket_id && hasImage && row.image_data) {
      try {
        decodeTicketImage(row.image_data);
        imagePath = images.save(row.image_data);
      } catch (err) {
        if (err.message !== 'invalid_image') throw err;
        // Old unvalidated uploads remain on their historical party rows.
      }
    }
    try {
      target.transaction(() => {
        if (!row.ticket_id) target.prepare(`
          INSERT INTO tickets
            (id, seller_user_id, concert_id, price_cents, quantity, section,
             description, image_path, status, source_party_id, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(`t_${randomUUID()}`, row.host_user_id, row.concert_id, row.price_cents,
          row.capacity, row.section, row.notes ?? '', imagePath,
          row.status === 'open' ? 'active' : row.status === 'matched' ? 'sold' : 'cancelled',
          row.id, row.created_at);
        if (row.status === 'open') {
          target.prepare("UPDATE parties SET status = 'cancelled' WHERE id = ?").run(row.id);
        }
      })();
    } catch (err) {
      images.remove(imagePath);
      throw err;
    }
  }
}

/** For tests: an isolated in-memory database with the schema applied. */
export function createTestDb() {
  const testDb = new Database(':memory:');
  testDb.pragma('foreign_keys = ON');
  testDb.exec(readFileSync(join(here, 'schema.sql'), 'utf8'));
  migrate(testDb);
  migrateGroups(testDb);
  migrateLegacyTickets(testDb);
  migrateCommunity(testDb);
  migrateNotifications(testDb);
  return testDb;
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}
