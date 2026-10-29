import { randomUUID } from 'node:crypto';
import { mapSeeker, USER_COLUMNS } from './rowMappers.js';

export function createSeekerRepo(db) {
  return {
    create(data) {
      const id = data.id ?? `s_${randomUUID().slice(0, 8)}`;
      db.prepare(`
        INSERT INTO seeker_requests (id, user_id, concert_id, section_pref, spend_band_max,
                                     arrival_pref, plans_wanted_json, strict_age_policy,
                                     age_tolerance, notes, joining_mode)
        VALUES (@id, @user_id, @concert_id, @section_pref, @spend_band_max,
                @arrival_pref, @plans_wanted_json, @strict_age_policy,
                @age_tolerance, @notes, @joining_mode)
      `).run({
        id,
        user_id: data.user_id,
        concert_id: data.concert_id,
        section_pref: data.section_pref,
        spend_band_max: data.spend_band_max,
        arrival_pref: data.arrival_pref,
        plans_wanted_json: JSON.stringify(data.plans_wanted ?? {}),
        strict_age_policy: data.strict_age_policy ? 1 : 0,
        age_tolerance: data.age_tolerance ?? 1,
        notes: data.notes ?? null,
        joining_mode: data.joining_mode ?? 'algorithm',
      });
      return this.findById(id);
    },

    findById(id) {
      const row = db.prepare(`
        SELECT s.*, u.id AS user_id_joined, ${USER_COLUMNS('u', 'user_')}
        FROM seeker_requests s JOIN users u ON u.id = s.user_id
        WHERE s.id = ?
      `).get(id);
      return mapSeeker(row);
    },

    /** Hydrated open requests for one concert — the right side of the instance. */
    openForConcert(concertId) {
      const rows = db.prepare(`
        SELECT s.*, u.id AS user_id_joined, ${USER_COLUMNS('u', 'user_')}
        FROM seeker_requests s JOIN users u ON u.id = s.user_id
        WHERE s.concert_id = ? AND s.status = 'open'
        ORDER BY s.id
      `).all(concertId);
      return rows.map(mapSeeker);
    },

    setStatus(id, status) {
      db.prepare(`UPDATE seeker_requests SET status = ?,
        matching_opt_in = CASE WHEN ? = 'withdrawn' THEN 0 ELSE matching_opt_in END WHERE id = ?`)
        .run(status, status, id);
    },
  };
}
