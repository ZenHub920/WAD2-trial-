const SECTIONS = ['vip', 'standing_pen', 'category_1', 'category_2', 'category_3', 'category_4', 'category_5', 'category_6', 'pit', 'ga_standing', 'lower_bowl', 'upper_bowl', 'seated_any'];

/** Widen seating checks without relabeling historical sections or losing columns. */
export function migrateSeating(db) {
  const upgrades = [];
  for (const [table, column] of [['parties', 'section'], ['seeker_requests', 'section_pref'], ['concert_participants', 'section_pref']]) {
    const definition = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)?.sql;
    if (!definition) continue;
    const check = new RegExp(`CHECK\\s*\\(\\s*${column}\\s+IN\\s*\\(([^)]+)\\)\\s*\\)`, 'i');
    const match = definition.match(check);
    if (!match) throw new Error(`seating_migration_missing_check:${table}`);
    const values = match[1].split(',').map(value => value.trim());
    if (SECTIONS.every(section => values.includes(`'${section}'`))) continue;
    upgrades.push({ table, definition: definition.replace(check, `CHECK (${column} IN (${SECTIONS.map(section => `'${section}'`).join(',')}))`) });
  }
  if (!upgrades.length) return;

  const foreignKeys = db.pragma('foreign_keys', { simple: true });
  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      // Cross-table triggers also reference these tables. Remove them temporarily
      // so ALTER TABLE does not validate a schema with a temporarily missing table.
      const triggers = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND sql IS NOT NULL").all();
      for (const trigger of triggers) db.exec(`DROP TRIGGER "${trigger.name.replaceAll('"', '""')}"`);
      for (const { table, definition } of upgrades) {
        const indexes = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL").all(table);
        const temporary = `${table}_seating_upgrade`;
        const create = new RegExp('CREATE TABLE\\s+(?:IF NOT EXISTS\\s+)?["`]?' + table + '["`]?', 'i');
        db.exec(definition.replace(create, `CREATE TABLE ${temporary}`));
        const columns = db.prepare(`PRAGMA table_info(${table})`).all().map(column => `"${column.name.replaceAll('"', '""')}"`).join(',');
        db.exec(`INSERT INTO ${temporary} (${columns}) SELECT ${columns} FROM ${table}`);
        db.exec(`DROP TABLE ${table}`);
        db.exec(`ALTER TABLE ${temporary} RENAME TO ${table}`);
        for (const index of indexes) db.exec(index.sql);
      }
      for (const trigger of triggers) db.exec(trigger.sql);
      if (db.pragma('foreign_key_check').length) throw new Error('seating_migration_foreign_key_failure');
    }).immediate();
  } finally {
    db.pragma(`foreign_keys = ${foreignKeys ? 'ON' : 'OFF'}`);
  }
}
