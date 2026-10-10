import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createTestDb } from '../src/db/connection.js';
import { createApp } from '../src/app.js';
import { importTicketmasterConcerts } from '../src/db/ticketmasterConcerts.js';
import { searchTicketmaster } from '../src/services/ticketmaster.js';

const providerEvent = {
  id: 'SG-show-42',
  name: 'Example Artist Live',
  url: 'https://www.ticketmaster.sg/event/42',
  dates: { start: { localDate: '2027-03-21', localTime: '20:00:00' } },
  _embedded: {
    attractions: [{ name: 'Example Artist' }],
    venues: [{ name: 'Example Hall', city: { name: 'Singapore' }, country: { countryCode: 'SG' } }],
  },
  images: [{ ratio: '16_9', url: 'https://example.test/event.jpg', attribution: 'Example credit' }],
};

test('searches SG music and imports a stable, linked concert without erasing local participation', async () => {
  const concerts = await searchTicketmaster({
    apiKey: 'test-key',
    now: new Date('2027-01-01T00:00:00Z'),
    fetchImpl: async (url) => {
      assert.equal(url.searchParams.get('countryCode'), 'SG');
      assert.equal(url.searchParams.get('classificationName'), 'music');
      assert.equal(url.searchParams.get('startDateTime'), '2027-01-01T00:00:00Z');
      return new Response(JSON.stringify({ _embedded: { events: [providerEvent] } }), { status: 200 });
    },
  });
  assert.equal(concerts.length, 1);
  assert.equal(concerts[0].artist, 'Example Artist');
  assert.equal(concerts[0].event_date, '2027-03-21');
  assert.equal(concerts[0].official_url, providerEvent.url);

  const db = createTestDb();
  let server;
  try {
    importTicketmasterConcerts(db, concerts);
    db.prepare(`INSERT INTO users (id, display_name, age_band, home_region, gender, vibe_json)
      VALUES ('host', 'Host', '21-24', 'central', 'f', '{}')`).run();
    db.prepare(`INSERT INTO parties (id, host_user_id, concert_id, capacity, section, spend_band, arrival_plan)
      VALUES ('party', 'host', ?, 1, 'pit', 2, 'mid')`).run(concerts[0].id);

    importTicketmasterConcerts(db, [{ ...concerts[0], venue: 'New Hall', official_url: 'https://www.ticketmaster.sg/event/42-updated' }]);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM concerts').get().n, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM parties').get().n, 1);

    const { app } = createApp({ db });
    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/concerts/${concerts[0].id}`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.concert.venue, 'New Hall');
    assert.equal(body.concert.official_url, 'https://www.ticketmaster.sg/event/42-updated');
    assert.equal(body.openParties, 1);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    db.close();
  }
});

test('skips provider events without a date or Singapore venue', async () => {
  const events = await searchTicketmaster({
    apiKey: 'test-key',
    fetchImpl: async () => new Response(JSON.stringify({ _embedded: { events: [
      { ...providerEvent, dates: { start: {} } },
      { ...providerEvent, _embedded: { ...providerEvent._embedded, venues: [{ ...providerEvent._embedded.venues[0], country: { countryCode: 'US' } }] } },
    ] } }), { status: 200 }),
  });
  assert.deepEqual(events, []);
});
