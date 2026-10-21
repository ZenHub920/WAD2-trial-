import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { createTestDb } from '../src/db/connection.js';
import { migrateGroups } from '../src/db/groupMigrations.js';
import { migrateCommunity } from '../src/db/communityMigrations.js';
import { validateAnswers, aggregateAnswers, compareProfiles } from '../src/services/discoveryPreferences.js';
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
function publishGroup(id) {
  const p = repos.parties.findById(id);
  if (!p || p.status === 'cancelled' || repos.membership.settings(id)) return;
  repos.membership.configure(p.host_user_id, id, { expectedFriends: 0 });
  repos.membership.saveAnswers(p.host_user_id, id, { about: ['supper'] });
  repos.membership.publish(p.host_user_id, id, { connectOpen: true });
}
const invite = (who = 'hostA', fromPartyId = 'pA', toPartyId = 'pB') => {
  publishGroup(fromPartyId);
  publishGroup(toPartyId);
  return call('/group-connections', who, 'POST', { fromPartyId, toPartyId });
};
const round = () => matching.run('c1', { batchKey: randomUUID() });
const directJoin = (user, party) => {
  repos.recommendations.setJoiningMode(user, repos.parties.findById(party).concert_id, 'direct');
  return repos.recommendations.requestJoin(user, party);
};

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
  assert.equal((await call(`/proposals/${proposal.id}/accept`, 'hostA', 'POST')).status, 200);
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
  publishGroup('pA2');
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
  assert.equal(repos.concerts.listWithCounts().find(c => c.id === 'c1').open_slots, 3);
  // Updating the proposal deadline also synchronizes its claim and availability.
  repos.proposals.expire();
  assert.equal(repos.parties.openForConcert('c1').find(p => p.id === 'pA').remaining_capacity, 1);
});

test('new hosts have authoritative membership and reconfiguration preserves original joining evidence', () => {
  assert.equal(repos.membership.active(cookies.hostAId, 'c1').party_id, 'pA');
  assert.equal(repos.membership.activeGroups(cookies.hostAId)[0].id, 'pA');
  db.prepare("UPDATE group_memberships SET joined_at='2020-01-01 00:00:00' WHERE party_id='pA'").run();
  repos.membership.configure(cookies.hostAId, 'pA', { expectedFriends: 1 });
  repos.membership.configure(cookies.hostAId, 'pA', { expectedFriends: 1 });
  assert.equal(repos.membership.active(cookies.hostAId, 'c1').joined_at, '2020-01-01 00:00:00');
  const first = repos.membership.invite(cookies.hostAId, 'pA');
  repos.membership.acceptInvite(cookies.otherId, first.token);
  repos.membership.leave(cookies.otherId, 'pA');
  db.prepare("UPDATE group_memberships SET joined_at='2020-01-01 00:00:00' WHERE user_id=?").run(cookies.otherId);
  repos.membership.acceptInvite(cookies.otherId, repos.membership.invite(cookies.hostAId, 'pA').token);
  assert.notEqual(repos.membership.active(cookies.otherId, 'c1').joined_at, '2020-01-01 00:00:00');
  repos.parties.setStatus('pA', 'cancelled');
  assert.equal(repos.membership.active(cookies.hostAId, 'c1'), undefined);
  repos.parties.create(makeParty('replacement', makeUser(cookies.hostAId)));
  migrateCommunity(db);
  assert.equal(repos.membership.active(cookies.hostAId, 'c1').party_id, 'replacement');
});

test('friend links recheck blocks against every active member without consuming rejected tokens', () => {
  repos.membership.configure(cookies.hostAId, 'pA', { expectedFriends: 2 });
  repos.membership.acceptInvite(cookies.otherId, repos.membership.invite(cookies.hostAId, 'pA').token);
  const token = repos.membership.invite(cookies.hostAId, 'pA').token;
  for (const [a, b] of [[cookies.otherId, cookies.seekerId], [cookies.seekerId, cookies.otherId]]) {
    repos.users.block(a, b);
    assert.throws(() => repos.membership.acceptInvite(cookies.seekerId, token), /blocked_pair/);
    assert.equal(repos.membership.active(cookies.seekerId, 'c1'), undefined);
    db.prepare('DELETE FROM blocks').run();
  }
  assert.equal(repos.membership.acceptInvite(cookies.seekerId, token).partyId, 'pA');
  assert.equal(repos.parties.findById('pA').remaining_capacity, 1);
});

test('expanding full stranger capacity reopens discovery and cancellation releases direct seekers without rewriting history', () => {
  publishGroup('pA');
  repos.recommendations.savePersonal(cookies.seekerId, 'c1', { about: ['supper'] });
  const join = directJoin(cookies.seekerId, 'pA');
  repos.recommendations.respond(cookies.hostAId, join.id, 'accept');
  assert.equal(repos.parties.findById('pA').status, 'matched');
  repos.membership.configure(cookies.hostAId, 'pA', { strangerPlaces: 2 });
  repos.membership.publish(cookies.hostAId, 'pA', { connectOpen: true });
  assert.equal(repos.parties.findById('pA').status, 'open');
  assert.equal(repos.recommendations.individual(cookies.otherId, 'c1').some(p => p.id === 'pA'), true);
  repos.membership.configure(cookies.hostAId, 'pA', { expectedFriends: 1 });
  repos.membership.acceptInvite(cookies.otherId, repos.membership.invite(cookies.hostAId, 'pA').token);
  repos.membership.leave(cookies.otherId, 'pA');
  db.prepare("UPDATE group_memberships SET left_at='2020-01-02 00:00:00' WHERE user_id=?").run(cookies.otherId);
  repos.membership.cancel(cookies.hostAId, 'pA');
  assert.equal(repos.groups.seeker(cookies.seekerId, 'c1').status, 'open');
  assert.equal(db.prepare('SELECT left_at FROM group_memberships WHERE user_id=?').get(cookies.otherId).left_at, '2020-01-02 00:00:00');
  assert.equal(db.prepare('SELECT status FROM group_join_requests WHERE id=?').get(join.id).status, 'cancelled');
  assert.equal(repos.membership.active(cookies.seekerId, 'c1'), undefined);
});

test('attendance membership and closed seeker requests exclude ineligible individual recommendations', () => {
  assert.deepEqual(repos.recommendations.individual(cookies.hostAId, 'c1'), []);
  repos.membership.configure(cookies.hostAId, 'pA', { expectedFriends: 1 });
  repos.membership.acceptInvite(cookies.seekerId, repos.membership.invite(cookies.hostAId, 'pA').token);
  assert.deepEqual(repos.recommendations.individual(cookies.seekerId, 'c1'), []);
  repos.membership.leave(cookies.seekerId, 'pA');
  assert.deepEqual(repos.recommendations.individual(cookies.seekerId, 'c1'), []);
  repos.groups.reopen(cookies.seekerId, 'c1');
  assert.equal(repos.recommendations.individual(cookies.seekerId, 'c1').some(p => p.id === 'pB'), true);
});

test('connections require both groups to publish and opt in, including acceptance after opt out', async () => {
  const post = () => call('/group-connections', 'hostA', 'POST', { fromPartyId: 'pA', toPartyId: 'pB' });
  assert.equal((await post()).body.error, 'group_not_open_to_connections');
  assert.equal((await call('/group-connections/candidates/c1?fromPartyId=pA', 'hostA')).body.total, 0);
  publishGroup('pA');
  assert.equal((await post()).status, 409);
  repos.membership.configure(cookies.hostBId, 'pB', {});
  repos.membership.saveAnswers(cookies.hostBId, 'pB', { about: ['supper'] });
  repos.membership.publish(cookies.hostBId, 'pB');
  assert.equal((await post()).status, 409);
  assert.equal(repos.recommendations.groups(cookies.hostAId, 'c1', 'pA').length, 0);
  repos.membership.publish(cookies.hostBId, 'pB', { connectOpen: true });
  const connection = (await post()).body.connection;
  repos.membership.publish(cookies.hostAId, 'pA', { connectOpen: false });
  assert.equal((await call(`/group-connections/${connection.id}/respond`, 'hostB', 'POST', { action: 'accept' })).body.error, 'group_not_open_to_connections');
  assert.equal(repos.groups.connections(cookies.hostAId)[0].status, 'pending');
});

test('supported recommendation reasons retain strongest evidence for repeated concepts', () => {
  const a = aggregateAnswers([validateAnswers({ about: ['supper'], wants: ['supper'] })]);
  const b = aggregateAnswers([
    validateAnswers({ about: ['supper'], wants: ['supper'] }),
    validateAnswers({ wants: ['supper'] }),
  ]);
  const result = compareProfiles(a, b);
  assert.equal(result.reasons.find(r => r.concept === 'post_supper').support, 100);
  assert.equal(result.reasons.length, 1);
});

test('seeker preference changes preserve submitted answers and require renewed choice even after restoring answers', () => {
  publishGroup('pA');
  const original = { about: ['supper'], wants: ['quiet'] };
  const submitted = repos.recommendations.savePersonal(cookies.seekerId, 'c1', original);
  const join = directJoin(cookies.seekerId, 'pA');
  repos.recommendations.savePersonal(cookies.seekerId, 'c1', original);
  assert.equal(db.prepare('SELECT group_version FROM group_join_requests WHERE id=?').get(join.id).group_version, repos.membership.settings('pA').version);
  repos.recommendations.savePersonal(cookies.seekerId, 'c1', { about: ['dancing'] });
  assert.deepEqual(repos.recommendations.requests(cookies.hostAId)[0].preferences, submitted);
  assert.throws(() => repos.recommendations.respond(cookies.hostAId, join.id, 'accept'), /preferences_changed_withdraw_and_resubmit/);
  repos.recommendations.savePersonal(cookies.seekerId, 'c1', original);
  assert.throws(() => repos.recommendations.respond(cookies.hostAId, join.id, 'accept'), /preferences_changed_withdraw_and_resubmit/);
  repos.recommendations.respond(cookies.seekerId, join.id, 'withdraw');
  const renewed = directJoin(cookies.seekerId, 'pA');
  assert.notEqual(renewed.id, join.id);
  assert.equal(repos.recommendations.respond(cookies.hostAId, renewed.id, 'accept').status, 'accepted');
});

test('repeated community migrations preserve unknown historical consent and require resubmission', () => {
  publishGroup('pA');
  repos.recommendations.savePersonal(cookies.seekerId, 'c1', { about: ['supper'] });
  const join = directJoin(cookies.seekerId, 'pA');
  db.prepare('UPDATE group_join_requests SET preferences_json=NULL WHERE id=?').run(join.id);
  migrateCommunity(db);
  migrateCommunity(db);
  assert.equal(db.prepare('SELECT preferences_json FROM group_join_requests WHERE id=?').get(join.id).preferences_json, null);
  assert.equal(repos.recommendations.requests(cookies.hostAId)[0].preferences, null);
  assert.throws(() => repos.recommendations.respond(cookies.hostAId, join.id, 'accept'), /preferences_changed_withdraw_and_resubmit/);
  repos.recommendations.respond(cookies.seekerId, join.id, 'withdraw');
  const renewed = directJoin(cookies.seekerId, 'pA');
  assert.notEqual(renewed.id, join.id);
  assert.equal(repos.recommendations.respond(cookies.hostAId, renewed.id, 'accept').status, 'accepted');
});

test('full managed groups do not block independent legacy rounds', () => {
  repos.membership.configure(cookies.hostBId, 'pB', { strangerPlaces: 1 });
  repos.membership.saveAnswers(cookies.hostBId, 'pB', {});
  repos.membership.publish(cookies.hostBId, 'pB');
  repos.seekers.create(makeSeeker('otherRequest', makeUser(cookies.otherId)));
  repos.recommendations.savePersonal(cookies.otherId, 'c1', {});
  const direct = directJoin(cookies.otherId, 'pB');
  repos.recommendations.respond(cookies.hostBId, direct.id, 'accept');
  assert.equal(repos.parties.findById('pB').remaining_capacity, 0);
  const result = round();
  assert.equal(result.empty, false);
  assert.deepEqual(repos.proposals.forUser(cookies.seekerId).map(p => p.partyId), ['pA']);
});

test('proposal confirmation rechecks blocks and supports published managed groups', () => {
  repos.groups.addPreference(cookies.seekerId, 'pA');
  round();
  const proposal = repos.proposals.forUser(cookies.seekerId)[0];
  for (const [from, to] of [[cookies.seekerId, cookies.hostAId], [cookies.hostAId, cookies.seekerId]]) {
    db.prepare('INSERT INTO blocks(blocker_user_id,blocked_user_id) VALUES(?,?)').run(from, to);
    assert.equal(repos.proposals.respond(cookies.seekerId, proposal.id, 'accept').error, 'group_unavailable');
    db.prepare('DELETE FROM blocks').run();
  }
  repos.membership.configure(cookies.hostAId, 'pA', { strangerPlaces: 1 });
  repos.membership.saveAnswers(cookies.hostAId, 'pA', {});
  repos.membership.publish(cookies.hostAId, 'pA');
  assert.equal(repos.proposals.respond(cookies.hostAId, proposal.id, 'accept').status, 'proposed');
  assert.equal(repos.proposals.respond(cookies.seekerId, proposal.id, 'accept').status, 'confirmed');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM group_memberships WHERE source='proposal'").get().n, 1);
  assert.equal(repos.proposals.forUser(cookies.seekerId)[0].status, 'confirmed');
});

test('database rejects capacity reductions below live claims and preserves valid proposals', () => {
  repos.parties.setStatus('pA', 'cancelled');
  repos.seekers.create(makeSeeker('s2', makeUser(cookies.otherId)));
  round();
  assert.throws(() => db.prepare("UPDATE parties SET capacity=1 WHERE id='pB'").run(), /seat_capacity_exceeded/);
  assert.equal(repos.parties.findById('pB').capacity, 2);
  const proposal = repos.proposals.forUser(cookies.seekerId)[0];
  assert.equal(repos.proposals.respond(cookies.hostBId, proposal.id, 'accept').status, 'proposed');
  assert.equal(repos.proposals.respond(cookies.seekerId, proposal.id, 'accept').status, 'confirmed');
  assert.equal(repos.parties.findById('pB').remaining_capacity, 0);
});

test('a cancelled target cannot receive a confirmed proposal', () => {
  repos.groups.addPreference(cookies.seekerId, 'pA');
  round();
  const proposal = repos.proposals.forUser(cookies.seekerId)[0];
  repos.parties.setStatus('pA', 'cancelled');
  assert.equal(repos.proposals.respond(cookies.seekerId, proposal.id, 'accept').status, 409);
  assert.notEqual(repos.proposals.forUser(cookies.seekerId)[0].status, 'confirmed');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM group_memberships WHERE source='proposal'").get().n, 0);
});

test('proposal expiry refreshes managed groups against stranger places rather than legacy capacity', () => {
  repos.groups.addPreference(cookies.seekerId, 'pB');
  round();
  repos.membership.configure(cookies.hostBId, 'pB', { strangerPlaces: 2 });
  repos.membership.saveAnswers(cookies.hostBId, 'pB', {});
  repos.membership.publish(cookies.hostBId, 'pB');
  repos.seekers.create(makeSeeker('otherRequest', makeUser(cookies.otherId)));
  repos.recommendations.savePersonal(cookies.otherId, 'c1', {});
  const direct = directJoin(cookies.otherId, 'pB');
  repos.recommendations.respond(cookies.hostBId, direct.id, 'accept');
  db.prepare('UPDATE match_proposals SET expires_at=?').run(Date.now() - 1000);
  repos.membership.configure(cookies.hostBId, 'pB', { strangerPlaces: 1 });
  repos.proposals.expire();
  assert.equal(repos.parties.findById('pB').remaining_capacity, 0);
  assert.equal(repos.parties.findById('pB').status, 'matched');
});

test('unexpected membership lookup failures abort matching rather than hiding seekers', () => {
  repos.membership.ensureFree = () => { throw new Error('database_read_failed'); };
  assert.throws(round, /database_read_failed/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM match_rounds').get().n, 0);
});
