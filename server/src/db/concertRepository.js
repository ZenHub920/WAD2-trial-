import { randomUUID } from 'node:crypto';
import { availableCapacitySql, reservedPlacesSql } from './capacity.js';

export function createConcertRepo(db) {
  return {
    create(data) {
      const id = data.id ?? `c_${randomUUID().slice(0, 8)}`;
      db.prepare(`
        INSERT INTO concerts (id, artist, tour_name, venue, city, event_date,
                              doors_time, hero_image_url, blurb, matching_closes_at)
        VALUES (@id, @artist, @tour_name, @venue, @city, @event_date,
                @doors_time, @hero_image_url, @blurb, @matching_closes_at)
      `).run({
        id,
        artist: data.artist,
        tour_name: data.tour_name ?? null,
        venue: data.venue,
        city: data.city,
        event_date: data.event_date,
        doors_time: data.doors_time ?? null,
        hero_image_url: data.hero_image_url ?? null,
        blurb: data.blurb ?? null,
        matching_closes_at: data.matching_closes_at ?? null,
      });
      return this.findById(id);
    },

    findById(id) {
      return db.prepare('SELECT * FROM concerts WHERE id = ?').get(id) ?? null;
    },

    /** One query supplies the concert list and its live capacity counts. */
    listWithCounts() {
      return db.prepare(`
        SELECT
          c.*,
          (SELECT COUNT(*) FROM parties p
            WHERE p.concert_id = c.id AND p.status = 'open'
              AND ${availableCapacitySql()} > ${reservedPlacesSql('p.id')}
              AND NOT EXISTS(SELECT 1 FROM group_settings gs WHERE gs.party_id=p.id AND gs.published=0)
              AND NOT EXISTS (SELECT 1 FROM tickets t WHERE t.source_party_id = p.id)) AS open_parties,
          (
            SELECT COALESCE(
              SUM(
                ${availableCapacitySql()} - ${reservedPlacesSql('p.id')}
              ),
              0
            )
            FROM parties p
            WHERE p.concert_id = c.id
              AND p.status = 'open'
              AND NOT EXISTS(SELECT 1 FROM group_settings gs WHERE gs.party_id=p.id AND gs.published=0)
              AND NOT EXISTS (
                SELECT 1
                FROM tickets t
                WHERE t.source_party_id = p.id
              )
          ) AS open_slots,
          (SELECT COUNT(*) FROM seeker_requests s
            WHERE s.concert_id = c.id AND s.status = 'open')            AS open_seekers
        FROM concerts c
        ORDER BY c.event_date ASC
      `).all();
    },
  };
}

export function createParticipationRepo(db) {
  const byUserConcert = db.prepare(`
    SELECT concert_id AS concertId, section_pref AS sectionPref, arrival_pref AS arrivalPref
    FROM concert_participants WHERE user_id = ? AND concert_id = ? AND status = 'joined'
  `);
  const mine = db.prepare(`
    SELECT c.*, p.section_pref AS sectionPref, p.arrival_pref AS arrivalPref
    FROM concert_participants p
    JOIN concerts c ON c.id = p.concert_id
    WHERE p.user_id = ? AND p.status = 'joined'
    ORDER BY c.event_date, c.id
  `);
  const upsert = db.prepare(`
    INSERT INTO concert_participants (user_id, concert_id, section_pref, arrival_pref)
    VALUES (?, ?, ?, ?)
    ON CONFLICT (user_id, concert_id) DO UPDATE SET
      section_pref = excluded.section_pref, arrival_pref = excluded.arrival_pref,
      status = 'joined', joined_at = datetime('now')
  `);
  const withdraw = db.prepare(`
    UPDATE concert_participants SET status = 'withdrawn'
    WHERE user_id = ? AND concert_id = ?
  `);
  const removeLikes = db.prepare(`
    DELETE FROM kaki_decisions
    WHERE actor_user_id = ? AND concert_id = ? AND decision = 'like'
  `);
  return {
    find(userId, concertId) {
      return byUserConcert.get(userId, concertId) ?? null;
    },
    mine(userId) {
      return mine.all(userId).map(({ sectionPref, arrivalPref, ...concert }) => ({
        concert, participation: { concertId: concert.id, sectionPref, arrivalPref },
      }));
    },
    join: db.transaction((userId, concertId, sectionPref, arrivalPref) => {
      upsert.run(userId, concertId, sectionPref, arrivalPref);
      return byUserConcert.get(userId, concertId);
    }),
    leave: db.transaction((userId, concertId) => {
      withdraw.run(userId, concertId);
      removeLikes.run(userId, concertId);
    }),
  };
}
