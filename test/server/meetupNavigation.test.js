import { test } from 'node:test';
import assert from 'node:assert/strict';
import { express } from '../support/server-dependencies.mjs';
import { createTestDb } from '../../server/src/db/connection.js';
import { createRepositories } from '../../server/src/db/repositories.js';
import { registerCommunityRoutes } from '../../server/src/routes/community.js';
import { migrateMeetups } from '../../server/src/db/meetupRepository.js';
import { makeUser, makeParty } from './helpers.js';

const startsAt = '2030-01-01T10:00:00+08:00', endsAt = '2030-01-01T12:00:00+08:00';
const input = { partyId: 'p1', title: 'Meet before Act', startsAt, endsAt };
const place = { label: 'City Hall MRT', latitude: 1.293, longitude: 103.852, sheltered: true };

function fixture(t) {
  const db = createTestDb(), repos = createRepositories(db);
  t.after(() => db.close());
  for (const id of ['host', 'member', 'otherHost', 'outsider']) repos.users.create(makeUser(id));
  repos.concerts.create({ id: 'c1', artist: 'Act', city: 'Singapore', venue: 'Hall',
    event_date: '2030-01-01', event_time: '20:00:00', event_timezone: 'Asia/Singapore' });
  repos.parties.create(makeParty('p1', makeUser('host'), { capacity: 2, name: 'Purple crew' }));
  repos.membership.configure('host', 'p1', { expectedFriends: 1 });
  repos.membership.acceptInvite('member', repos.membership.invite('host', 'p1').token);
  return { db, repos };
}

test('meetup summaries and scoped creation context expose actionable state without private origins or heavyweight detail', t => {
  const { repos } = fixture(t), { id } = repos.meetups.create('host', input);
  repos.meetups.availability('member', id, [{ startsAt, endsAt, latitude: 1.3, longitude: 103.8, label: 'private-home', travelMode: 'drive' }]);
  const placeId = repos.meetups.place('member', id, place).id;
  const summary = repos.meetups.list('member')[0];
  assert.deepEqual(summary.scope, { partyId: 'p1' });
  assert.equal(summary.scopeLabel, 'Purple crew');
  assert.equal(summary.returnPath, '/groups/p1/channel');
  assert.equal(summary.concert.artist, 'Act');
  assert.equal(summary.startsAt, Date.parse(startsAt));
  assert.equal(summary.participantCount, 2);
  assert.equal(summary.availabilityParticipantCount, 1);
  assert.equal(summary.hasAvailability, true);
  assert.equal(summary.nextStage, 'places');
  assert.equal(summary.capabilities.canPropose, false);
  assert.equal(summary.selectedPlace, null);
  assert.equal(summary.isHistorical, false);
  const context = repos.meetups.context('member', { partyId: 'p1' });
  assert.deepEqual(context.meetups, [summary]);
  assert.equal(context.capabilities.canCreate, false);
  assert.equal(context.returnPath, '/groups/p1/channel');
  assert.equal(repos.meetups.list('host')[0].hasAvailability, false);
  assert.equal(repos.meetups.list('host')[0].nextStage, 'availability');
  assert.doesNotMatch(JSON.stringify(context), /private-home|latitude|longitude|travelMode|comments|grid|suggestions/);
  const version = repos.meetups.access('host', id).version;
  repos.meetups.propose('host', id, { version, placeId, startsAt });
  const proposed = repos.meetups.list('member')[0];
  assert.deepEqual(proposed.selectedPlace, { id: placeId, label: place.label });
  assert.equal(proposed.selectedStart, Date.parse(startsAt));
  assert.equal(proposed.nextStage, 'review');
  assert.equal(proposed.requiredApprovalCount, 1);
  assert.equal(proposed.approvalCount, 1);
  assert.equal(proposed.status, 'confirmed');
});

test('board creation retries and default scope navigation reuse active plans while explicit additional plans remain possible', t => {
  const { db, repos } = fixture(t);
  const first = repos.meetups.create('host', { ...input, creationRequestId: 'attempt-one' });
  assert.deepEqual(repos.meetups.create('host', { ...input, creationRequestId: 'attempt-one' }), { id: first.id, reused: true });
  assert.deepEqual(repos.meetups.create('host', { ...input, title: 'Another intention', creationRequestId: 'attempt-two' }), { id: first.id, reused: true });
  const secondInput = { ...input, title: 'Separate pre-show meal', createAnother: true, creationRequestId: 'attempt-three' };
  const second = repos.meetups.create('host', secondInput);
  assert.notEqual(second.id, first.id);
  assert.deepEqual(repos.meetups.create('host', secondInput), { id: second.id, reused: true });
  assert.deepEqual(repos.meetups.create('host', input), { id: second.id, reused: true });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM meetups').get().n, 2);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM notifications WHERE category='meetup'").get().n, 2);
  assert.deepEqual(repos.meetups.context('host', { partyId: 'p1' }).meetups.map(m => m.id), [second.id, first.id]);
});

test('creation request identities are persisted across repository instances and reject changed payloads atomically', t => {
  const { db, repos } = fixture(t);
  const body = { ...input, createAnother: true, creationRequestId: 'durable-attempt' };
  const first = repos.meetups.create('host', body), restartedRepos = createRepositories(db);
  assert.deepEqual(restartedRepos.meetups.create('host', body), { id: first.id, reused: true });
  assert.throws(() => restartedRepos.meetups.create('host', { ...body, title: 'Different title' }), { message: 'meetup_creation_conflict', status: 409 });
  assert.throws(() => restartedRepos.meetups.create('host', { ...body, endsAt: '2030-01-01T13:00:00+08:00' }), /meetup_creation_conflict/);
  for (const options of [{ creationRequestId: 'short' }, { creationRequestId: [] }, { creationRequestId: 'path/unsafe' }, { createAnother: 'true' }])
    assert.throws(() => restartedRepos.meetups.create('host', { ...input, ...options }), { message: 'invalid_meetup_creation_options', status: 400 });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM meetups').get().n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM notifications WHERE category='meetup'").get().n, 1);
});

test('a lost reuse response still maps to its original board after cancellation instead of creating another', t => {
  const { db, repos } = fixture(t);
  const first = repos.meetups.create('host', input);
  const retryBody = { ...input, title: 'Another organizer intention', creationRequestId: 'reused-attempt' };
  assert.deepEqual(repos.meetups.create('host', retryBody), { id: first.id, reused: true });
  repos.meetups.cancel('host', first.id, 1);
  const restarted = createRepositories(db);
  assert.deepEqual(restarted.meetups.create('host', retryBody), { id: first.id, reused: true });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM meetups').get().n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM meetup_creation_requests').get().n, 1);
  assert.throws(() => restarted.meetups.create('host', { ...retryBody, createAnother: true }), /meetup_creation_conflict/);
  const next = restarted.meetups.create('host', { ...retryBody, creationRequestId: 'new-intention' });
  assert.notEqual(next.id, first.id, 'a fresh deliberate request can create a new plan');
});

test('request ledgers are additive, retain old boards, bind account and scope, and roll back with notifications', t => {
  const { db, repos } = fixture(t);
  const first = repos.meetups.create('host', input);
  db.exec('DROP TABLE meetup_creation_requests');
  const before = db.prepare('SELECT * FROM meetups WHERE id=?').get(first.id);
  migrateMeetups(db); migrateMeetups(db);
  assert.deepEqual(db.prepare('SELECT * FROM meetups WHERE id=?').get(first.id), before);
  const body = { ...input, creationRequestId: 'same-local-token' };
  assert.deepEqual(repos.meetups.create('host', body), { id: first.id, reused: true });
  repos.parties.create(makeParty('p2', makeUser('otherHost'), { capacity: 1 }));
  const separate = repos.meetups.create('otherHost', { ...body, partyId: 'p2' });
  assert.notEqual(separate.id, first.id);
  repos.concerts.create({ id: 'c2', artist: 'Second act', city: 'Singapore', venue: 'Hall', event_date: '2030-01-01' });
  repos.parties.create(makeParty('p3', makeUser('host'), { concert_id: 'c2', capacity: 1 }));
  const otherScope = repos.meetups.create('host', { ...body, partyId: 'p3' });
  assert.notEqual(otherScope.id, first.id, 'the same organizer token is bound to its original scope');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM meetup_creation_requests').get().n, 3);
  const serialized = JSON.stringify(db.prepare('SELECT * FROM meetup_creation_requests').all());
  assert.doesNotMatch(serialized, /same-local-token|Meet before Act/);
  db.exec("CREATE TRIGGER fail_creation_notice BEFORE INSERT ON notifications WHEN NEW.event_key LIKE '%:created' BEGIN SELECT RAISE(ABORT,'creation_notification_failed'); END");
  assert.throws(() => repos.meetups.create('host', { ...body, createAnother: true, creationRequestId: 'rollback-attempt' }), /creation_notification_failed/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM meetups').get().n, 3);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM meetup_creation_requests').get().n, 3);
});

test('cancelled and historical boards remain visible without preventing a new active plan', t => {
  const { db, repos } = fixture(t), first = repos.meetups.create('host', input);
  repos.meetups.cancel('host', first.id, 1);
  const second = repos.meetups.create('host', input);
  assert.notEqual(second.id, first.id);
  assert.equal(repos.meetups.list('host').find(m => m.id === first.id).isHistorical, true);
  db.prepare("UPDATE meetups SET status='confirmed',selected_start=0 WHERE id=?").run(second.id);
  const third = repos.meetups.create('host', input);
  assert.notEqual(third.id, second.id);
  assert.equal(repos.meetups.list('host').find(m => m.id === second.id).isHistorical, true);
  db.prepare('UPDATE meetups SET starts_at=?,ends_at=? WHERE id=?').run(0, 1800000, third.id);
  assert.equal(repos.meetups.list('host').find(m => m.id === third.id).isHistorical, true);
  assert.notEqual(repos.meetups.create('host', input).id, third.id);
});

test('enriched summaries and creation safeguards preserve current membership and organizer authorization', t => {
  const { repos } = fixture(t), { id } = repos.meetups.create('host', input);
  assert.deepEqual(repos.meetups.list('outsider'), []);
  assert.throws(() => repos.meetups.context('outsider', { partyId: 'p1' }), { message: 'scope_membership_required', status: 403 });
  assert.throws(() => repos.meetups.create('member', { ...input, createAnother: true, creationRequestId: 'member-attempt', isOrganizer: true }), /meetup_organizer_required/);
  repos.membership.leave('member', 'p1');
  assert.deepEqual(repos.meetups.list('member'), []);
  assert.throws(() => repos.meetups.context('member', { partyId: 'p1' }), /scope_membership_required/);
  assert.throws(() => repos.meetups.detail('member', id), /meetup_not_found/);
});

test('connected hosts see their current approval state and cannot mistake an existing approval for pending work', t => {
  const { repos } = fixture(t);
  repos.parties.create(makeParty('p2', makeUser('otherHost'), { capacity: 1, name: 'Encore crew' }));
  repos.membership.configure('otherHost', 'p2', { expectedFriends: 0 });
  for (const [party, host, members] of [['p1', 'host', ['host', 'member']], ['p2', 'otherHost', ['otherHost']]]) {
    for (const user of members) repos.membership.saveAnswers(user, party, {});
    repos.membership.publish(host, party, { connectOpen: true });
  }
  const connectionId = repos.groups.invite('host', 'p1', 'p2').id;
  repos.groups.respond('otherHost', connectionId, 'accept');
  const { id } = repos.meetups.create('host', { ...input, partyId: undefined, connectionId });
  const placeId = repos.meetups.place('member', id, place).id;
  const proposal = repos.meetups.propose('host', id, { version: repos.meetups.access('host', id).version, placeId, startsAt });
  repos.meetups.approve('host', id, proposal.version);
  const summary = repos.meetups.list('host')[0];
  assert.deepEqual(summary.scope, { connectionId });
  assert.equal(summary.scopeLabel, 'Purple crew + Encore crew');
  assert.equal(summary.returnPath, `/groups/connections/${connectionId}/channel`);
  assert.equal(summary.approvalCount, 1); assert.equal(summary.requiredApprovalCount, 2);
  assert.equal(summary.hasApproved, true); assert.equal(summary.capabilities.canApprove, false);
  assert.equal(repos.meetups.detail('host', id).capabilities.canApprove, false);
  assert.equal(repos.meetups.list('otherHost')[0].capabilities.canApprove, true);
  assert.equal(repos.meetups.list('member')[0].capabilities.canApprove, false);
  assert.equal(repos.meetups.approve('host', id, proposal.version).confirmed, false, 'HTTP/API retry remains harmless');
  repos.meetups.approve('otherHost', id, proposal.version);
  assert.equal(repos.meetups.list('member')[0].status, 'confirmed');
  repos.meetups.reopen('host', id, proposal.version);
  assert.equal(repos.meetups.list('host')[0].hasApproved, false);
});

test('meetup notifications link to the relevant stage without duplicate retry notifications', t => {
  const { db, repos } = fixture(t), { id } = repos.meetups.create('host', input);
  const note = suffix => db.prepare('SELECT resource_path FROM notifications WHERE event_key=?').get(`meetup:${id}:${suffix}`)?.resource_path;
  assert.equal(note('created'), `/meetups/${id}#meetup-availability`);
  const placeId = repos.meetups.place('host', id, place).id;
  assert.equal(note('place:2'), `/meetups/${id}#meetup-places`);
  repos.meetups.place('host', id, place);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM notifications WHERE event_key LIKE ?").get(`meetup:${id}:place:%`).n, 1);
  const proposal = repos.meetups.propose('host', id, { version: 2, placeId, startsAt });
  assert.equal(proposal.confirmed, true);
  assert.equal(note(`proposal:${proposal.version}`), undefined, 'a sole organizer does not leave a redundant approval notification');
  assert.equal(note(`confirmed:${proposal.version}`), `/meetups/${id}#meetup-review`);
  const reopened = repos.meetups.reopen('host', id, proposal.version);
  assert.equal(note(`reopened:${reopened.version}`), `/meetups/${id}#meetup-availability`);
});

test('simultaneous creation requests commit one board, one notification and one live invalidation', async t => {
  const { db, repos } = fixture(t), app = express(), events = [];
  app.use(express.json());
  app.use((req, res, next) => { if (req.headers['x-test-user']) req.user = { id: req.headers['x-test-user'] }; next(); });
  const requireUser = (req, res, next) => req.user ? next() : res.status(401).json({ error: 'authentication_required' });
  registerCommunityRoutes(app, { db, repos, requireUser, requireOperator: requireUser,
    realtime: { emitTo: (ids, type, payload) => events.push({ ids, type, payload }) } });
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const responses = await Promise.all(Array.from({ length: 5 }, () => fetch(`http://127.0.0.1:${server.address().port}/meetups`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-test-user': 'host' }, body: JSON.stringify(input),
  })));
  assert.ok(responses.every(response => response.status === 200));
  const bodies = await Promise.all(responses.map(response => response.json()));
  assert.equal(new Set(bodies.map(body => body.meetup.id)).size, 1);
  assert.equal(bodies.filter(body => body.meetup.reused).length, 4);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM meetups').get().n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM notifications WHERE category='meetup'").get().n, 1);
  assert.equal(events.length, 1);
});

test('legacy weather reads reauthorize the caller and reject stale selections after awaited provider responses', async t => {
  const { db, repos } = fixture(t), app = express();
  const { id } = repos.meetups.create('host', input);
  const placeId = repos.meetups.place('host', id, place).id;
  const proposal = repos.meetups.propose('host', id, { version: 2, startsAt, placeId });
  let entered, finish, calls = 0;
  const weather = { forecast: () => { calls++; entered(); return new Promise(resolve => { finish = resolve; }); } };
  app.use((req, res, next) => { if (req.headers['x-test-user']) req.user = { id: req.headers['x-test-user'] }; next(); });
  const requireUser = (req, res, next) => req.user ? next() : res.status(401).json({ error: 'authentication_required' });
  registerCommunityRoutes(app, { db, repos, requireUser, requireOperator: requireUser, weather });
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const url = `http://127.0.0.1:${server.address().port}/meetups/${id}/weather`;
  const run = async (user, change) => {
    const started = new Promise(resolve => { entered = resolve; });
    const pending = fetch(url, { headers: { 'x-test-user': user } });
    await started;
    change(); finish({ status: 'available', forecast: 'Fair' });
    return pending;
  };
  const departed = await run('member', () => repos.membership.leave('member', 'p1'));
  assert.equal(departed.status, 404); assert.equal((await departed.json()).error, 'meetup_not_found');
  const stale = await run('host', () => repos.meetups.reopen('host', id, proposal.version));
  assert.equal(stale.status, 409); assert.equal((await stale.json()).error, 'stale_meetup_version');
  assert.equal((await fetch(url, { headers: { 'x-test-user': 'outsider' } })).status, 404);
  assert.equal(calls, 2, 'outsiders are rejected before the provider is called');
});
