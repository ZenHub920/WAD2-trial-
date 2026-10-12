import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createApp } from '../src/app.js';
import { createTestDb, migrateLegacyTickets } from '../src/db/connection.js';

const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000b49444154789c636000020000050001a5f645400000000049454e44ae426082', 'hex');
const imageData = `data:image/png;base64,${png.toString('base64')}`;
const concert = { artist: 'The Act', venue: 'Hall', event_date: '2027-03-01' };
const listing = { concert, priceCents: 12345, quantity: 2, section: 'A1', description: 'Two seats' };

async function fixture(t) {
  const db = createTestDb();
  const imageDir = mkdtempSync(join(tmpdir(), 'encore-ticket-images-'));
  const server = createApp({ db, imageDir }).app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    db.close();
    rmSync(imageDir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  async function api(path, { method = 'GET', cookie, body } = {}) {
    const response = await fetch(`${base}/api${path}`, {
      method,
      headers: { ...(cookie ? { cookie } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, body: response.status === 204 ? null : await response.json(),
      cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  async function register(name) {
    const result = await api('/auth/register', { method: 'POST', body: {
      display_name: name, email: `${name}@example.test`, password: 'test-password',
    } });
    assert.equal(result.status, 201);
    return result;
  }
  return { db, imageDir, base, api, register };
}

test('ticket inventory is independent of parties; create/list/detail/edit/delete enforce ownership', async (t) => {
  const { db, api, register } = await fixture(t);
  const alice = await register('ticket-alice');
  const bob = await register('ticket-bob');
  assert.equal((await api('/tickets', { method: 'POST', cookie: alice.cookie,
    body: { ...listing, quantity: 0 } })).status, 400);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM concerts').get().n, 0);
  assert.equal((await api('/tickets', { method: 'POST', body: listing })).status, 401);
  const created = await api('/tickets', { method: 'POST', cookie: alice.cookie, body: {
    ...listing, seller_user_id: bob.body.user.id,
  } });
  assert.equal(created.status, 201);
  const id = created.body.listing.id;
  assert.equal(created.body.listing.seller.id, alice.body.user.id);
  assert.equal(created.body.listing.seller.email, undefined);
  assert.deepEqual(created.body.listing.concert.artist, concert.artist);
  assert.equal(created.body.listing.priceCents, listing.priceCents);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM parties').get().n, 0);
  assert.equal((await api('/tickets')).body.listings[0].id, id);
  assert.equal((await api(`/tickets/${id}`)).body.listing.quantity, 2);
  assert.equal((await api('/me/tickets')).status, 401);
  assert.deepEqual((await api('/me/tickets', { cookie: bob.cookie })).body.listings, []);
  assert.equal((await api(`/tickets/${id}`, { method: 'PATCH', cookie: bob.cookie,
    body: { priceCents: 1 } })).status, 404);
  assert.equal((await api(`/tickets/${id}`, { method: 'DELETE', cookie: bob.cookie })).status, 404);
  const edited = await api(`/tickets/${id}`, { method: 'PATCH', cookie: alice.cookie,
    body: { priceCents: 14000, quantity: 1, section: 'B2', description: 'One seat' } });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.listing.priceCents, 14000);
  assert.equal(edited.body.listing.section, 'B2');
  assert.equal((await api(`/tickets/${id}`, { method: 'DELETE', cookie: alice.cookie })).status, 204);
  assert.deepEqual((await api('/tickets')).body.listings, []);
  assert.deepEqual((await api('/me/tickets', { cookie: alice.cookie })).body.listings, []);
  assert.equal((await api(`/tickets/${id}`)).status, 404);
});

test('ticket image bytes are stored on disk; invalid uploads and failed inserts leave no files or orphan concert', async (t) => {
  const { db, api, base, imageDir, register } = await fixture(t);
  const alice = await register('ticket-image');
  const cookie = alice.cookie;
  const bad = await api('/tickets', { method: 'POST', cookie, body: {
    ...listing, imageData: `data:image/png;base64,${Buffer.from('not a png').toString('base64')}`,
  } });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, 'invalid_image');
  const oversized = await api('/tickets', { method: 'POST', cookie, body: {
    ...listing, imageData: `data:image/png;base64,${Buffer.alloc(2 * 1024 * 1024 + 1).toString('base64')}`,
  } });
  assert.equal(oversized.status, 400);
  assert.equal(oversized.body.error, 'invalid_image');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM concerts').get().n, 0);
  const created = await api('/tickets', { method: 'POST', cookie, body: { ...listing, imageData } });
  assert.equal(created.status, 201);
  const id = created.body.listing.id;
  const firstUrl = created.body.listing.imageUrl;
  assert.match(firstUrl, /^\/api\/ticket-images\/[0-9a-f-]+\.png$/);
  assert.equal((await (await fetch(`${base}${firstUrl}`)).arrayBuffer()).byteLength, png.length);
  const disk = db.prepare('SELECT image_path FROM tickets WHERE id = ?').get(id).image_path;
  assert.deepEqual(readFileSync(join(imageDir, disk)), png);
  assert.equal(db.prepare('PRAGMA table_info(tickets)').all().some((column) => column.name === 'image_data'), false);
  const bob = await register('ticket-image-other');
  assert.equal((await api(`/tickets/${id}`, { method: 'PATCH', cookie: bob.cookie,
    body: { imageData } })).status, 404);
  assert.deepEqual(readdirSync(imageDir), [disk]);
  const replaced = await api(`/tickets/${id}`, { method: 'PATCH', cookie, body: { imageData } });
  assert.equal(replaced.status, 200);
  assert.notEqual(replaced.body.listing.imageUrl, firstUrl);
  assert.equal(readdirSync(imageDir).length, 1);
  const invalidEdit = await api(`/tickets/${id}`, { method: 'PATCH', cookie, body: { imageData: 'data:image/png;base64,SGVsbG8=' } });
  assert.equal(invalidEdit.status, 400);
  assert.equal((await api(`/tickets/${id}`, { method: 'PATCH', cookie,
    body: { imageData: null } })).body.listing.imageUrl, null);
  assert.deepEqual(readdirSync(imageDir), []);
  db.exec("CREATE TRIGGER deny_ticket_insert BEFORE INSERT ON tickets BEGIN SELECT RAISE(ABORT, 'denied'); END");
  const countBefore = db.prepare('SELECT COUNT(*) AS n FROM concerts').get().n;
  const failed = await api('/tickets', { method: 'POST', cookie, body: { ...listing, imageData } });
  assert.equal(failed.status, 500);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM concerts').get().n, countBefore);
  assert.deepEqual(readdirSync(imageDir), []);
});

test('legacy priced parties migrate once, preserve matching history and cannot enter active matching', async (t) => {
  const { db, api, imageDir, register } = await fixture(t);
  const alice = await register('legacy-seller');
  db.exec('ALTER TABLE parties ADD COLUMN price_cents INTEGER; ALTER TABLE parties ADD COLUMN image_data TEXT');
  db.prepare("INSERT INTO concerts (id, artist, venue, city, event_date) VALUES ('c_old', 'Old Act', 'Old Hall', 'Singapore', '2027-01-01')").run();
  db.prepare(`INSERT INTO parties (id, host_user_id, concert_id, capacity, section,
    spend_band, arrival_plan, price_cents, image_data)
    VALUES (?, ?, 'c_old', 2, 'pit', 2, 'mid', 5000, ?)`)
    .run('p_old', alice.body.user.id, imageData);
  const seeker = await register('legacy-seeker');
  db.prepare(`INSERT INTO seeker_requests (id, user_id, concert_id, section_pref,
    spend_band_max, arrival_pref) VALUES ('s_old', ?, 'c_old', 'pit', 2, 'mid')`)
    .run(seeker.body.user.id);
  db.prepare(`INSERT INTO match_rounds (id, concert_id, is_stable, seeker_count, party_count,
    total_capacity, feasible_pairs, matched_count, metrics_json, timings_json)
    VALUES ('r_old', 'c_old', 1, 1, 1, 2, 1, 1, '{}', '{}')`).run();
  db.prepare(`INSERT INTO match_results (id, round_id, seeker_request_id, party_id, outcome)
    VALUES ('m_old', 'r_old', 's_old', 'p_old', 'matched')`).run();
  migrateLegacyTickets(db, imageDir);
  migrateLegacyTickets(db, imageDir);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM tickets WHERE source_party_id = ?').get('p_old').n, 1);
  assert.equal(db.prepare('SELECT party_id FROM match_results WHERE id = ?').get('m_old').party_id, 'p_old');
  assert.equal(db.prepare('SELECT status FROM parties WHERE id = ?').get('p_old').status, 'cancelled');
  assert.deepEqual((await api('/concerts/c_old/parties')).body.parties, []);
  assert.equal((await api('/concerts/c_old')).body.openParties, 0);
  assert.equal((await api('/tickets')).body.listings[0].priceCents, 5000);
  assert.equal((await api('/tickets')).body.listings[0].imageUrl.startsWith('/api/ticket-images/'), true);
  assert.equal((await api('/concerts/c_old/parties', { method: 'POST', cookie: alice.cookie,
    body: { capacity: 1, section: 'pit', spend_band: 2, arrival_plan: 'mid', priceCents: 5000 } })).status, 400);
  const legacyId = db.prepare('SELECT id FROM tickets WHERE source_party_id = ?').get('p_old').id;
  assert.equal((await api(`/tickets/${legacyId}`, { method: 'DELETE', cookie: alice.cookie })).status, 204);
  migrateLegacyTickets(db, imageDir);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM tickets WHERE source_party_id = ?').get('p_old').n, 1);
  assert.equal(db.prepare('SELECT status FROM parties WHERE id = ?').get('p_old').status, 'cancelled');
});
