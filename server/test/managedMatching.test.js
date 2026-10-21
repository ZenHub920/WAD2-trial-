import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createTestDb } from '../src/db/connection.js';
import { createApp } from '../src/app.js';
import { makeUser, makeParty, makeSeeker } from './helpers.js';
import { findBlockingPairs } from '../src/matching/stability.js';

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
  db.prepare('UPDATE users SET is_operator=1 WHERE id=?').run(ids.hostA);
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
  db.prepare("UPDATE seeker_requests SET joining_mode='direct',matching_opt_in=0").run();
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
    assert.deepEqual(response.body, { matching: { optedIn: true, state: 'queued', request: null, proposal: null } });
  }
}

const official = (key = randomUUID()) => call('/concerts/c1/match', 'hostA', 'POST', {}, { 'Idempotency-Key': key });
const proposal = who => repos.proposals.forUser(ids[who], 'c1').find(p => p.role === 'seeker' && p.status === 'proposed');
const answer = (offer, who, decision) => call(`/proposals/${offer.id}/${decision}`, who, 'POST');

test('queue authenticates, validates keys and ignores submitted identities without running a global batch', async () => {
  for (const method of ['GET', 'POST', 'DELETE']) assert.equal((await call(endpoint, null, method)).status, 401);
  assert.deepEqual((await state('friend')).body, { matching: { optedIn: false, state: 'idle', request: null, proposal: null } });
  assert.equal((await run('friend')).body.error, 'open_seeker_request_required');
  assert.equal((await call(endpoint, 'a', 'POST')).status, 400);
  assert.equal((await call(endpoint, 'a', 'POST', {}, { 'Idempotency-Key': 'not-a-uuid' })).status, 400);
  assert.equal((await call('/me/concerts/missing/matching', 'a')).status, 404);
  publish();
  assert.equal((await run('a', randomUUID(), { userId: ids.b, seekerId: 's_b' })).status, 200);
  assert.equal((await state('a')).body.matching.state, 'queued');
  assert.equal((await state('b')).body.matching.optedIn, false);
  assert.equal(count('match_rounds'), 0);
  assert.equal((await call('/concerts/c1/match', 'a', 'POST', {}, { 'Idempotency-Key': randomUUID() })).status, 403);
});

test('official batches use two-sided managed scores, saved priorities and actual reserved proposals', async () => {
  await queue('a', 'b', 'c');
  publish('cheap'); publish('rich');
  assert.equal((await call('/group-preferences/cheap', 'b', 'PUT')).status, 200);
  const outcome = await official();
  assert.equal(outcome.status, 201);
  assert.equal(proposal('b').partyId, 'rich');
  assert.equal(proposal('c').partyId, 'cheap');
  assert.equal((await state('a')).body.matching.state, 'queued');
  assert.equal((await state('outsider')).body.matching.state, 'idle');
  assert.equal(count('match_proposals'), 2);
  assert.equal(count('group_join_requests'), 0);
  assert.equal(count('match_results'), 3);
  assert.ok(count('match_trace') > 0);
  const round = repos.rounds.findById(outcome.body.roundId);
  const snapshot = JSON.parse(round.preference_snapshot_json);
  assert.equal(round.solver_id, 'hospital-residents');
  assert.equal(round.is_stable, 1);
  assert.equal(snapshot.seekerPrefs.s_b[0], 'cheap');
  assert.deepEqual(snapshot.seekerPrefs.s_a, ['cheap']);
  assert.equal(snapshot.partyPrefs.cheap[0], 's_c');
  assert.equal(matching.reverify(round.id).verified, true);
  assert.equal(repos.parties.findById('cheap').remaining_capacity, 0);
  assert.equal(repos.parties.findById('rich').remaining_capacity, 0);
  const pending = (await state('c')).body.matching;
  assert.equal(pending.state, 'pending');
  assert.equal(pending.request, null);
  assert.equal(pending.proposal.id, proposal('c').id);
  assert.equal((await call(`/rounds/${round.id}`, 'b')).status, 403);
  const serialized = JSON.stringify(pending);
  for (const privateValue of ['s_a', ids.a, '@managed.test', 'assignments', 'trace', 'ledger', 'roster']) assert.ok(!serialized.includes(privateValue));
});

test('queue retries and operator batch retries never create duplicate offers or rewrite history', async () => {
  publish();
  const key = randomUUID();
  await run('a', key); await run('a', key);
  assert.equal(count('match_rounds'), 0);
  const first = await official(key);
  const replay = await official(key);
  assert.equal(first.status, 201);
  assert.equal(replay.status, 200);
  assert.equal(first.body.roundId, replay.body.roundId);
  assert.equal(count('match_rounds'), 1);
  assert.equal(count('match_proposals'), 1);
  const pending = (await state('a')).body;
  assert.deepEqual((await run('a', key)).body, pending);
  assert.equal(count('match_rounds'), 1);
});

test('no-option seekers remain queued and official runs do not fabricate empty rounds', async () => {
  await queue('a');
  assert.equal((await official()).status, 409);
  assert.equal(count('match_rounds'), 0);
  publish('rich'); // unaffordable for a
  assert.equal((await official()).body.error, 'nothing_to_match');
  assert.equal(count('match_rounds'), 0);
  assert.equal((await state('a')).body.matching.state, 'queued');
});

test('failure after later proposal persistence rolls back complete round, claims and statuses', async () => {
  await queue('a', 'b');
  publish('cheap'); publish('rich');
  const original = repos.proposals.createFromRound;
  repos.proposals.createFromRound = (...args) => {
    original(...args);
    throw new Error('injected persistence failure');
  };
  try {
    assert.equal((await official()).status, 500);
    for (const table of ['match_rounds', 'match_results', 'match_trace', 'match_proposals', 'active_seat_claims']) assert.equal(count(table), 0);
    assert.equal((await state('a')).body.matching.state, 'queued');
    assert.equal((await state('b')).body.matching.state, 'queued');
    assert.equal(repos.parties.findById('cheap').remaining_capacity, 1);
  } finally { repos.proposals.createFromRound = original; }
});

for (const first of ['seeker', 'host']) test(`${first}-first approval keeps the offer reserved until both sides accept`, async () => {
  await queue('a'); publish(); await official();
  const offer = proposal('a');
  const firstUser = first === 'seeker' ? 'a' : 'hostA';
  const secondUser = first === 'seeker' ? 'hostA' : 'a';
  assert.equal((await answer(offer, 'b', 'accept')).status, 404);
  const initial = await answer(offer, firstUser, 'accept');
  assert.equal(initial.status, 200);
  assert.equal(initial.body.proposal.status, 'proposed');
  const partial = proposal('a');
  assert.equal(partial.seekerApproved, first === 'seeker');
  assert.equal(partial.hostApproved, first === 'host');
  assert.throws(() => db.prepare("UPDATE match_proposals SET status='confirmed' WHERE id=?").run(offer.id), /mutual_approval_required/);
  assert.equal((await state('a')).body.matching.state, 'pending');
  assert.equal(repos.parties.findById('cheap').remaining_capacity, 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM group_memberships WHERE user_id=? AND status='active'").get(ids.a).n, 0);
  assert.equal((await call(endpoint, 'a', 'DELETE')).status, 409);
  assert.equal((await answer(offer, firstUser, 'accept')).status, 409);
  const final = await answer(offer, secondUser, 'accept');
  assert.equal(final.status, 200);
  assert.equal((await state('a')).body.matching.state, 'accepted');
  assert.equal(repos.parties.findById('cheap').remaining_capacity, 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM group_memberships WHERE user_id=? AND status='active'").get(ids.a).n, 1);
  assert.equal(repos.rounds.hasUnreconciledLegacyAssignments('c1'), false);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM active_seat_claims WHERE seeker_request_id='s_a' AND status='confirmed'").get().n, 1);
  assert.equal((await answer(offer, secondUser, 'accept')).status, 409);
  assert.equal((await call('/groups/cheap/leave', 'a', 'POST')).status, 200);
  assert.equal((await state('a')).body.matching.state, 'idle');
  assert.equal(repos.parties.findById('cheap').remaining_capacity, 1);
  assert.equal(count('match_results'), 1);
});

for (const firstApprover of ['a', 'hostA']) test(`the other side may decline after ${firstApprover} approves without creating membership`, async () => {
  await queue('a'); publish(); await official();
  const offer = proposal('a');
  assert.equal((await answer(offer, firstApprover, 'accept')).status, 200);
  assert.equal((await answer(offer, firstApprover === 'a' ? 'hostA' : 'a', 'decline')).status, 200);
  assert.equal((await state('a')).body.matching.state, 'queued');
  assert.equal(repos.parties.findById('cheap').remaining_capacity, 1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM group_memberships WHERE user_id=? AND status='active'").get(ids.a).n, 0);
  assert.equal(repos.proposals.forUser(ids.a)[0].status, 'declined');
  assert.equal(count('match_results'), 1);
  assert.ok(repos.proposals.declinedPairsForConcert('c1').has('s_a|cheap'));
});

test('mode changes never silently decline pending offers or withdraw direct applications', async () => {
  await queue('a'); publish(); await official();
  const offer = proposal('a');
  assert.equal((await call(endpoint, 'a', 'DELETE')).status, 409);
  assert.equal(proposal('a').id, offer.id);
  assert.equal((await answer(offer, 'a', 'decline')).status, 200);
  assert.equal((await call(endpoint, 'a', 'DELETE')).status, 200);
  assert.equal((await state('a')).body.matching.state, 'idle');
  assert.ok(repos.proposals.declinedPairsForConcert('c1').has('s_a|cheap'));
  const direct = await call('/groups/cheap/join-requests', 'c', 'POST');
  assert.equal(direct.status, 200);
  assert.equal((await run('c')).status, 409);
  assert.equal(repos.recommendations.requests(ids.c).find(r => r.id === direct.body.request.id)?.status, 'pending');
});

test('expiry releases proposals, restores algorithm queue and does not create compatibility declines', async () => {
  await queue('a'); publish(); await official();
  const offer = proposal('a');
  assert.equal((await answer(offer, 'hostA', 'accept')).status, 200);
  assert.equal(proposal('a').hostApproved, true);
  db.prepare('UPDATE match_proposals SET expires_at=? WHERE id=?').run(Date.now() - 1, offer.id);
  assert.equal((await state('a')).body.matching.state, 'queued');
  assert.equal(repos.parties.findById('cheap').remaining_capacity, 1);
  assert.ok(!repos.proposals.declinedPairsForConcert('c1').has('s_a|cheap'));
  assert.equal((await official()).status, 201);
  assert.notEqual(proposal('a').id, offer.id);
});

test('member blocks, unpublished groups and budget constraints exclude the same pairs in discovery and GS', async () => {
  const invite = repos.membership.invite(ids.hostA, 'cheap');
  repos.membership.configure(ids.hostA, 'cheap', { expectedFriends: 1, strangerPlaces: 1 });
  repos.membership.acceptInvite(ids.friend, invite.token);
  repos.membership.saveAnswers(ids.friend, 'cheap', { about: ['supper'] });
  publish();
  repos.users.block(ids.a, ids.friend);
  await queue('a');
  assert.equal((await official()).status, 409);
  assert.equal((await call('/groups/discover/c1', 'a')).body.groups.length, 0);
  publish('rich');
  assert.equal((await official()).status, 409);
  await queue('b');
  assert.equal((await official()).status, 201);
  assert.ok(proposal('b'));
});

test('discovery permits browsing both modes and identifies eligible managed destinations', async () => {
  publish();
  const cards = (await call('/groups/discover/c1', 'a')).body.groups;
  assert.equal(cards.find(p => p.id === 'cheap').automaticPlacementAvailable, true);
  const withoutSeeker = (await call('/groups/discover/c1', 'friend')).body.groups;
  assert.equal(withoutSeeker.find(p => p.id === 'cheap').automaticPlacementAvailable, false);
  assert.equal((await call('/groups/cheap/join-requests', 'a', 'POST')).status, 200);
  assert.equal((await call('/groups/discover/c1', 'a')).body.groups.find(p => p.id === 'cheap').automaticPlacementAvailable, false);
});

test('direct discovery and automatic preference construction share the same directional compatibility', async () => {
  publish('cheap'); publish('rich');
  const directCards = (await call('/groups/discover/c1', 'b')).body.groups;
  await queue('b');
  const automaticCards = (await call('/groups/discover/c1', 'b')).body.groups;
  assert.deepEqual(automaticCards.map(p => [p.id, p.compatibility]), directCards.map(p => [p.id, p.compatibility]));
  const before = matching.preview('c1');
  for (const card of automaticCards) {
    const pair = before.profile.pairScores.get(`s_b|${card.id}`);
    const shared = repos.recommendations.pairScore(repos.seekers.findById('s_b'), repos.parties.findById(card.id));
    assert.equal(pair.seekerToParty, shared.seekerToParty);
    assert.equal(pair.partyToSeeker, shared.partyToSeeker);
    assert.equal(card.compatibility, Math.round(((pair.seekerToParty + pair.partyToSeeker) / 2) * 10000) / 10000);
  }
  assert.equal((await call('/group-preferences/rich', 'b', 'PUT')).status, 200);
  const after = matching.preview('c1');
  assert.equal(after.profile.seekerPrefs.get('s_b')[0], 'rich');
  assert.deepEqual(after.profile.partyPrefs, before.profile.partyPrefs);
  assert.ok(after.profile.seekerPrefs.get('s_b').includes('cheap'));
  assert.equal(findBlockingPairs(after.profile, after.result).stable, true);
});

test('concurrent official rounds cannot overbook and do not enroll direct-mode seekers', async () => {
  await queue('a', 'b', 'c');
  publish('cheap'); publish('rich');
  const attempts = await Promise.all([official(), official(), official()]);
  assert.ok(attempts.every(r => [201, 409].includes(r.status)));
  assert.equal(count('match_proposals'), 2);
  assert.equal(count('group_join_requests'), 0);
  assert.equal((await state('outsider')).body.matching.state, 'idle');
  assert.equal(proposal('outsider'), undefined);
  assert.equal(repos.parties.findById('cheap').remaining_capacity, 0);
  assert.equal(repos.parties.findById('rich').remaining_capacity, 0);
});

test('concurrent host approval and operator matching share the final seat and preserve the losing pathway', async () => {
  publish('cheap');
  await queue('a');
  const applied = await call('/groups/cheap/join-requests', 'c', 'POST');
  assert.equal(applied.status, 200);
  assert.equal(repos.parties.findById('cheap').remaining_capacity, 1);
  const [batch, host] = await Promise.all([
    official(),
    respond(applied.body.request, 'hostA', 'accept'),
  ]);
  assert.ok([201, 409].includes(batch.status), JSON.stringify(batch.body));
  assert.ok([200, 409].includes(host.status), JSON.stringify(host.body));
  assert.equal(Number(batch.status === 201) + Number(host.status === 200), 1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM active_seat_claims WHERE party_id='cheap' AND status IN('proposed','confirmed')").get().n, 1);
  assert.equal(repos.parties.findById('cheap').remaining_capacity, 0);
  assert.equal(count('match_results'), batch.status === 201 ? 1 : 0);
  assert.equal(count('match_rounds'), batch.status === 201 ? 1 : 0);
  assert.equal(repos.proposals.declinedPairsForConcert('c1').has('s_c|cheap'), false);
  if (batch.status === 201) {
    assert.equal(repos.recommendations.requests(ids.c).find(r => r.id === applied.body.request.id).status, 'pending');
    const offer = proposal('a');
    assert.equal((await answer(offer, 'a', 'accept')).status, 200);
    assert.equal((await state('a')).body.matching.state, 'pending');
    assert.equal((await answer(offer, 'hostA', 'accept')).status, 200);
    assert.equal((await state('a')).body.matching.state, 'accepted');
    assert.equal(matching.reverify(batch.body.roundId).verified, true);
  } else {
    assert.equal((await state('c')).body.matching.state, 'accepted');
    assert.equal((await state('a')).body.matching.state, 'queued');
    assert.equal(count('match_proposals'), 0);
  }
  assert.equal(repos.parties.findById('cheap').remaining_capacity, 0);
});

test('cancelled destinations stop appearing as current matching offers', async () => {
  await queue('a'); publish(); await official();
  const pending = proposal('a');
  assert.equal((await call('/groups/cheap/cancel', 'hostA', 'POST')).status, 200);
  assert.equal((await state('a')).body.matching.proposal, null);
  assert.equal((await answer(pending, 'a', 'accept')).status, 409);
  assert.equal(repos.parties.findById('cheap').remaining_capacity, 1);
});

test('classification and preview ledger remain available but unsupported official assignments do not persist', async () => {
  await queue('a', 'b');
  db.prepare("UPDATE seeker_requests SET linked_request_id='s_b' WHERE id='s_a'").run();
  db.prepare("UPDATE seeker_requests SET linked_request_id='s_a' WHERE id='s_b'").run();
  publish('cheap'); publish('rich');
  const preview = matching.preview('c1');
  assert.ok(preview.ledger.relaxations.length > 0);
  const result = await official();
  assert.equal(result.status, 409);
  assert.equal(result.body.error, 'unsupported_matching_constraints');
  assert.equal(count('match_rounds'), 0);
  assert.equal(count('match_proposals'), 0);
});
