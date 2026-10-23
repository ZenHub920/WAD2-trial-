import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../src/db/connection.js';
import { readMessagePage } from '../src/db/messagePage.js';

test('cursor pages preserve burst order, bound responses, and reject cross-thread cursors', () => {
  const db = createTestDb();
  try {
    db.exec("INSERT INTO users(id,display_name,age_band,home_region,gender,vibe_json) VALUES('u','U','21-24','central','f','{}'),('v','V','21-24','central','f','{}'); INSERT INTO concerts(id,artist,venue,city,event_date) VALUES('c','A','V','SG','2030-01-01'); INSERT INTO conversations(id,concert_id,user_a_id,user_b_id) VALUES('one','c','u','v');");
    const add = db.prepare("INSERT INTO messages(id,conversation_id,sender_user_id,body) VALUES(?,'one','u','hello')");
    for (let i = 0; i < 125; i++) add.run(`m${i}`);
    const latest = readMessagePage(db, 'kaki', 'one');
    assert.equal(latest.rows.length, 50);
    assert.equal(latest.rows[0].id, 'm75');
    const older = readMessagePage(db, 'kaki', 'one', { before: latest.page.nextCursor });
    assert.equal(older.rows[0].id, 'm25');
    const oldest = readMessagePage(db, 'kaki', 'one', { before: older.page.nextCursor });
    assert.equal(oldest.rows.length, 25);
    assert.equal(oldest.page.nextCursor, null);
    assert.equal(new Set([...oldest.rows, ...older.rows, ...latest.rows].map((m) => m.id)).size, 125);
    const newer = readMessagePage(db, 'kaki', 'one', { after: 'm24', limit: 100 });
    assert.equal(newer.rows[0].id, 'm25');
    assert.throws(() => readMessagePage(db, 'kaki', 'other-thread', { before: 'm1' }), /invalid_message_cursor/);
    assert.throws(() => readMessagePage(db, 'kaki', 'one', { limit: 1000 }), /invalid_message_cursor/);
  } finally { db.close(); }
});
