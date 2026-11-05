import { test } from 'node:test';
import assert from 'node:assert/strict';
import { express } from '../support/server-dependencies.mjs';
import { createTestDb } from '../../server/src/db/connection.js';
import { createRepositories } from '../../server/src/db/repositories.js';
import { registerCommunityRoutes } from '../../server/src/routes/community.js';
import { makeUser, makeParty } from './helpers.js';
import { meetupDatePolicy, parseMeetupTimestamp, parseSingaporeInput, singaporeInputValue } from '../../shared/meetupDates.mjs';

const startsAt = '2030-01-01T10:00:00+08:00', endsAt = '2030-01-01T12:00:00+08:00';
const input = { partyId: 'p1', title: 'Meet before the concert', startsAt, endsAt };
const location = { label: 'City Hall MRT', latitude: 1.293, longitude: 103.852, sheltered: true };
const windows = [{ startsAt, endsAt, latitude: 1.31, longitude: 103.83, label: 'private-home', travelMode: 'drive' }];

function fixture(t, overrides = {}) {
  const db = createTestDb(), repos = createRepositories(db);
  t.after(() => db.close());
  for (const user of ['host', 'host2', 'friend', 'outsider', 'kakiA', 'kakiB']) repos.users.create(makeUser(user));
  repos.concerts.create({ id: 'c1', artist: 'Act', city: 'Singapore', venue: 'Hall',
    event_date: '2030-01-01', event_time: '20:00:00', event_timezone: 'Asia/Singapore', ...overrides });
  repos.parties.create(makeParty('p1', makeUser('host'), { capacity: 2 }));
  repos.parties.create(makeParty('p2', makeUser('host2'), { capacity: 2 }));
  repos.membership.configure('host', 'p1', { expectedFriends: 1 });
  repos.membership.acceptInvite('friend', repos.membership.invite('host', 'p1').token);
  const create = (scope = { partyId: 'p1' }, user = 'host') => repos.meetups.create(user, { ...input, partyId: undefined, ...scope }).id;
  const version = id => repos.meetups.access('host', id).version;
  const prepare = (id = create()) => {
    repos.meetups.availability('friend', id, windows);
    const placeId = repos.meetups.place('friend', id, location).id;
    repos.meetups.vote('friend', id, placeId);
    return { id, placeId };
  };
  return { db, repos, create, version, prepare };
}

const invalidDates = [
  ['after verified concert start', '2030-01-01T19:00:00+08:00', '2030-01-01T20:30:00+08:00', 'meetup_must_end_before_concert'],
  ['ending exactly at verified start', '2030-01-01T19:00:00+08:00', '2030-01-01T20:00:00+08:00', 'meetup_must_end_before_concert'],
  ['past', '2020-01-01T10:00:00+08:00', '2020-01-01T11:00:00+08:00', 'meetup_must_be_future'],
  ['impossible calendar day', '2030-02-30T10:00:00+08:00', endsAt, 'invalid_meetup_datetime'],
  ['reversed window', endsAt, startsAt, 'meetup_end_must_follow_start'],
  ['non half-hour', '2030-01-01T10:15:00+08:00', endsAt, 'meetup_half_hour_required'],
  ['over seven days', startsAt, '2030-01-09T10:00:00+08:00', 'invalid_meetup_window'],
  ['before travel day', '2029-12-30T10:00:00+08:00', '2029-12-30T11:00:00+08:00', 'meetup_outside_concert_dates'],
  ['missing timezone', '2030-01-01T10:00:00', endsAt, 'invalid_meetup_datetime'],
  ['invalid offset', '2030-01-01T10:00:00+08:60', endsAt, 'invalid_meetup_datetime'],
  ['malformed', 'tomorrow at ten', endsAt, 'invalid_meetup_datetime'],
];
for (const [description, start, end, code] of invalidDates) test(`meetup creation rejects ${description} without writes`, t => {
  const { db, repos } = fixture(t);
  assert.throws(() => repos.meetups.create('host', { ...input, startsAt: start, endsAt: end }), { message: code, status: 400 });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM meetups').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM notifications').get().n, 0);
});

test('concert policy uses the concert day and previous travel day, with honest missing-time context', t => {
  const { repos } = fixture(t, { event_time: null, doors_time: '18:00' });
  const context = repos.meetups.context('host', { partyId: 'p1' });
  assert.equal(context.policy.earliestDate, '2029-12-31');
  assert.equal(context.policy.latestDate, '2030-01-01');
  assert.equal(context.policy.hasVerifiedStart, false, 'doors are not the performance start');
  assert.equal(context.policy.concertStartAt, null);
  assert.match(context.policy.message, /start time is unavailable/);
  assert.equal(context.concert.doors_time, '18:00');
  for (const [start, end] of [
    ['2029-12-31T23:30:00+08:00', '2030-01-01T00:30:00+08:00'],
    ['2030-01-01T23:30:00+08:00', '2030-01-02T00:00:00+08:00'],
  ]) assert.ok(repos.meetups.create('host', { ...input, startsAt: start, endsAt: end }).id);
  assert.throws(() => repos.meetups.create('host', { ...input, startsAt: '2030-01-02T00:00:00+08:00', endsAt: '2030-01-02T00:30:00+08:00' }), /outside_concert_dates/);
});

test('strict parsing and concert policy handle Singapore midnight independently of the machine timezone', () => {
  assert.equal(parseSingaporeInput('2030-01-01T00:00'), Date.parse('2029-12-31T16:00:00Z'));
  assert.equal(singaporeInputValue(Date.parse('2029-12-31T16:30:00Z')), '2030-01-01T00:30');
  assert.equal(singaporeInputValue(1e50), '');
  assert.ok(Number.isNaN(parseSingaporeInput('2030-02-29T00:00')));
  assert.ok(Number.isNaN(parseMeetupTimestamp('2030-01-01T24:00:00+08:00')));
  assert.ok(Number.isFinite(parseMeetupTimestamp('2028-02-29T00:00:00+08:00')));
  const policy = meetupDatePolicy({ event_date: '2030-01-01', event_time: '00:30:00', event_timezone: 'Asia/Singapore' }, Date.parse('2029-12-30T00:00:00Z'));
  assert.equal(policy.concertStartAt, Date.parse('2029-12-31T16:30:00Z'));
  assert.equal(policy.maximumEndsAt, Date.parse('2029-12-31T16:00:00Z'));
  assert.equal(policy.earliestAt, Date.parse('2029-12-30T16:00:00Z'));
  const overseas = meetupDatePolicy({ event_date: '2030-01-01', event_time: '20:00:00', event_timezone: 'America/New_York' }, 0);
  assert.equal(overseas.concertStartAt, Date.parse('2030-01-02T01:00:00Z'));
  assert.equal(meetupDatePolicy({ event_date: '2030-01-01', event_time: '20:00', event_timezone: 'Invalid/Zone' }, 0).hasVerifiedStart, false);
});

test('invalid concert dates cannot create boards but existing historical boards stay readable', t => {
  const { db, repos, create } = fixture(t);
  const id = create();
  db.prepare("UPDATE concerts SET event_date='2030-02-30' WHERE id='c1'").run();
  const context = repos.meetups.context('host', { partyId: 'p1' });
  assert.equal(context.policy.canSchedule, false);
  assert.equal(repos.meetups.detail('host', id).id, id);
  assert.throws(() => repos.meetups.create('host', input), /concert_date_unavailable/);
});

test('a verified early-morning concert accepts only the preceding valid meetup periods', t => {
  const { repos } = fixture(t, { event_time: '00:30:00' });
  assert.ok(repos.meetups.create('host', { ...input, startsAt: '2029-12-31T23:30:00+08:00', endsAt: '2030-01-01T00:00:00+08:00' }).id);
  assert.throws(() => repos.meetups.create('host', { ...input, startsAt: '2030-01-01T00:00:00+08:00', endsAt: '2030-01-01T00:30:00+08:00' }), /must_end_before_concert/);
});

test('HTTP context, creation and reopen enforce permissions even when browser validation is bypassed', async t => {
  const { repos } = fixture(t), app = express();
  app.use(express.json());
  app.use((req, res, next) => { if (req.headers['x-test-user']) req.user = { id: req.headers['x-test-user'] }; next(); });
  const requireUser = (req, res, next) => req.user ? next() : res.status(401).json({ error: 'authentication_required' });
  registerCommunityRoutes(app, { repos, requireUser, requireOperator: requireUser });
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const call = (path, user, body) => fetch(`http://127.0.0.1:${server.address().port}${path}`, {
    method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(user ? { 'x-test-user': user } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  assert.equal((await call('/meetup-context?partyId=p1')).status, 401);
  assert.equal((await call('/meetup-context?partyId=p1', 'outsider')).status, 403);
  const context = await call('/meetup-context?partyId=p1', 'friend');
  assert.equal(context.headers.get('cache-control'), 'private, no-store');
  assert.equal((await context.json()).context.capabilities.canCreate, false);
  assert.equal((await call('/meetups', 'friend', { ...input, isOrganizer: true })).status, 403);
  const invalid = await call('/meetups', 'host', { ...input, endsAt: '2030-01-01T22:00:00+08:00' });
  assert.equal(invalid.status, 400); assert.equal((await invalid.json()).error, 'meetup_must_end_before_concert');
  const id = (await (await call('/meetups', 'host', input)).json()).meetup.id;
  const placeId = repos.meetups.place('friend', id, location).id;
  const proposal = repos.meetups.propose('host', id, { version: repos.meetups.access('host', id).version, placeId, startsAt, acknowledgeNoAvailability: true });
  assert.equal((await call(`/meetups/${id}/reopen`, 'friend', { version: proposal.version })).status, 403);
  assert.equal((await call(`/meetups/${id}/reopen`, 'host', { version: proposal.version })).status, 200);
});
