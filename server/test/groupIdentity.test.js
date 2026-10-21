/** Group names and pictures: set by the host only, shown on group cards. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createApp } from '../src/app.js';
import { createTestDb } from '../src/db/connection.js';

const PNG_1PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PARTY = { capacity: 2, section: 'pit', spend_band: 2, arrival_plan: 'doors' };

async function fixture(t) {
  const db = createTestDb();
  const avatarDir = mkdtempSync(join(tmpdir(), 'encore-avatars-'));
  const imageDir = mkdtempSync(join(tmpdir(), 'encore-images-'));
  const server = createApp({ db, avatarDir, imageDir }).app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    db.close();
    rmSync(avatarDir, { recursive: true, force: true });
    rmSync(imageDir, { recursive: true, force: true });
  });
  db.prepare(`INSERT INTO concerts (id, artist, tour_name, venue, city, event_date)
              VALUES ('c_id', 'Artist', 'Tour', 'Hall', 'Singapore', '2027-05-01')`).run();

  async function api(path, { method = 'GET', cookie, body } = {}) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method,
      headers: { ...(cookie ? { cookie } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  async function user(name) {
    const r = await api('/auth/register', { method: 'POST',
      body: { display_name: name, email: `${name}@example.test`, password: 'test-password' } });
    assert.equal(r.status, 201);
    return { cookie: r.cookie };
  }
  return { api, user };
}

test('a group is created with its name and the host can change its name and picture', async (t) => {
  const f = await fixture(t);
  const host = await f.user('host');
  const created = await f.api('/concerts/c_id/parties', { method: 'POST', cookie: host.cookie, body: { ...PARTY, name: '  Front   Row Crew ' } });
  assert.equal(created.status, 201);
  assert.equal(created.body.party.name, 'Front Row Crew');
  const id = created.body.party.id;

  const [card] = (await f.api('/me/hosted-groups', { cookie: host.cookie })).body.groups;
  assert.equal(card.name, 'Front Row Crew');
  assert.equal(card.imageUrl, null);

  const renamed = await f.api(`/groups/${id}/name`, { method: 'PUT', cookie: host.cookie, body: { name: 'Pit Pals' } });
  assert.equal(renamed.body.group.name, 'Pit Pals');

  const pictured = await f.api(`/groups/${id}/image`, { method: 'PUT', cookie: host.cookie, body: { image: PNG_1PX } });
  assert.match(pictured.body.group.imageUrl, /^\/api\/avatars\//);
  assert.equal((await f.api('/me/hosted-groups', { cookie: host.cookie })).body.groups[0].imageUrl, pictured.body.group.imageUrl);

  const cleared = await f.api(`/groups/${id}/image`, { method: 'DELETE', cookie: host.cookie });
  assert.equal(cleared.body.group.imageUrl, null);
});

test('only the host can rename a group, and names are limited to 60 characters', async (t) => {
  const f = await fixture(t);
  const host = await f.user('owner');
  const other = await f.user('stranger');
  const id = (await f.api('/concerts/c_id/parties', { method: 'POST', cookie: host.cookie, body: PARTY })).body.party.id;

  assert.equal((await f.api(`/groups/${id}/name`, { method: 'PUT', cookie: other.cookie, body: { name: 'Mine now' } })).status, 403);
  assert.equal((await f.api(`/groups/${id}/image`, { method: 'PUT', cookie: other.cookie, body: { image: PNG_1PX } })).status, 403);
  assert.equal((await f.api(`/groups/${id}/name`, { method: 'PUT', cookie: host.cookie, body: { name: 'x'.repeat(61) } })).status, 400);
  assert.equal((await f.api('/concerts/c_id/parties', { method: 'POST', cookie: host.cookie, body: { ...PARTY, name: 'x'.repeat(61) } })).body.error, 'invalid_group_name');
});
