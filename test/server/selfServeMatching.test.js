import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestDb } from '../../server/src/db/connection.js';
import { migrateMatchingSearches } from '../../server/src/db/matchingSearchMigrations.js';
import { createApp } from '../../server/src/app.js';
import { makeUser, makeSeeker, makeParty } from './helpers.js';

async function fixture(t) {
  const db = createTestDb(), directory = mkdtempSync(join(tmpdir(), 'encore-self-serve-'));
  const built = createApp({ db, env: { NODE_ENV: 'test', APP_ORIGIN: 'https://encore.example' },
    avatarDir: join(directory, 'avatars'), imageDir: join(directory, 'tickets'),
    fetchImpl: async () => { throw new Error('unexpected_external_request'); },
    mailer: { configured: false, async send() { throw new Error('unexpected_test_email'); } },
  });
  const server = built.app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    await built.delivery.stop(); await built.security.close(); db.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const { repos, matching } = built, cookies = {};
  for (const id of ['host_a', 'host_b', 'seeker_a', 'seeker_b', 'outsider']) {
    repos.users.create(makeUser(id));
    const token = randomBytes(32).toString('hex');
    repos.sessions.create(createHash('sha256').update(token).digest('hex'), id, Date.now() + 3600000);
    cookies[id] = `encore_session=${token}`;
  }
  for (const id of ['c1', 'c2']) repos.concerts.create({ id, artist: id, venue: 'Hall', city: 'Singapore', event_date: '2030-12-01' });
  for (const id of ['seeker_a', 'seeker_b']) {
    repos.seekers.create(makeSeeker(`request_${id}`, makeUser(id)));
    db.prepare("UPDATE seeker_requests SET joining_mode='direct',matching_opt_in=0 WHERE user_id=?").run(id);
    repos.recommendations.savePersonal(id, 'c1', { about: ['singalong'], wants: ['supper'] });
  }
  for (const [id, host] of [['group_a', 'host_a'], ['group_b', 'host_b']]) {
    repos.parties.create(makeParty(id, makeUser(host)));
    repos.membership.configure(host, id, { strangerPlaces: 1 });
    // Groups are listed as soon as they are set up; these tests list each one themselves.
    db.prepare('UPDATE group_settings SET published=0 WHERE party_id=?').run(id);
    repos.membership.saveAnswers(host, id, { about: ['singalong'], wants: ['supper'] });
  }
  async function call(path, { user = 'seeker_a', method = 'GET', key, body, headers = {} } = {}) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, { method,
      headers: { 'X-Requested-With': 'Encore', ...(user ? { cookie: cookies[user] } : {}), ...(key ? { 'Idempotency-Key': key } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json(), headers: response.headers };
  }
  return { db, repos, matching, call,
    count: table => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n,
    enroll: (user = 'seeker_a', concert = 'c1') => repos.recommendations.setJoiningMode(user, concert, 'algorithm'),
    publish: (id = 'group_a') => repos.membership.publish(repos.parties.findById(id).host_user_id, id),
    find: ({ user = 'seeker_a', concert = 'c1', key = randomUUID(), ...rest } = {}) => call(`/me/concerts/${concert}/matching/find`, { user, method: 'POST', key, ...rest }),
    answer: (proposal, user, action = 'accept') => call(`/proposals/${proposal.id}/${action}`, { user, method: 'POST' }),
  };
}

test('Find a match authenticates, validates UUIDs and keeps internal batch data private', async t => {
  const f = await fixture(t);
  assert.equal((await f.find({ user: null })).status, 401);
  for (const key of [null, 'not-a-uuid']) assert.equal((await f.find({ key })).body.error, 'invalid_idempotency_key');
  assert.equal((await f.find({ concert: 'missing' })).status, 404);
  f.enroll(); f.enroll('seeker_b'); f.publish(); f.publish('group_b');
  const response = await f.find({ body: { userId: 'seeker_b', concertId: 'c2', trace: true } });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(response.body.matching.state, 'pending');
  assert.equal(response.body.search.status, 'proposed');
  assert.equal(response.body.matching.proposal.role, 'seeker');
  assert.equal(response.body.matching.proposal.seekerId, undefined);
  assert.deepEqual(Object.keys(response.body).sort(), ['matching', 'search']);
  const json = JSON.stringify(response.body);
  for (const forbidden of ['"metrics"', '"trace"', '"assignments"', '"unmatched"', '"ledger"', '"seeker_b"', '"request_seeker_b"'])
    assert.ok(!json.includes(forbidden), forbidden);
  assert.equal(f.count('match_rounds'), 1);
  assert.equal(f.count('match_proposals'), 2);
  const round = f.db.prepare('SELECT * FROM match_rounds').get();
  assert.equal(round.is_stable, 1); assert.equal(round.solver_id, 'hospital-residents');
  assert.equal(f.matching.reverify(round.id).verified, true);
  assert.ok(f.count('match_trace') > 0);
});

test('joining, switching modes, publishing and prioritising do not start a round; Find is a separate action', async t => {
  const f = await fixture(t); f.publish();
  const joined = await f.call('/me/concerts/c1/matching', { method: 'POST', key: randomUUID() });
  assert.equal(joined.body.matching.state, 'queued');
  assert.equal((await f.call('/group-preferences/group_a', { method: 'PUT' })).status, 200);
  f.enroll('seeker_b');
  assert.equal(f.count('match_rounds'), 0); assert.equal(f.count('match_proposals'), 0);
  assert.equal(f.count('matching_search_requests'), 0);
  assert.equal((await f.find()).body.search.status, 'proposed');
  assert.equal(f.count('match_rounds'), 1);
});

test('new searches require actual enrollment and saved preferences, including legacy algorithm mode without answers', async t => {
  const f = await fixture(t); f.publish();
  assert.equal((await f.find()).body.error, 'join_matching_pool_first');
  assert.equal((await f.find({ user: 'outsider' })).body.error, 'open_seeker_request_required');
  f.enroll();
  f.db.prepare("UPDATE seeker_requests SET matching_opt_in=0 WHERE user_id='seeker_a'").run();
  f.db.prepare("DELETE FROM seeker_discovery_preferences WHERE user_id='seeker_a'").run();
  assert.equal((await f.find()).body.error, 'save_discovery_preferences_first');
  assert.equal(f.count('matching_search_requests'), 0); assert.equal(f.count('match_rounds'), 0);
  f.repos.recommendations.savePersonal('seeker_a', 'c1', { about: ['singalong'] });
  assert.equal((await f.find()).body.search.status, 'proposed', 'canonical algorithm enrollment remains compatible with the legacy flag');
});

test('no offer is a real waiting result; retrying the same empty attempt cannot run after a group becomes available', async t => {
  const f = await fixture(t); f.enroll(); const key = randomUUID();
  const empty = await f.find({ key });
  assert.equal(empty.status, 200); assert.equal(empty.body.search.status, 'waiting');
  assert.equal(empty.body.matching.state, 'queued'); assert.equal(empty.body.matching.proposal, null);
  assert.ok(empty.body.search.message.startsWith('No suitable group is available.'));
  assert.equal(empty.body.search.replayed, false);
  const attempt = empty.body.search.attempt;
  assert.equal(attempt.id, key); assert.equal(attempt.status, 'waiting');
  assert.equal(attempt.completed, true); assert.equal(attempt.receivedProposal, false);
  assert.equal(attempt.proposalId, null); assert.equal(attempt.ranMatching, true);
  assert.ok(Number.isFinite(attempt.attemptedAt)); assert.ok(attempt.completedAt >= attempt.attemptedAt);
  const refreshed = await f.call('/me/concerts/c1/matching');
  assert.equal(refreshed.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(refreshed.body.matching.latestAttempt, attempt, 'the empty attempt survives an ordinary page refresh');
  assert.equal(f.count('match_rounds'), 0); assert.equal(f.count('matching_search_requests'), 1);
  f.publish();
  const retry = await f.find({ key: key.toUpperCase() });
  assert.equal(retry.body.search.replayed, true); assert.equal(retry.body.search.status, 'waiting');
  assert.deepEqual(retry.body.search.attempt, attempt);
  assert.equal(f.count('match_rounds'), 0); assert.equal(f.count('match_proposals'), 0);
  assert.equal((await f.find()).body.search.status, 'proposed'); assert.equal(f.count('match_rounds'), 1);
});

test('latest attempt is user/concert scoped and historical outcomes do not replace current proposals on replay', async t => {
  const f = await fixture(t); f.enroll(); f.enroll('seeker_b');
  const firstKey = randomUUID(), empty = await f.find({ key: firstKey });
  assert.equal((await f.call('/me/concerts/c1/matching', { user: 'seeker_b' })).body.matching.latestAttempt, null);
  assert.equal((await f.call('/me/concerts/c2/matching')).body.matching.latestAttempt, null);
  f.publish();
  const secondKey = randomUUID(), offered = await f.find({ key: secondKey });
  const proposal = offered.body.matching.proposal, receipt = offered.body.search.attempt;
  assert.equal(receipt.id, secondKey); assert.equal(receipt.status, 'proposed');
  assert.equal(receipt.receivedProposal, true); assert.equal(receipt.proposalId, proposal.id);
  assert.equal(receipt.completed, true); assert.equal(receipt.ranMatching, true);
  assert.deepEqual(offered.body.matching.latestAttempt, receipt);
  const replay = await f.find({ key: firstKey });
  assert.equal(replay.body.search.status, 'proposed', 'the current offer still takes precedence over an older empty receipt');
  assert.deepEqual(replay.body.search.attempt, empty.body.search.attempt);
  assert.deepEqual(replay.body.matching.latestAttempt, receipt);
  await f.answer(proposal, 'seeker_a', 'decline');
  const refreshed = await f.call('/me/concerts/c1/matching');
  assert.equal(refreshed.body.matching.proposal, null);
  assert.deepEqual(refreshed.body.matching.latestAttempt, receipt, 'declining does not rewrite the historical offer outcome');
  assert.equal(f.count('match_rounds'), 1);
});

test('migration preserves legacy receipts without inventing a result or rerunning them', async t => {
  const f = await fixture(t); f.enroll(); const key = randomUUID();
  // Model the already-deployed receipt schema, with an empty result that was not recorded.
  f.db.exec(`DROP TABLE matching_search_requests;
    CREATE TABLE matching_search_requests (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      concert_id TEXT NOT NULL REFERENCES concerts(id) ON DELETE CASCADE,
      request_key TEXT NOT NULL CHECK(length(request_key)=36),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY(user_id,concert_id,request_key))`);
  f.db.prepare('INSERT INTO matching_search_requests(user_id,concert_id,request_key) VALUES(?,?,?)').run('seeker_a', 'c1', key);
  migrateMatchingSearches(f.db); migrateMatchingSearches(f.db); f.publish();
  const state = (await f.call('/me/concerts/c1/matching')).body.matching;
  assert.equal(state.latestAttempt.id, key); assert.equal(state.latestAttempt.status, 'unknown');
  assert.equal(state.latestAttempt.completed, null); assert.equal(state.latestAttempt.receivedProposal, null);
  assert.equal(state.latestAttempt.proposalId, null); assert.equal(state.latestAttempt.ranMatching, null);
  assert.ok(Number.isFinite(state.latestAttempt.attemptedAt));
  const replay = await f.find({ key });
  assert.equal(replay.body.search.replayed, true); assert.deepEqual(replay.body.search.attempt, state.latestAttempt);
  assert.equal(f.count('match_rounds'), 0); assert.equal(f.count('match_proposals'), 0);
});

test('receipts survive service recreation and migration repeats, scoped by authenticated account and concert', async t => {
  const f = await fixture(t); f.enroll(); f.enroll('seeker_b'); const key = randomUUID();
  await f.find({ key }); await f.find({ key, user: 'seeker_b' });
  f.repos.seekers.create(makeSeeker('second_concert_request', makeUser('seeker_a'), { concert_id: 'c2' }));
  f.repos.recommendations.savePersonal('seeker_a', 'c2', { about: ['singalong'] }); f.enroll('seeker_a', 'c2');
  const separate = await f.find({ key, concert: 'c2' });
  assert.equal(separate.body.search.replayed, false); assert.equal(f.count('matching_search_requests'), 3);
  migrateMatchingSearches(f.db); migrateMatchingSearches(f.db);
  assert.equal(f.count('matching_search_requests'), 3);
  f.publish();
  const { createMatchingService } = await import('../../server/src/services/matchingService.js');
  const fresh = createMatchingService({ db: f.db, repos: f.repos });
  assert.equal(fresh.findManaged('c1', 'seeker_a', { batchKey: key }).search.replayed, true);
  assert.equal(f.count('match_rounds'), 0);
  f.publish('group_b');
  assert.equal((await f.find({ user: 'seeker_b' })).body.search.status, 'proposed');
  assert.equal(f.count('match_rounds'), 1);
});

for (const first of ['seeker_a', 'host_a']) test(`Find preserves both approvals when ${first} accepts first and never creates another offer while pending`, async t => {
  const f = await fixture(t); f.enroll(); f.publish();
  const offer = (await f.find()).body.matching.proposal;
  assert.equal(offer.seekerApproved, false); assert.equal(offer.hostApproved, false);
  const held = f.repos.parties.findById('group_a').remaining_capacity; assert.equal(held, 0);
  await f.answer(offer, first);
  const pending = await f.find();
  assert.equal(pending.body.matching.state, 'pending'); assert.equal(f.count('match_rounds'), 1);
  assert.equal(pending.body.matching.proposal.id, offer.id);
  assert.equal(pending.body.search.attempt.ranMatching, false, 'checking a pending offer does not start another round');
  assert.equal(pending.body.matching.proposal.seekerApproved, first === 'seeker_a');
  assert.equal(pending.body.matching.proposal.hostApproved, first === 'host_a');
  assert.equal(f.repos.membership.active('seeker_a', 'c1'), undefined);
  await f.answer(offer, first === 'seeker_a' ? 'host_a' : 'seeker_a');
  const confirmedKey = randomUUID(), confirmed = await f.find({ key: confirmedKey });
  assert.equal(confirmed.body.search.status, 'confirmed'); assert.equal(confirmed.body.matching.state, 'accepted');
  assert.equal(confirmed.body.search.attempt.ranMatching, false);
  assert.equal(f.count('match_rounds'), 1); assert.equal(f.count('match_proposals'), 1);
  assert.ok(f.repos.membership.active('seeker_a', 'c1'));
  assert.equal((await f.call('/groups/group_a/leave', { method: 'POST' })).status, 200);
  const replay = await f.find({ key: confirmedKey });
  assert.equal(replay.body.search.replayed, true); assert.equal(replay.body.matching.state, 'idle');
  assert.deepEqual(replay.body.search.attempt, confirmed.body.search.attempt);
  assert.equal(f.count('match_rounds'), 1);
});

test('pending-state receipts and post-decline retries return current state without replacing a declined offer', async t => {
  const f = await fixture(t); f.enroll(); f.publish();
  const firstKey = randomUUID(), initial = await f.find({ key: firstKey }), pendingKey = randomUUID();
  await f.find({ key: pendingKey }); await f.answer(initial.body.matching.proposal, 'seeker_a', 'decline'); f.publish('group_b');
  for (const key of [firstKey, pendingKey]) {
    const retry = await f.find({ key }); assert.equal(retry.body.search.replayed, true);
    assert.equal(retry.body.matching.state, 'queued'); assert.equal(retry.body.matching.proposal, null);
  }
  assert.equal(f.count('match_rounds'), 1);
  const next = await f.find(); assert.equal(next.body.matching.proposal.partyId, 'group_b');
  assert.notEqual(next.body.matching.proposal.id, initial.body.matching.proposal.id);
});

test('replay never reenrolls after leaving the pool or creates historical proposals; new attempts enforce the cutoff', async t => {
  const f = await fixture(t); f.enroll(); const key = randomUUID(); await f.find({ key });
  await f.call('/me/concerts/c1/matching', { method: 'DELETE' });
  assert.equal((await f.find({ key })).body.matching.state, 'idle');
  assert.equal((await f.find()).body.error, 'join_matching_pool_first');
  f.enroll(); f.db.prepare("UPDATE concerts SET event_date='2020-01-01' WHERE id='c1'").run();
  assert.equal((await f.find({ key })).body.search.replayed, true);
  assert.equal((await f.find()).body.error, 'concert_finished');
  assert.equal(f.count('matching_search_requests'), 1); assert.equal(f.count('match_rounds'), 0);
});

test('concurrent retries of one search create one stable batch, one offer and one seat claim', async t => {
  const f = await fixture(t); f.enroll(); f.publish(); const key = randomUUID();
  const results = await Promise.all(Array.from({ length: 6 }, () => f.find({ key })));
  assert.ok(results.every(result => result.status === 200 && result.body.matching.state === 'pending'));
  assert.equal(new Set(results.map(result => result.body.matching.proposal.id)).size, 1);
  assert.equal(f.count('matching_search_requests'), 1); assert.equal(f.count('match_rounds'), 1);
  assert.equal(f.count('match_proposals'), 1); assert.equal(f.count('active_seat_claims'), 1);
  assert.equal(f.repos.parties.findById('group_a').remaining_capacity, 0);
});

test('proposal persistence failure rolls back receipt, round, capacity and statuses so the same key can safely retry', async t => {
  const f = await fixture(t); f.enroll(); f.publish(); const key = randomUUID();
  const original = f.repos.proposals.createFromRound;
  f.repos.proposals.createFromRound = (...args) => { original(...args); throw new Error('injected proposal failure'); };
  assert.deepEqual((await f.find({ key })).body, { error: 'match_failed' });
  for (const table of ['matching_search_requests', 'match_rounds', 'match_results', 'match_trace', 'match_proposals', 'active_seat_claims'])
    assert.equal(f.count(table), 0, table);
  assert.equal(f.repos.groups.seeker('seeker_a', 'c1').status, 'open');
  assert.equal(f.repos.parties.findById('group_a').remaining_capacity, 1);
  assert.equal((await f.call('/me/concerts/c1/matching')).body.matching.latestAttempt, null);
  f.repos.proposals.createFromRound = original;
  assert.equal((await f.find({ key })).body.search.status, 'proposed');
});

test('eligibility blocks, unavailable groups and pending direct claims stay protected', async t => {
  const f = await fixture(t); f.enroll(); f.publish();
  f.repos.users.block('seeker_a', 'host_a');
  assert.equal((await f.find()).body.search.status, 'waiting'); assert.equal(f.count('match_proposals'), 0);
  f.repos.kakiChat.unblock('seeker_a', 'host_a');
  f.db.prepare("UPDATE group_settings SET published=0 WHERE party_id='group_a'").run();
  assert.equal((await f.find()).body.search.status, 'waiting'); assert.equal(f.count('match_proposals'), 0);
  f.publish(); f.repos.recommendations.setJoiningMode('seeker_a', 'c1', 'direct');
  const direct = f.repos.recommendations.requestJoin('seeker_a', 'group_a');
  const failure = await f.find(); assert.equal(failure.status, 409);
  assert.equal(f.repos.recommendations.requests('seeker_a').find(request => request.id === direct.id).status, 'pending');
  assert.equal(f.count('match_rounds'), 0); assert.equal(f.count('active_seat_claims'), 1);
});

test('searches use the shared bounded IP and authenticated-user rate limiter across keys and concerts', async t => {
  const f = await fixture(t); f.enroll();
  for (let index = 0; index < 10; index++) assert.equal((await f.find()).status, 200);
  const limited = await f.find({ concert: 'c2', user: 'seeker_b' });
  assert.equal(limited.status, 429); assert.equal(limited.body.error, 'rate_limit_exceeded');
  assert.equal(limited.headers.get('ratelimit-limit'), '10'); assert.ok(Number(limited.headers.get('retry-after')) > 0);
  for (const path of ['/ME/CONCERTS/c1/MATCHING/FIND', '/me/concerts/c1/matching/FiNd/']) {
    const alternate = await f.call(path, { method: 'POST', key: randomUUID() });
    assert.equal(alternate.status, 429, `the same Express route variant must share its budget: ${path}`);
    assert.equal(alternate.body.error, 'rate_limit_exceeded');
    assert.equal(alternate.headers.get('ratelimit-limit'), '10');
  }
  assert.equal(f.count('matching_search_requests'), 10); assert.equal(f.count('match_rounds'), 0);
});
