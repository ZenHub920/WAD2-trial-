/** Additive, repeatable upgrade. Conflicting historical memberships are retained for review. */
export function migrateCommunity(db) {
  db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS group_settings (
        party_id TEXT PRIMARY KEY REFERENCES parties(id) ON DELETE CASCADE,
        expected_friends INTEGER NOT NULL DEFAULT 0 CHECK(expected_friends BETWEEN 0 AND 100),
        published INTEGER NOT NULL DEFAULT 0 CHECK(published IN (0,1)),
        connect_open INTEGER NOT NULL DEFAULT 0 CHECK(connect_open IN (0,1))
      );
      CREATE TABLE IF NOT EXISTS group_memberships (
        party_id TEXT NOT NULL REFERENCES parties(id), user_id TEXT NOT NULL REFERENCES users(id),
        concert_id TEXT NOT NULL REFERENCES concerts(id),
        source TEXT NOT NULL CHECK(source IN ('host','friend','join','proposal')),
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','left')),
        joined_at TEXT NOT NULL DEFAULT (datetime('now')), left_at TEXT,
        PRIMARY KEY(party_id,user_id)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_one_attendance_group ON group_memberships(user_id,concert_id) WHERE status='active';
      CREATE TABLE IF NOT EXISTS membership_conflicts (
        party_id TEXT NOT NULL, user_id TEXT NOT NULL, reason TEXT NOT NULL,
        PRIMARY KEY(party_id,user_id)
      );
      CREATE TABLE IF NOT EXISTS group_member_preferences (
        party_id TEXT NOT NULL REFERENCES parties(id), user_id TEXT NOT NULL REFERENCES users(id),
        answers_json TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY(party_id,user_id)
      );
      CREATE TABLE IF NOT EXISTS seeker_discovery_preferences (
        user_id TEXT NOT NULL REFERENCES users(id), concert_id TEXT NOT NULL REFERENCES concerts(id),
        answers_json TEXT NOT NULL, PRIMARY KEY(user_id,concert_id)
      );
      CREATE TABLE IF NOT EXISTS group_friend_invites (
        id TEXT PRIMARY KEY, party_id TEXT NOT NULL REFERENCES parties(id), token_hash TEXT NOT NULL UNIQUE,
        expires_at INTEGER NOT NULL, accepted_by TEXT REFERENCES users(id), accepted_at TEXT, revoked INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS group_join_requests (
        id TEXT PRIMARY KEY, party_id TEXT NOT NULL REFERENCES parties(id), user_id TEXT NOT NULL REFERENCES users(id),
        status TEXT NOT NULL CHECK(status IN ('pending','accepted','rejected','withdrawn','expired')),
        expires_at INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), responded_at TEXT,
        UNIQUE(party_id,user_id)
      );
      CREATE INDEX IF NOT EXISTS idx_join_requests_user ON group_join_requests(user_id,status);
      CREATE TRIGGER IF NOT EXISTS one_host_group_insert BEFORE INSERT ON parties WHEN NEW.status <> 'cancelled'
      BEGIN
        SELECT RAISE(ABORT,'already_in_concert_group') WHERE EXISTS(
          SELECT 1 FROM parties WHERE host_user_id=NEW.host_user_id AND concert_id=NEW.concert_id AND status<>'cancelled')
          OR EXISTS(SELECT 1 FROM group_memberships WHERE user_id=NEW.host_user_id AND concert_id=NEW.concert_id AND status='active');
      END;
      CREATE TRIGGER IF NOT EXISTS membership_concert_guard BEFORE INSERT ON group_memberships BEGIN
        SELECT RAISE(ABORT,'membership_concert_mismatch') WHERE NOT EXISTS(SELECT 1 FROM parties WHERE id=NEW.party_id AND concert_id=NEW.concert_id);
      END;
      CREATE TRIGGER IF NOT EXISTS one_host_group_update BEFORE UPDATE OF status,host_user_id,concert_id ON parties WHEN NEW.status <> 'cancelled'
      BEGIN
        SELECT RAISE(ABORT,'already_in_concert_group') WHERE EXISTS(
          SELECT 1 FROM parties WHERE id<>NEW.id AND host_user_id=NEW.host_user_id AND concert_id=NEW.concert_id AND status<>'cancelled')
          OR EXISTS(SELECT 1 FROM group_memberships WHERE party_id<>NEW.id AND user_id=NEW.host_user_id AND concert_id=NEW.concert_id AND status='active');
      END;
    `);
    // Do not silently discard duplicate legacy groups or assign a person twice.
    const add = db.prepare(`INSERT OR IGNORE INTO group_memberships(party_id,user_id,concert_id,source) VALUES(?,?,?,?)`);
    const conflict = db.prepare('INSERT OR IGNORE INTO membership_conflicts VALUES(?,?,?)');
    const rows = db.prepare(`SELECT p.id AS party_id,p.host_user_id AS user_id,p.concert_id,'host' AS source FROM parties p
      WHERE p.status<>'cancelled' AND NOT EXISTS(SELECT 1 FROM tickets WHERE source_party_id=p.id)
      UNION ALL SELECT mp.party_id,s.user_id,p.concert_id,'proposal' FROM match_proposals mp
      JOIN seeker_requests s ON s.id=mp.seeker_request_id JOIN parties p ON p.id=mp.party_id
      WHERE mp.status='confirmed' AND p.status<>'cancelled'`).all();
    for (const r of rows) {
      const existing = db.prepare("SELECT party_id FROM group_memberships WHERE user_id=? AND concert_id=? AND status='active'").get(r.user_id,r.concert_id);
      if (existing && existing.party_id !== r.party_id) conflict.run(r.party_id,r.user_id,'multiple_legacy_groups');
      else add.run(r.party_id,r.user_id,r.concert_id,r.source);
    }
  }).immediate();
}
