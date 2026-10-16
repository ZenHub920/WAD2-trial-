/** Additive group tables and the one-host/many-groups schema upgrade. */
export function migrateGroups(db) {
  const definition = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'parties'").get()?.sql;
  const onePerConcert = /,?\s*UNIQUE\s*\(host_user_id,\s*concert_id\)/i;
  // SQLite's inline UNIQUE constraint cannot be dropped with ALTER TABLE.
  // Copy every column and preserve all referencing IDs, with FK checks before commit.
  if (definition && onePerConcert.test(definition)) {
    const foreignKeys = db.pragma('foreign_keys', { simple: true });
    db.pragma('foreign_keys = OFF');
    try {
      db.transaction(() => {
        const indexes = db.prepare("SELECT sql FROM sqlite_master WHERE type IN ('index','trigger') AND tbl_name = 'parties' AND sql IS NOT NULL").all();
        db.exec(definition.replace(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?["`]?parties["`]?/i, 'CREATE TABLE parties_group_upgrade').replace(onePerConcert, ''));
        const columns = db.prepare('PRAGMA table_info(parties)').all().map(c => `"${c.name}"`).join(',');
        db.exec(`INSERT INTO parties_group_upgrade (${columns}) SELECT ${columns} FROM parties`);
        db.exec('DROP TABLE parties');
        db.exec('ALTER TABLE parties_group_upgrade RENAME TO parties');
        for (const index of indexes) db.exec(index.sql);
        if (db.pragma('foreign_key_check').length) throw new Error('group_migration_foreign_key_failure');
      }).immediate();
    } finally {
      db.pragma(`foreign_keys = ${foreignKeys ? 'ON' : 'OFF'}`);
    }
  }
  db.transaction(() => db.exec(`
    CREATE TABLE IF NOT EXISTS seeker_party_preferences (
      seeker_request_id TEXT NOT NULL REFERENCES seeker_requests(id) ON DELETE CASCADE,
      party_id TEXT NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (seeker_request_id, party_id)
    );
    CREATE INDEX IF NOT EXISTS idx_group_preferences_party ON seeker_party_preferences(party_id);
    CREATE TABLE IF NOT EXISTS group_connections (
      id TEXT PRIMARY KEY,
      party_a_id TEXT NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
      party_b_id TEXT NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
      initiator_party_id TEXT NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      responded_at TEXT,
      CHECK (party_a_id < party_b_id),
      CHECK (initiator_party_id IN (party_a_id, party_b_id)),
      UNIQUE (party_a_id, party_b_id)
    );
    CREATE INDEX IF NOT EXISTS idx_group_connections_b ON group_connections(party_b_id);
  `)).immediate();
}
