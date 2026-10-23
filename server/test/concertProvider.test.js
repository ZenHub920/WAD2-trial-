import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../src/db/connection.js';
import { createConcertProvider } from '../src/services/concertProvider.js';
import { normalizeTicketmasterEvent, searchTicketmaster } from '../src/services/ticketmaster.js';
import { importTicketmasterConcerts } from '../src/db/ticketmasterConcerts.js';
const raw = { id: 'sg1', name: 'Artist', dates: { start: { localDate: '2030-03-01', localTime: '20:00:00' }, status: { code: 'onsale' } },
  _embedded: { venues: [{ name: 'Hall', city: { name: 'Singapore' }, location: { latitude: '1.3', longitude: '103.8' } }] } };
const response = (body, status = 200) => new Response(JSON.stringify(body), { status });

test('concert queries coalesce, persist cache, serve stale data, and enforce a restart-safe daily budget', async () => {
  const db = createTestDb();
  let calls = 0, clock = Date.parse('2030-01-01T00:00:00Z');
  const options = { db, now: () => clock, pause: async () => {}, env: { TICKETMASTER_API_KEY: 'fake', TICKETMASTER_DAILY_LIMIT: '1' },
    fetchImpl: async () => { calls++; return response({ _embedded: { events: [raw] } }); } };
  try {
    const provider = createConcertProvider(options);
    const [a, b] = await Promise.all([provider.discover(), provider.discover()]);
    assert.deepEqual(a, b);
    assert.equal(calls, 1);
    assert.equal((await createConcertProvider(options).discover()).source, 'cache');
    clock += 3600000;
    const stale = await createConcertProvider(options).discover();
    assert.equal(stale.stale, true);
    assert.equal(stale.events[0].id, 'tm_sg1');
    assert.equal(calls, 1, 'persisted daily budget prevents further provider traffic after restart');
  } finally { db.close(); }
});

test('paged provider discovery deduplicates events and bounds page count', async () => {
  let calls = 0;
  const events = await searchTicketmaster({ apiKey: 'fake', maxPages: 2, fetchImpl: async (url) => {
    calls++;
    return response({ page: { totalPages: 8 }, _embedded: { events: [raw, { ...raw, id: `page${url.searchParams.get('page')}` }] } });
  } });
  assert.equal(calls, 2);
  assert.equal(events.length, 3);
});

test('concert changes notify participants once and preserve their groups and meetups', () => {
  const db = createTestDb();
  try {
    const concert = normalizeTicketmasterEvent(raw);
    importTicketmasterConcerts(db, [concert]);
    db.exec("INSERT INTO users(id,display_name,age_band,home_region,gender,vibe_json) VALUES('u','U','21-24','central','f','{}'); INSERT INTO concert_participants(concert_id,user_id,status,section_pref,arrival_pref) VALUES('tm_sg1','u','joined','pit','mid');");
    const changed = { ...concert, provider_status: 'canceled', venue: 'New Hall' };
    importTicketmasterConcerts(db, [changed]);
    importTicketmasterConcerts(db, [changed]);
    assert.equal(db.prepare('SELECT count(*) n FROM notifications').get().n, 1);
    assert.equal(db.prepare('SELECT count(*) n FROM concert_updates').get().n, 1);
    assert.equal(db.prepare('SELECT status FROM concert_participants').get().status, 'joined');
  } finally { db.close(); }
});

test('same-day time changes and a legacy cancellation are audited against the persisted provider ID', () => {
  const db = createTestDb();
  try {
    const concert = normalizeTicketmasterEvent(raw);
    importTicketmasterConcerts(db, [{ ...concert, id: 'legacy-id' }]);
    db.prepare("UPDATE concerts SET provider_status=NULL WHERE id='legacy-id'").run();
    importTicketmasterConcerts(db, [{ ...concert, provider_status: 'canceled' }]);
    assert.equal(db.prepare('SELECT concert_id FROM concert_updates').get().concert_id, 'legacy-id');
    importTicketmasterConcerts(db, [{ ...concert, event_time: '21:00:00', provider_status: 'canceled' }]);
    assert.equal(db.prepare('SELECT count(*) n FROM concert_updates').get().n, 2);
  } finally { db.close(); }
});
