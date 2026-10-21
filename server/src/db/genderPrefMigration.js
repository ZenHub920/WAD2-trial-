/**
 * Companion gender preference moved from {any, same_only} to {any, male, female}.
 *
 * SQLite cannot change a CHECK constraint in place, so the users table is
 * rebuilt the same way migrateSeating rebuilds its tables. Existing answers are
 * carried over: "same gender only" becomes the user's own gender where that is
 * male or female, and "any" otherwise, since there is no equivalent choice.
 */
const VALUES = ['any', 'male', 'female'];

export function migrateGenderPref(db) {
  const definition = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'").get()?.sql;
  if (!definition) return;
  const check = /CHECK\s*\(\s*companion_gender_pref\s+IN\s*\(([^)]+)\)\s*\)/i;
  const match = definition.match(check);
  if (!match) throw new Error('gender_pref_migration_missing_check');
  if (VALUES.every(value => match[1].includes(`'${value}'`)) && !match[1].includes("'same_only'")) return;

  const upgraded = definition
    .replace(check, `CHECK (companion_gender_pref IN (${VALUES.map(value => `'${value}'`).join(',')}))`)
    .replace(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?["`]?users["`]?/i, 'CREATE TABLE users_gender_pref_upgrade');

  const foreignKeys = db.pragma('foreign_keys', { simple: true });
  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      // Views and triggers read users; drop them while the table is swapped
      // so SQLite does not validate them against a missing table.
      const views = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'view' AND sql IS NOT NULL").all();
      for (const view of views) db.exec(`DROP VIEW "${view.name.replaceAll('"', '""')}"`);
      const triggers = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND sql IS NOT NULL").all();
      for (const trigger of triggers) db.exec(`DROP TRIGGER "${trigger.name.replaceAll('"', '""')}"`);
      const indexes = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'users' AND sql IS NOT NULL").all();

      db.exec(upgraded);
      const names = db.prepare('PRAGMA table_info(users)').all().map(column => column.name);
      const columns = names.map(name => `"${name.replaceAll('"', '""')}"`).join(',');
      const values = names.map(name => name === 'companion_gender_pref'
        ? `CASE WHEN companion_gender_pref = 'same_only' AND gender = 'm' THEN 'male'
                WHEN companion_gender_pref = 'same_only' AND gender = 'f' THEN 'female'
                WHEN companion_gender_pref IN ('male','female') THEN companion_gender_pref
                ELSE 'any' END`
        : `"${name.replaceAll('"', '""')}"`).join(',');
      db.exec(`INSERT INTO users_gender_pref_upgrade (${columns}) SELECT ${values} FROM users`);
      db.exec('DROP TABLE users');
      db.exec('ALTER TABLE users_gender_pref_upgrade RENAME TO users');
      for (const index of indexes) db.exec(index.sql);
      for (const view of views) db.exec(view.sql);
      for (const trigger of triggers) db.exec(trigger.sql);
      if (db.pragma('foreign_key_check').length) throw new Error('gender_pref_migration_foreign_key_failure');
    }).immediate();
  } finally {
    db.pragma(`foreign_keys = ${foreignKeys ? 'ON' : 'OFF'}`);
  }
}
