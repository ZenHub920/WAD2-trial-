import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createApp } from '../src/app.js';
import { createTestDb } from '../src/db/connection.js';

async function start(db) {
  const server = createApp({ db }).app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  return {
    server,
    async request(path, { cookie, body, method = 'GET' } = {}) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
        method,
        headers: { ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      return {
        status: response.status,
        body: response.status === 204 ? null : await response.json(),
        setCookie: response.headers.get('set-cookie'),
      };
    },
  };
}

const registration = (name) => ({
  display_name: name,
  email: `${name}@example.test`,
  password: 'test-password',
});
const cookieOf = (result) => result.setCookie?.split(';')[0];

async function stop(server) {
  await new Promise((resolve) => server.close(resolve));
}

test('registration creates a private, persistent, expiring session without accepting trust fields', async () => {
  const db = createTestDb();
  let api = await start(db);
  try {
    const registered = await api.request('/auth/register', {
      method: 'POST', body: { ...registration('alice'), id: 'chosen', reliability: 1, verified: true },
    });
    assert.equal(registered.status, 201);
    assert.notEqual(registered.body.user.id, 'chosen');
    assert.equal(registered.body.user.reliability, 0.75);
    assert.equal(registered.body.user.verified, false);
    assert.equal(registered.body.user.email, undefined);
    assert.match(registered.setCookie, /HttpOnly/);
    assert.match(registered.setCookie, /SameSite=Lax/);
    assert.match(registered.setCookie, /Path=\/api/);
    const cookie = cookieOf(registered);
    const stored = db.prepare('SELECT token_hash FROM sessions').get();
    assert.ok(stored.token_hash);
    assert.notEqual(stored.token_hash, cookie.split('=')[1]);
    assert.equal((await api.request('/auth/me', { cookie })).body.user.id, registered.body.user.id);
    await stop(api.server);
    api = await start(db);
    assert.equal((await api.request('/auth/me', { cookie })).body.user.id, registered.body.user.id);
    db.prepare('UPDATE sessions SET expires_at = 0').run();
    assert.equal((await api.request('/auth/me', { cookie })).status, 401);
  } finally {
    await stop(api.server);
    db.close();
  }
});

test('login rotates session, bad credentials do not log in, logout revokes the cookie', async () => {
  const db = createTestDb();
  const api = await start(db);
  try {
    const registered = await api.request('/auth/register', { method: 'POST', body: registration('bob') });
    const oldCookie = cookieOf(registered);
    const wrong = await api.request('/auth/login', {
      method: 'POST', cookie: oldCookie, body: { email: 'bob@example.test', password: 'wrong-password' },
    });
    assert.equal(wrong.status, 401);
    assert.equal(wrong.setCookie, null);
    const login = await api.request('/auth/login', {
      method: 'POST', cookie: oldCookie, body: { email: ' BOB@EXAMPLE.TEST ', password: 'test-password' },
    });
    assert.equal(login.status, 200);
    assert.notEqual(cookieOf(login), oldCookie);
    assert.equal((await api.request('/auth/me', { cookie: oldCookie })).status, 401);
    const cookie = cookieOf(login);
    assert.equal((await api.request('/auth/me', { cookie })).body.user.id, registered.body.user.id);
    const logout = await api.request('/auth/logout', { method: 'POST', cookie });
    assert.equal(logout.status, 204);
    assert.match(logout.setCookie, /Expires=Thu, 01 Jan 1970/);
    assert.equal((await api.request('/auth/me', { cookie })).status, 401);
  } finally {
    await stop(api.server);
    db.close();
  }
});

test('mutations require a session and ignore forged user IDs', async () => {
  const db = createTestDb();
  db.prepare("INSERT INTO concerts (id, artist, venue, city, event_date) VALUES ('c_auth', 'Act', 'Hall', 'Singapore', '2027-03-01')").run();
  const api = await start(db);
  try {
    const alice = await api.request('/auth/register', { method: 'POST', body: registration('alice') });
    const bob = await api.request('/auth/register', { method: 'POST', body: registration('bob') });
    const party = { host_user_id: bob.body.user.id, capacity: 1, section: 'pit', spend_band: 2, arrival_plan: 'mid' };
    assert.equal((await api.request('/concerts/c_auth/parties', { method: 'POST', body: party })).status, 401);
    assert.equal((await api.request('/concerts/c_auth/match', { method: 'POST' })).status, 401);
    assert.equal((await api.request('/users', { method: 'POST', body: registration('fake') })).status, 404);
    const created = await api.request('/concerts/c_auth/parties', {
      method: 'POST', cookie: cookieOf(alice), body: party,
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.party.host_user_id, alice.body.user.id);
    const request = await api.request('/concerts/c_auth/requests', {
      method: 'POST', cookie: cookieOf(bob),
      body: { user_id: alice.body.user.id, section_pref: 'pit', spend_band_max: 2, arrival_pref: 'mid' },
    });
    assert.equal(request.status, 201);
    assert.equal(request.body.request.user_id, bob.body.user.id);
  } finally {
    await stop(api.server);
    db.close();
  }
});
