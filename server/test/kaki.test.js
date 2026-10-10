import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createApp } from '../src/app.js';
import { createTestDb } from '../src/db/connection.js';

async function fixture(t) {
  const db = createTestDb();
  let server;
  async function listen() {
    server = createApp({ db }).app.listen(0, '127.0.0.1');
    await new Promise((resolve) => server.once('listening', resolve));
  }
  await listen();
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  });
  async function api(path, { method = 'GET', cookie, body } = {}) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method,
      headers: { ...(cookie ? { cookie } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: response.status === 204 ? null : await response.json(),
      cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  async function user(name) {
    const result = await api('/auth/register', { method: 'POST', body: {
      display_name: name, email: `${name}@example.test`, password: 'test-password',
    } });
    assert.equal(result.status, 201);
    return { id: result.body.user.id, cookie: result.cookie };
  }
  function concert(id) {
    db.prepare('INSERT INTO concerts (id, artist, tour_name, venue, city, event_date) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, `Artist ${id}`, 'Tour', 'Hall', 'Singapore', '2027-05-01');
  }
  function seeker(id, person, concertId) {
    db.prepare("INSERT INTO seeker_requests (id, user_id, concert_id, section_pref, spend_band_max, arrival_pref) VALUES (?, ?, ?, 'pit', 2, 'doors')")
      .run(id, person.id, concertId);
  }
  function party(id, person, concertId) {
    db.prepare("INSERT INTO parties (id, host_user_id, concert_id, capacity, section, spend_band, arrival_plan) VALUES (?, ?, ?, 2, 'pit', 2, 'doors')")
      .run(id, person.id, concertId);
  }
  const decision = (concertId, target) => `/kaki/decisions/${concertId}/${target.id}`;
  return { db, api, user, concert, seeker, party, decision,
    async restart() {
      await new Promise((resolve) => server.close(resolve));
      await listen();
    } };
}

test('Kaki routes require authentication and reject self, blocks, and cross-concert decisions', async (t) => {
  const f = await fixture(t);
  const alice = await f.user('kaki-alice');
  const bob = await f.user('kaki-bob');
  const outsider = await f.user('kaki-outsider');
  const host = await f.user('kaki-host');
  f.concert('c_one');
  f.concert('c_two');
  f.seeker('s_alice', alice, 'c_one');
  f.seeker('s_bob', bob, 'c_one');
  f.seeker('s_bob_other', bob, 'c_two');
  f.seeker('s_outsider', outsider, 'c_two');
  f.party('p_host', host, 'c_one');
  for (const path of ['/kaki/pool', '/kaki/decisions', '/kaki/matches']) {
    assert.equal((await f.api(path)).status, 401);
  }
  assert.equal((await f.api(f.decision('c_one', bob), { method: 'PUT', body: { decision: 'like' } })).status, 401);
  assert.equal((await f.api(f.decision('c_one', bob), { method: 'DELETE' })).status, 401);
  assert.equal((await f.api(f.decision('c_one', alice), { method: 'PUT', cookie: alice.cookie,
    body: { decision: 'like' } })).status, 404);
  assert.equal((await f.api(f.decision('c_two', bob), { method: 'PUT', cookie: alice.cookie,
    body: { decision: 'like' } })).status, 404);
  assert.equal((await f.api(f.decision('c_one', outsider), { method: 'PUT', cookie: alice.cookie,
    body: { decision: 'like' } })).status, 404);
  assert.equal((await f.api(f.decision('c_one', bob), { method: 'PUT', cookie: outsider.cookie,
    body: { decision: 'like' } })).status, 404);
  assert.equal((await f.api(f.decision('c_one', bob), { method: 'PUT', cookie: alice.cookie,
    body: { decision: 'maybe' } })).status, 400);
  const hostPool = (await f.api('/kaki/pool', { cookie: host.cookie })).body;
  assert.deepEqual(hostPool.people.map((person) => person.id).sort(),
    [`c_one:${alice.id}`, `c_one:${bob.id}`].sort());
  assert.equal((await f.api(f.decision('c_one', bob), { method: 'PUT', cookie: host.cookie,
    body: { decision: 'like' } })).body.decision.mutual, false);
  assert.equal((await f.api(f.decision('c_one', host), { method: 'PUT', cookie: bob.cookie,
    body: { decision: 'like' } })).status, 404);
  f.db.prepare("UPDATE parties SET status = 'cancelled' WHERE id = 'p_host'").run();
  assert.deepEqual((await f.api('/kaki/pool', { cookie: host.cookie })).body,
    { concerts: [], people: [] });
  assert.deepEqual((await f.api('/kaki/decisions', { cookie: host.cookie })).body.decisions, {});
  assert.equal((await f.api(f.decision('c_one', bob), { method: 'PUT', cookie: host.cookie,
    body: { decision: 'like' } })).status, 404);
  const pool = (await f.api('/kaki/pool', { cookie: alice.cookie })).body;
  assert.deepEqual(pool.concerts.map((item) => item.id), ['c_one']);
  assert.deepEqual(pool.people.map((person) => person.id), [`c_one:${bob.id}`]);
  assert.equal(pool.people[0].artist, 'Artist c_one');
  assert.equal(pool.people[0].tourName, 'Tour');
  assert.equal(pool.people[0].eventDate, '2027-05-01');
  assert.equal(pool.people[0].venue, 'Hall');
  assert.equal(pool.people[0].sectionPref, 'pit');
  assert.equal(pool.people[0].spendBandMax, 2);
  assert.equal(pool.people[0].arrivalPref, 'doors');
  assert.deepEqual(pool.people[0].plansWanted, {});
  assert.equal(pool.people[0].user.id, bob.id);
  for (const field of ['email', 'password_hash', 'gender', 'companion_gender_pref', 'created_at']) {
    assert.equal(pool.people[0].user[field], undefined);
  }
  f.db.prepare('INSERT INTO blocks (blocker_user_id, blocked_user_id) VALUES (?, ?)').run(bob.id, alice.id);
  assert.deepEqual((await f.api('/kaki/pool', { cookie: alice.cookie })).body.people, []);
  assert.equal((await f.api(f.decision('c_one', bob), { method: 'PUT', cookie: alice.cookie,
    body: { decision: 'like' } })).status, 404);
  assert.equal((await f.api(f.decision('c_one', bob), { method: 'DELETE', cookie: alice.cookie })).status, 404);
  f.db.prepare('DELETE FROM blocks').run();
  f.db.prepare('INSERT INTO blocks (blocker_user_id, blocked_user_id) VALUES (?, ?)').run(alice.id, bob.id);
  assert.deepEqual((await f.api('/kaki/pool', { cookie: alice.cookie })).body.people, []);
  assert.equal((await f.api(f.decision('c_one', bob), { method: 'PUT', cookie: alice.cookie,
    body: { decision: 'like' } })).status, 404);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM kaki_decisions WHERE actor_user_id = ?')
    .get(alice.id).n, 0);
});

test('Kaki likes persist, mutuality is live, and skips/undo/inactive membership remove matches', async (t) => {
  const f = await fixture(t);
  const alice = await f.user('kaki-like-alice');
  const bob = await f.user('kaki-like-bob');
  f.concert('c_likes');
  f.seeker('s_like_alice', alice, 'c_likes');
  f.seeker('s_like_bob', bob, 'c_likes');
  const aliceToBob = f.decision('c_likes', bob);
  const bobToAlice = f.decision('c_likes', alice);
  const first = await f.api(aliceToBob, { method: 'PUT', cookie: alice.cookie, body: { decision: 'like' } });
  assert.equal(first.status, 200);
  assert.equal(first.body.decision.decision, 'like');
  assert.equal(first.body.decision.mutual, false);
  assert.ok(Number.isSafeInteger(first.body.decision.at));
  assert.deepEqual((await f.api('/kaki/matches', { cookie: alice.cookie })).body.matches, []);
  await f.restart();
  assert.deepEqual((await f.api('/kaki/decisions', { cookie: alice.cookie })).body.decisions,
    { [`c_likes:${bob.id}`]: first.body.decision });
  const reciprocal = await f.api(bobToAlice, { method: 'PUT', cookie: bob.cookie, body: { decision: 'like' } });
  assert.equal(reciprocal.body.decision.mutual, true);
  assert.deepEqual((await f.api('/kaki/matches', { cookie: alice.cookie })).body.matches.map((p) => p.id),
    [`c_likes:${bob.id}`]);
  assert.deepEqual((await f.api('/kaki/matches', { cookie: bob.cookie })).body.matches.map((p) => p.id),
    [`c_likes:${alice.id}`]);
  assert.equal((await f.api('/kaki/decisions', { cookie: alice.cookie })).body.decisions[`c_likes:${bob.id}`].mutual, true);
  const skip = await f.api(bobToAlice, { method: 'PUT', cookie: bob.cookie, body: { decision: 'skip' } });
  assert.equal(skip.body.decision.mutual, false);
  assert.deepEqual((await f.api('/kaki/matches', { cookie: alice.cookie })).body.matches, []);
  assert.equal((await f.api('/kaki/decisions', { cookie: alice.cookie })).body.decisions[`c_likes:${bob.id}`].mutual, false);
  assert.equal((await f.api(bobToAlice, { method: 'PUT', cookie: bob.cookie,
    body: { decision: 'like' } })).body.decision.mutual, true);
  assert.equal((await f.api(bobToAlice, { method: 'DELETE', cookie: bob.cookie })).status, 204);
  assert.deepEqual((await f.api('/kaki/decisions', { cookie: bob.cookie })).body.decisions, {});
  assert.deepEqual((await f.api('/kaki/matches', { cookie: alice.cookie })).body.matches, []);
  assert.equal((await f.api(bobToAlice, { method: 'PUT', cookie: bob.cookie,
    body: { decision: 'like' } })).body.decision.mutual, true);
  f.db.prepare("UPDATE seeker_requests SET status = 'withdrawn' WHERE id = 's_like_bob'").run();
  assert.deepEqual((await f.api('/kaki/pool', { cookie: alice.cookie })).body.people, []);
  assert.deepEqual((await f.api('/kaki/decisions', { cookie: alice.cookie })).body.decisions, {});
  assert.deepEqual((await f.api('/kaki/matches', { cookie: alice.cookie })).body.matches, []);
  assert.equal((await f.api(aliceToBob, { method: 'PUT', cookie: alice.cookie,
    body: { decision: 'like' } })).status, 404);
  assert.equal((await f.api(bobToAlice, { method: 'PUT', cookie: bob.cookie,
    body: { decision: 'like' } })).status, 404);
  f.db.prepare("UPDATE seeker_requests SET status = 'open' WHERE id = 's_like_bob'").run();
  assert.deepEqual((await f.api('/kaki/matches', { cookie: alice.cookie })).body.matches.map((p) => p.id),
    [`c_likes:${bob.id}`]);
  f.db.prepare('INSERT INTO blocks (blocker_user_id, blocked_user_id) VALUES (?, ?)').run(bob.id, alice.id);
  assert.deepEqual((await f.api('/kaki/matches', { cookie: alice.cookie })).body.matches, []);
  assert.deepEqual((await f.api('/kaki/decisions', { cookie: alice.cookie })).body.decisions, {});
});
