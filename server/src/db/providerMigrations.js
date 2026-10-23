export function migrateProviders(db) {
  const columns = new Set(db.prepare('PRAGMA table_info(concerts)').all().map((c) => c.name));
  for (const [name, type] of Object.entries({ event_time: 'TEXT', event_timezone: 'TEXT', provider_status: 'TEXT',
    venue_latitude: 'REAL', venue_longitude: 'REAL', provider_synced_at: 'TEXT' }))
    if (!columns.has(name)) db.exec(`ALTER TABLE concerts ADD COLUMN ${name} ${type}`);
  db.exec(`CREATE TABLE IF NOT EXISTS provider_cache (
    cache_key TEXT PRIMARY KEY, body_json TEXT NOT NULL, synced_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS provider_budget (
    provider TEXT NOT NULL, day TEXT NOT NULL, requests INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(provider,day)
  );
  CREATE TABLE IF NOT EXISTS concert_updates (
    id TEXT PRIMARY KEY, concert_id TEXT NOT NULL REFERENCES concerts(id),
    previous_json TEXT NOT NULL, current_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_concert_provider_status ON concerts(source,event_date,provider_status);
  CREATE INDEX IF NOT EXISTS idx_messages_cursor ON messages(conversation_id);
  CREATE INDEX IF NOT EXISTS idx_market_messages_cursor ON ticket_messages(conversation_id);
  CREATE INDEX IF NOT EXISTS idx_feedback_members ON group_memberships(user_id,party_id);`);
}
