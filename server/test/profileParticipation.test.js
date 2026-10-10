import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createApp } from '../src/app.js';
import { createTestDb } from '../src/db/connection.js';

async function fixture(t) {
  const db = createTestDb();
  const server = createApp({ db }).app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
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
    return {
      status: response.status,
      body: response.status === 204 ? null : await response.json(),
      cookie: response.headers.get('set-cookie')?.split(';')[0],
    };
  }
  async function user(name) {
    const response = await api('/auth/register', { method: 'POST', body: {
      display_name: name, email: `${name}@example.test`, password: 'test-password',
    } });
    assert.equal(response.status, 201);
    return { id: response.body.user.id, cookie: response.cookie, email: `${name}@example.test` };
  }
  function concert(id) {
    db.prepare('INSERT INTO concerts (id, artist, venue, city, event_date) VALUES (?, ?, ?, ?, ?)')
      .run(id, `Artist ${id}`, 'Hall', 'Singapore', '2027-05-01');
  }
  function seeker(id, person, concertId) {
    db.prepare("INSERT INTO seeker_requests (id, user_id, concert_id, section_pref, spend_band_max, arrival_pref) VALUES (?, ?, ?, 'pit', 2, 'doors')")
      .run(id, person.id, concertId);
  }
  function host(id, person, concertId) {
    db.prepare("INSERT INTO parties (id, host_user_id, concert_id, capacity, section, spend_band, arrival_plan) VALUES (?, ?, ?, 2, 'pit', 2, 'doors')")
      .run(id, person.id, concertId);
  }
  return { db, api, user, concert, seeker, host };
}

const join = (f, concertId, cookie, sectionPref = 'pit', arrivalPref = 'doors') =>
  f.api(`/concerts/${concertId}/participation`, { method: 'POST', cookie,
    body: { sectionPref, arrivalPref } });
const decision = (concertId, target) => `/kaki/decisions/${concertId}/${target.id}`;
const poolIds = async (f, person) =>
  (await f.api('/kaki/pool', { cookie: person.cookie })).body.people.map((candidate) => candidate.id);
const matchIds = async (f, person) =>
  (await f.api('/kaki/matches', { cookie: person.cookie })).body.matches.map((candidate) => candidate.id);

test('profile is session-owned, private to its owner and only accepts whitelisted valid edits', async (t) => {
  const f = await fixture(t);
  const alice = await f.user('profile-alice');
  const bob = await f.user('profile-bob');
  assert.equal((await f.api('/me/profile')).status, 401);
  assert.equal((await f.api('/me/profile', { method: 'PATCH', body: { displayName: 'Eve' } })).status, 401);
  const initial = (await f.api('/me/profile', { cookie: alice.cookie })).body.profile;
  assert.equal(initial.email, alice.email);
  assert.equal(initial.id, alice.id);
  assert.equal(initial.companionGenderPref, 'any');
  assert.deepEqual(initial.vibe, { singalong: 0, photography: 0, dancing: 0, quiet: 0, queue_early: 0, merch: 0 });
  const updated = await f.api('/me/profile', { method: 'PATCH', cookie: alice.cookie, body: {
    displayName: 'Alice Edit', ageBand: '30-34', homeRegion: 'north_east', gender: 'nb',
    companionGenderPref: 'same_only', languages: ['ta', 'zh'], vibe: { dancing: 4, quiet: 2 },
  } });
  assert.equal(updated.status, 200);
  assert.deepEqual(updated.body.profile, { ...initial, displayName: 'Alice Edit', ageBand: '30-34',
    homeRegion: 'north_east', gender: 'nb', companionGenderPref: 'same_only', languages: ['ta', 'zh'],
    vibe: { singalong: 0, photography: 0, dancing: 4, quiet: 2, queue_early: 0, merch: 0 } });
  assert.deepEqual((await f.api('/me/profile', { cookie: alice.cookie })).body.profile, updated.body.profile);
  assert.equal((await f.api('/me/profile', { cookie: bob.cookie })).body.profile.email, bob.email);
  const publicAlice = (await f.api(`/users/${alice.id}`)).body.user;
  assert.equal(publicAlice.email, undefined);
  assert.equal((await f.api('/auth/me', { cookie: alice.cookie })).body.user.email, undefined);
  for (const field of ['email', 'password', 'password_hash', 'reliability', 'verified', 'id', 'userId']) {
    assert.equal((await f.api('/me/profile', { method: 'PATCH', cookie: alice.cookie,
      body: { [field]: field === 'verified' ? true : 'evil' } })).status, 400, field);
  }
  for (const invalid of [null, [], { displayName: '' }, { ageBand: '40-44' }, { homeRegion: 'south' },
    { gender: 'unknown' }, { companionGenderPref: 'everyone' }, { languages: [] },
    { languages: ['en', 'xx'] }, { languages: 'en' }, { vibe: { surprise: 2 } },
    { vibe: { dancing: 5 } }, { vibe: { dancing: 1.5 } }, { vibe: [] },
    { displayName: 'Changed', languages: ['invalid'] }]) {
    assert.equal((await f.api('/me/profile', { method: 'PATCH', cookie: alice.cookie, body: invalid })).status, 400,
      JSON.stringify(invalid));
  }
  assert.deepEqual((await f.api('/me/profile', { cookie: alice.cookie })).body.profile, updated.body.profile);
  assert.equal((await f.api('/me/profile', { method: 'PATCH', cookie: alice.cookie,
    body: { vibe: { merch: 3 } } })).body.profile.vibe.dancing, 0);
});

test('explicit concert joins are private, upsertable, withdrawable and independent of group matching', async (t) => {
  const f = await fixture(t);
  const alice = await f.user('join-alice');
  const bob = await f.user('join-bob');
  f.concert('c_join');
  const path = '/concerts/c_join/participation';
  assert.equal((await f.api('/me/concerts')).status, 401);
  for (const method of ['GET', 'POST', 'DELETE']) {
    assert.equal((await f.api(path, { method, body: method === 'POST' ?
      { sectionPref: 'pit', arrivalPref: 'doors' } : undefined })).status, 401);
    assert.equal((await f.api('/concerts/unknown/participation', { method, cookie: alice.cookie,
      body: method === 'POST' ? { sectionPref: 'pit', arrivalPref: 'doors' } : undefined })).status, 404);
  }
  assert.deepEqual((await f.api(path, { cookie: alice.cookie })).body, { participation: null });
  for (const body of [null, {}, { sectionPref: 'pit' }, { sectionPref: 'wrong', arrivalPref: 'doors' },
    { sectionPref: 'pit', arrivalPref: 'late' }, { sectionPref: 1, arrivalPref: 'doors' },
    { sectionPref: 'pit', arrivalPref: 'doors', userId: bob.id }]) {
    assert.equal((await f.api(path, { method: 'POST', cookie: alice.cookie, body })).status, 400);
  }
  const first = await join(f, 'c_join', alice.cookie);
  assert.equal(first.status, 200);
  assert.deepEqual(first.body.participation, { concertId: 'c_join', sectionPref: 'pit', arrivalPref: 'doors' });
  assert.deepEqual((await f.api(path, { cookie: bob.cookie })).body, { participation: null });
  assert.deepEqual((await f.api('/me/concerts', { cookie: alice.cookie })).body.concerts.map(({ concert, participation }) =>
    ({ id: concert.id, participation })), [{ id: 'c_join', participation: first.body.participation }]);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM seeker_requests').get().n, 0);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM parties').get().n, 0);
  assert.equal((await f.api('/concerts/c_join/requests')).body.requests.length, 0);
  assert.equal((await join(f, 'c_join', alice.cookie, 'upper_bowl', 'early_queue')).status, 200);
  assert.deepEqual((await f.api(path, { cookie: alice.cookie })).body.participation,
    { concertId: 'c_join', sectionPref: 'upper_bowl', arrivalPref: 'early_queue' });
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM concert_participants').get().n, 1);
  assert.equal((await f.api(path, { method: 'DELETE', cookie: alice.cookie })).status, 204);
  assert.deepEqual((await f.api(path, { cookie: alice.cookie })).body, { participation: null });
  assert.deepEqual((await f.api('/me/concerts', { cookie: alice.cookie })).body.concerts, []);
  assert.equal(f.db.prepare("SELECT status FROM concert_participants WHERE user_id = ? AND concert_id = 'c_join'")
    .get(alice.id).status, 'withdrawn');
  assert.equal((await join(f, 'c_join', alice.cookie, 'seated_any', 'mid')).status, 200);
  assert.deepEqual((await f.api(path, { cookie: alice.cookie })).body.participation,
    { concertId: 'c_join', sectionPref: 'seated_any', arrivalPref: 'mid' });
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM seeker_requests').get().n, 0);
});

test('joined participants extend Kaki candidates, withdrawal overrides legacy membership and clears outgoing likes', async (t) => {
  const f = await fixture(t);
  const alice = await f.user('candidate-alice');
  const bob = await f.user('candidate-bob');
  const host = await f.user('candidate-host');
  f.concert('c_pool');
  f.seeker('s_alice', alice, 'c_pool');
  f.seeker('s_bob', bob, 'c_pool');
  f.host('p_host', host, 'c_pool');
  assert.equal((await join(f, 'c_pool', alice.cookie)).status, 200);
  assert.equal((await join(f, 'c_pool', bob.cookie, 'ga_standing', 'early_queue')).status, 200);
  assert.equal((await join(f, 'c_pool', host.cookie)).status, 200);
  assert.deepEqual((await poolIds(f, alice)).sort(), [`c_pool:${bob.id}`, `c_pool:${host.id}`].sort());
  const hostCandidate = (await f.api('/kaki/pool', { cookie: alice.cookie })).body.people
    .find((person) => person.user.id === host.id);
  assert.equal(hostCandidate.sectionPref, 'pit');
  assert.equal(hostCandidate.arrivalPref, 'doors');
  assert.equal(hostCandidate.spendBandMax, null);
  assert.deepEqual(hostCandidate.plansWanted, {});
  assert.equal((await f.api(decision('c_pool', bob), { method: 'PUT', cookie: alice.cookie,
    body: { decision: 'like' } })).body.decision.mutual, false);
  assert.equal((await f.api(decision('c_pool', alice), { method: 'PUT', cookie: bob.cookie,
    body: { decision: 'like' } })).body.decision.mutual, true);
  assert.deepEqual(await matchIds(f, alice), [`c_pool:${bob.id}`]);
  assert.equal((await f.api('/concerts/c_pool/participation', { method: 'DELETE', cookie: bob.cookie })).status, 204);
  assert.deepEqual(await poolIds(f, alice), [`c_pool:${host.id}`]);
  assert.deepEqual(await poolIds(f, bob), []);
  assert.deepEqual(await matchIds(f, alice), []);
  assert.deepEqual((await f.api('/kaki/decisions', { cookie: alice.cookie })).body.decisions, {});
  assert.equal((await f.api(decision('c_pool', alice), { method: 'PUT', cookie: bob.cookie,
    body: { decision: 'like' } })).status, 404);
  assert.equal((await f.api(decision('c_pool', bob), { method: 'PUT', cookie: alice.cookie,
    body: { decision: 'like' } })).status, 404);
  assert.equal(f.db.prepare("SELECT count(*) AS n FROM kaki_decisions WHERE actor_user_id = ? AND decision = 'like'")
    .get(bob.id).n, 0);
  await join(f, 'c_pool', bob.cookie);
  assert.deepEqual((await poolIds(f, alice)).sort(), [`c_pool:${bob.id}`, `c_pool:${host.id}`].sort());
  assert.deepEqual(await matchIds(f, alice), []);
  assert.equal((await f.api(decision('c_pool', alice), { method: 'PUT', cookie: bob.cookie,
    body: { decision: 'like' } })).body.decision.mutual, true);
  assert.deepEqual(await matchIds(f, alice), [`c_pool:${bob.id}`]);
  assert.equal((await f.api('/concerts/c_pool/participation', { method: 'DELETE', cookie: host.cookie })).status, 204);
  assert.deepEqual(await poolIds(f, host), []);
  assert.equal((await f.api(decision('c_pool', alice), { method: 'PUT', cookie: host.cookie,
    body: { decision: 'like' } })).status, 404);
});

test('participation-only members can like mutually without creating seeker requests', async (t) => {
  const f = await fixture(t);
  const alice = await f.user('only-alice');
  const bob = await f.user('only-bob');
  f.concert('c_only');
  await join(f, 'c_only', alice.cookie);
  await join(f, 'c_only', bob.cookie);
  assert.deepEqual(await poolIds(f, alice), [`c_only:${bob.id}`]);
  assert.equal((await f.api(decision('c_only', bob), { method: 'PUT', cookie: alice.cookie,
    body: { decision: 'like' } })).body.decision.mutual, false);
  assert.equal((await f.api(decision('c_only', alice), { method: 'PUT', cookie: bob.cookie,
    body: { decision: 'like' } })).body.decision.mutual, true);
  assert.deepEqual(await matchIds(f, alice), [`c_only:${bob.id}`]);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM seeker_requests').get().n, 0);
});
