import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createTestDb } from '../src/db/connection.js';
import { createRepositories } from '../src/db/repositories.js';
import { registerCommunityRoutes } from '../src/routes/community.js';
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

test('scope context and capabilities are authenticated and derive organizer authority from current membership', t => {
  const { repos, db, create } = fixture(t);
  assert.equal(repos.meetups.context('host', { partyId: 'p1' }).capabilities.canCreate, true);
  assert.equal(repos.meetups.context('friend', { partyId: 'p1' }).capabilities.canCreate, false);
  assert.throws(() => repos.meetups.context('outsider', { partyId: 'p1' }), /scope_membership_required/);
  assert.throws(() => repos.meetups.context('host', { partyId: 'p1', connectionId: 'unrelated' }), /one_meetup_scope_required/);
  assert.throws(() => repos.meetups.create('friend', { ...input, isOrganizer: true }), { message: 'meetup_organizer_required', status: 403 });
  const id = create();
  db.prepare("UPDATE meetups SET creator_id='friend' WHERE id=?").run(id);
  assert.throws(() => repos.meetups.cancel('friend', id, 1), /organizer_required/, 'legacy creator flag cannot grant organizer privileges');
  repos.membership.leave('friend', 'p1');
  assert.throws(() => repos.meetups.context('friend', { partyId: 'p1' }), /scope_membership_required/);
  assert.throws(() => repos.meetups.detail('friend', id), /meetup_not_found/);
});

test('proposed and confirmed plans lock substantive contributions while preserving exact no-ops and discussion', t => {
  const { db, repos, version, prepare } = fixture(t);
  const { id, placeId } = prepare();
  assert.throws(() => repos.meetups.propose('friend', id, { version: version(id), startsAt, placeId }), /organizer_required/);
  const proposal = repos.meetups.propose('host', id, { version: version(id), startsAt, placeId });
  for (const status of ['proposed', 'confirmed']) {
    assert.equal(repos.meetups.detail('friend', id).status, status);
    const before = db.prepare('SELECT * FROM meetups WHERE id=?').get(id);
    assert.throws(() => repos.meetups.availability('friend', id, []), /reopen_required/);
    assert.throws(() => repos.meetups.place('friend', id, { ...location, label: 'New meeting place' }), /reopen_required/);
    assert.throws(() => repos.meetups.cancel('friend', id, proposal.version), /organizer_required/);
    assert.throws(() => repos.meetups.reopen('friend', id, proposal.version), /organizer_required/);
    assert.equal(repos.meetups.availability('friend', id, windows, proposal.version).unchanged, true);
    assert.equal(repos.meetups.vote('friend', id, placeId, proposal.version).unchanged, true);
    assert.deepEqual(repos.meetups.place('friend', id, { ...location, label: '  CITY HALL MRT  ' }), { id: placeId, unchanged: true });
    repos.meetups.comment('friend', id, 'Can we discuss an alternative entrance?');
    assert.deepEqual(db.prepare('SELECT * FROM meetups WHERE id=?').get(id), before);
    assert.equal(repos.meetups.detail('friend', id).currentVotePlaceId, placeId);
    assert.equal(repos.meetups.detail('friend', id).capabilities.canContribute, false);
    if (status === 'proposed') assert.equal(repos.meetups.approve('host', id, proposal.version).confirmed, true);
  }
  assert.equal(db.prepare('SELECT COUNT(*) n FROM meetup_places WHERE meetup_id=?').get(id).n, 1);
});

test('explicit reopening is atomic, versioned and starts a fresh approval cycle without deleting history', t => {
  const { db, repos, version, prepare } = fixture(t);
  const { id, placeId } = prepare();
  const proposal = repos.meetups.propose('host', id, { version: version(id), startsAt, placeId });
  repos.meetups.approve('host', id, proposal.version);
  const reopened = repos.meetups.reopen('host', id, proposal.version);
  assert.equal(reopened.version, proposal.version + 1);
  const board = repos.meetups.detail('friend', id);
  assert.equal(board.status, 'planning'); assert.equal(board.selected_start, null); assert.equal(board.selected_place_id, null);
  assert.deepEqual(board.approvals, []);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM meetup_approvals WHERE meetup_id=?').get(id).n, 1);
  assert.ok(db.prepare('SELECT 1 FROM notifications WHERE user_id=? AND event_key=?').get('friend', `meetup:${id}:reopened:${reopened.version}`));
  assert.throws(() => repos.meetups.reopen('host', id, proposal.version), /stale_meetup_version/);
  assert.throws(() => repos.meetups.availability('friend', id, [], proposal.version), /stale_meetup_version/);
  const next = repos.meetups.propose('host', id, { version: version(id), startsAt, placeId });
  assert.deepEqual(repos.meetups.detail('host', id).approvals, []);
  assert.throws(() => repos.meetups.approve('host', id, proposal.version), /stale_meetup_version/);
  assert.equal(repos.meetups.approve('host', id, next.version).confirmed, true);
  const before = db.prepare('SELECT * FROM meetups WHERE id=?').get(id);
  db.exec("CREATE TRIGGER fail_reopen_notification BEFORE INSERT ON notifications WHEN NEW.event_key LIKE '%:reopened:%' BEGIN SELECT RAISE(ABORT,'reopen_notification_failed'); END");
  assert.throws(() => repos.meetups.reopen('host', id, next.version), /reopen_notification_failed/);
  assert.deepEqual(db.prepare('SELECT * FROM meetups WHERE id=?').get(id), before);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM meetup_approvals WHERE meetup_id=?').get(id).n, 2);
  db.exec('DROP TRIGGER fail_reopen_notification');
  repos.meetups.cancel('host', id, next.version);
  assert.throws(() => repos.meetups.reopen('host', id, next.version + 1), /meetup_cancelled/);
  assert.throws(() => repos.meetups.availability('friend', id, windows), /meetup_cancelled/);
});

test('approval rechecks a concert reschedule without destroying the pending proposal', t => {
  const { db, repos, version, prepare } = fixture(t);
  const { id, placeId } = prepare();
  const proposal = repos.meetups.propose('host', id, { version: version(id), startsAt, placeId });
  db.prepare("UPDATE concerts SET event_time='09:00:00' WHERE id='c1'").run();
  assert.throws(() => repos.meetups.approve('host', id, proposal.version), /must_end_before_concert/);
  assert.equal(repos.meetups.detail('host', id).status, 'proposed');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM meetup_approvals WHERE meetup_id=?').get(id).n, 0);
  assert.equal(repos.meetups.reopen('host', id, proposal.version).reopened, true);
});

test('connected groups and mutual Kaki pairs retain both-organizer approval requirements', t => {
  const { repos, create } = fixture(t);
  for (const [host, party, users] of [['host', 'p1', ['host', 'friend']], ['host2', 'p2', ['host2']]]) {
    if (party === 'p2') repos.membership.configure(host, party, { expectedFriends: 0 });
    for (const user of users) repos.membership.saveAnswers(user, party, {});
    repos.membership.publish(host, party, { connectOpen: true });
  }
  const connectionId = repos.groups.invite('host', 'p1', 'p2').id;
  repos.groups.respond('host2', connectionId, 'accept');
  for (const user of ['kakiA', 'kakiB']) repos.participation.join(user, 'c1', 'pit', 'doors');
  repos.kaki.setDecision('kakiA', 'c1', 'kakiB', 'like'); repos.kaki.setDecision('kakiB', 'c1', 'kakiA', 'like');
  const kakiConversationId = repos.kakiChat.openFor({ concertId: 'c1', me: 'kakiA', other: 'kakiB' }).id;
  for (const [scope, first, second] of [[{ connectionId }, 'host2', 'host'], [{ kakiConversationId }, 'kakiA', 'kakiB']]) {
    assert.equal(repos.meetups.context(second, scope).capabilities.canCreate, true);
    const id = create(scope, first), placeId = repos.meetups.place(second, id, location).id;
    const proposal = repos.meetups.propose(first, id, { version: repos.meetups.access(first, id).version, startsAt, placeId });
    assert.equal(repos.meetups.approve(first, id, proposal.version).confirmed, false);
    assert.equal(repos.meetups.detail(second, id).status, 'proposed');
    assert.equal(repos.meetups.approve(second, id, proposal.version).confirmed, true);
    const reopened = repos.meetups.reopen(second, id, proposal.version);
    assert.equal(repos.meetups.detail(first, id).version, reopened.version);
    assert.deepEqual(repos.meetups.detail(first, id).approvals, []);
  }
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
  const proposal = repos.meetups.propose('host', id, { version: repos.meetups.access('host', id).version, placeId, startsAt });
  assert.equal((await call(`/meetups/${id}/reopen`, 'friend', { version: proposal.version })).status, 403);
  assert.equal((await call(`/meetups/${id}/reopen`, 'host', { version: proposal.version })).status, 200);
});
