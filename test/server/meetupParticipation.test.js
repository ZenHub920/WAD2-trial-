import { test } from 'node:test';
import assert from 'node:assert/strict';
import { express } from '../support/server-dependencies.mjs';
import { createTestDb } from '../../server/src/db/connection.js';
import { createRepositories } from '../../server/src/db/repositories.js';
import { migrateMeetups } from '../../server/src/db/meetupRepository.js';
import { registerCommunityRoutes } from '../../server/src/routes/community.js';
import { makeUser, makeParty } from './helpers.js';

const startsAt = '2030-01-01T10:00:00+08:00', endsAt = '2030-01-01T11:00:00+08:00';
const windows = [{ startsAt, endsAt, latitude: 1.3, longitude: 103.8, label: 'private-home', travelMode: 'drive' }];
const place = { label: 'Public entrance', latitude: 1.31, longitude: 103.86, sheltered: true };
function fixture(t) {
  const db = createTestDb(), repos = createRepositories(db);
  t.after(() => db.close());
  for (const id of ['host', 'friend', 'late', 'host2', 'outsider']) repos.users.create(makeUser(id));
  repos.concerts.create({ id: 'c1', artist: 'Act', venue: 'Hall', city: 'Singapore', event_date: '2030-01-01', event_time: '20:00:00' });
  repos.parties.create(makeParty('p1', makeUser('host'), { capacity: 3 }));
  repos.membership.configure('host', 'p1', { expectedFriends: 2 });
  repos.membership.acceptInvite('friend', repos.membership.invite('host', 'p1').token);
  const { id } = repos.meetups.create('host', { partyId: 'p1', title: 'Before the show', startsAt, endsAt });
  return { db, repos, id, version: () => repos.meetups.access('host', id).version };
}

test('participation migration preserves intervals, backfills only proven responses and never invents legacy confirmation times', t => {
  const { db, repos, id } = fixture(t);
  repos.meetups.availability('host', id, windows);
  const before = db.prepare('SELECT * FROM meetup_availability').all();
  db.exec('DROP TABLE meetup_availability_responses; DROP TABLE meetup_confirmation_context');
  migrateMeetups(db); migrateMeetups(db);
  assert.deepEqual(db.prepare('SELECT * FROM meetup_availability').all(), before);
  assert.deepEqual(db.prepare('SELECT user_id,status,responded_at FROM meetup_availability_responses').all(), [
    { user_id: 'host', status: 'available', responded_at: null },
  ]);
  assert.equal(repos.meetups.detail('host', id).availabilityResponse, 'available');
  assert.equal(repos.meetups.detail('friend', id).availabilityResponse, 'unanswered');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM meetup_confirmation_context').get().n, 0);
  assert.deepEqual(db.pragma('foreign_key_check'), []);
});

test('explicit unavailable, selected times and no response remain distinct, private, revisable and idempotent', t => {
  const { db, repos, id, version } = fixture(t);
  repos.meetups.availability('host', id, windows);
  repos.meetups.availability('friend', id, [], version(), 'unavailable');
  let own = repos.meetups.detail('friend', id);
  assert.equal(own.availabilityResponse, 'unavailable'); assert.equal(own.hasResponded, true);
  assert.deepEqual(own.availability, []);
  assert.deepEqual(own.availabilityResponses, { respondedCount: 2, availableCount: 1, unavailableCount: 1, unansweredCount: 0 });
  assert.doesNotMatch(JSON.stringify(own), /private-home|participant_ids_json|responded_at/);
  const saved = db.prepare('SELECT * FROM meetup_availability_responses WHERE user_id=?').get('friend');
  const notices = db.prepare('SELECT COUNT(*) AS n FROM notifications').get().n, before = version();
  assert.equal(repos.meetups.availability('friend', id, [], before, 'unavailable').unchanged, true);
  assert.equal(version(), before);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM notifications').get().n, notices);
  assert.deepEqual(db.prepare('SELECT * FROM meetup_availability_responses WHERE user_id=?').get('friend'), saved);
  repos.meetups.availability('friend', id, [{ startsAt, endsAt }], version(), 'available');
  own = repos.meetups.detail('friend', id);
  assert.equal(own.availabilityResponse, 'available'); assert.equal(own.availability.length, 1);
  repos.meetups.availability('friend', id, [], version());
  own = repos.meetups.detail('friend', id);
  assert.equal(own.availabilityResponse, 'unanswered'); assert.equal(own.hasResponded, false);
  assert.equal(own.availabilityResponses.unansweredCount, 1);
  assert.equal(own.availabilityResponses.unavailableCount, 0);
  assert.throws(() => repos.meetups.detail('outsider', id), /meetup_not_found/);
});

test('invalid response combinations, stale writes and notification failures leave response and availability unchanged', t => {
  const { db, repos, id, version } = fixture(t);
  repos.meetups.availability('friend', id, [], version(), 'unavailable');
  const before = repos.meetups.detail('friend', id);
  for (const [rows, status] of [[[], 'available'], [windows, 'unavailable'], [windows, 'unanswered'], [[], null], [[], 'perhaps']])
    assert.throws(() => repos.meetups.availability('friend', id, rows, version(), status), { message: 'invalid_availability_response', status: 400 });
  assert.throws(() => repos.meetups.availability('friend', id, windows, version() - 1), /stale_meetup_version/);
  assert.deepEqual(repos.meetups.detail('friend', id), before);
  db.exec("CREATE TRIGGER fail_response_notice BEFORE INSERT ON notifications WHEN NEW.category='meetup' BEGIN SELECT RAISE(ABORT,'response_notice_failed'); END");
  assert.throws(() => repos.meetups.availability('friend', id, windows, version()), /response_notice_failed/);
  assert.deepEqual(repos.meetups.detail('friend', id), before);
});

test('response counts and overview next actions use current members and do not chase explicitly unavailable members', t => {
  const { repos, id, version } = fixture(t);
  repos.meetups.availability('host', id, windows);
  repos.meetups.availability('friend', id, [], version(), 'unavailable');
  repos.meetups.place('friend', id, place);
  let member = repos.meetups.list('friend')[0], host = repos.meetups.list('host')[0];
  assert.equal(member.hasResponded, true); assert.equal(member.hasAvailability, false); assert.equal(member.nextStage, 'places');
  assert.equal(host.nextStage, 'review');
  repos.membership.leave('friend', 'p1');
  host = repos.meetups.detail('host', id);
  assert.equal(host.participantCount, 1);
  assert.deepEqual(host.availabilityResponses, { respondedCount: 1, availableCount: 1, unavailableCount: 0, unansweredCount: 0 });
});

test('zero-attendance proposals require a real boolean acknowledgement without changing recommendations or approval policy', t => {
  const { repos, id, version } = fixture(t);
  const placeId = repos.meetups.place('friend', id, place).id;
  const before = repos.meetups.detail('host', id), input = { startsAt, placeId, version: version() };
  assert.deepEqual(before.suggestions, []);
  for (const extra of [{}, { acknowledgeNoAvailability: false }])
    assert.throws(() => repos.meetups.propose('host', id, { ...input, ...extra }), { message: 'meetup_no_availability_acknowledgement_required', status: 400 });
  assert.throws(() => repos.meetups.propose('host', id, { ...input, acknowledgeNoAvailability: 'true' }), /invalid_meetup_acknowledgement/);
  assert.throws(() => repos.meetups.propose('friend', id, { ...input, acknowledgeNoAvailability: true }), /meetup_organizer_required/);
  assert.deepEqual(repos.meetups.detail('host', id), before);
  const result = repos.meetups.propose('host', id, { ...input, acknowledgeNoAvailability: true });
  assert.equal(result.confirmed, true);
  assert.deepEqual(repos.meetups.detail('host', id).approvals, ['host']);
  assert.deepEqual(repos.meetups.detail('host', id).suggestions, []);
});

test('same-count member replacement changes an opaque scoped participation revision and rejects an outdated reviewed proposal', t => {
  const { db, repos, id, version } = fixture(t);
  repos.meetups.availability('friend', id, windows);
  const placeId = repos.meetups.place('host', id, place).id, before = repos.meetups.detail('host', id);
  repos.membership.leave('friend', 'p1');
  repos.membership.acceptInvite('late', repos.membership.invite('host', 'p1').token);
  const after = repos.meetups.detail('host', id);
  assert.equal(after.version, before.version); assert.equal(after.participantCount, before.participantCount);
  assert.match(after.participationRevision, /^[a-f0-9]{64}$/);
  assert.notEqual(after.participationRevision, before.participationRevision);
  assert.doesNotMatch(JSON.stringify(after), /private-home|participant_ids_json/);
  const notices = db.prepare('SELECT COUNT(*) AS n FROM notifications').get().n;
  assert.throws(() => repos.meetups.propose('host', id, { placeId, startsAt, version: version(),
    participationRevision: before.participationRevision, acknowledgeNoAvailability: true }), /stale_meetup_membership/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM notifications').get().n, notices);
  assert.equal(repos.meetups.access('host', id).status, 'planning');
  assert.equal(repos.meetups.propose('host', id, { placeId, startsAt, version: version(),
    participationRevision: after.participationRevision, acknowledgeNoAvailability: true }).confirmed, true);
});

test('confirmed plans remain valid for later members and disclose only their own historical context', t => {
  const { db, repos, id, version } = fixture(t);
  repos.meetups.availability('friend', id, windows);
  const placeId = repos.meetups.place('host', id, place).id;
  repos.meetups.propose('host', id, { startsAt, placeId, version: version() });
  assert.equal(repos.meetups.detail('friend', id).confirmationContext.confirmedBeforeJoined, false);
  repos.membership.acceptInvite('late', repos.membership.invite('host', 'p1').token);
  const joined = repos.meetups.detail('late', id);
  assert.equal(joined.status, 'confirmed'); assert.equal(joined.confirmationContext.confirmedBeforeJoined, true);
  assert.ok(Number.isInteger(joined.confirmationContext.confirmedAt));
  assert.deepEqual(Object.keys(joined.confirmationContext).sort(), ['confirmedAt', 'confirmedBeforeJoined']);
  assert.equal(repos.meetups.list('late')[0].confirmationContext.confirmedBeforeJoined, true);
  const context = db.prepare('SELECT * FROM meetup_confirmation_context WHERE meetup_id=?').get(id);
  db.prepare("UPDATE group_memberships SET joined_at=? WHERE party_id='p1' AND user_id='friend'")
    .run(new Date(context.confirmed_at + 2000).toISOString().slice(0, 19).replace('T', ' '));
  assert.equal(repos.meetups.detail('friend', id).confirmationContext.confirmedBeforeJoined, true);
  db.prepare('DELETE FROM meetup_confirmation_context WHERE meetup_id=?').run(id);
  migrateMeetups(db);
  assert.equal(repos.meetups.detail('late', id).confirmationContext, null, 'legacy confirmation time remains unknown');
});

test('connected meetups record their confirmation context only after both explicit host approvals', t => {
  const { db, repos } = fixture(t);
  repos.parties.create(makeParty('p2', makeUser('host2'), { capacity: 1 }));
  repos.membership.configure('host', 'p1', { expectedFriends: 1 });
  repos.membership.configure('host2', 'p2', { expectedFriends: 0 });
  for (const [host, party, members] of [['host', 'p1', ['host', 'friend']], ['host2', 'p2', ['host2']]]) {
    for (const member of members) repos.membership.saveAnswers(member, party, {});
    repos.membership.publish(host, party, { connectOpen: true });
  }
  const connectionId = repos.groups.invite('host', 'p1', 'p2').id;
  repos.groups.respond('host2', connectionId, 'accept');
  const { id } = repos.meetups.create('host', { connectionId, title: 'Together', startsAt, endsAt });
  const placeId = repos.meetups.place('friend', id, place).id;
  const proposal = repos.meetups.propose('host', id, { placeId, startsAt,
    version: repos.meetups.access('host', id).version, acknowledgeNoAvailability: true });
  assert.equal(proposal.confirmed, false);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM meetup_confirmation_context WHERE meetup_id=?').get(id).n, 0);
  assert.equal(repos.meetups.approve('host', id, proposal.version).confirmed, false);
  assert.equal(repos.meetups.approve('host2', id, proposal.version).confirmed, true);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM meetup_confirmation_context WHERE meetup_id=?').get(id).n, 1);
  assert.equal(repos.meetups.detail('friend', id).confirmationContext.confirmedBeforeJoined, false);
});

test('availability HTTP endpoints enforce response semantics and return no other participant response identities', async t => {
  const { repos, id } = fixture(t), app = express(); app.use(express.json());
  app.use((req, res, next) => { if (req.headers['x-test-user']) req.user = { id: req.headers['x-test-user'] }; next(); });
  const requireUser = (req, res, next) => req.user ? next() : res.status(401).json({ error: 'authentication_required' });
  registerCommunityRoutes(app, { repos, requireUser, requireOperator: requireUser });
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const call = (user, body) => fetch(`http://127.0.0.1:${server.address().port}/meetups/${id}/availability`, {
    method: 'PUT', headers: { 'content-type': 'application/json', ...(user ? { 'x-test-user': user } : {}) }, body: JSON.stringify(body),
  });
  assert.equal((await call(null, { windows: [], responseStatus: 'unavailable' })).status, 401);
  assert.equal((await call('outsider', { windows: [], responseStatus: 'unavailable' })).status, 404);
  assert.equal((await call('friend', { windows: [], responseStatus: 'available' })).status, 400);
  const saved = await call('friend', { windows: [], responseStatus: 'unavailable' });
  assert.equal(saved.status, 200); assert.equal((await saved.json()).result.responseStatus, 'unavailable');
  const host = repos.meetups.detail('host', id);
  assert.equal(host.availabilityResponse, 'unanswered');
  assert.deepEqual(host.availabilityResponses, { respondedCount: 1, availableCount: 0, unavailableCount: 1, unansweredCount: 1 });
});
