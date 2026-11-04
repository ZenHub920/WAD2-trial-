import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { concertGroupCreationEligibility } from '../../shared/concertEligibility.mjs';
import { createTestDb } from '../../server/src/db/connection.js';
import { createRepositories } from '../../server/src/db/repositories.js';
import { createApp } from '../../server/src/app.js';
import { makeParty, makeUser } from './helpers.js';

const day = { event_date: '2030-01-01' };
const dateOnlyCutoff = Date.parse('2030-01-01T16:00:00Z');
for (const [name, concert, now, expected] of [
  ['past date', { event_date: '2020-10-01' }, '2030-01-01T04:00:00Z', { eligible: false, reason: 'concert_day_ended' }],
  ['Singapore day while UTC is still yesterday', day, '2029-12-31T16:01:00Z', { eligible: true, cutoffAt: dateOnlyCutoff }],
  ['date-only concert until the final millisecond of its local day', day, '2030-01-01T15:59:59.999Z', { eligible: true, cutoffAt: dateOnlyCutoff }],
  ['date-only concert at the next local midnight', day, '2030-01-01T16:00:00Z', { eligible: false, reason: 'concert_day_ended' }],
  ['future concert', { event_date: '2030-02-01' }, '2030-01-01T04:00:00Z', { eligible: true }],
  ['known performance before its start', { ...day, event_time: '20:00:00', event_timezone: 'Asia/Singapore' }, '2030-01-01T11:59:59.999Z', { eligible: true, hasVerifiedStart: true, cutoffAt: Date.parse('2030-01-01T12:00:00Z') }],
  ['known performance exactly at its start', { ...day, event_time: '20:00', event_timezone: 'Asia/Singapore' }, '2030-01-01T12:00:00Z', { eligible: false, reason: 'concert_started', hasVerifiedStart: true }],
  ['doors time does not become a performance cutoff', { ...day, doors_time: '18:00' }, '2030-01-01T15:00:00Z', { eligible: true, hasVerifiedStart: false, cutoffAt: dateOnlyCutoff }],
  ['invalid performance time falls back to date-only', { ...day, event_time: '25:00', event_timezone: 'Asia/Singapore' }, '2030-01-01T15:00:00Z', { eligible: true, hasVerifiedStart: false }],
  ['invalid timezone cannot claim a verified start', { ...day, event_time: '20:00', event_timezone: 'Invalid/Zone' }, '2030-01-01T15:00:00Z', { eligible: true, hasVerifiedStart: false, cutoffAt: dateOnlyCutoff }],
  ['valid overseas timezone is authoritative', { ...day, event_time: '20:00', event_timezone: 'America/New_York' }, '2030-01-02T00:59:59Z', { eligible: true, hasVerifiedStart: true, cutoffAt: Date.parse('2030-01-02T01:00:00Z') }],
  ['overseas concert at its actual start', { ...day, event_time: '20:00', event_timezone: 'America/New_York' }, '2030-01-02T01:00:00Z', { eligible: false, reason: 'concert_started' }],
  ['invalid calendar date fails closed', { event_date: '2030-02-30' }, '2030-01-01T04:00:00Z', { eligible: false, reason: 'concert_date_unavailable', cutoffAt: null }],
  ['missing date fails closed', {}, '2030-01-01T04:00:00Z', { eligible: false, reason: 'concert_date_unavailable', cutoffAt: null }],
]) test(`group creation eligibility: ${name}`, () => {
  const eligibility = concertGroupCreationEligibility(concert, Date.parse(now));
  for (const [key, value] of Object.entries(expected)) assert.equal(eligibility[key], value, key);
  if (eligibility.eligible) assert.equal(eligibility.reason, null);
});

function fixture(t) {
  const db = createTestDb(), repos = createRepositories(db);
  t.after(() => db.close());
  for (const id of ['host', 'second', 'third']) repos.users.create(makeUser(id));
  const concert = (id, fields) => repos.concerts.create({ id, artist: 'Test act', city: 'Singapore', venue: 'Hall', ...fields });
  return { db, repos, concert };
}

test('repository creation reads authoritative concert rows and rejects invalid or historical scopes without writes', t => {
  const { db, repos, concert } = fixture(t);
  t.mock.method(Date, 'now', () => Date.parse('2030-01-01T04:00:00Z'));
  concert('past', { event_date: '2029-10-01' });
  concert('invalid', { event_date: '2030-02-30' });
  for (const [id, code, status] of [['past', 'concert_no_longer_upcoming', 409], ['invalid', 'concert_date_unavailable', 400], ['missing', 'concert_not_found', 404]]) {
    assert.throws(() => repos.parties.create(makeParty(`group-${id}`, makeUser('host'), { concert_id: id, event_date: '2099-01-01' })), { message: code, status });
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM parties').get().n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM group_memberships').get().n, 0);
  }
});

test('date-only same-day repository creation stays open until Singapore midnight', t => {
  const { repos, concert } = fixture(t);
  let now = Date.parse('2029-12-31T16:01:00Z');
  t.mock.method(Date, 'now', () => now);
  concert('c1', day);
  assert.equal(repos.parties.create(makeParty('early', makeUser('host'))).id, 'early');
  now = dateOnlyCutoff - 1;
  assert.equal(repos.parties.create(makeParty('late', makeUser('second'))).id, 'late');
  now++;
  assert.throws(() => repos.parties.create(makeParty('too-late', makeUser('third'))), { message: 'concert_no_longer_upcoming', status: 409 });
});

test('new creation closes at a verified start while authorized historical groups remain readable', t => {
  const { db, repos, concert } = fixture(t);
  let now = Date.parse('2030-01-01T11:59:59Z');
  t.mock.method(Date, 'now', () => now);
  concert('c1', { ...day, event_time: '20:00', event_timezone: 'Asia/Singapore' });
  repos.parties.create(makeParty('existing', makeUser('host')));
  repos.membership.configure('host', 'existing', {});
  now = Date.parse('2030-01-02T12:00:00Z');
  assert.throws(() => repos.parties.create(makeParty('new', makeUser('second'))), /concert_no_longer_upcoming/);
  assert.equal(repos.parties.findById('existing').id, 'existing');
  assert.equal(repos.membership.detail('host', 'existing').partyId, 'existing');
  assert.equal(repos.groups.hosted('host')[0].id, 'existing');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM parties').get().n, 1);
});

test('authenticated HTTP creation cannot bypass concert eligibility with forged dates, and returns structured errors', async t => {
  const db = createTestDb(), application = createApp({ db, env: { NODE_ENV: 'test' } }), { repos } = application;
  t.mock.method(Date, 'now', () => Date.parse('2030-01-01T04:00:00Z'));
  repos.users.create(makeUser('host'));
  const token = '1'.repeat(64);
  repos.sessions.create(createHash('sha256').update(token).digest('hex'), 'host', Date.now() + 3600000);
  for (const [id, event_date, event_time] of [['past', '2029-10-01', null], ['today', '2030-01-01', null], ['started', '2030-01-01', '10:00'], ['future', '2030-02-01', null], ['invalid', '2030-02-30', null]])
    repos.concerts.create({ id, artist: 'Test act', venue: 'Hall', city: 'Singapore', event_date, event_time });
  const server = application.app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); db.close(); });
  async function call(id, authenticated = true) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/concerts/${id}/parties`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'X-Requested-With': 'Encore', ...(authenticated ? { cookie: `encore_session=${token}` } : {}) },
      body: JSON.stringify({ capacity: 2, section: 'ga_standing', spend_band: 2, arrival_plan: 'mid', event_date: '2099-01-01', event_time: '23:00' }),
    });
    return { status: response.status, body: await response.json() };
  }
  assert.equal((await call('today', false)).status, 401);
  for (const [id, status, error] of [['past', 409, 'concert_no_longer_upcoming'], ['started', 409, 'concert_no_longer_upcoming'], ['invalid', 400, 'concert_date_unavailable'], ['missing', 404, 'concert_not_found']]) {
    const response = await call(id);
    assert.equal(response.status, status); assert.equal(response.body.error, error);
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM parties').get().n, 0);
  assert.equal((await call('today')).status, 201);
  assert.equal((await call('future')).status, 201);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM parties').get().n, 2);
});
