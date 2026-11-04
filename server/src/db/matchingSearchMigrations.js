/** A receipt also covers an empty search, which intentionally creates no round. */
export function migrateMatchingSearches(db) {
  db.transaction(() => {
    db.exec(`CREATE TABLE IF NOT EXISTS matching_search_requests (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      concert_id TEXT NOT NULL REFERENCES concerts(id) ON DELETE CASCADE,
      request_key TEXT NOT NULL CHECK(length(request_key)=36),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY(user_id,concert_id,request_key)
    )`);
    const columns = new Set(db.prepare('PRAGMA table_info(matching_search_requests)').all().map(row => row.name));
    // Old receipts already prevent another round. Their outcome was not saved,
    // so keep it unknown rather than fabricating a historical unsuccessful search.
    for (const [name, definition] of Object.entries({
      completed_at: 'TEXT',
      outcome: "TEXT CHECK(outcome IN ('waiting','proposed','confirmed'))",
      received_proposal: 'INTEGER CHECK(received_proposal IN (0,1))',
      proposal_id: 'TEXT',
      ran_matching: 'INTEGER CHECK(ran_matching IN (0,1))',
    })) {
      if (!columns.has(name)) db.exec(`ALTER TABLE matching_search_requests ADD COLUMN ${name} ${definition}`);
    }
  }).immediate();
}
