/** Import provider events without replacing user-created parties, requests, or rounds. */
export function importTicketmasterConcerts(db, concerts) {
  const upsert = db.prepare(`
    INSERT INTO concerts (
      id, artist, tour_name, venue, city, event_date, hero_image_url,
      source, source_event_id, official_url, image_attribution
    ) VALUES (
      @id, @artist, @tour_name, @venue, @city, @event_date, @hero_image_url,
      @source, @source_event_id, @official_url, @image_attribution
    )
    ON CONFLICT(source, source_event_id) DO UPDATE SET
      artist = excluded.artist,
      tour_name = excluded.tour_name,
      venue = excluded.venue,
      city = excluded.city,
      event_date = excluded.event_date,
      hero_image_url = excluded.hero_image_url,
      official_url = excluded.official_url,
      image_attribution = excluded.image_attribution
  `);
  db.transaction(() => {
    for (const concert of concerts) upsert.run(concert);
  })();
  return concerts.length;
}
