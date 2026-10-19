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
  info: 'Provider concert information.',
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
  assert.equal(concerts[0].blurb, providerEvent.info);

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
    assert.equal(body.concert.blurb, providerEvent.info);
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

test('provider normalization rejects impossible dates and tolerates absent image arrays', async () => {
  const concerts = await searchTicketmaster({
    apiKey: 'test-key',
    fetchImpl: async () => new Response(JSON.stringify({ _embedded: { events: [
      { ...providerEvent, dates: { start: { localDate: '2027-02-30' } } },
      { ...providerEvent, id: 'image-less', images: {} },
    ] } }), { status: 200 }),
  });
  assert.equal(concerts.length, 1);
  assert.equal(concerts[0].source_event_id, 'image-less');
  assert.equal(concerts[0].hero_image_url, null);
});

test('provider text prefers event descriptions, falls back to artist biography, and stays absent without text', async () => {
  const concerts = await searchTicketmaster({
    apiKey: 'test-key',
    fetchImpl: async () => new Response(JSON.stringify({ _embedded: { events: [
      { ...providerEvent, id: 'description', description: '  Full concert description.  ' },
      { ...providerEvent, id: 'info', description: '  ' },
      { ...providerEvent, id: 'event-extra', info: null, additionalInfo: 'Additional event details.' },
      { ...providerEvent, id: 'artist-description', info: null, _embedded: {
        ...providerEvent._embedded,
        attractions: [{ name: 'Example Artist', description: 'An artist biography.', additionalInfo: 'Additional artist details.' }],
      } },
      { ...providerEvent, id: 'artist-extra', info: null, _embedded: {
        ...providerEvent._embedded,
        attractions: [{ name: 'Example Artist', description: ' ', additionalInfo: 'Additional artist details.' }],
      } },
      { ...providerEvent, id: 'absent', description: {}, info: null },
    ] } }), { status: 200 }),
  });
  assert.deepEqual(concerts.map((concert) => concert.blurb), [
    'Full concert description.', providerEvent.info, 'Additional event details.',
    'An artist biography.', 'Additional artist details.', null,
  ]);
});

test('live discovery persists stable event IDs without returning local concerts or erasing participation', async (t) => {
  const db = createTestDb();
  const originalKey = process.env.TICKETMASTER_API_KEY;
  const request = globalThis.fetch;
  let event = providerEvent;
  let providerStatus = 200;
  let server;
  process.env.TICKETMASTER_API_KEY = 'test-key';
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (String(url).startsWith('https://app.ticketmaster.com/discovery/')) {
      return new Response(JSON.stringify({ _embedded: { events: [event] } }), { status: providerStatus });
    }
    return request(url, options);
  });
  try {
    db.prepare(`INSERT INTO concerts (id, artist, venue, city, event_date)
      VALUES ('local-demo', 'Local concert', 'Local hall', 'Singapore', '2027-04-01')`).run();
    const { app } = createApp({ db });
    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}/api`;

    const response = await fetch(`${base}/concerts/external`);
    assert.equal(response.status, 200);
    const { events } = await response.json();
    assert.equal(events.length, 1);
    assert.equal(events[0].id, 'tm_SG-show-42');
    assert.equal(events[0].official_url, providerEvent.url);
    assert.equal(db.prepare('SELECT artist FROM concerts WHERE id = ?').get(events[0].id).artist, 'Example Artist');

    db.prepare(`INSERT INTO users (id, display_name, age_band, home_region, gender, vibe_json)
      VALUES ('host', 'Host', '21-24', 'central', 'f', '{}')`).run();
    db.prepare(`INSERT INTO parties (id, host_user_id, concert_id, capacity, section, spend_band, arrival_plan)
      VALUES ('party', 'host', ?, 1, 'pit', 2, 'mid')`).run(events[0].id);
    event = {
      ...providerEvent,
      url: 'https://www.ticketmaster.sg/event/42-updated',
      _embedded: {
        ...providerEvent._embedded,
        venues: [{ ...providerEvent._embedded.venues[0], name: 'Updated Hall' }],
      },
    };
    const repeated = await fetch(`${base}/concerts/external?keyword=Example`);
    assert.equal(repeated.status, 200);
    assert.equal((await repeated.json()).events[0].id, events[0].id);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM concerts').get().n, 2);
    assert.equal(db.prepare('SELECT concert_id FROM parties WHERE id = ?').get('party').concert_id, events[0].id);

    const detail = await fetch(`${base}/concerts/${events[0].id}`);
    assert.equal(detail.status, 200);
    const body = await detail.json();
    assert.equal(body.concert.venue, 'Updated Hall');
    assert.equal(body.concert.official_url, event.url);
    assert.equal(body.openParties, 1);

    const beforeFailure = db.prepare('SELECT * FROM concerts ORDER BY id').all();
    providerStatus = 500;
    const failed = await fetch(`${base}/concerts/external`);
    assert.equal(failed.status, 502);
    assert.deepEqual(await failed.json(), { error: 'concert_provider_unavailable' });
    assert.deepEqual(db.prepare('SELECT * FROM concerts ORDER BY id').all(), beforeFailure);

    delete process.env.TICKETMASTER_API_KEY;
    const unconfigured = await fetch(`${base}/concerts/external`);
    assert.equal(unconfigured.status, 503);
    assert.deepEqual(await unconfigured.json(), { error: 'concert_provider_not_configured' });
    assert.deepEqual(db.prepare('SELECT * FROM concerts ORDER BY id').all(), beforeFailure);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (originalKey === undefined) delete process.env.TICKETMASTER_API_KEY;
    else process.env.TICKETMASTER_API_KEY = originalKey;
    db.close();
  }
});
