import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createApp } from '../../server/src/app.js';
import { createTestDb } from '../../server/src/db/connection.js';
import { makeUser, makeParty } from './helpers.js';

const startsAt = '2030-01-01T10:00:00+08:00';
const endsAt = '2030-01-01T11:00:00+08:00';

async function fixture(t) {
  const db = createTestDb();
  const application = createApp({ db, env: { NODE_ENV: 'test' } });
  const { repos, realtime } = application;
  const names = ['hostA', 'hostB', 'friendA', 'friendB', 'outsider', 'kakiA', 'kakiB'];
  const cookies = {};
  const events = [];
  names.forEach((name, index) => {
    repos.users.create(makeUser(name));
    repos.membership.savePreferences(name, { about: ['supper'], wants: ['supper'], avoid: [] });
    const token = (index + 1).toString(16).padStart(64, '0');
    repos.sessions.create(createHash('sha256').update(token).digest('hex'), name, Date.now() + 3600000);
    cookies[name] = `encore_session=${token}`;
    realtime.subscribe(name, (type, payload) => {
      if (type !== 'meetup-updated') return;
      const committed = db.prepare('SELECT version,status FROM meetups WHERE id=?').get(payload.meetupId);
      events.push({ recipient: name, payload, committed });
    });
  });
  repos.concerts.create({ id: 'c1', artist: 'Test artist', venue: 'Hall', city: 'Singapore', event_date: '2030-01-01' });
  for (const [party, host, friend] of [['pA', 'hostA', 'friendA'], ['pB', 'hostB', 'friendB']]) {
    repos.parties.create(makeParty(party, makeUser(host), { capacity: 2 }));
    repos.membership.configure(host, party, { expectedFriends: 1 });
    repos.membership.acceptInvite(friend, repos.membership.invite(host, party).token);
    repos.membership.saveAnswers(host, party, {});
    repos.membership.saveAnswers(friend, party, {});
    repos.membership.publish(host, party, { connectOpen: true });
  }
  const connection = repos.groups.invite('hostA', 'pA', 'pB');
  repos.groups.respond('hostB', connection.id, 'accept');
  const server = application.app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    db.close();
  });
  async function call(path, user, method = 'GET', body) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method, headers: { 'content-type': 'application/json', 'X-Requested-With': 'Encore', ...(cookies[user] ? { cookie: cookies[user] } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() };
  }
  return { db, repos, events, call, connectionId: connection.id };
}

test('availability versions reject stale writes atomically and chat entry scopes list only their own plans', async t => {
  const { repos, call, events, connectionId } = await fixture(t);
  const group = (await call('/meetups', 'hostA', 'POST', { partyId: 'pA', title: 'Our group plan', startsAt, endsAt })).body.meetup;
  const shared = (await call('/meetups', 'hostA', 'POST', { connectionId, title: 'Shared plan', startsAt, endsAt })).body.meetup;
  assert.deepEqual((await call('/me/meetups?partyId=pA', 'hostA')).body.meetups.map(m => m.id), [group.id]);
  assert.deepEqual((await call(`/me/meetups?connectionId=${connectionId}`, 'friendB')).body.meetups.map(m => m.id), [shared.id]);
  assert.deepEqual((await call('/me/meetups?partyId=pA', 'outsider')).body.meetups, []);
  assert.equal((await call('/me/meetups?partyId=pA&connectionId=other', 'hostA')).status, 400);
  const initial = repos.meetups.detail('hostA', group.id).version;
  const windows = [{ startsAt, endsAt, travelMode: 'drive', latitude: 1.3, longitude: 103.8, label: 'Public station' }];
  assert.equal((await call(`/meetups/${group.id}/availability`, 'hostA', 'PUT', { windows, version: initial })).status, 200);
  const saved = repos.meetups.detail('hostA', group.id);
  events.length = 0;
  const stale = await call(`/meetups/${group.id}/availability`, 'hostA', 'PUT', { windows: [], version: initial });
  assert.equal(stale.status, 409); assert.equal(stale.body.error, 'stale_meetup_version');
  assert.deepEqual(repos.meetups.detail('hostA', group.id), saved);
  assert.deepEqual(events, []);
});

test('planner mutations invalidate only current connected-group members after committed writes', async t => {
  const { db, repos, call, events, connectionId } = await fixture(t);
  const recipients = ['friendA', 'friendB', 'hostA', 'hostB'];
  function takeEvents(id) {
    const batch = events.splice(0);
    assert.deepEqual(batch.map(event => event.recipient).sort(), recipients);
    const version = repos.meetups.access('hostA', id).version;
    for (const event of batch) {
      assert.deepEqual(event.payload, { meetupId: id, version });
      assert.equal(event.committed.version, version, 'subscribers must observe committed state');
    }
    assert.doesNotMatch(JSON.stringify(batch), /private-origin|latitude|longitude|actorId|body|title/);
  }
  const created = await call('/meetups', 'hostA', 'POST', { connectionId, title: 'Private title', startsAt, endsAt });
  assert.equal(created.status, 200);
  const id = created.body.meetup.id;
  takeEvents(id);
  const save = await call(`/meetups/${id}/availability`, 'friendA', 'PUT', {
    windows: [{ startsAt, endsAt, latitude: 1.30, longitude: 103.85, label: 'private-origin', travelMode: 'drive' }],
  });
  assert.equal(save.status, 200); takeEvents(id);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM meetup_availability WHERE meetup_id=?').get(id).n, 1);
  const place = await call(`/meetups/${id}/places`, 'friendB', 'POST', { label: 'Public meeting place', latitude: 1.31, longitude: 103.86 });
  assert.equal(place.status, 200); takeEvents(id);
  assert.equal((await call(`/meetups/${id}/vote`, 'friendA', 'PUT', { placeId: place.body.place.id })).status, 200); takeEvents(id);
  const beforeComment = repos.meetups.access('hostA', id).version;
  assert.equal((await call(`/meetups/${id}/comments`, 'friendA', 'POST', { body: 'Private discussion' })).status, 200); takeEvents(id);
  assert.equal(repos.meetups.access('hostA', id).version, beforeComment, 'comments still notify without revising the plan');
  assert.equal((await call(`/meetups/${id}/propose`, 'hostA', 'POST', { placeId: place.body.place.id, startsAt, version: beforeComment })).status, 200); takeEvents(id);
  const version = repos.meetups.access('hostA', id).version;
  const first = await call(`/meetups/${id}/approve`, 'hostA', 'POST', { version });
  assert.equal(first.body.approval.confirmed, false); takeEvents(id);
  const second = await call(`/meetups/${id}/approve`, 'hostB', 'POST', { version });
  assert.equal(second.body.approval.confirmed, true); takeEvents(id);
  assert.equal((await call(`/meetups/${id}/cancel`, 'hostA', 'POST', { version })).status, 200); takeEvents(id);
  assert.equal(repos.meetups.access('hostA', id).status, 'cancelled');
});

test('failed, unauthorized and read-only planner requests emit no invalidation', async t => {
  const { repos, call, events } = await fixture(t);
  const { id } = repos.meetups.create('hostA', { partyId: 'pA', title: 'Test meetup', startsAt, endsAt });
  assert.equal((await call(`/meetups/${id}/availability`, 'friendA', 'PUT', { windows: [{ startsAt, endsAt, travelMode: 'walk' }] })).status, 400);
  assert.equal((await call(`/meetups/${id}/comments`, 'outsider', 'POST', { body: 'Unauthorized' })).status, 404);
  assert.equal((await call(`/meetups/${id}/comments`, null, 'POST', { body: 'Anonymous' })).status, 401);
  assert.equal((await call(`/meetups/${id}`, 'hostA')).status, 200);
  assert.equal((await call(`/meetups/${id}/weather`, 'hostA')).status, 200);
  assert.equal((await call('/me/meetups', 'hostA')).status, 200);
  assert.deepEqual(events, []);
});

test('departed members are excluded from the next planner update', async t => {
  const { repos, call, events, connectionId } = await fixture(t);
  const { id } = repos.meetups.create('hostA', { connectionId, title: 'Test meetup', startsAt, endsAt });
  repos.membership.leave('friendB', 'pB');
  const response = await call(`/meetups/${id}/comments`, 'hostA', 'POST', { body: 'Current participants only' });
  assert.equal(response.status, 200);
  assert.deepEqual(events.map(event => event.recipient).sort(), ['friendA', 'hostA', 'hostB']);
  assert.equal((await call(`/meetups/${id}`, 'friendB')).status, 404);
});

test('a sole hosted-group organizer explicitly confirms on proposal, preserving history and contributions when reopened', async t => {
  const { db, repos, call, events } = await fixture(t);
  const id = (await call('/meetups', 'hostA', 'POST', { partyId: 'pA', title: 'Our final arrangement', startsAt, endsAt })).body.meetup.id;
  const path = `/meetups/${id}`;
  const windows = [{ startsAt, endsAt, travelMode: 'drive', latitude: 1.3, longitude: 103.8, label: 'private starting point' }];
  assert.equal((await call(`${path}/availability`, 'friendA', 'PUT', { windows })).status, 200);
  const placeId = (await call(`${path}/places`, 'friendA', 'POST', { label: 'Public entrance', latitude: 1.31, longitude: 103.86 })).body.place.id;
  assert.equal((await call(`${path}/vote`, 'friendA', 'PUT', { placeId })).status, 200);
  assert.equal((await call(`${path}/comments`, 'friendA', 'POST', { body: 'Meet by the sign.' })).status, 200);
  const before = repos.meetups.detail('hostA', id);
  const input = { version: before.version, placeId, startsAt };
  assert.equal((await call(`${path}/propose`, 'friendA', 'POST', input)).status, 403);
  assert.equal((await call(`${path}/propose`, 'hostA', 'POST', { ...input, version: before.version - 1 })).status, 409);
  events.length = 0;
  const submitted = await call(`${path}/propose`, 'hostA', 'POST', input);
  assert.deepEqual(submitted.body.proposal, { version: before.version + 1, confirmed: true });
  const version = submitted.body.proposal.version;
  const confirmed = (await call(path, 'friendA')).body.meetup;
  assert.equal(confirmed.status, 'confirmed');
  assert.deepEqual(confirmed.requiredApprovers, ['hostA']);
  assert.deepEqual(confirmed.approvals, ['hostA']);
  assert.equal(confirmed.capabilities.canContribute, false);
  assert.equal(confirmed.capabilities.canApprove, false);
  assert.equal(events.length, 2, 'both current members observe one committed invalidation');
  assert.ok(events.every(event => event.committed.status === 'confirmed'));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE event_key=?').get(`meetup:${id}:confirmed:${version}`).n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE event_key=?').get(`meetup:${id}:proposal:${version}`).n, 0);
  assert.equal((await call(`${path}/propose`, 'hostA', 'POST', input)).status, 409);
  assert.equal((await call(`${path}/availability`, 'friendA', 'PUT', { windows: [], version })).status, 409);
  assert.equal((await call(`${path}/places`, 'friendA', 'POST', { label: 'Another place', latitude: 1.32, longitude: 103.87, version })).status, 409);
  assert.equal((await call(`${path}/reopen`, 'friendA', 'POST', { version })).status, 403);
  assert.equal((await call(`${path}/cancel`, 'friendA', 'POST', { version })).status, 403);
  assert.equal((await call(`${path}/comments`, 'friendA', 'POST', { body: 'Could we discuss the entrance?' })).status, 200);
  const reopened = await call(`${path}/reopen`, 'hostA', 'POST', { version });
  assert.equal(reopened.status, 200);
  const fresh = (await call(path, 'friendA')).body.meetup;
  assert.equal(fresh.status, 'planning');
  assert.equal(fresh.selected_start, null); assert.equal(fresh.selected_place_id, null);
  assert.deepEqual(fresh.approvals, []);
  assert.equal(fresh.capabilities.canContribute, true);
  assert.equal(fresh.availability.length, 1);
  assert.equal(fresh.places.length, 1);
  assert.equal(fresh.currentVotePlaceId, placeId);
  assert.equal(fresh.comments.length, 2);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM meetup_approvals WHERE meetup_id=?').get(id).n, 1);
  assert.equal((await call(`${path}/availability`, 'friendA', 'PUT', { windows: [], version: fresh.version })).status, 200);
  const nextVersion = repos.meetups.access('hostA', id).version;
  const next = await call(`${path}/propose`, 'hostA', 'POST', { ...input, version: nextVersion, acknowledgeNoAvailability: true });
  assert.equal(next.body.proposal.confirmed, true);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM meetup_approvals WHERE meetup_id=?').get(id).n, 2);
  assert.equal((await call(`${path}/approve`, 'hostA', 'POST', { version })).status, 409);
});

test('sole-organizer proposal rolls back its approval, selected plan, version and notification together', async t => {
  const { db, repos } = await fixture(t);
  const { id } = repos.meetups.create('hostA', { partyId: 'pA', title: 'Atomic proposal', startsAt, endsAt });
  const placeId = repos.meetups.place('friendA', id, { label: 'Public entrance', latitude: 1.31, longitude: 103.86 }).id;
  const before = repos.meetups.detail('hostA', id);
  db.exec("CREATE TRIGGER fail_solo_confirmation BEFORE INSERT ON notifications WHEN NEW.event_key LIKE '%:confirmed:%' BEGIN SELECT RAISE(ABORT,'confirmation_notification_failed'); END");
  assert.throws(() => repos.meetups.propose('hostA', id, { version: before.version, startsAt, placeId, acknowledgeNoAvailability: true }), /confirmation_notification_failed/);
  assert.deepEqual(repos.meetups.detail('hostA', id), before);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM meetup_approvals WHERE meetup_id=?').get(id).n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM notifications WHERE event_key LIKE ?").get(`meetup:${id}:confirmed:%`).n, 0);
});

test('connected-group proposal withdrawals preserve contributions, invalidate partial approvals and serialize simultaneous approvals', async t => {
  const { db, repos, call, connectionId } = await fixture(t);
  const id = (await call('/meetups', 'hostA', 'POST', { connectionId, title: 'Both groups decide', startsAt, endsAt })).body.meetup.id;
  const path = `/meetups/${id}`;
  assert.equal((await call(`${path}/availability`, 'friendA', 'PUT', { windows: [{ startsAt, endsAt }] })).status, 200);
  const placeId = (await call(`${path}/places`, 'friendB', 'POST', { label: 'Shared entrance', latitude: 1.31, longitude: 103.86 })).body.place.id;
  assert.equal((await call(`${path}/vote`, 'friendA', 'PUT', { placeId })).status, 200);
  const propose = async () => {
    const version = repos.meetups.access('hostA', id).version;
    const result = await call(`${path}/propose`, 'hostA', 'POST', { version, startsAt, placeId, acknowledgeNoAvailability: true });
    assert.equal(result.status, 200); assert.equal(result.body.proposal.confirmed, false);
    return result.body.proposal.version;
  };
  let version = await propose();
  assert.deepEqual((await call(path, 'hostB')).body.meetup.approvals, [], 'proposal does not approve for either host');
  assert.equal((await call(`${path}/approve`, 'friendA', 'POST', { version })).status, 403);
  assert.equal((await call(`${path}/reopen`, 'hostB', 'POST', { version })).status, 200, 'either authorized host can withdraw before any approval');
  version = await propose();
  assert.equal((await call(`${path}/approve`, 'hostA', 'POST', { version })).body.approval.confirmed, false);
  assert.equal((await call(path, 'hostB')).body.meetup.status, 'proposed', 'refresh preserves pending approval');
  assert.equal((await call(`${path}/reopen`, 'hostB', 'POST', { version })).status, 200);
  const reopened = repos.meetups.detail('friendA', id);
  assert.equal(reopened.availability.length, 1); assert.equal(reopened.places.length, 1);
  assert.equal(reopened.currentVotePlaceId, placeId); assert.deepEqual(reopened.approvals, []);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM meetup_approvals WHERE meetup_id=?').get(id).n, 1);
  const staleVersion = version;
  version = await propose();
  assert.equal((await call(`${path}/approve`, 'hostB', 'POST', { version: staleVersion })).status, 409);
  const approvals = await Promise.all(['hostA', 'hostB'].map(user => call(`${path}/approve`, user, 'POST', { version })));
  assert.ok(approvals.every(result => result.status === 200));
  assert.deepEqual(approvals.map(result => result.body.approval.confirmed).sort(), [false, true]);
  assert.equal((await call(path, 'friendB')).body.meetup.status, 'confirmed');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM meetup_approvals WHERE meetup_id=? AND version=?').get(id, version).n, 2);
  assert.equal((await call(`${path}/reopen`, 'hostB', 'POST', { version })).status, 200);
  assert.equal((await call(path, 'hostA')).body.meetup.status, 'planning');
  assert.deepEqual((await call(path, 'hostA')).body.meetup.approvals, []);
});

test('mutual Kaki partners still each approve their own authenticated session and can explicitly reopen', async t => {
  const { repos, call } = await fixture(t);
  for (const user of ['kakiA', 'kakiB']) repos.participation.join(user, 'c1', 'ga_standing', 'doors');
  repos.kaki.setDecision('kakiA', 'c1', 'kakiB', 'like'); repos.kaki.setDecision('kakiB', 'c1', 'kakiA', 'like');
  const kakiConversationId = repos.kakiChat.openFor({ concertId: 'c1', me: 'kakiA', other: 'kakiB' }).id;
  const id = (await call('/meetups', 'kakiA', 'POST', { kakiConversationId, title: 'Our pair meetup', startsAt, endsAt })).body.meetup.id;
  const path = `/meetups/${id}`;
  const placeId = (await call(`${path}/places`, 'kakiB', 'POST', { label: 'Pair entrance', latitude: 1.31, longitude: 103.86 })).body.place.id;
  const version = repos.meetups.access('kakiA', id).version;
  const proposed = await call(`${path}/propose`, 'kakiA', 'POST', { version, startsAt, placeId, acknowledgeNoAvailability: true });
  assert.equal(proposed.body.proposal.confirmed, false);
  const revision = proposed.body.proposal.version;
  const beforeApproval = (await call(path, 'kakiB')).body.meetup;
  assert.deepEqual(beforeApproval.requiredApprovers.sort(), ['kakiA', 'kakiB']);
  assert.deepEqual(beforeApproval.approvals, []);
  assert.equal((await call(`${path}/approve`, 'outsider', 'POST', { version: revision })).status, 404);
  assert.equal((await call(`${path}/approve`, 'kakiA', 'POST', { version: revision })).body.approval.confirmed, false);
  assert.equal((await call(path, 'kakiB')).body.meetup.status, 'proposed');
  assert.equal((await call(`${path}/approve`, 'kakiB', 'POST', { version: revision })).body.approval.confirmed, true);
  assert.equal((await call(`${path}/reopen`, 'kakiB', 'POST', { version: revision })).status, 200);
  const reopened = (await call(path, 'kakiA')).body.meetup;
  assert.equal(reopened.status, 'planning'); assert.deepEqual(reopened.approvals, []);
  assert.equal(reopened.places.length, 1);
});

test('single-group and Kaki planner events keep their own participant scopes', async t => {
  const { repos, call, events } = await fixture(t);
  const group = await call('/meetups', 'hostA', 'POST', { partyId: 'pA', title: 'One group', startsAt, endsAt });
  assert.equal(group.status, 200);
  assert.deepEqual(events.splice(0).map(event => event.recipient).sort(), ['friendA', 'hostA']);
  for (const user of ['kakiA', 'kakiB']) repos.participation.join(user, 'c1', 'pit', 'doors');
  repos.kaki.setDecision('kakiA', 'c1', 'kakiB', 'like');
  repos.kaki.setDecision('kakiB', 'c1', 'kakiA', 'like');
  const conversation = repos.kakiChat.openFor({ concertId: 'c1', me: 'kakiA', other: 'kakiB' });
  const pair = await call('/meetups', 'kakiB', 'POST', { kakiConversationId: conversation.id, title: 'Kaki pair', startsAt, endsAt });
  assert.equal(pair.status, 200);
  assert.deepEqual(events.map(event => event.recipient).sort(), ['kakiA', 'kakiB']);
});
