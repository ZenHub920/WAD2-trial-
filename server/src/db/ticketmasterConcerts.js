import { randomUUID } from 'node:crypto';
import { migrateProviders } from './providerMigrations.js';
/** Import provider events without replacing user-created parties, requests, or rounds. */
export function importTicketmasterConcerts(db, concerts) {
  migrateProviders(db);
  const upsert = db.prepare(`
    INSERT INTO concerts (
      id, artist, tour_name, venue, city, event_date, hero_image_url,
      source, source_event_id, official_url, image_attribution, blurb, seatmap_url
    ) VALUES (
      @id, @artist, @tour_name, @venue, @city, @event_date, @hero_image_url,
      @source, @source_event_id, @official_url, @image_attribution, @blurb, @seatmap_url
    )
    ON CONFLICT(source, source_event_id) DO UPDATE SET
      artist = excluded.artist,
      tour_name = excluded.tour_name,
      venue = excluded.venue,
      city = excluded.city,
      event_date = excluded.event_date,
      hero_image_url = excluded.hero_image_url,
      official_url = excluded.official_url,
      image_attribution = excluded.image_attribution,
      blurb = excluded.blurb,
      seatmap_url = excluded.seatmap_url
  `);
  db.transaction(() => {
    for (const concert of concerts) {
      const previous = db.prepare('SELECT event_date,venue,provider_status FROM concerts WHERE source=? AND source_event_id=?')
        .get(concert.source, concert.source_event_id);
      upsert.run(concert);
      db.prepare(`UPDATE concerts SET event_time=?,event_timezone=?,provider_status=?,venue_latitude=?,venue_longitude=?,
        provider_synced_at=datetime('now') WHERE source=? AND source_event_id=?`)
        .run(concert.event_time ?? null, concert.event_timezone ?? null, concert.provider_status ?? 'onsale',
          concert.venue_latitude ?? null, concert.venue_longitude ?? null, concert.source, concert.source_event_id);
      const current = { event_date: concert.event_date, venue: concert.venue, provider_status: concert.provider_status ?? 'onsale' };
      if (previous && (previous.event_date !== current.event_date || previous.venue !== current.venue
        || (previous.provider_status && previous.provider_status !== current.provider_status))) {
        const id = randomUUID();
        db.prepare('INSERT INTO concert_updates(id,concert_id,previous_json,current_json) VALUES(?,?,?,?)')
          .run(id, concert.id, JSON.stringify(previous), JSON.stringify(current));
        const recipients = db.prepare(`SELECT user_id FROM concert_participants WHERE concert_id=? AND status='joined'
          UNION SELECT host_user_id FROM parties WHERE concert_id=? AND status<>'cancelled'
          UNION SELECT m.user_id FROM group_memberships m JOIN parties p ON p.id=m.party_id WHERE p.concert_id=? AND m.status='active'
          UNION SELECT user_id FROM seeker_requests WHERE concert_id=? AND status<>'withdrawn'`)
          .all(concert.id, concert.id, concert.id, concert.id);
        for (const { user_id } of recipients) db.prepare(`INSERT OR IGNORE INTO notifications
          (id,user_id,category,event_key,title,resource_path)
          SELECT ?,?,'group',?,?,? WHERE NOT EXISTS(SELECT 1 FROM notification_preferences WHERE user_id=? AND category='group' AND enabled=0)`)
          .run(randomUUID(), user_id, `concert-update:${id}`, `${concert.artist}: concert details changed. Check the organiser's update.`,
            `/concerts/${encodeURIComponent(concert.id)}`, user_id);
      }
    }
  })();
  return concerts.length;
}
