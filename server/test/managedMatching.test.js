import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createTestDb } from '../src/db/connection.js';
import { createApp } from '../src/app.js';
import { makeUser, makeParty, makeSeeker } from './helpers.js';

let db, repos, matching, server, base, cookies, ids;
beforeEach(async () => {
  db = createTestDb();
  const app = createApp({ db });
  ({ repos, matching } = app);
  server = app.app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}/api`;
  cookies = {};
  ids = {};
  for (const who of ['hostA', 'hostB', 'a', 'b', 'c', 'outsider', 'friend']) {
    const response = await call('/auth/register', null, 'POST', {
      display_name: who, email: `${who}@managed.test`, password: 'test-password',
      age_band: '21-24', home_region: 'central', gender: 'f', vibe: makeUser(who).vibe,
    });
    assert.equal(response.status, 201);
    cookies[who] = response.cookie;
    ids[who] = response.body.user.id;
  }
  for (const id of ['c1', 'c2']) repos.concerts.create({
    id, artist: id, venue: 'Venue', city: 'Singapore', event_date: '2026-12-01',
  });
  repos.parties.create(makeParty('cheap', makeUser(ids.hostA), { spend_band: 1 }));
  repos.parties.create(makeParty('rich', makeUser(ids.hostB), { spend_band: 3 }));
  for (const [id, host] of [['cheap', 'hostA'], ['rich', 'hostB']]) {
    repos.membership.configure(ids[host], id, { strangerPlaces: 1 });
    repos.membership.saveAnswers(ids[host], id, { about: ['supper'], wants: ['singalong'] });
  }
  for (const who of ['a', 'b', 'c', 'outsider']) repos.seekers.create(makeSeeker(`s_${who}`, makeUser(ids[who]), {
    spend_band_max: who === 'a' || who === 'c' ? 1 : 3,
  }));
  repos.recommendations.savePersonal(ids.a, 'c1', { about: ['quiet'] });
  repos.recommendations.savePersonal(ids.b, 'c1', { about: ['quiet'] });
  repos.recommendations.savePersonal(ids.c, 'c1', { about: ['singalong'] });
});
afterEach(async () => {
  await new Promise(resolve => server.close(resolve));
  db.close();
});
async function call(path, who, method = 'GET', body, extra = {}) {
  const response = await fetch(base + path, { method,
    headers: { 'content-type': 'application/json', ...(cookies[who] ? { cookie: cookies[who] } : {}), ...extra },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json(),
    cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
const endpoint = '/me/concerts/c1/matching';
const run = (who, key = randomUUID(), body) => call(endpoint, who, 'POST', body, { 'Idempotency-Key': key });
const state = who => call(endpoint, who);
const publish = (id = 'cheap') => {
  const party = repos.parties.findById(id);
  repos.membership.publish(party.host_user_id, id);
};
const count = table => db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n;
const respond = (request, who, action) => call(`/group-join-requests/${request.id}/respond`, who, 'POST', { action });
async function queue(...users) {
  for (const who of users) {
    const response = await run(who);
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { matching: { optedIn: true, state: 'queued', request: null } });
  }
}

// No operator endpoint, proposal acceptance, or directly seeded opt-in is used to run these batches.
test('normal-user endpoints authenticate, validate keys and ignore submitted identities', async () => {
  for (const method of ['GET', 'POST', 'DELETE']) assert.equal((await call(endpoint, null, method)).status, 401);
  assert.deepEqual((await state('friend')).body, { matching: { optedIn: false, state: 'idle', request: null } });
  assert.equal((await run('friend')).body.error, 'open_seeker_request_required');
  assert.equal((await call(endpoint, 'a', 'POST')).status, 400);
  assert.equal((await call(endpoint, 'a', 'POST', {}, { 'Idempotency-Key': 'not-a-uuid' })).status, 400);
  assert.equal((await call('/me/concerts/missing/matching', 'a')).status, 404);
  assert.equal((await call('/me/concerts/missing/matching', 'a', 'POST', {}, { 'Idempotency-Key': randomUUID() })).status, 404);
  assert.equal((await run('a', randomUUID(), { userId: ids.b, seekerId: 's_b' })).status, 200);
  assert.equal((await state('a')).body.matching.state, 'queued');
  assert.equal((await state('b')).body.matching.optedIn, false);
  assert.equal((await call('/concerts/c1/match', 'a', 'POST', {}, { 'Idempotency-Key': randomUUID() })).status, 403);
});

test('real batch competition persists stable budget-feasible assignments, traces and private requests', async () => {
  await queue('a', 'b', 'c');
  assert.equal(count('match_rounds'), 0);
  publish('cheap'); publish('rich');
  assert.equal((await call('/group-preferences/cheap', 'b', 'PUT')).status, 200);
  const result = await run('b');
  assert.equal(result.status, 200);
  assert.equal(result.body.matching.request.partyId, 'rich');
  const c = (await state('c')).body.matching;
  assert.equal(c.request.partyId, 'cheap');
  assert.equal(c.state, 'pending');
  assert.equal((await state('a')).body.matching.state, 'queued');
  assert.equal((await state('outsider')).body.matching.state, 'idle');
  assert.equal(count('match_rounds'), 1);
  assert.equal(count('match_results'), 3);
  assert.equal(count('match_proposals'), 0);
  assert.equal(count('group_join_requests'), 2);
  assert.ok(count('match_trace') > 0);
  const round = repos.rounds.findById(c.request.matchingRoundId);
  const snapshot = JSON.parse(round.preference_snapshot_json);
  assert.equal(round.solver_id, 'hospital-residents');
  assert.equal(round.is_stable, 1);
  assert.equal(round.seeker_count, 3);
  assert.equal(snapshot.seekerPrefs.s_b[0], 'cheap');
  assert.deepEqual(snapshot.seekerPrefs.s_a, ['cheap']);
  assert.equal(snapshot.partyPrefs.cheap[0], 's_c');
  assert.equal(matching.reverify(round.id).verified, true);
  assert.equal(repos.parties.findById('cheap').remaining_capacity, 0);
  assert.equal(repos.parties.findById('rich').remaining_capacity, 0);
  assert.deepEqual(Object.keys(result.body), ['matching']);
  assert.deepEqual(Object.keys(c.request).sort(), ['id', 'partyId', 'concertId', 'artist', 'hostName', 'section', 'status', 'expiresAt', 'matchingRoundId'].sort());
  assert.equal(c.request.hostName, 'hostA');
  assert.equal(c.request.artist, 'c1');
  assert.equal(c.request.status, 'pending');
  assert.equal(typeof c.request.expiresAt, 'number');
  const serialized = JSON.stringify(result.body);
  for (const privateValue of ['s_a', 's_c', ids.c, '@managed.test', 'assignments', 'trace', 'ledger', 'roster']) assert.ok(!serialized.includes(privateValue));
  assert.equal((await call(`/rounds/${round.id}`, 'b')).status, 403);
});

test('pending retries do not allocate twice and idempotency keys are account-scoped', async () => {
  publish('cheap'); publish('rich');
  const key = randomUUID();
  const first = await run('a', key);
  assert.equal(first.body.matching.state, 'pending');
  assert.deepEqual((await run('a', key)).body, first.body);
  assert.deepEqual((await run('a')).body, first.body);
  assert.equal(count('match_rounds'), 1);
  const second = await run('b', key);
  assert.equal(second.body.matching.request.partyId, 'rich');
  assert.notEqual(second.body.matching.request.matchingRoundId, first.body.matching.request.matchingRoundId);
  assert.equal(count('match_rounds'), 2);
  assert.equal(count('group_join_requests'), 2);
  assert.equal(db.prepare('SELECT COUNT(DISTINCT batch_key) n FROM match_rounds').get().n, 2);
  await call(endpoint, 'a', 'DELETE');
  assert.deepEqual((await run('a', key)).body, { matching: { optedIn: false, state: 'idle', request: null } });
  assert.equal(count('match_rounds'), 2);
});

test('no-option retries stay queued without empty rounds and missing saved answers get explicit defaults', async () => {
  const key = randomUUID();
  assert.equal(db.prepare('SELECT 1 FROM seeker_discovery_preferences WHERE user_id=?').get(ids.outsider), undefined);
  await run('outsider', key);
  assert.equal((await run('outsider', key)).body.matching.state, 'queued');
  assert.equal(count('match_rounds'), 0);
  assert.deepEqual(repos.recommendations.answers(ids.outsider, 'c1'), { about: [], wants: [], avoid: [] });
  publish('rich');
  assert.equal((await run('outsider', key)).body.matching.state, 'pending');
  assert.equal(count('match_rounds'), 1);
  assert.equal((await state('b')).body.matching.state, 'idle');
});

test('all writes including round and opt-in roll back if a later assigned request fails', async () => {
  await queue('a');
  publish('cheap'); publish('rich');
  const original = repos.recommendations.requestJoin;
  let calls = 0;
  repos.recommendations.requestJoin = (...args) => {
    const result = original(...args);
    if (++calls === 2) throw new Error('injected persistence failure');
    return result;
  };
  try {
    const response = await run('b');
    assert.equal(response.status, 500);
    assert.deepEqual(response.body, { error: 'match_failed' });
    assert.equal(calls, 2);
    assert.equal(count('match_rounds'), 0);
    assert.equal(count('match_results'), 0);
    assert.equal(count('match_trace'), 0);
    assert.equal(count('group_join_requests'), 0);
    assert.equal((await state('a')).body.matching.state, 'queued');
    assert.equal((await state('b')).body.matching.optedIn, false);
    assert.equal(repos.parties.findById('cheap').remaining_capacity, 1);
  } finally {
    repos.recommendations.requestJoin = original;
  }
});

test('host approval consumes a reserved seat once and legacy reconciliation accepts managed membership', async () => {
  publish();
  const request = (await run('a')).body.matching.request;
  assert.equal((await respond(request, 'b', 'accept')).status, 404);
  assert.equal((await respond(request, 'hostA', 'accept')).status, 200);
  assert.equal((await respond(request, 'hostA', 'accept')).status, 409);
  assert.equal((await state('a')).body.matching.state, 'accepted');
  assert.equal((await state('a')).body.matching.request.id, request.id);
  assert.equal(repos.parties.findById('cheap').remaining_capacity, 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM group_memberships WHERE user_id=? AND status='active'").get(ids.a).n, 1);
  assert.equal(repos.rounds.hasUnreconciledLegacyAssignments('c1'), false);
  assert.equal((await run('b')).body.matching.state, 'queued');
  await call('/groups/cheap/leave', 'a', 'POST');
  assert.equal((await state('a')).body.matching.state, 'idle');
  assert.equal((await state('a')).body.matching.request, null);
  assert.equal(repos.parties.findById('cheap').remaining_capacity, 1);
});

test('same-round multiple reservations survive approval without consent version invalidation', async () => {
  repos.membership.configure(ids.hostA, 'cheap', { strangerPlaces: 2 });
  await queue('a', 'c');
  publish();
  await run('a');
  const a = (await state('a')).body.matching.request;
  const c = (await state('c')).body.matching.request;
  assert.equal(a.matchingRoundId, c.matchingRoundId);
  assert.equal(repos.parties.findById('cheap').remaining_capacity, 0);
  assert.equal((await respond(a, 'hostA', 'accept')).status, 200);
  assert.equal((await respond(c, 'hostA', 'accept')).status, 200);
  assert.equal(repos.parties.findById('cheap').remaining_capacity, 0);
});

test('withdrawal, expiry and rejection release reservations and retain declined-pair exclusion', async () => {
  publish();
  let request = (await run('a')).body.matching.request;
  assert.equal((await call(endpoint, 'b', 'DELETE')).body.matching.state, 'idle');
  assert.equal((await state('a')).body.matching.state, 'pending');
  assert.equal((await call(endpoint, 'a', 'DELETE')).body.matching.state, 'idle');
  assert.equal(repos.parties.findById('cheap').remaining_capacity, 1);
  request = (await run('c')).body.matching.request;
  db.prepare('UPDATE group_join_requests SET expires_at=? WHERE id=?').run(Date.now() - 1, request.id);
  assert.equal((await state('c')).body.matching.state, 'queued');
  await call(endpoint, 'c', 'DELETE');
  assert.equal((await run('a')).body.matching.state, 'pending');
  const a = (await state('a')).body.matching.request;
  assert.equal((await respond(a, 'hostA', 'reject')).status, 200);
  assert.equal(repos.parties.findById('cheap').remaining_capacity, 1);
  assert.equal((await run('a')).body.matching.state, 'queued');
  assert.equal((await run('c')).body.matching.state, 'pending');
  assert.ok(repos.proposals.declinedPairsForConcert('c1').has('s_a|cheap'));
});

test('manual requests and legacy proposals cannot be silently replaced by managed matching', async () => {
  publish();
  assert.equal((await call('/groups/cheap/join-requests', 'a', 'POST')).status, 200);
  assert.equal((await run('a')).body.error, 'withdraw_current_join_request_first');
  assert.equal((await state('a')).body.matching.optedIn, false);
  const pending = repos.recommendations.requests(ids.a).find(r => r.userId === ids.a && r.status === 'pending');
  assert.equal(pending.matchingRoundId, null);
  // A manual request does not reserve an automatic place, but its seeker is excluded.
  assert.equal(repos.parties.findById('cheap').remaining_capacity, 1);
  assert.equal(matching.preview('c1').empty, true);
  repos.parties.create(makeParty('legacy', makeUser(ids.friend)));
  const legacy = matching.run('c1', { batchKey: randomUUID() });
  assert.equal(legacy.empty, false);
  const proposal = repos.proposals.forUser(ids.b).find(p => p.status === 'proposed');
  assert.ok(proposal);
  assert.equal((await run('b')).body.error, 'active_matching_proposal_exists');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM group_join_requests WHERE user_id=?').get(ids.a).n, 1);
});

test('member blocks, unpublished groups, saved concept changes and budget constraints are respected', async () => {
  const invitation = repos.membership.invite(ids.hostA, 'cheap');
  repos.membership.configure(ids.hostA, 'cheap', { expectedFriends: 1, strangerPlaces: 1 });
  repos.membership.acceptInvite(ids.friend, invitation.token);
  repos.membership.saveAnswers(ids.friend, 'cheap', { about: ['supper'] });
  publish();
  repos.users.block(ids.a, ids.friend);
  assert.equal((await run('a')).body.matching.state, 'queued');
  assert.equal(count('match_rounds'), 0);
  publish('rich');
  assert.equal((await run('a')).body.matching.state, 'queued');
  assert.equal(count('match_rounds'), 0);
  const request = (await run('b')).body.matching.request;
  assert.ok(request);
  repos.recommendations.savePersonal(ids.b, 'c1', { wants: ['merch'] });
  assert.equal((await respond(request, request.partyId === 'cheap' ? 'hostA' : 'hostB', 'accept')).body.error,
    'preferences_changed_withdraw_and_resubmit');
  await call(endpoint, 'b', 'DELETE');
  assert.equal((await state('b')).body.matching.state, 'idle');
});

test('discovery advertises automatic matching only for eligible managed destinations', async () => {
  publish();
  const cards = (await call('/groups/discover/c1', 'a')).body.groups;
  assert.equal(cards.find(p => p.id === 'cheap').automaticPlacementAvailable, true);
  assert.ok(!cards.some(p => p.id === 'rich'));
  const withoutSeeker = (await call('/groups/discover/c1', 'friend')).body.groups;
  assert.equal(withoutSeeker.find(p => p.id === 'cheap').automaticPlacementAvailable, false);
  await call('/groups/cheap/join-requests', 'a', 'POST');
  assert.equal((await call('/groups/discover/c1', 'a')).body.groups.find(p => p.id === 'cheap').automaticPlacementAvailable, false);
  assert.equal((await call('/me/concerts/c2/matching', 'a')).body.matching.state, 'idle');
});

test('simultaneous HTTP attempts never overbook and never enrol an untouched seeker', async () => {
  publish('cheap'); publish('rich');
  const attempts = await Promise.all([run('a'), run('c'), run('b')]);
  assert.ok(attempts.every(r => r.status === 200));
  const reservations = db.prepare(`SELECT party_id,COUNT(*) n FROM group_join_requests
    WHERE status='pending' AND matching_round_id IS NOT NULL GROUP BY party_id`).all();
  assert.equal(reservations.reduce((n, r) => n + r.n, 0), 2);
  assert.ok(reservations.every(r => r.n === 1));
  assert.equal(count('match_proposals'), 0);
  assert.equal((await state('outsider')).body.matching.optedIn, false);
  assert.equal((await state('outsider')).body.matching.request, null);
  assert.ok(repos.parties.findById('cheap').remaining_capacity >= 0);
  assert.ok(repos.parties.findById('rich').remaining_capacity >= 0);
});

test('cancelled destinations and left memberships never appear as current accepted or pending matches', async () => {
  publish();
  const pending = (await run('a')).body.matching.request;
  assert.equal((await call('/groups/cheap/cancel', 'hostA', 'POST')).status, 200);
  const current = (await state('a')).body.matching;
  assert.ok(['idle', 'queued'].includes(current.state));
  assert.equal(current.request, null);
  assert.equal((await respond(pending, 'hostA', 'accept')).status, 409);
  assert.equal((await run('a')).body.matching.request, null);
});

test('managed matching refuses unsupported linked-request constraints without committing a relaxed assignment', async () => {
  await queue('a', 'b');
  db.prepare("UPDATE seeker_requests SET linked_request_id='s_b' WHERE id='s_a'").run();
  db.prepare("UPDATE seeker_requests SET linked_request_id='s_a' WHERE id='s_b'").run();
  publish('cheap'); publish('rich');
  const result = await run('a');
  assert.equal(result.status, 409);
  assert.equal(result.body.error, 'unsupported_matching_constraints');
  assert.equal(count('match_rounds'), 0);
  assert.equal(count('group_join_requests'), 0);
  assert.equal((await state('a')).body.matching.state, 'queued');
});
