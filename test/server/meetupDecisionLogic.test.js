import { test } from 'node:test';
import assert from 'node:assert/strict';
import { express } from '../support/server-dependencies.mjs';
import { createTestDb } from '../../server/src/db/connection.js';
import { createRepositories } from '../../server/src/db/repositories.js';
import { registerCommunityRoutes } from '../../server/src/routes/community.js';
import { createMeetupIntegrations } from '../../server/src/services/meetupIntegrations.js';
import { makeUser, makeParty } from './helpers.js';

const startsAt = '2030-01-01T10:00:00+08:00', endsAt = '2030-01-01T12:00:00+08:00';
const origin = { latitude: 1.3, longitude: 103.8 };
const location = { label: 'Funan', latitude: 1.291, longitude: 103.85, sheltered: true };
function fixture(t) {
  const db = createTestDb(), repos = createRepositories(db);
  t.after(() => db.close());
  for (const id of ['host', 'friend', 'outsider']) repos.users.create(makeUser(id));
  repos.concerts.create({ id: 'c1', artist: 'Act', venue: 'Hall', city: 'Singapore', event_date: '2030-01-01', event_time: '20:00:00' });
  repos.parties.create(makeParty('p1', makeUser('host'), { capacity: 2 }));
  repos.membership.configure('host', 'p1', { expectedFriends: 1 });
  repos.membership.acceptInvite('friend', repos.membership.invite('host', 'p1').token);
  const { id } = repos.meetups.create('host', { partyId: 'p1', title: 'Before the concert', startsAt, endsAt });
  const version = () => repos.meetups.access('host', id).version;
  const a = repos.meetups.place('friend', id, location).id;
  const b = repos.meetups.place('host', id, { ...location, label: 'Raffles Building', latitude: 1.31 }).id;
  return { db, repos, id, a, b, version };
}

test('a place vote can switch and be removed idempotently without affecting another voter', t => {
  const { db, repos, id, a, b, version } = fixture(t);
  const initial = version();
  const firstVote = repos.meetups.vote('host', id, a, initial);
  assert.equal(firstVote.version, initial + 1);
  const unchanged = repos.meetups.vote('host', id, a, firstVote.version);
  assert.equal(unchanged.version, firstVote.version); assert.equal(unchanged.unchanged, true);
  repos.meetups.vote('friend', id, a, version());
  repos.meetups.vote('friend', id, b, version());
  let detail = repos.meetups.detail('friend', id);
  assert.equal(detail.currentVotePlaceId, b);
  assert.deepEqual(detail.places.map(p => p.votes), [1, 1]);
  const before = version(), result = repos.meetups.removeVote('friend', id, before);
  assert.deepEqual(result, { voted: false, version: before + 1 });
  detail = repos.meetups.detail('friend', id);
  assert.equal(detail.currentVotePlaceId, null); assert.deepEqual(detail.places.map(p => p.votes), [1, 0]);
  const notices = db.prepare('SELECT COUNT(*) n FROM notifications').get().n;
  assert.equal(repos.meetups.removeVote('friend', id, version()).unchanged, true);
  assert.equal(version(), before + 1); assert.equal(db.prepare('SELECT COUNT(*) n FROM notifications').get().n, notices);
  assert.throws(() => repos.meetups.removeVote('host', id, before), /stale_meetup_version/);
  assert.throws(() => repos.meetups.removeVote('host', id), /stale_meetup_version/);
  assert.throws(() => repos.meetups.removeVote('outsider', id, version()), /meetup_not_found/);
  assert.equal(repos.meetups.detail('host', id).currentVotePlaceId, a);
});

test('only a suggestion owner can correct it; genuine edits clear support and stale concurrent changes fail', t => {
  const { repos, id, a, b, version } = fixture(t);
  repos.meetups.vote('host', id, a); repos.meetups.vote('friend', id, a);
  assert.equal(repos.meetups.detail('host', id).places.find(p => p.id === a).canEdit, false);
  assert.equal(repos.meetups.detail('friend', id).places.find(p => p.id === a).canEdit, true);
  assert.throws(() => repos.meetups.updatePlace('host', id, a, { ...location, version: version() }), /place_owner_required/);
  assert.throws(() => repos.meetups.removePlace('host', id, a, version()), /place_owner_required/);
  const before = version();
  assert.equal(repos.meetups.updatePlace('friend', id, a, { ...location, version: before }).unchanged, true);
  assert.equal(repos.meetups.detail('host', id).places.find(p => p.id === a).votes, 2);
  assert.throws(() => repos.meetups.updatePlace('friend', id, a, { ...location, latitude: '1.3', version: before }), /invalid_place/);
  assert.throws(() => repos.meetups.updatePlace('friend', id, a, { ...location, label: 'Raffles Building', latitude: 1.31, version: before }), /place_already_suggested/);
  const result = repos.meetups.updatePlace('friend', id, a, { ...location, label: 'Funan north entrance', version: before });
  assert.equal(result.votesCleared, 2); assert.equal(result.version, before + 1);
  assert.equal(repos.meetups.detail('host', id).currentVotePlaceId, null);
  assert.equal(repos.meetups.detail('friend', id).places.find(p => p.id === a).label, 'Funan north entrance');
  assert.throws(() => repos.meetups.removePlace('friend', id, a, before), /stale_meetup_version/);
  assert.equal(repos.meetups.detail('host', id).places.find(p => p.id === b).label, 'Raffles Building');
});

test('confirmed plans protect votes and selected places until an organizer reopens; removal cannot orphan votes', t => {
  const { db, repos, id, a, version } = fixture(t);
  repos.meetups.availability('friend', id, [{ startsAt, endsAt }]);
  repos.meetups.vote('host', id, a); repos.meetups.vote('friend', id, a);
  const recommendation = repos.meetups.detail('host', id).suggestions[0];
  assert.equal(recommendation.availableCount, 1); assert.equal(recommendation.participantCount, 2);
  const proposal = repos.meetups.propose('host', id, { version: version(), placeId: a, startsAt });
  assert.equal(proposal.confirmed, true, 'availability informs choice; unanimous attendance is not an approval rule');
  for (const action of [() => repos.meetups.removeVote('friend', id, version()),
    () => repos.meetups.removePlace('friend', id, a, version()),
    () => repos.meetups.updatePlace('friend', id, a, { ...location, label: 'Other', version: version() })])
    assert.throws(action, /reopen_required/);
  assert.equal(repos.meetups.detail('friend', id).places.find(p => p.id === a).canRemove, false);
  repos.meetups.reopen('host', id, version());
  assert.deepEqual(repos.meetups.detail('host', id).approvals, []);
  const result = repos.meetups.removePlace('friend', id, a, version());
  assert.equal(result.votesCleared, 2);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM meetup_votes WHERE place_id=?').get(a).n, 0);
  assert.equal(repos.meetups.detail('host', id).places.some(p => p.id === a), false);
});

test('suggestion correction and removal roll back if notification writing fails', t => {
  const { db, repos, id, a, version } = fixture(t);
  repos.meetups.vote('host', id, a);
  const before = version();
  db.exec("CREATE TRIGGER reject_meetup_notice BEFORE INSERT ON notifications BEGIN SELECT RAISE(ABORT,'notice_failed'); END");
  assert.throws(() => repos.meetups.removePlace('friend', id, a, before), /notice_failed/);
  assert.throws(() => repos.meetups.updatePlace('friend', id, a, { ...location, label: 'Changed', version: before }), /notice_failed/);
  assert.throws(() => repos.meetups.removeVote('host', id, before), /notice_failed/);
  assert.equal(version(), before); assert.equal(repos.meetups.detail('host', id).currentVotePlaceId, a);
  assert.equal(repos.meetups.detail('friend', id).places.find(p => p.id === a).label, 'Funan');
});

test('sheltered filtering precedes the default limit and agrees with bounded travel filtering', async t => {
  const { repos, id, a, b } = fixture(t);
  repos.meetups.removePlace('friend', id, a, repos.meetups.access('friend', id).version);
  repos.meetups.removePlace('host', id, b, repos.meetups.access('host', id).version);
  for (const user of ['host', 'friend']) repos.meetups.availability(user, id, [{ startsAt, endsAt, ...origin }]);
  for (let i = 0; i < 6; i++) repos.meetups.place('host', id, { label: `Open ${i}`, ...origin, latitude: origin.latitude + i / 10000, sheltered: false });
  const sheltered = repos.meetups.place('friend', id, { label: 'Sheltered far away', latitude: 1.45, longitude: 103.95, sheltered: true }).id;
  assert.equal(repos.meetups.detail('host', id).suggestions.some(p => p.placeId === sheltered), false);
  const filtered = repos.meetups.detail('host', id, { shelteredOnly: true });
  assert.equal(filtered.suggestions.length, 4); assert.ok(filtered.suggestions.every(p => p.placeId === sheltered));
  assert.equal(filtered.places.length, 7, 'filter affects recommendations, not the persistent place-voting list');
  const service = createMeetupIntegrations({ repos, travel: { configured: false } });
  const result = await service.suggestions('host', id, { shelteredOnly: true });
  assert.ok(result.options.every(p => p.placeId === sheltered)); assert.equal(result.eligiblePlaces, 1);
});

test('vote and place correction HTTP endpoints enforce authentication, version and owner permissions', async t => {
  const { repos, db, id, a } = fixture(t);
  const app = express(); app.use(express.json());
  app.use((req, res, next) => { if (req.headers['x-test-user']) req.user = { id: req.headers['x-test-user'] }; next(); });
  const requireUser = (req, res, next) => req.user ? next() : res.status(401).json({ error: 'authentication_required' });
  registerCommunityRoutes(app, { repos, db, requireUser, requireOperator: requireUser });
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const call = async (path, user, method = 'GET', body) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/meetups/${id}${path}`, {
      method, headers: { 'Content-Type': 'application/json', ...(user ? { 'x-test-user': user } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: await response.json() };
  };
  let version = repos.meetups.access('host', id).version;
  assert.equal((await call('/vote', undefined, 'DELETE', { version })).status, 401);
  assert.equal((await call('/vote', 'outsider', 'DELETE', { version })).status, 404);
  assert.equal((await call('/vote', 'friend', 'DELETE', {})).status, 409);
  assert.equal((await call(`/places/${a}`, 'host', 'DELETE', { version })).status, 403);
  const edited = await call(`/places/${a}`, 'friend', 'PUT', { ...location, label: 'Funan entrance', version });
  assert.equal(edited.status, 200); version = edited.body.place.version;
  assert.equal((await call('/vote', 'friend', 'PUT', { placeId: a, version })).status, 200);
  version = repos.meetups.access('host', id).version;
  assert.equal((await call('/vote', 'friend', 'DELETE', { version })).status, 200);
  version = repos.meetups.access('host', id).version;
  assert.equal((await call(`/places/${a}`, 'friend', 'DELETE', { version })).status, 200);
  assert.equal((await call('?shelteredOnly=invalid', 'friend')).status, 400);
  assert.equal((await call('?shelteredOnly=true', 'friend')).body.meetup.suggestionsShelteredOnly, true);
});
