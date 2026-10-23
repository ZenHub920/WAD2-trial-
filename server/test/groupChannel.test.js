/**
 * Group channels: the host chooses who is in the room, from the people the
 * group already accepted, and a member may leave it without leaving the group.
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../src/db/connection.js';
import { createApp } from '../src/app.js';
import { migrateGroupChannels } from '../src/db/groupChannelRepository.js';

let db, repos, server, base, cookies;

beforeEach(async () => {
  db = createTestDb();
  const app = createApp({ db });
  ({ repos } = app);
  server = app.app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}/api`;
  cookies = {};
  for (const name of ['host', 'member', 'other', 'stranger']) {
    const r = await call('/auth/register', null, 'POST', {
      display_name: name, email: `${name}@test.example`, password: 'test-password',
      age_band: '21-24', home_region: 'central', gender: 'f',
      vibe: { singalong: 3, photography: 3, dancing: 3, quiet: 3, queue_early: 3, merch: 3 },
    });
    assert.equal(r.status, 201, `register ${name}`);
    cookies[name] = r.cookie;
    cookies[`${name}Id`] = r.body.user.id;
  }
  repos.concerts.create({ id: 'c1', artist: 'Artist', venue: 'Hall', city: 'Singapore', event_date: '2027-05-01' });
  repos.parties.create({
    id: 'p1', host_user_id: cookies.hostId, concert_id: 'c1', capacity: 4,
    section: 'ga_standing', spend_band: 2, arrival_plan: 'mid', plans: {},
    vibe: { singalong: 3, photography: 3, dancing: 3, quiet: 3, queue_early: 3, merch: 3 },
  });
  // Accepted into the GROUP — eligibility only, not the channel. 'friend' is
  // the invite path; 'join' would need a confirmed seat claim to exist first,
  // which is the matching flow and not what this file is about.
  for (const who of ['member', 'other']) {
    db.prepare(`INSERT INTO group_memberships (party_id, user_id, concert_id, source, status)
                VALUES ('p1', ?, 'c1', 'friend', 'active')`).run(cookies[`${who}Id`]);
  }
});
afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  db.close();
});

async function call(path, who, method = 'GET', body) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(cookies?.[who] ? { cookie: cookies[who] } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const parsed = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  return { status: res.status, body: parsed, cookie: res.headers.get('set-cookie')?.split(';')[0] };
}

test('the host is in their own room and accepted members are not, until added', async () => {
  const mine = await call('/me/group-channels', 'host');
  assert.equal(mine.status, 200);
  assert.equal(mine.body.channels.length, 1, 'the host sees their room without being added');
  assert.equal(mine.body.channels[0].partyId, 'p1');

  // Accepted into the group, but the room is not theirs to see yet.
  assert.deepEqual((await call('/me/group-channels', 'member')).body.channels, []);
  assert.equal((await call('/group-channels/p1', 'member')).status, 404,
    'a non-member gets 404, not 403, so party ids cannot be probed');
  assert.equal((await call('/group-channels/p1', 'stranger')).status, 404);
});

test('only the host adds, and only people the group already accepted', async () => {
  // Candidates are exactly the accepted members who are not in the room.
  const candidates = await call('/group-channels/p1/candidates', 'host');
  assert.equal(candidates.status, 200);
  assert.deepEqual(candidates.body.candidates.map((c) => c.displayName).sort(), ['member', 'other']);

  assert.equal((await call('/group-channels/p1/candidates', 'member')).status, 403);
  assert.equal((await call('/group-channels/p1/members', 'member', 'POST', { userId: cookies.otherId })).status, 403,
    'a member cannot add anybody');
  assert.equal((await call('/group-channels/p1/members', 'member', 'POST', { userId: cookies.memberId })).status, 403,
    'nobody adds themselves');
  assert.equal((await call('/group-channels/p1/members', 'host', 'POST', { userId: cookies.strangerId })).status, 409,
    'somebody the group never accepted cannot be added');

  const added = await call('/group-channels/p1/members', 'host', 'POST', { userId: cookies.memberId });
  assert.equal(added.status, 200);
  assert.deepEqual(added.body.members.map((m) => m.displayName), ['host', 'member']);
  assert.equal((await call('/group-channels/p1/members', 'host', 'POST', { userId: cookies.memberId })).status, 409,
    'adding twice is refused');

  // Added, so now they see it.
  assert.equal((await call('/me/group-channels', 'member')).body.channels.length, 1);
  assert.equal((await call('/group-channels/p1', 'member')).status, 200);
  // And they drop off the candidate list.
  assert.deepEqual((await call('/group-channels/p1/candidates', 'host')).body.candidates.map((c) => c.displayName), ['other']);
});

test('members talk, and only members read or write', async () => {
  await call('/group-channels/p1/members', 'host', 'POST', { userId: cookies.memberId });

  assert.equal((await call('/group-channels/p1/messages', 'other', 'POST', { body: 'let me in' })).status, 404,
    'someone outside the room cannot write into it');
  assert.equal((await call('/group-channels/p1/messages', 'host', 'POST', { body: '   ' })).status, 400);

  const sent = await call('/group-channels/p1/messages', 'host', 'POST', { body: 'Meeting at gate 3.' });
  assert.equal(sent.status, 200);
  assert.equal(sent.body.message.body, 'Meeting at gate 3.');

  const seen = await call('/group-channels/p1', 'member');
  assert.equal(seen.body.channel.messages.length, 1);
  assert.equal(seen.body.channel.messages[0].sender.displayName, 'host');
  assert.equal(seen.body.channel.messages[0].mine, false);
  assert.equal(seen.body.channel.isHost, false);
  assert.equal((await call('/group-channels/p1', 'host')).body.channel.isHost, true);

  // Only your own messages, and the thread keeps its shape.
  const id = sent.body.message.id;
  assert.equal((await call(`/group-channels/p1/messages/${id}`, 'member', 'DELETE')).status, 403);
  assert.equal((await call(`/group-channels/p1/messages/${id}`, 'host', 'DELETE')).status, 200);
  const after = (await call('/group-channels/p1', 'member')).body.channel.messages;
  assert.equal(after.length, 1);
  assert.equal(after[0].deleted, true);
  assert.equal(after[0].body, null);
});

test('unread counts rooms, not messages, and opening clears it', async () => {
  await call('/group-channels/p1/members', 'host', 'POST', { userId: cookies.memberId });
  for (const body of ['one', 'two', 'three']) {
    await call('/group-channels/p1/messages', 'host', 'POST', { body });
  }
  assert.equal((await call('/group-channels/unread', 'member')).body.total, 1,
    'three messages in one room are one room waiting');
  assert.equal((await call('/group-channels/unread', 'host')).body.total, 0,
    'your own messages are never unread to you');
  assert.equal((await call('/me/group-channels', 'member')).body.channels[0].unread, 3,
    'inside the list the count is still messages');

  await call('/group-channels/p1', 'member');
  assert.equal((await call('/group-channels/unread', 'member')).body.total, 0);
});

test('leaving the channel is not leaving the group, and the host cannot leave', async () => {
  await call('/group-channels/p1/members', 'host', 'POST', { userId: cookies.memberId });
  assert.equal((await call('/group-channels/p1/members/me', 'host', 'DELETE')).status, 409,
    'the host would strand their own room');

  assert.equal((await call('/group-channels/p1/members/me', 'member', 'DELETE')).status, 200);
  assert.deepEqual((await call('/me/group-channels', 'member')).body.channels, []);
  assert.equal((await call('/group-channels/p1', 'member')).status, 404);
  assert.equal((await call('/group-channels/p1/messages', 'member', 'POST', { body: 'still here?' })).status, 404);

  // The group membership itself is untouched: they are still going.
  assert.equal(db.prepare(`SELECT status FROM group_memberships WHERE party_id='p1' AND user_id=?`)
    .get(cookies.memberId).status, 'active');
  // So the host can invite them back.
  assert.deepEqual((await call('/group-channels/p1/candidates', 'host')).body.candidates.map((c) => c.displayName).sort(),
    ['member', 'other']);
  assert.equal((await call('/group-channels/p1/members', 'host', 'POST', { userId: cookies.memberId })).status, 200);
});

test('a group message notifies the room once, named, and not the sender', async () => {
  await call('/group-channels/p1/members', 'host', 'POST', { userId: cookies.memberId });
  for (const body of ['first', 'second']) {
    await call('/group-channels/p1/messages', 'host', 'POST', { body });
  }
  const inbox = (await call('/me/notifications', 'member')).body.notifications
    .filter((n) => n.path === '/groups/p1/channel');
  assert.equal(inbox.length, 1, 'two messages in one room are one notification');
  assert.equal(inbox[0].title, 'Message from host');
  assert.equal((await call('/me/notifications', 'host')).body.notifications
    .filter((n) => n.path === '/groups/p1/channel').length, 0);

  // Opening the room clears it, as with every other chat notification.
  await call('/group-channels/p1', 'member');
  assert.equal((await call('/me/notifications', 'member')).body.notifications
    .filter((n) => n.path === '/groups/p1/channel').length, 0);
});

test('leaving the group revokes channel access and requires a new host grant after rejoining', async () => {
  await call('/group-channels/p1/members', 'host', 'POST', { userId: cookies.memberId });
  await call('/group-channels/p1/messages', 'host', 'POST', { body: 'Before leaving' });
  db.prepare("UPDATE group_memberships SET status='left' WHERE party_id='p1' AND user_id=?")
    .run(cookies.memberId);
  assert.equal((await call('/group-channels/p1', 'member')).status, 404);
  assert.equal((await call('/group-channels/p1/messages', 'member', 'POST', { body: 'Stale tab' })).status, 404);
  assert.deepEqual((await call('/me/group-channels', 'member')).body.channels, []);
  assert.equal((await call('/group-channels/unread', 'member')).body.total, 0);
  assert.equal(repos.groupChannels.memberIds('p1').includes(cookies.memberId), false);
  assert.deepEqual((await call('/group-channels/p1', 'host')).body.channel.members.map((m) => m.displayName), ['host']);

  db.prepare("UPDATE group_memberships SET status='active' WHERE party_id='p1' AND user_id=?")
    .run(cookies.memberId);
  assert.equal((await call('/group-channels/p1', 'member')).status, 404);
  assert.equal((await call('/group-channels/p1/members', 'host', 'POST', { userId: cookies.memberId })).status, 200);
  db.prepare("DELETE FROM group_memberships WHERE party_id='p1' AND user_id=?").run(cookies.memberId);
  assert.equal((await call('/group-channels/p1', 'member')).status, 404);
});

test('cancelling a group removes its channel and prevents the host from reopening it', async () => {
  await call('/group-channels/p1/members', 'host', 'POST', { userId: cookies.memberId });
  await call('/group-channels/p1/messages', 'host', 'POST', { body: 'Old plan' });
  db.prepare("UPDATE parties SET status='cancelled' WHERE id='p1'").run();
  for (const who of ['host', 'member']) {
    assert.deepEqual((await call('/me/group-channels', who)).body.channels, []);
    assert.equal((await call('/group-channels/unread', who)).body.total, 0);
    assert.equal((await call('/group-channels/p1', who)).status, 404);
    assert.equal((await call('/group-channels/p1/messages', who, 'POST', { body: 'Stale plan' })).status, 404);
  }
  assert.equal((await call('/group-channels/p1/candidates', 'host')).status, 404);
  assert.equal((await call('/group-channels/p1/members', 'host', 'POST', { userId: cookies.otherId })).status, 404);
  assert.deepEqual(repos.groupChannels.memberIds('p1'), []);
});

test('channel migration clears legacy grants without removing eligible members or history', async () => {
  await call('/group-channels/p1/members', 'host', 'POST', { userId: cookies.memberId });
  await call('/group-channels/p1/messages', 'host', 'POST', { body: 'Keep history' });
  db.prepare("INSERT INTO group_channel_members(party_id,user_id) VALUES('p1',?)").run(cookies.strangerId);
  migrateGroupChannels(db);
  migrateGroupChannels(db);
  assert.deepEqual(repos.groupChannels.memberIds('p1').sort(), [cookies.hostId, cookies.memberId].sort());
  assert.equal((await call('/group-channels/p1', 'member')).body.channel.messages[0].body, 'Keep history');
});

test('replying in a channel clears the sender notification and rearms the next message', async () => {
  await call('/group-channels/p1/members', 'host', 'POST', { userId: cookies.memberId });
  await call('/group-channels/p1/messages', 'host', 'POST', { body: 'Question' });
  assert.equal(repos.notifications.unread(cookies.memberId), 1);
  await call('/group-channels/p1/messages', 'member', 'POST', { body: 'Answer' });
  assert.equal((await call('/group-channels/unread', 'member')).body.total, 0);
  assert.equal(repos.notifications.unread(cookies.memberId), 0);
  await call('/group-channels/p1/messages', 'host', 'POST', { body: 'Next question' });
  assert.equal(repos.notifications.unread(cookies.memberId), 1);
});
