import { randomUUID } from 'node:crypto';
import { mapParty, USER_COLUMNS } from './rowMappers.js';
import { availableCapacitySql, reservedPlacesSql, queueablePlacesSql } from './capacity.js';

export function createPartyRepo(db) {
  return {
    create(data) {
      const id = data.id ?? `p_${randomUUID().slice(0, 8)}`;
      db.prepare(`
        INSERT INTO parties (id, host_user_id, concert_id, capacity, section, spend_band,
                             arrival_plan, plans_json, strict_age_policy, min_age_band, notes, name)
        VALUES (@id, @host_user_id, @concert_id, @capacity, @section, @spend_band,
                @arrival_plan, @plans_json, @strict_age_policy, @min_age_band, @notes, @name)
      `).run({
        id,
        host_user_id: data.host_user_id,
        concert_id: data.concert_id,
        capacity: data.capacity,
        section: data.section,
        spend_band: data.spend_band,
        arrival_plan: data.arrival_plan,
        plans_json: JSON.stringify(data.plans ?? {}),
        strict_age_policy: data.strict_age_policy ? 1 : 0,
        min_age_band: data.min_age_band ?? null,
        notes: data.notes ?? null,
        name: data.name ?? null,
      });
      return this.findById(id);
    },

    setName(id, name) {
      db.prepare('UPDATE parties SET name = ? WHERE id = ?').run(name ?? null, id);
    },

    setImage(id, filename) {
      db.prepare('UPDATE parties SET image_path = ? WHERE id = ?').run(filename ?? null, id);
    },

    findById(id) {
      const row = db.prepare(`
        SELECT p.*, ${availableCapacitySql()} AS capacity, ${queueablePlacesSql('p.id')} AS queueable_places, ${USER_COLUMNS('u', 'host_')}
        FROM parties p JOIN users u ON u.id = p.host_user_id
        WHERE p.id = ?
      `).get(id);
      if (row) row.remaining_capacity = Math.max(0, row.capacity - db.prepare(`SELECT ${reservedPlacesSql('@id')} AS n`).get({id}).n);
      return mapParty(row);
    },

    /** Open published groups with capacity after live seat reservations. */
    openForConcert(concertId) {
      const rows = db.prepare(`
        SELECT p.*, ${availableCapacitySql()} AS capacity,
          ${USER_COLUMNS('u', 'host_')},
          ${availableCapacitySql()} - ${reservedPlacesSql('p.id')} AS remaining_capacity
        FROM parties p
        JOIN users u ON u.id = p.host_user_id
        WHERE p.concert_id = ? AND p.status = 'open'
          AND NOT EXISTS (SELECT 1 FROM tickets t WHERE t.source_party_id = p.id)
          AND ${availableCapacitySql()} > ${reservedPlacesSql('p.id')}
          AND NOT EXISTS(SELECT 1 FROM group_settings gs WHERE gs.party_id=p.id AND gs.published=0)
        ORDER BY p.id
      `).all(concertId);
      return rows.map(mapParty);
    },

    /** Queue admission stays open while at least one stranger place is unconfirmed. */
    queueableForConcert(concertId) {
      return db.prepare(`SELECT p.*,${availableCapacitySql()} capacity,
        ${availableCapacitySql()}-${reservedPlacesSql('p.id')} remaining_capacity,
        ${queueablePlacesSql('p.id')} queueable_places,${USER_COLUMNS('u','host_')}
        FROM parties p JOIN users u ON u.id=p.host_user_id
        WHERE p.concert_id=? AND p.status IN('open','matched')
          AND ${queueablePlacesSql('p.id')}>0
          AND NOT EXISTS(SELECT 1 FROM tickets t WHERE t.source_party_id=p.id)
          AND NOT EXISTS(SELECT 1 FROM group_settings gs WHERE gs.party_id=p.id AND gs.published=0)
        ORDER BY p.id`).all(concertId).map(mapParty);
    },

    /** Matching updates this status after creating its operational proposals. */
    setStatus(id, status) {
      db.prepare(`UPDATE parties SET status = ? WHERE id = ?`).run(status, id);
    },
  };
}
