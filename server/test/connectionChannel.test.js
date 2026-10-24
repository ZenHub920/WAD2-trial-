import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createECDH } from 'node:crypto';
import { createTestDb } from '../src/db/connection.js';
import { createApp } from '../src/app.js';
import { migrateConnectionChannels, connectionChannelPath } from '../src/db/connectionChannelRepository.js';
import { createDeliveryService } from '../src/services/delivery.js';
import { makeUser, makeParty } from './helpers.js';

let db, repos, app, server, base, cookies, ids, connectionId;
beforeEach(async () => {
  db = createTestDb();
  app = createApp({ db }); repos = app.repos;
  server = app.app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}/api`;
  cookies = {}; ids = {};
  for (const who of ['hostA', 'hostB', 'friendA', 'friendB', 'outsider']) {
    const response = await call('/auth/register', null, 'POST', {
      display_name: who, email: `${who}@connection-chat.test`, password: 'test-password',
      age_band: '21-24', home_region: 'central', gender: 'f', vibe: makeUser(who).vibe,
    });
    assert.equal(response.status, 201);
    cookies[who] = response.cookie; ids[who] = response.body.user.id;
  }
  repos.concerts.create({ id: 'c1', artist: 'Artist', venue: 'Hall', city: 'Singapore', event_date: '2030-01-01' });
  for (const [party, host, friend] of [['pA', 'hostA', 'friendA'], ['pB', 'hostB', 'friendB']]) {
    repos.parties.create(makeParty(party, makeUser(ids[host]), { capacity: 2 }));
    repos.membership.configure(ids[host], party, { expectedFriends: 1 });
    repos.membership.acceptInvite(ids[friend], repos.membership.invite(ids[host], party).token);
    for (const who of [host, friend]) repos.membership.saveAnswers(ids[who], party, {});
    repos.membership.publish(ids[host], party, { connectOpen: true });
  }
  connectionId = repos.groups.invite(ids.hostA, 'pA', 'pB').id;
});
afterEach(async () => { await new Promise((resolve) => server.close(resolve)); db.close(); });
async function call(path, who, method = 'GET', body) {
  const response = await fetch(base + path, { method,
    headers: { 'content-type': 'application/json', ...(cookies?.[who] ? { cookie: cookies[who] } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, headers: response.headers, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
const path = () => `/connection-channels/${connectionId}`;
const accept = () => repos.groups.respond(ids.hostB, connectionId, 'accept');
const send = (who = 'hostA', body = 'Hello both groups', extra = {}) => call(`${path()}/messages`, who, 'POST', { body, ...extra });

test('accepting a connection exposes one shared room automatically to both hosts and all active members', async () => {
  assert.equal((await call(path(), null)).status, 401);
  assert.equal((await call(path(), 'hostA')).status, 404);
  assert.deepEqual((await call('/me/connection-channels', 'friendA')).body.channels, []);
  const openedEvents = [];
  for (const who of ['hostA', 'hostB', 'friendA', 'friendB']) app.realtime.subscribe(ids[who], (type, payload) => openedEvents.push({ who, type, payload }));
  assert.equal((await call(`/group-connections/${connectionId}/respond`, 'hostB', 'POST', { action: 'accept' })).body.connection.status, 'accepted');
  for (const who of ['hostA', 'hostB', 'friendA', 'friendB']) assert.ok(openedEvents.some((event) => event.who === who && event.type === 'connection-members' && event.payload.connectionId === connectionId));
  for (const who of ['hostA', 'hostB', 'friendA', 'friendB']) {
    const opened = await call(path(), who);
    assert.equal(opened.status, 200);
    assert.equal(opened.headers.get('cache-control'), 'private, no-store');
    assert.equal(opened.body.channel.connectionId, connectionId);
    assert.equal(opened.body.channel.members.length, 4);
    assert.equal(opened.body.channel.members.filter((person) => person.isHost).length, 2);
    assert.equal(opened.body.channel.isHost, who.startsWith('host'));
    assert.equal((await call('/me/connection-channels', who)).body.channels.length, 1);
  }
  assert.equal((await call(path(), 'outsider')).status, 404);
  assert.equal((await call('/me/group-channels', 'friendA')).body.channels.length, 0, 'shared connection chat must not change the host-managed single-group room');
  assert.equal(repos.membership.active(ids.friendA, 'c1').party_id, 'pA');
  assert.equal(repos.membership.active(ids.friendB, 'c1').party_id, 'pB');
  const board = repos.meetups.create(ids.friendA, { connectionId, title: 'Meet both groups', startsAt: '2030-01-01T10:00:00+08:00', endsAt: '2030-01-01T11:00:00+08:00' });
  assert.equal(repos.meetups.detail(ids.friendB, board.id).participantCount, 4);
});

test('a newly joined friend appears automatically and both old members and the newcomer receive membership invalidation', async () => {
  accept();
  assert.equal((await call('/me/connection-channels', 'outsider')).body.channels.length, 0);
  const events = [];
  for (const who of ['hostA', 'outsider']) app.realtime.subscribe(ids[who], (type, payload) => events.push({ who, type, payload }));
  repos.membership.configure(ids.hostA, 'pA', { expectedFriends: 2, strangerPlaces: 2 });
  repos.membership.savePreferences(ids.outsider, { about: ['supper'] });
  const invitation = repos.membership.invite(ids.hostA, 'pA');
  const response = await call(`/group-friend-invites/${invitation.token}/accept`, 'outsider', 'POST');
  assert.equal(response.status, 200);
  assert.equal((await call(path(), 'outsider')).body.channel.members.length, 5);
  for (const who of ['hostA', 'outsider']) assert.ok(events.some((event) => event.who === who && event.type === 'connection-members' && event.payload.connectionId === connectionId));
  await send('hostA', 'Welcome to both groups');
  assert.equal((await call('/connection-channels/unread', 'outsider')).body.total, 1);
});

test('messages use session identity, notify the whole shared room, persist unread state and expose read receipts', async () => {
  accept();
  const emitted = [];
  const dispose = app.realtime.subscribe(ids.friendB, (type, payload) => emitted.push({ type, payload }));
  const response = await send('friendA', 'Meet us at the entrance', { senderId: ids.outsider, userId: ids.hostB });
  assert.equal(response.status, 200);
  const message = response.body.message;
  assert.equal(message.sender.id, ids.friendA);
  assert.equal(message.mine, true);
  assert.ok(emitted.some((event) => event.type === 'connection-message' && event.payload.connectionId === connectionId && event.payload.messageId === message.id));
  assert.equal((await call('/connection-channels/unread', 'friendB')).body.total, 1);
  const unread = (await call('/me/connection-channels', 'friendB')).body.channels[0];
  assert.equal(unread.unread, 1);
  assert.equal(unread.lastMessage.body, 'Meet us at the entrance');
  for (const who of ['hostA', 'hostB', 'friendB']) assert.equal(db.prepare("SELECT COUNT(*) n FROM notifications WHERE user_id=? AND category='chat' AND resource_path=?").get(ids[who], connectionChannelPath(connectionId)).n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM notifications WHERE user_id=? AND category='chat'").get(ids.friendA).n, 0);
  await call(path(), 'friendB');
  assert.equal((await call('/connection-channels/unread', 'friendB')).body.total, 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM notifications WHERE user_id=? AND category='chat'").get(ids.friendB).n, 0);
  assert.ok(emitted.some((event) => event.type === 'connection-read' && event.payload.readerId === ids.friendB));
  const hydrated = await call(`${path()}/messages/${message.id}`, 'friendA');
  assert.ok(hydrated.body.message.readBy.some((person) => person.id === ids.friendB));
  assert.doesNotMatch(JSON.stringify(hydrated.body), /@connection-chat.test|password_hash|email/);
  dispose();
});

test('only message authors edit or delete, replies stay scoped and tombstones redact quoted text', async () => {
  accept();
  const first = (await send('hostA', 'Original')).body.message;
  assert.equal((await call(`${path()}/messages/${first.id}`, 'friendB', 'PATCH', { body: 'Impersonated' })).status, 403);
  assert.equal((await call(`${path()}/messages/${first.id}`, 'hostB', 'DELETE')).status, 403);
  const edited = await call(`${path()}/messages/${first.id}`, 'hostA', 'PATCH', { body: 'Updated' });
  assert.equal(edited.body.message.body, 'Updated');
  assert.ok(edited.body.message.editedAt);
  const reply = (await send('friendB', 'Agreed', { replyTo: first.id })).body.message;
  assert.equal(reply.replyTo.id, first.id);
  assert.equal(reply.replyTo.body, 'Updated');
  assert.equal((await send('friendA', 'Bad quote', { replyTo: 'unknown' })).status, 400);
  assert.equal((await call(`${path()}/messages/${first.id}`, 'hostA', 'DELETE')).status, 200);
  const tombstone = (await call(`${path()}/messages/${first.id}`, 'friendA')).body.message;
  assert.equal(tombstone.deleted, true); assert.equal(tombstone.body, null);
  const quoted = (await call(`${path()}/messages/${reply.id}`, 'hostB')).body.message.replyTo;
  assert.equal(quoted.deleted, true); assert.equal(quoted.body, null);
  assert.equal((await call(`${path()}/messages/${first.id}`, 'hostA', 'PATCH', { body: 'Restore' })).status, 409);
  assert.equal((await call(`${path()}/messages/${first.id}`, 'outsider')).status, 404);
});

test('backgrounds remain personal and invalid content or cursors do not mutate chat history', async () => {
  accept();
  assert.equal((await call(`${path()}/background`, 'friendA', 'PUT', { background: 'dusk' })).status, 200);
  assert.equal((await call(path(), 'friendA')).body.channel.background, 'dusk');
  assert.equal((await call(path(), 'friendB')).body.channel.background, 'default');
  assert.equal((await call(`${path()}/background`, 'friendA', 'PUT', { background: 'url(https://outside.test)' })).status, 400);
  assert.equal((await send('hostA', ' ')).status, 400);
  assert.equal((await send('hostA', 'a'.repeat(2001))).status, 400);
  const idsInOrder = [];
  for (let i = 0; i < 4; i++) idsInOrder.push((await send('hostA', `Message ${i}`)).body.message.id);
  const latest = (await call(`${path()}?limit=2`, 'friendA')).body.channel;
  assert.deepEqual(latest.messages.map((message) => message.id), idsInOrder.slice(2));
  const older = (await call(`${path()}?limit=2&before=${latest.page.nextCursor}`, 'friendA')).body.channel;
  assert.deepEqual(older.messages.map((message) => message.id), idsInOrder.slice(0, 2));
  assert.equal((await call(`${path()}?after=unknown`, 'friendA')).status, 400);
  migrateConnectionChannels(db); migrateConnectionChannels(db);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM connection_channel_messages').get().n, 4);
  assert.deepEqual(db.pragma('foreign_key_check'), []);
});

test('leaving a group revokes shared-room access, unread counts and future notifications without deleting history', async () => {
  accept(); await send();
  await call(path(), 'friendB');
  const events = [];
  app.realtime.subscribe(ids.friendB, (type, payload) => events.push({ type, payload }));
  assert.equal((await call('/groups/pB/leave', 'friendB', 'POST')).status, 200);
  assert.ok(events.some((event) => event.type === 'connection-members' && event.payload.connectionId === connectionId));
  assert.equal((await call(path(), 'friendB')).status, 404);
  assert.equal((await send('friendB')).status, 404);
  assert.equal((await call('/connection-channels/unread', 'friendB')).body.total, 0);
  assert.equal((await call('/me/connection-channels', 'friendB')).body.channels.length, 0);
  await send('hostA', 'Still meeting');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM notifications WHERE user_id=? AND category='chat'").get(ids.friendB).n, 0);
  assert.equal((await call(path(), 'hostA')).body.channel.members.length, 3);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM connection_channel_messages').get().n, 2);
});

test('messages and cursors from another connection cannot be quoted or inspected across rooms', async () => {
  accept();
  repos.concerts.create({ id: 'c2', artist: 'Other artist', venue: 'Other hall', city: 'Singapore', event_date: '2030-02-01' });
  for (const [party, host] of [['pC', 'hostA'], ['pD', 'hostB']]) {
    repos.parties.create(makeParty(party, makeUser(ids[host]), { concert_id: 'c2' }));
    repos.membership.configure(ids[host], party, {});
    repos.membership.saveAnswers(ids[host], party, {});
    repos.membership.publish(ids[host], party, { connectOpen: true });
  }
  const other = repos.groups.invite(ids.hostA, 'pC', 'pD');
  repos.groups.respond(ids.hostB, other.id, 'accept');
  const privateMessage = repos.connectionChannels.send(other.id, ids.hostA, 'Other room secret');
  assert.equal((await call(`${path()}/messages/${privateMessage.id}`, 'friendA')).status, 404);
  assert.equal((await send('friendA', 'Quote forbidden', { replyTo: privateMessage.id })).status, 400);
  assert.equal((await call(`${path()}?after=${privateMessage.id}`, 'friendA')).status, 400);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM connection_channel_messages WHERE connection_id=?').get(connectionId).n, 0);
});

for (const cause of ['block', 'cancelled group', 'ticket inventory', 'revoked connection']) test(`${cause} closes shared-room access for both groups`, async () => {
  accept(); await send();
  if (cause === 'block') repos.users.block(ids.friendA, ids.friendB);
  if (cause === 'cancelled group') repos.membership.cancel(ids.hostB, 'pB');
  if (cause === 'ticket inventory') db.prepare("INSERT INTO tickets(id,seller_user_id,concert_id,price_cents,quantity,section,source_party_id) VALUES('legacy-ticket',?,'c1',100,1,'pit','pB')").run(ids.hostB);
  if (cause === 'revoked connection') db.prepare("UPDATE group_connections SET status='declined' WHERE id=?").run(connectionId);
  for (const who of ['hostA', 'hostB', 'friendA', 'friendB']) {
    assert.equal((await call(path(), who)).status, 404);
    assert.equal((await call('/me/connection-channels', who)).body.channels.length, 0);
  }
});

test('failed notifications roll back message persistence and read-state creation atomically', () => {
  accept();
  const original = repos.notifications.chatMessage;
  repos.notifications.chatMessage = () => { throw new Error('notification_write_failed'); };
  try { assert.throws(() => repos.connectionChannels.send(connectionId, ids.hostA, 'Must roll back'), /notification_write_failed/); }
  finally { repos.notifications.chatMessage = original; }
  assert.equal(db.prepare('SELECT COUNT(*) n FROM connection_channel_messages').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM connection_channel_members').get().n, 0);
});

for (const cause of ['departure', 'block', 'suspension', 'group cancellation']) test(`queued connection-chat push is suppressed after recipient ${cause}`, async () => {
  accept();
  const receiver = createECDH('prime256v1'); receiver.generateKeys();
  let pushes = 0;
  const worker = createDeliveryService({ db, repos, env: { VAPID_PUBLIC_KEY: 'public', VAPID_PRIVATE_KEY: 'private', VAPID_SUBJECT: 'mailto:test@example.org' }, logger: { warn() {} }, webPush: { sendNotification: async () => { pushes++; } } });
  const subscription = worker.subscribe(ids.friendB, { endpoint: 'https://fcm.googleapis.com/fcm/send/connection-test', keys: { p256dh: receiver.getPublicKey().toString('base64url'), auth: Buffer.alloc(16, 7).toString('base64url') } });
  repos.connectionChannels.send(connectionId, ids.hostA, 'Private message body');
  const notification = db.prepare("SELECT id FROM notifications WHERE user_id=? AND category='chat'").get(ids.friendB);
  assert.ok(worker.notification(ids.friendB, notification.id, subscription.id));
  assert.equal(db.prepare("SELECT COUNT(*) n FROM background_jobs WHERE type='notification.push'").get().n, 1);
  assert.doesNotMatch(db.prepare("SELECT payload_json FROM background_jobs WHERE type='notification.push'").get().payload_json, /Private message body|friendB|hostA/);
  if (cause === 'departure') repos.membership.leave(ids.friendB, 'pB');
  if (cause === 'block') repos.users.block(ids.friendB, ids.hostA);
  if (cause === 'suspension') db.prepare("UPDATE account_security SET suspended_at=datetime('now') WHERE user_id=?").run(ids.friendB);
  if (cause === 'group cancellation') repos.membership.cancel(ids.hostB, 'pB');
  assert.equal(worker.notification(ids.friendB, notification.id, subscription.id), null);
  await worker.runOnce();
  assert.equal(pushes, 0);
  await worker.stop();
});
