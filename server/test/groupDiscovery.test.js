import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { createTestDb } from '../src/db/connection.js';
import { migrateGroups } from '../src/db/groupMigrations.js';
import { createApp } from '../src/app.js';
import { makeUser, makeParty, makeSeeker } from './helpers.js';
import { buildPreferences } from '../src/matching/preferences.js';
import { galeShapley } from '../src/matching/galeShapley.js';
import { findBlockingPairs } from '../src/matching/stability.js';
import { filterGroups } from '../../client/src/groupFilters.js';

let db, repos, matching, server, base, cookies;
beforeEach(async () => {
  db = createTestDb();
  const app = createApp({ db });
  ({ repos, matching } = app);
  // Use the production session service through real login requests below.
  server = app.app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}/api`;
  cookies = {};
  for (const id of ['hostA', 'hostB', 'seeker', 'other']) {
    const response = await call('/auth/register', null, 'POST', {
      display_name: id, email: `${id}@test.example`, password: 'test-password',
      age_band: '21-24', home_region: 'central', gender: 'f', vibe: makeUser(id).vibe,
    });
    assert.equal(response.status, 201);
    cookies[id] = response.cookie;
    cookies[`${id}Id`] = response.body.user.id;
  }
  db.prepare('UPDATE users SET is_operator = 1 WHERE id = ?').run(cookies.hostAId);
  for (const id of ['c1', 'c2']) repos.concerts.create({ id, artist: id, venue: 'Venue', city: 'Singapore', event_date: '2026-12-01' });
  repos.parties.create({ ...makeParty('pA', makeUser(cookies.hostAId)), capacity: 1 });
  repos.parties.create({ ...makeParty('pB', makeUser(cookies.hostBId)), section: 'upper_bowl', capacity: 2 });
  repos.seekers.create(makeSeeker('s1', makeUser(cookies.seekerId)));
});
afterEach(async () => { await new Promise(resolve => server.close(resolve)); db.close(); });
async function call(path, who, method = 'GET', body, extra = {}) {
  const response = await fetch(base + path, { method,
    headers: { 'content-type': 'application/json', ...(cookies?.[who] ? { cookie: cookies[who] } : {}), ...extra },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status,
    body: response.headers.get('content-type')?.includes('json') ? await response.json() : null,
    cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
const pref = (party = 'pB', who = 'seeker', method = 'PUT', body) => call(`/group-preferences/${party}`, who, method, body);
const invite = (who = 'hostA', fromPartyId = 'pA', toPartyId = 'pB') => call('/group-connections', who, 'POST', { fromPartyId, toPartyId });
const round = () => matching.run('c1', { batchKey: randomUUID() });

test('discovery is concert scoped, private, and uses existing feasibility scores', async () => {
  assert.equal((await call('/groups/discover/c1')).status, 401);
  assert.equal((await call('/groups/discover/missing', 'seeker')).status, 404);
  const result = await call('/groups/discover/c1', 'seeker');
  assert.deepEqual(result.body.groups.map(p => p.id), ['pA', 'pB']);
  assert.ok(result.body.groups.every(p => p.compatibility > 0 && p.remainingCapacity > 0));
  assert.ok(!JSON.stringify(result.body).includes('@test.example'));
  assert.equal((await call('/groups/discover/c2', 'seeker')).body.groups.length, 0);
});
test('preferences persist, are idempotent, and never reserve capacity or trust submitted identity', async () => {
  assert.equal((await pref()).status, 200);
  assert.equal((await pref()).status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM seeker_party_preferences').get().n, 1);
  assert.equal(repos.parties.findById('pB').remaining_capacity, 2);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM match_proposals').get().n, 0);
  assert.equal((await call('/me/group-preferences/c1', 'seeker')).body.preferences.length, 1);
  await call('/auth/logout', 'seeker', 'POST');
  const login = await call('/auth/login', null, 'POST', { email: 'seeker@test.example', password: 'test-password' });
  assert.equal(login.status, 200);
  cookies.seeker = login.cookie;
  assert.equal((await call('/me/group-preferences/c1', 'seeker')).body.preferences.length, 1);
  assert.equal((await pref('pA', 'other', 'PUT', { seeker_request_id: 's1', userId: cookies.seekerId })).status, 409);
  await pref('pB', 'other', 'DELETE');
  assert.equal(repos.groups.preferences(cookies.seekerId, 'c1').length, 1);
  assert.equal((await pref('pB', null)).status, 401);
});
test('request enrollment validates fields and reopening only permits withdrawn requests without active proposals', async () => {
  assert.equal((await call('/concerts/c1/requests', 'other', 'POST', {})).status, 400);
  assert.equal((await call('/concerts/c1/requests', 'other', 'POST', { section_pref: 'pit', spend_band_max: 2, arrival_pref: 'doors' })).status, 201);
  assert.equal((await call('/me/seeker-request/c1/reopen', 'other', 'POST')).status, 409);
  repos.seekers.setStatus('s1', 'withdrawn');
  assert.equal((await pref()).status, 409);
  assert.equal((await call('/me/seeker-request/c1/reopen', 'seeker', 'POST')).status, 200);
  round();
  assert.equal((await call('/me/seeker-request/c1/reopen', 'seeker', 'POST')).status, 409);
  repos.seekers.setStatus('s1', 'withdrawn');
  assert.equal((await call('/me/seeker-request/c1/reopen', 'seeker', 'POST')).status, 409);
});
test('blocked, declined, own, cancelled, full and unaffordable groups reject preferences', async () => {
  repos.users.block(cookies.seekerId, cookies.hostBId);
  assert.equal((await pref()).status, 400);
  assert.equal(repos.groups.discover(cookies.seekerId, 'c1').length, 1);
  db.prepare('DELETE FROM blocks').run();
  db.prepare('INSERT INTO match_declines (seeker_request_id, party_id) VALUES (?, ?)').run('s1', 'pB');
  assert.equal((await pref()).body.error, 'previously_declined');
  db.prepare('DELETE FROM match_declines').run();
  repos.parties.setStatus('pB', 'cancelled');
  assert.equal((await pref()).body.error, 'group_unavailable');
  repos.parties.setStatus('pB', 'open');
  db.prepare('UPDATE parties SET spend_band = 4 WHERE id = ?').run('pB');
  assert.equal((await pref()).body.error, 'unaffordable');
  repos.seekers.create(makeSeeker('hostRequest', makeUser(cookies.hostAId)));
  assert.equal((await pref('pA', 'hostA')).body.error, 'self_match');
  await pref('pA'); round();
  repos.seekers.create(makeSeeker('s2', makeUser(cookies.otherId)));
  assert.equal((await pref('pA', 'other')).body.error, 'group_unavailable');
});
test('preferences remain removable after closure and matching preserves independent rankings and stability', async () => {
  const initial = matching.preview('c1');
  assert.equal((await pref()).status, 200);
  const preferred = matching.preview('c1');
  assert.equal(preferred.profile.seekerPrefs.get('s1')[0], 'pB');
  assert.ok(preferred.profile.seekerPrefs.get('s1').includes('pA'));
  assert.deepEqual(preferred.profile.partyPrefs, initial.profile.partyPrefs);
  assert.equal(findBlockingPairs(preferred.profile, preferred.result).stable, true);
  assert.equal(matching.explain('c1', 's1').preferenceList[0].partyId, 'pB');
  const committed = round();
  assert.equal(matching.reverify(committed.roundId).verified, true);
  repos.parties.setStatus('pB', 'cancelled');
  assert.equal((await pref('pB', 'seeker', 'DELETE')).status, 200);
  assert.equal(repos.groups.preferences(cookies.seekerId, 'c1').length, 0);
});
test('declining excludes the pair from preview, execution and explanations even if a preference remains', async () => {
  await pref(); round();
  const proposal = repos.proposals.forUser(cookies.seekerId)[0];
  assert.equal((await call(`/proposals/${proposal.id}/decline`, 'seeker', 'POST')).status, 200);
  assert.ok(!matching.preview('c1').profile.seekerPrefs.get('s1').includes('pB'));
  assert.ok(!matching.explain('c1', 's1').preferenceList.some(p => p.partyId === 'pB'));
  round();
  assert.equal(repos.proposals.forUser(cookies.seekerId).find(p => p.status === 'proposed').partyId, 'pA');
});
test('matching retries preserve history, confirmed proposals and live capacity across later rounds', async () => {
  await pref('pA');
  const key = randomUUID();
  const one = await call('/concerts/c1/match', 'hostA', 'POST', undefined, { 'Idempotency-Key': key });
  assert.equal(one.status, 201);
  const retry = await call('/concerts/c1/match', 'hostA', 'POST', undefined, { 'Idempotency-Key': key });
  assert.equal(retry.status, 200);
  assert.equal(retry.body.roundId, one.body.roundId);
  assert.equal((await call('/concerts/c1/match', 'hostA', 'POST')).status, 400);
  const proposal = repos.proposals.forUser(cookies.seekerId)[0];
  assert.equal((await call(`/proposals/${proposal.id}/accept`, 'other', 'POST')).status, 404);
  assert.equal((await call(`/proposals/${proposal.id}/accept`, 'seeker', 'POST')).status, 200);
  repos.seekers.create(makeSeeker('s2', makeUser(cookies.otherId)));
  round(); round();
  assert.equal(repos.proposals.forUser(cookies.seekerId)[0].status, 'confirmed');
  assert.equal(repos.parties.findById('pA').remaining_capacity, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM match_results WHERE round_id = ?').get(one.body.roundId).n, 1);
  assert.equal(db.prepare(`SELECT COUNT(*) n FROM parties p WHERE (SELECT COUNT(*) FROM match_proposals mp
    WHERE mp.party_id = p.id AND mp.status IN ('proposed','confirmed')) > p.capacity`).get().n, 0);
});
test('expired proposals release capacity, reopen requests and preserve history', async () => {
  await pref('pA'); round();
  db.prepare('UPDATE match_proposals SET expires_at = ?').run(Date.now() - 1000);
  const groups = (await call('/groups/discover/c1', 'seeker')).body.groups;
  assert.equal(groups.find(g => g.id === 'pA').remainingCapacity, 1);
  assert.equal(repos.groups.seeker(cookies.seekerId, 'c1').status, 'open');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM match_proposals WHERE status = 'expired'").get().n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM match_results').get().n, 1);
});
test('invitations require source ownership, same concert, distinct hosts and available unblocked groups', async () => {
  assert.equal((await invite(null)).status, 401);
  assert.equal((await invite('other')).status, 403);
  assert.equal((await invite('hostA', 'pA', 'pA')).status, 400);
  assert.throws(()=>repos.parties.create(makeParty('pA2', makeUser(cookies.hostAId))),/already_in_concert_group/);
  repos.parties.create(makeParty('pC', makeUser(cookies.hostBId), { concert_id: 'c2' }));
  assert.equal((await invite('hostA', 'pA', 'pC')).status, 400);
  repos.users.block(cookies.hostBId, cookies.hostAId);
  assert.equal((await invite()).status, 403);
  assert.equal((await call('/group-connections/candidates/c1?fromPartyId=pA', 'hostA')).body.groups.length, 0);
  db.prepare('DELETE FROM blocks').run();
  repos.parties.setStatus('pB', 'cancelled');
  assert.equal((await invite()).status, 409);
});
test('canonical invitation uniqueness prevents duplicate and reversed invitations', async () => {
  const concurrent = await Promise.all([invite(), invite('hostB', 'pB', 'pA')]);
  assert.deepEqual(concurrent.map(r => r.status).sort(), [201, 409]);
  assert.equal((await invite()).status, 409);
  assert.equal((await invite('hostB', 'pB', 'pA')).status, 409);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM group_connections').get().n, 1);
  assert.throws(() => db.prepare(`INSERT INTO group_connections (id, party_a_id, party_b_id, initiator_party_id)
    VALUES ('bad', 'pB', 'pA', 'pA')`).run(), /CHECK/);
});
test('only receiving hosts respond, accepted connections appear for both and do not change matching or tickets', async () => {
  round();
  const state = () => ['parties', 'match_proposals', 'match_results', 'tickets'].map(t => db.prepare(`SELECT * FROM ${t} ORDER BY id`).all());
  const snapshot = state();
  const id = (await invite()).body.connection.id;
  assert.equal((await call(`/group-connections/${id}/respond`, 'hostA', 'POST', { action: 'accept' })).status, 403);
  assert.equal((await call(`/group-connections/${id}/respond`, 'other', 'POST', { action: 'accept' })).status, 403);
  assert.equal((await call('/me/group-connections', 'other')).body.connections.length, 0);
  assert.equal((await call(`/group-connections/${id}/respond`, 'hostB', 'POST', { action: 'accept' })).status, 200);
  assert.equal((await call(`/group-connections/${id}/respond`, 'hostB', 'POST', { action: 'decline' })).status, 409);
  for (const host of ['hostA', 'hostB']) assert.equal((await call('/me/group-connections', host)).body.connections[0].status, 'accepted');
  assert.deepEqual(state(), snapshot);
});
test('only the sending host may withdraw an invitation, and withdrawing frees the pair', async () => {
  const id = (await invite()).body.connection.id;
  // The receiving host answers; they do not withdraw. Nor does a bystander.
  assert.equal((await call(`/group-connections/${id}`, 'hostB', 'DELETE')).status, 403);
  assert.equal((await call(`/group-connections/${id}`, 'other', 'DELETE')).status, 403);
  assert.equal((await call(`/group-connections/${id}`, null, 'DELETE')).status, 401);
  assert.equal((await call('/me/group-connections', 'hostB')).body.connections.length, 1);

  assert.equal((await call(`/group-connections/${id}`, 'hostA', 'DELETE')).status, 200);
  // Gone for both sides, not merely hidden from the sender.
  for (const host of ['hostA', 'hostB']) {
    assert.equal((await call('/me/group-connections', host)).body.connections.length, 0);
  }
  assert.equal(db.prepare('SELECT COUNT(*) n FROM group_connections').get().n, 0);

  // Withdrawn is not a verdict: the same two groups can be introduced again.
  const second = await invite();
  assert.equal(second.status, 201);
  assert.notEqual(second.body.connection.id, id);

  // Twice is a no-op, and an answered invitation is not withdrawable.
  assert.equal((await call(`/group-connections/${id}`, 'hostA', 'DELETE')).status, 404);
  const live = second.body.connection.id;
  assert.equal((await call(`/group-connections/${live}/respond`, 'hostB', 'POST', { action: 'accept' })).status, 200);
  assert.equal((await call(`/group-connections/${live}`, 'hostA', 'DELETE')).status, 409);
  assert.equal((await call('/me/group-connections', 'hostA')).body.connections[0].status, 'accepted');
});
test('one active hosted group is enforced, history remains, and declined invitations stay final', async () => {
  assert.throws(()=>repos.parties.create(makeParty('pA2', makeUser(cookies.hostAId))),/already_in_concert_group/);
  const first = (await invite()).body.connection.id;
  assert.equal((await call(`/group-connections/${first}/respond`, 'hostB', 'POST', { action: 'decline' })).status, 200);
  assert.equal((await invite()).status, 409);
  repos.parties.setStatus('pA','cancelled');
  repos.parties.create(makeParty('pA2', makeUser(cookies.hostAId)));
  assert.equal((await call('/me/hosted-groups', 'hostA')).body.groups.length, 2);
  const candidates = await call('/group-connections/candidates/c1?fromPartyId=pA2', 'hostA');
  assert.equal(candidates.body.groups[0].invitation, null);
  assert.equal((await invite('hostA', 'pA2', 'pB')).status, 201);
  assert.equal((await call('/group-connections/candidates/c1?fromPartyId=pA', 'other')).status, 403);
});
test('acceptance rechecks blocks and cancellation after invitation creation', async () => {
  const id = (await invite()).body.connection.id;
  repos.users.block(cookies.hostAId, cookies.hostBId);
  assert.equal((await call(`/group-connections/${id}/respond`, 'hostB', 'POST', { action: 'accept' })).status, 403);
  db.prepare('DELETE FROM blocks').run();
  repos.parties.setStatus('pA', 'cancelled');
  assert.equal((await call(`/group-connections/${id}/respond`, 'hostB', 'POST', { action: 'accept' })).status, 409);
  assert.equal((await call(`/group-connections/${id}/respond`, 'hostB', 'POST', { action: 'decline' })).status, 200);
});
test('client filters cover text, seating, capacity, spending, arrival, plans, vibe, saved state and ranking', () => {
  const groups = repos.groups.discover(cookies.seekerId, 'c1');
  const a = { ...groups[0], preferred: true, compatibility: 0.7 };
  const b = { ...groups[1], compatibility: 0.9 };
  for (const filters of [{ query: a.hostName }, { section: a.section }, { preferredOnly: true }]) assert.equal(filterGroups([a, b], filters)[0].id, a.id);
  assert.equal(filterGroups([a, b], { minCapacity: 2 })[0].id, b.id);
  assert.equal(filterGroups([a, b], { spendBand: 4 }).length, 0);
  assert.equal(filterGroups([a, b], { arrival: 'doors' }).length, 0);
  assert.equal(filterGroups([a, b], { activity: 'pre_meetup', vibe: 'dancing' }).length, 2);
  assert.equal(filterGroups([a, b])[0].id, b.id);
  assert.equal(filterGroups([a, b], { query: 'nonexistent' }).length, 0);
});
test('saved preference priority never overrides feasibility or changes group ranking', () => {
  const s = makeSeeker('s', makeUser('u'));
  const a = makeParty('a', makeUser('ha'));
  const b = makeParty('b', makeUser('hb'), { section: 'upper_bowl' });
  const excluded = makeParty('x', makeUser('hx'), { spend_band: 4 });
  const profile = buildPreferences([s], [a, b, excluded], { preferredPairs: new Set(['s|b', 's|x']) });
  assert.deepEqual(profile.seekerPrefs.get('s'), ['b', 'a']);
  assert.equal(findBlockingPairs(profile, galeShapley(profile)).stable, true);
});
test('fresh and legacy group migrations repeat safely and preserve referencing data and foreign keys', () => {
  migrateGroups(db); migrateGroups(db);
  assert.deepEqual(db.pragma('foreign_key_check'), []);
  const legacy = new Database(':memory:');
  try {
    const schema = readFileSync(new URL('../src/db/schema.sql', import.meta.url), 'utf8')
      .replace('CHECK (min_size IS NULL OR min_size <= capacity)', 'UNIQUE (host_user_id, concert_id), CHECK (min_size IS NULL OR min_size <= capacity)');
    legacy.exec(schema);
    legacy.pragma('foreign_keys = ON');
    legacy.exec("INSERT INTO users (id, display_name, age_band, home_region, gender, vibe_json) VALUES ('u','User','21-24','central','f','{}')");
    legacy.exec("INSERT INTO concerts (id, artist, venue, city, event_date) VALUES ('c','Act','Venue','Singapore','2026-12-01')");
    legacy.exec("INSERT INTO parties (id, host_user_id, concert_id, capacity, section, spend_band, arrival_plan) VALUES ('p','u','c',1,'pit',1,'mid')");
    legacy.exec(`INSERT INTO seeker_requests (id, user_id, concert_id, section_pref, spend_band_max, arrival_pref)
      VALUES ('s','u','c','pit',2,'mid');
      INSERT INTO match_rounds (id, concert_id, is_stable, seeker_count, party_count, total_capacity, feasible_pairs, matched_count, metrics_json, timings_json)
      VALUES ('r','c',1,1,1,1,1,1,'{}','{}');
      INSERT INTO match_results (id, round_id, seeker_request_id, party_id, outcome) VALUES ('mr','r','s','p','matched');
      INSERT INTO match_proposals (id, round_id, match_result_id, seeker_request_id, party_id, status, expires_at)
      VALUES ('mp','r','mr','s','p','confirmed',9999999999999);`);
    migrateGroups(legacy); migrateGroups(legacy);
    assert.equal(legacy.prepare('SELECT id FROM parties').get().id, 'p');
    assert.equal(legacy.prepare('SELECT party_id FROM match_results').get().party_id, 'p');
    assert.equal(legacy.prepare('SELECT status FROM match_proposals').get().status, 'confirmed');
    legacy.exec("INSERT INTO parties (id, host_user_id, concert_id, capacity, section, spend_band, arrival_plan) VALUES ('p2','u','c',1,'pit',1,'mid')");
    assert.equal(legacy.pragma('foreign_keys', { simple: true }), 1);
    assert.deepEqual(legacy.pragma('foreign_key_check'), []);
    legacy.exec("INSERT INTO seeker_party_preferences (seeker_request_id, party_id) VALUES ('s','p')");
    assert.throws(() => legacy.exec("INSERT INTO seeker_party_preferences (seeker_request_id, party_id) VALUES ('s','p')"), /UNIQUE/);
    migrateGroups(legacy);
    assert.equal(legacy.prepare('SELECT COUNT(*) n FROM seeker_party_preferences').get().n, 1);
    assert.throws(() => legacy.exec("INSERT INTO seeker_party_preferences (seeker_request_id, party_id) VALUES ('missing','p')"), /FOREIGN KEY/);
    assert.ok(legacy.prepare("SELECT name FROM sqlite_master WHERE name = 'idx_group_preferences_party'").get());
  } finally { legacy.close(); }
});
test('migration failure rolls back table reconstruction and restores foreign key enforcement', () => {
  const broken = new Database(':memory:');
  try {
    broken.pragma('foreign_keys = OFF');
    broken.exec(`CREATE TABLE parties (id TEXT PRIMARY KEY, host_user_id TEXT, concert_id TEXT, UNIQUE(host_user_id, concert_id));
      CREATE TABLE child (party_id TEXT REFERENCES parties(id)); INSERT INTO child VALUES ('missing');`);
    broken.pragma('foreign_keys = ON');
    assert.throws(() => migrateGroups(broken), /foreign_key_failure/);
    assert.match(broken.prepare("SELECT sql FROM sqlite_master WHERE name = 'parties'").get().sql, /UNIQUE/);
    assert.equal(broken.pragma('foreign_keys', { simple: true }), 1);
    assert.equal(broken.prepare("SELECT name FROM sqlite_master WHERE name = 'parties_group_upgrade'").get(), undefined);
  } finally { broken.close(); }
});

test('concurrent matching requests cannot overbook across separate logical rounds', async () => {
  for (let i = 0; i < 5; i++) {
    const user = repos.users.create(makeUser(`extra${i}`));
    repos.seekers.create(makeSeeker(`extraRequest${i}`, user));
  }
  const runs = await Promise.all(Array.from({ length: 5 }, () => call('/concerts/c1/match', 'hostA', 'POST', undefined, { 'Idempotency-Key': randomUUID() })));
  assert.ok(runs.every(r => [201, 409].includes(r.status)));
  assert.equal(db.prepare("SELECT COUNT(*) n FROM match_proposals WHERE status = 'proposed'").get().n, 3);
  assert.equal(repos.parties.findById('pA').remaining_capacity, 0);
  assert.equal(repos.parties.findById('pB').remaining_capacity, 0);
});

test('proposal persistence failure rolls back round history, reservations and listing status together', () => {
  const create = repos.proposals.createFromRound;
  repos.proposals.createFromRound = id => { create(id); throw new Error('simulated_write_failure'); };
  assert.throws(round, /simulated_write_failure/);
  for (const table of ['match_rounds', 'match_results', 'match_proposals']) assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n, 0);
  assert.equal(repos.groups.seeker(cookies.seekerId, 'c1').status, 'open');
  assert.equal(repos.parties.findById('pA').remaining_capacity, 1);
});

test('time-based capacity queries release elapsed proposals before the expiration sweep', () => {
  repos.groups.addPreference(cookies.seekerId, 'pA'); round();
  db.prepare('UPDATE match_proposals SET expires_at = ?').run(Date.now() - 1);
  assert.equal(repos.parties.findById('pA').remaining_capacity, 1);
  assert.equal(repos.concerts.listWithCounts().find(c => c.id === 'c1').open_slots, 2);
  // Full parties remain marked matched until the sweep reopens them.
  repos.proposals.expire();
  assert.equal(repos.parties.openForConcert('c1').find(p => p.id === 'pA').remaining_capacity, 1);
});
