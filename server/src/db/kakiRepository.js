import { mapUser, prefixed } from './rowMappers.js';
import { createKakiPreferenceGate } from '../services/kakiPreferenceGate.js';

const kakiJoined = (user, concert) => `EXISTS (
  SELECT 1 FROM concert_participants joined
  WHERE joined.user_id = ${user} AND joined.concert_id = ${concert}
    AND joined.status = 'joined'
)`;
const kakiEligiblePair = (actor, concert, target) => `(
  ${actor} <> ${target}
  AND ${kakiJoined(actor, concert)}
  AND ${kakiJoined(target, concert)}
  AND NOT EXISTS (SELECT 1 FROM blocks b
                  WHERE (b.blocker_user_id = ${actor} AND b.blocked_user_id = ${target})
                     OR (b.blocker_user_id = ${target} AND b.blocked_user_id = ${actor}))
)`;

export function createKakiRepo(db) {
  const preferenceEligible = createKakiPreferenceGate(db);
  const concerts = db.prepare(`
    SELECT c.* FROM concerts c
    WHERE ${kakiJoined('@viewer', 'c.id')}
    ORDER BY c.event_date, c.id
  `);
  const people = db.prepare(`
    SELECT c.id AS concert_id, c.artist, c.tour_name, c.event_date, c.venue,
           p.section_pref,
           s.spend_band_max,
           p.arrival_pref,
           COALESCE(s.plans_wanted_json, '{}') AS plans_wanted_json,
           u.id AS user_id, u.display_name AS user_display_name,
           u.age_band AS user_age_band, u.home_region AS user_home_region,
           u.languages_json AS user_languages_json, u.vibe_json AS user_vibe_json,
           u.reliability AS user_reliability, u.verified AS user_verified,
           u.avatar_path AS user_avatar_path
    FROM concert_participants p
    JOIN concerts c ON c.id = p.concert_id
    JOIN users u ON u.id = p.user_id
    LEFT JOIN seeker_requests s ON s.concert_id = p.concert_id
      AND s.user_id = p.user_id AND s.status = 'open'
    WHERE p.status = 'joined' AND ${kakiEligiblePair('@viewer', 'c.id', 'u.id')}
    ORDER BY c.event_date, c.id, u.id
  `);
  const eligible = db.prepare(`
    SELECT 1 WHERE ${kakiEligiblePair('@actor', '@concert', '@target')}
  `);
  const decisions = db.prepare(`
    SELECT d.concert_id, d.target_user_id, d.decision, d.decided_at,
           reverse.decision AS reverse_decision,
           ${kakiJoined('d.actor_user_id', 'd.concert_id')} AS actor_is_candidate
    FROM kaki_decisions d
    LEFT JOIN kaki_decisions reverse ON reverse.concert_id = d.concert_id
      AND reverse.actor_user_id = d.target_user_id
      AND reverse.target_user_id = d.actor_user_id
    WHERE d.actor_user_id = ?
  `);
  const upsert = db.prepare(`
    INSERT INTO kaki_decisions (concert_id, actor_user_id, target_user_id, decision, decided_at)
    VALUES (@concert, @actor, @target, @decision, @at)
    ON CONFLICT (concert_id, actor_user_id, target_user_id)
    DO UPDATE SET decision = excluded.decision, decided_at = excluded.decided_at
  `);
  const reciprocal = db.prepare(`
    SELECT 1 FROM kaki_decisions d
    WHERE d.concert_id = @concert AND d.actor_user_id = @target
      AND d.target_user_id = @actor AND d.decision = 'like'
      AND ${kakiJoined('@actor', '@concert')}
  `);
  const remove = db.prepare(`
    DELETE FROM kaki_decisions
    WHERE concert_id = @concert AND actor_user_id = @actor AND target_user_id = @target
  `);
  const toPerson = (row) => ({
    id: `${row.concert_id}:${row.user_id}`,
    concertId: row.concert_id,
    artist: row.artist,
    tourName: row.tour_name,
    eventDate: row.event_date,
    venue: row.venue,
    sectionPref: row.section_pref,
    spendBandMax: row.spend_band_max,
    arrivalPref: row.arrival_pref,
    plansWanted: JSON.parse(row.plans_wanted_json),
    user: mapUser(prefixed(row, 'user_')),
  });
  return {
    people(viewer) {
      return people.all({ viewer }).map(toPerson);
    },
    pool(viewer) {
      return { concerts: concerts.all({ viewer }), people: this.people(viewer) };
    },
    decisions(viewer, visiblePeople) {
      const visible = new Set(visiblePeople.map((person) => person.id));
      const result = {};
      for (const row of decisions.all(viewer)) {
        const id = `${row.concert_id}:${row.target_user_id}`;
        if (!visible.has(id)) continue;
        result[id] = {
          decision: row.decision,
          at: row.decided_at,
          mutual: row.decision === 'like' && row.reverse_decision === 'like'
            && Boolean(row.actor_is_candidate) && preferenceEligible(viewer, row.target_user_id),
        };
      }
      return result;
    },
    setDecision: db.transaction((actor, concert, target, decision) => {
      const pair = { actor, concert, target };
      if (!eligible.get(pair)) return null;
      // Passing and withdrawing remain available even after a preference change.
      if (decision === 'like' && !preferenceEligible(actor, target)) return null;
      const at = Date.now();
      upsert.run({ ...pair, decision, at });
      return { decision, at, mutual: decision === 'like' && Boolean(reciprocal.get(pair)) };
    }),
    deleteDecision: db.transaction((actor, concert, target) => {
      const pair = { actor, concert, target };
      if (!eligible.get(pair)) return false;
      remove.run(pair);
      return true;
    }),
  };
}
