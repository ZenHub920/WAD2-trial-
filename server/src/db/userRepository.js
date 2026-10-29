import { randomUUID } from 'node:crypto';
import { mapUser } from './rowMappers.js';

export function createUserRepo(db) {
  return {
    create(data) {
      const id = data.id ?? `u_${randomUUID().slice(0, 8)}`;
      db.prepare(`
        INSERT INTO users (id, display_name, email, password_hash, age_band, home_region, gender,
                           companion_gender_pref, languages_json, vibe_json,
                           reliability, verified)
        VALUES (@id, @display_name, @email, @password_hash, @age_band, @home_region, @gender,
                @companion_gender_pref, @languages_json, @vibe_json,
                @reliability, @verified)
      `).run({
        id,
        display_name: data.display_name,
        email: data.email ?? null,
        password_hash: data.password_hash ?? null,
        age_band: data.age_band,
        home_region: data.home_region,
        gender: data.gender,
        companion_gender_pref: data.companion_gender_pref ?? 'any',
        languages_json: JSON.stringify(data.languages ?? ['en']),
        vibe_json: JSON.stringify(data.vibe),
        reliability: data.reliability ?? 0.75,
        verified: data.verified ? 1 : 0,
      });
      return this.findById(id);
    },

    findById(id) {
      return mapUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id));
    },

    findByEmail(email) {
      return db.prepare('SELECT * FROM users WHERE lower(email) = lower(?)').get(email);
    },

    /** Account-wide answers shared by group matching and companion ranking. */
    groupAnswers(id) {
      return db.prepare('SELECT answers_json FROM user_group_preferences WHERE user_id = ?')
        .get(id)?.answers_json ?? null;
    },

    /** Stores the filename only; pass null to fall back to the silhouette. */
    setAvatar(id, filename) {
      db.prepare('UPDATE users SET avatar_path = ? WHERE id = ?').run(filename ?? null, id);
    },

    list(limit = 100) {
      return db.prepare('SELECT * FROM users ORDER BY created_at DESC LIMIT ?')
        .all(limit).map(mapUser);
    },
    updateProfile(id, changes) {
      const columns = {
        displayName: 'display_name',
        ageBand: 'age_band',
        homeRegion: 'home_region',
        gender: 'gender',
        companionGenderPref: 'companion_gender_pref',
        languages: 'languages_json',
        vibe: 'vibe_json',
      };
      const entries = Object.entries(changes).map(([key, value]) => [columns[key], key === 'languages' || key === 'vibe' ? JSON.stringify(value) : value]);
      if (entries.length) {
        db.prepare(`UPDATE users SET ${entries.map(([column]) => `${column} = ?`).join(', ')} WHERE id = ?`)
          .run(...entries.map(([, value]) => value), id);
      }
      return this.findById(id);
    },

    /** Recompute the cached reliability projection from the feedback view. */
    refreshReliability(userId) {
      const row = db.prepare('SELECT derived_reliability FROM user_reliability WHERE user_id = ?')
        .get(userId);
      if (!row) return null;
      db.prepare('UPDATE users SET reliability = ? WHERE id = ?')
        .run(row.derived_reliability, userId);
      return row.derived_reliability;
    },

    blocklist() {
      const rows = db.prepare('SELECT blocker_user_id, blocked_user_id FROM blocks').all();
      return new Set(rows.map((r) => `${r.blocker_user_id}:${r.blocked_user_id}`));
    },

    block(blockerId, blockedId) {
      db.prepare('INSERT OR IGNORE INTO blocks (blocker_user_id, blocked_user_id) VALUES (?, ?)')
        .run(blockerId, blockedId);
    },
  };
}

export function createSessionRepo(db) {
  return {
    create(tokenHash, userId, expiresAt) {
      db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
        .run(tokenHash, userId, expiresAt);
    },
    findUserId(tokenHash, now) {
      return db.prepare('SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at > ?')
        .get(tokenHash, now)?.user_id ?? null;
    },
    delete(tokenHash) {
      db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
    },
  };
}
