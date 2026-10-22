/**
 * One set of group preferences per user.
 *
 * Preferences used to be answered again for every group and every concert.
 * They now live once on the user and are copied into each group they join.
 * Existing users are seeded from their most recent saved answers, and active
 * members missing a group copy get one, so nobody is asked twice.
 * Additive and repeatable.
 */
export function migrateUserPreferences(db) {
  db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS user_group_preferences (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        answers_json TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    // Automatic matching saves an empty set on the user's behalf; that is not
    // an answer, so it neither seeds nor counts as having preferences.
    const answered = (column) => `(json_array_length(${column},'$.about') + json_array_length(${column},'$.wants') + json_array_length(${column},'$.avoid')) > 0`;
    // INSERT OR IGNORE keeps the first row per user, so newest go first.
    db.exec(`
      DELETE FROM user_group_preferences WHERE NOT ${answered('answers_json')};
      INSERT OR IGNORE INTO user_group_preferences(user_id, answers_json)
        SELECT user_id, answers_json FROM group_member_preferences WHERE ${answered('answers_json')} ORDER BY updated_at DESC;
      INSERT OR IGNORE INTO user_group_preferences(user_id, answers_json)
        SELECT user_id, answers_json FROM seeker_discovery_preferences WHERE ${answered('answers_json')};
      INSERT OR IGNORE INTO group_member_preferences(party_id, user_id, answers_json)
        SELECT m.party_id, m.user_id, u.answers_json FROM group_memberships m
        JOIN user_group_preferences u ON u.user_id = m.user_id WHERE m.status = 'active';
    `);
  })();
}
