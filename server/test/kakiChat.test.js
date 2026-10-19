/**
 * Kaki chat.
 *
 * The rules worth protecting are the authorisation ones, so most of this file
 * is about who may NOT do things:
 *   - no chat without a mutual like
 *   - a withdrawn like or a block closes an existing thread, in both directions
 *   - a non-participant gets 404, never 403 (ids must not be probeable)
 *   - edit and delete are sender-only, and delete is a tombstone that keeps
 *     the text for moderation while hiding it from both participants
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createApp } from '../src/app.js';
import { createTestDb } from '../src/db/connection.js';

async function fixture(t) {
  const db = createTestDb();
  const server = createApp({ db }).app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  });

  async function api(path, { method = 'GET', cookie, body } = {}) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method,
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return {
      status: response.status,
      body: response.status === 204 ? null : await response.json(),
      cookie: response.headers.get('set-cookie')?.split(';')[0],
    };
  }

  async function user(name) {
    const result = await api('/auth/register', {
      method: 'POST',
      body: { display_name: name, email: `${name}@example.test`, password: 'test-password' },
    });
    assert.equal(result.status, 201, `register ${name}`);
    return { id: result.body.user.id, cookie: result.cookie };
  }

  function concert(id) {
    db.prepare(`INSERT INTO concerts (id, artist, tour_name, venue, city, event_date)
                VALUES (?, ?, ?, ?, ?, ?)`)
      .run(id, `Artist ${id}`, 'Tour', 'Hall', 'Singapore', '2027-05-01');
  }

  async function join(person, concertId) {
    const result = await api(`/concerts/${concertId}/participation`, {
      method: 'POST', cookie: person.cookie, body: { sectionPref: 'pit', arrivalPref: 'doors' },
    });
    assert.equal(result.status, 200);
  }

  const like = (cookie, concertId, target) =>
    api(`/kaki/decisions/${concertId}/${target.id}`, {
      method: 'PUT', cookie, body: { decision: 'like' },
    });

  /** Two users who have liked each other for the same concert. */
  async function matchedPair(concertId) {
    const a = await user(`a-${concertId}`);
    const b = await user(`b-${concertId}`);
    concert(concertId);
    await join(a, concertId);
    await join(b, concertId);
    assert.equal((await like(a.cookie, concertId, b)).status, 200);
    assert.equal((await like(b.cookie, concertId, a)).status, 200);
    return { a, b };
  }

  const openChat = (cookie, concertId, other) =>
    api(`/kaki/concerts/${concertId}/conversations/${other.id}`, { method: 'POST', cookie });

  return { db, api, user, concert, join, like, matchedPair, openChat };
}

test('a conversation requires a mutual like', async (t) => {
  const f = await fixture(t);
  const alice = await f.user('m-alice');
  const bob = await f.user('m-bob');
  f.concert('c1');
  await f.join(alice, 'c1');
  await f.join(bob, 'c1');

  // Nobody has liked anybody.
  assert.equal((await f.openChat(alice.cookie, 'c1', bob)).status, 403);

  // One-sided like is still not a match.
  await f.like(alice.cookie, 'c1', bob);
  const oneSided = await f.openChat(alice.cookie, 'c1', bob);
  assert.equal(oneSided.status, 403);
  assert.equal(oneSided.body.error, 'not_matched');

  // Reciprocated — now it opens.
  await f.like(bob.cookie, 'c1', alice);
  assert.equal((await f.openChat(alice.cookie, 'c1', bob)).status, 201);
});

test('authentication is required for every chat route', async (t) => {
  const f = await fixture(t);
  const paths = [
    ['/kaki/conversations', 'GET'],
    ['/kaki/concerts/x/conversations/y', 'POST'],
    ['/kaki/conversations/x', 'GET'],
    ['/kaki/conversations/x/messages', 'POST'],
    ['/me/blocked', 'GET'],
    ['/users/x/block', 'PUT'],
    ['/users/x/reports', 'POST'],
  ];
  for (const [path, method] of paths) {
    assert.equal((await f.api(path, { method })).status, 401, `${method} ${path}`);
  }
});

test('opening a conversation is idempotent and symmetric', async (t) => {
  const f = await fixture(t);
  const { a, b } = await f.matchedPair('c_idem');

  const first = await f.openChat(a.cookie, 'c_idem', b);
  const again = await f.openChat(a.cookie, 'c_idem', b);
  const fromOtherSide = await f.openChat(b.cookie, 'c_idem', a);

  assert.equal(first.body.conversation.id, again.body.conversation.id);
  assert.equal(
    first.body.conversation.id,
    fromOtherSide.body.conversation.id,
    'whoever opens it first, the pair shares one thread per concert',
  );
});

test('opening or acknowledging a thread clears only that user’s chat notifications', async (t) => {
  const f = await fixture(t);
  const { a, b } = await f.matchedPair('c_notification_read');
  const id = (await f.openChat(a.cookie, 'c_notification_read', b)).body.conversation.id;
  const path = `/kaki/chat/${id}`;
  const send = (person, body) => f.api(`/kaki/conversations/${id}/messages`, {
    method: 'POST', cookie: person.cookie, body: { body },
  });
  const notifications = async (person) => (await f.api('/me/notifications', { cookie: person.cookie })).body.notifications;
  await send(a, 'Meet at the entrance?');
  const unread = (await notifications(b)).find(n => n.path === path);
  assert.equal(unread.readAt, null);
  f.db.prepare(`INSERT INTO notifications(id,user_id,category,event_key,title,resource_path)
    VALUES('unrelated',?,'meetup','unrelated','Meetup update','/meetups/other')`).run(b.id);

  const outsider = await f.user('notification-outsider');
  assert.equal((await f.api(`/kaki/conversations/${id}`, { cookie: outsider.cookie })).status, 404);
  assert.equal((await notifications(b)).find(n => n.id === unread.id).readAt, null);

  assert.equal((await f.api(`/kaki/conversations/${id}`, { cookie: b.cookie })).status, 200);
  let inbox = await notifications(b);
  assert.ok(inbox.find(n => n.id === unread.id).readAt);
  assert.equal(inbox.find(n => n.id === 'unrelated').readAt, null);

  await send(b, 'Yes, see you there.');
  const otherSide = (await notifications(a)).find(n => n.path === path);
  await f.api(`/kaki/conversations/${id}`, { cookie: b.cookie });
  assert.equal((await notifications(a)).find(n => n.id === otherSide.id).readAt, null);

  await send(a, 'I am on the way.');
  assert.ok((await notifications(b)).some(n => n.path === path && !n.readAt));
  assert.equal((await f.api(`/kaki/conversations/${id}/read`, { method: 'POST', cookie: b.cookie })).status, 200);
  inbox = await notifications(b);
  assert.ok(inbox.filter(n => n.path === path).every(n => n.readAt));
  assert.equal(inbox.find(n => n.id === 'unrelated').readAt, null);
});

test('a non-participant gets 404, not 403, so ids cannot be probed', async (t) => {
  const f = await fixture(t);
  const { a, b } = await f.matchedPair('c_probe');
  const nosy = await f.user('nosy');
  const id = (await f.openChat(a.cookie, 'c_probe', b)).body.conversation.id;

  const peek = await f.api(`/kaki/conversations/${id}`, { cookie: nosy.cookie });
  assert.equal(peek.status, 404, '403 would confirm the id names a real conversation');

  const post = await f.api(`/kaki/conversations/${id}/messages`, {
    method: 'POST', cookie: nosy.cookie, body: { body: 'hello' },
  });
  assert.equal(post.status, 404);
});

test('messages send, list, and reply within the thread', async (t) => {
  const f = await fixture(t);
  const { a, b } = await f.matchedPair('c_msg');
  const id = (await f.openChat(a.cookie, 'c_msg', b)).body.conversation.id;

  const sent = await f.api(`/kaki/conversations/${id}/messages`, {
    method: 'POST', cookie: a.cookie, body: { body: 'are you queueing early?' },
  });
  assert.equal(sent.status, 201);
  assert.equal(sent.body.message.body, 'are you queueing early?');
  assert.equal(sent.body.message.deleted, false);
  assert.equal(sent.body.message.edited, false);

  const reply = await f.api(`/kaki/conversations/${id}/messages`, {
    method: 'POST', cookie: b.cookie,
    body: { body: 'from 4pm', replyTo: sent.body.message.id },
  });
  assert.equal(reply.status, 201);
  assert.equal(reply.body.message.replyTo.id, sent.body.message.id);
  assert.equal(reply.body.message.replyTo.body, 'are you queueing early?');
  assert.ok(reply.body.message.seq > sent.body.message.seq);
  const edited = await f.api(`/kaki/conversations/${id}/messages/${reply.body.message.id}`, {
    method: 'PATCH', cookie: b.cookie, body: { body: 'from 3pm instead' },
  });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.message.body, 'from 3pm instead');
  assert.deepEqual(edited.body.message.replyTo, reply.body.message.replyTo);
  assert.equal(edited.body.message.seq, reply.body.message.seq);

  const thread = await f.api(`/kaki/conversations/${id}`, { cookie: b.cookie });
  assert.equal(thread.body.messages.length, 2);
});

test('a burst of messages keeps its order', async (t) => {
  // created_at has one-second granularity, so everything here shares a
  // timestamp. Ordering must still come out as sent — an earlier version
  // tie-broke on the random UUID id and scrambled the thread.
  const f = await fixture(t);
  const { a, b } = await f.matchedPair('c_order');
  const id = (await f.openChat(a.cookie, 'c_order', b)).body.conversation.id;

  const sentOrder = [];
  for (let i = 0; i < 12; i += 1) {
    const who = i % 2 === 0 ? a : b;
    const body = `message ${i}`;
    // Sequential on purpose: concurrent sends have no defined order to assert.
    // eslint-disable-next-line no-await-in-loop
    await f.api(`/kaki/conversations/${id}/messages`, {
      method: 'POST', cookie: who.cookie, body: { body },
    });
    sentOrder.push(body);
  }

  const thread = await f.api(`/kaki/conversations/${id}`, { cookie: a.cookie });
  assert.deepEqual(thread.body.messages.map((m) => m.body), sentOrder);
});

test('a reply cannot point at a message from another conversation', async (t) => {
  const f = await fixture(t);
  const one = await f.matchedPair('c_r1');
  const two = await f.matchedPair('c_r2');

  const idOne = (await f.openChat(one.a.cookie, 'c_r1', one.b)).body.conversation.id;
  const idTwo = (await f.openChat(two.a.cookie, 'c_r2', two.b)).body.conversation.id;

  const foreign = await f.api(`/kaki/conversations/${idOne}/messages`, {
    method: 'POST', cookie: one.a.cookie, body: { body: 'private' },
  });

  const attempt = await f.api(`/kaki/conversations/${idTwo}/messages`, {
    method: 'POST', cookie: two.a.cookie,
    body: { body: 'quoting someone else', replyTo: foreign.body.message.id },
  });
  assert.equal(attempt.status, 400, 'quoting would leak text from a thread they cannot read');
});

test('empty and oversized messages are rejected', async (t) => {
  const f = await fixture(t);
  const { a, b } = await f.matchedPair('c_valid');
  const id = (await f.openChat(a.cookie, 'c_valid', b)).body.conversation.id;
  const send = (body) => f.api(`/kaki/conversations/${id}/messages`, {
    method: 'POST', cookie: a.cookie, body: { body },
  });

  assert.equal((await send('')).status, 400);
  assert.equal((await send('   ')).status, 400, 'whitespace-only is empty');
  assert.equal((await send('x'.repeat(2001))).status, 400);
  assert.equal((await send('x'.repeat(2000))).status, 201);
});

test('edit and delete are sender-only', async (t) => {
  const f = await fixture(t);
  const { a, b } = await f.matchedPair('c_own');
  const id = (await f.openChat(a.cookie, 'c_own', b)).body.conversation.id;
  const mine = (await f.api(`/kaki/conversations/${id}/messages`, {
    method: 'POST', cookie: a.cookie, body: { body: 'mine' },
  })).body.message;

  const theirEdit = await f.api(`/kaki/conversations/${id}/messages/${mine.id}`, {
    method: 'PATCH', cookie: b.cookie, body: { body: 'tampered' },
  });
  assert.equal(theirEdit.status, 403);

  const theirDelete = await f.api(`/kaki/conversations/${id}/messages/${mine.id}`, {
    method: 'DELETE', cookie: b.cookie,
  });
  assert.equal(theirDelete.status, 403, 'you may only delete your own messages');

  const ownEdit = await f.api(`/kaki/conversations/${id}/messages/${mine.id}`, {
    method: 'PATCH', cookie: a.cookie, body: { body: 'mine, revised' },
  });
  assert.equal(ownEdit.status, 200);
  assert.equal(ownEdit.body.message.body, 'mine, revised');
  assert.equal(ownEdit.body.message.edited, true);
});

test('deleting leaves a tombstone for both sides but keeps the text for moderation', async (t) => {
  const f = await fixture(t);
  const { a, b } = await f.matchedPair('c_del');
  const id = (await f.openChat(a.cookie, 'c_del', b)).body.conversation.id;
  const sent = (await f.api(`/kaki/conversations/${id}/messages`, {
    method: 'POST', cookie: a.cookie, body: { body: 'something regrettable' },
  })).body.message;

  const removed = await f.api(`/kaki/conversations/${id}/messages/${sent.id}`, {
    method: 'DELETE', cookie: a.cookie,
  });
  assert.equal(removed.status, 200);
  assert.equal(removed.body.message.deleted, true);
  assert.equal(removed.body.message.body, null);

  // The recipient sees a tombstone, never the text.
  const asRecipient = await f.api(`/kaki/conversations/${id}`, { cookie: b.cookie });
  const found = asRecipient.body.messages.find((m) => m.id === sent.id);
  assert.equal(found.deleted, true);
  assert.equal(found.body, null);

  // But the row survives, so a report filed afterwards still has its evidence.
  const stored = f.db.prepare('SELECT body, deleted_at FROM messages WHERE id = ?').get(sent.id);
  assert.equal(stored.body, 'something regrettable');
  assert.ok(stored.deleted_at, 'soft delete, not a row removal');

  // A deleted message cannot then be edited back into existence.
  const reEdit = await f.api(`/kaki/conversations/${id}/messages/${sent.id}`, {
    method: 'PATCH', cookie: a.cookie, body: { body: 'undelete me' },
  });
  assert.equal(reEdit.status, 409);
});

test('blocking closes the thread for both people, and unblocking reopens it', async (t) => {
  const f = await fixture(t);
  const { a, b } = await f.matchedPair('c_block');
  const id = (await f.openChat(a.cookie, 'c_block', b)).body.conversation.id;
  await f.api(`/kaki/conversations/${id}/messages`, {
    method: 'POST', cookie: a.cookie, body: { body: 'hello' },
  });

  assert.equal((await f.api(`/users/${b.id}/block`, { method: 'PUT', cookie: a.cookie })).status, 200);

  // The blocker is shut out of the thread too — blocking is not a mute.
  assert.equal((await f.api(`/kaki/conversations/${id}`, { cookie: a.cookie })).status, 403);

  // And so is the blocked person, who is not told why.
  const asBlocked = await f.api(`/kaki/conversations/${id}`, { cookie: b.cookie });
  assert.equal(asBlocked.status, 403);
  assert.equal(asBlocked.body.error, 'conversation_closed',
    'the same error either way, so a block is not distinguishable from an unmatch');

  assert.equal((await f.api(`/kaki/conversations/${id}/messages`, {
    method: 'POST', cookie: b.cookie, body: { body: 'let me in' },
  })).status, 403);

  // It disappears from both listings rather than lingering greyed out.
  assert.equal((await f.api('/kaki/conversations', { cookie: a.cookie })).body.conversations.length, 0);
  assert.equal((await f.api('/kaki/conversations', { cookie: b.cookie })).body.conversations.length, 0);

  // Only the blocker can lift it.
  assert.equal((await f.api(`/users/${a.id}/block`, { method: 'DELETE', cookie: b.cookie })).status, 200);
  assert.equal((await f.api(`/kaki/conversations/${id}`, { cookie: a.cookie })).status, 403,
    'b unblocking a does nothing: it was a who blocked b');

  assert.equal((await f.api(`/users/${b.id}/block`, { method: 'DELETE', cookie: a.cookie })).status, 200);
  const reopened = await f.api(`/kaki/conversations/${id}`, { cookie: a.cookie });
  assert.equal(reopened.status, 200);
  assert.equal(reopened.body.messages.length, 1, 'history survives the block');
});

test('withdrawing a like closes an existing thread', async (t) => {
  const f = await fixture(t);
  const { a, b } = await f.matchedPair('c_unmatch');
  const id = (await f.openChat(a.cookie, 'c_unmatch', b)).body.conversation.id;
  assert.equal((await f.api(`/kaki/conversations/${id}`, { cookie: a.cookie })).status, 200);

  await f.api(`/kaki/decisions/c_unmatch/${a.id}`, { method: 'DELETE', cookie: b.cookie });

  assert.equal((await f.api(`/kaki/conversations/${id}`, { cookie: a.cookie })).status, 403,
    'the right to talk is re-checked, not granted once at creation');
});

test('blocked users cannot be listed and the block list is private', async (t) => {
  const f = await fixture(t);
  const { a, b } = await f.matchedPair('c_list');
  await f.api(`/users/${b.id}/block`, { method: 'PUT', cookie: a.cookie });

  const mine = await f.api('/me/blocked', { cookie: a.cookie });
  assert.equal(mine.body.blocked.length, 1);
  assert.equal(mine.body.blocked[0].id, b.id);

  const theirs = await f.api('/me/blocked', { cookie: b.cookie });
  assert.equal(theirs.body.blocked.length, 0, 'being blocked is not visible to the blocked');
});

test('blocking yourself is rejected', async (t) => {
  const f = await fixture(t);
  const alice = await f.user('self-block');
  assert.equal((await f.api(`/users/${alice.id}/block`, { method: 'PUT', cookie: alice.cookie })).status, 400);
});

test('reports validate, attach evidence, and auto-block for harassment', async (t) => {
  const f = await fixture(t);
  const { a, b } = await f.matchedPair('c_report');
  const id = (await f.openChat(a.cookie, 'c_report', b)).body.conversation.id;
  const nasty = (await f.api(`/kaki/conversations/${id}/messages`, {
    method: 'POST', cookie: b.cookie, body: { body: 'abusive text' },
  })).body.message;

  assert.equal((await f.api(`/users/${b.id}/reports`, {
    method: 'POST', cookie: a.cookie, body: { category: 'nonsense', details: 'x' },
  })).status, 400);

  assert.equal((await f.api(`/users/${b.id}/reports`, {
    method: 'POST', cookie: a.cookie, body: { category: 'spam', details: '' },
  })).status, 400);

  assert.equal((await f.api(`/users/${a.id}/reports`, {
    method: 'POST', cookie: a.cookie, body: { category: 'spam', details: 'me' },
  })).status, 400, 'cannot report yourself');

  const filed = await f.api(`/users/${b.id}/reports`, {
    method: 'POST',
    cookie: a.cookie,
    body: {
      category: 'harassment',
      details: 'sent abusive messages',
      conversationId: id,
      messageId: nasty.id,
    },
  });
  assert.equal(filed.status, 201);
  assert.equal(filed.body.blocked, true, 'a harassment report also blocks');

  const stored = f.db.prepare('SELECT * FROM reports WHERE id = ?').get(filed.body.reportId);
  assert.equal(stored.reported_user_id, b.id);
  assert.equal(stored.conversation_id, id);
  assert.equal(stored.message_id, nasty.id);
  assert.equal(stored.status, 'open');

  // The auto-block took effect.
  assert.equal((await f.api(`/kaki/conversations/${id}`, { cookie: a.cookie })).status, 403);
});

test('a report cannot cite a conversation the reporter is not in', async (t) => {
  const f = await fixture(t);
  const pair = await f.matchedPair('c_eviden');
  const outsider = await f.user('evidence-outsider');
  const id = (await f.openChat(pair.a.cookie, 'c_eviden', pair.b)).body.conversation.id;

  const attempt = await f.api(`/users/${pair.b.id}/reports`, {
    method: 'POST', cookie: outsider.cookie,
    body: { category: 'spam', details: 'made up', conversationId: id },
  });
  assert.equal(attempt.status, 404);
});

test('chat background is per-viewer and validated against an allowlist', async (t) => {
  const f = await fixture(t);
  const { a, b } = await f.matchedPair('c_bg');
  const id = (await f.openChat(a.cookie, 'c_bg', b)).body.conversation.id;

  assert.equal((await f.api(`/kaki/conversations/${id}/background`, {
    method: 'PUT', cookie: a.cookie, body: { background: '<script>' },
  })).status, 400);

  assert.equal((await f.api(`/kaki/conversations/${id}/background`, {
    method: 'PUT', cookie: a.cookie, body: { background: 'neon' },
  })).status, 200);

  const mine = await f.api(`/kaki/conversations/${id}`, { cookie: a.cookie });
  assert.equal(mine.body.conversation.background, 'neon');

  const theirs = await f.api(`/kaki/conversations/${id}`, { cookie: b.cookie });
  assert.equal(theirs.body.conversation.background, 'default',
    'restyling my own thread must not change what the other person sees');
});

test('reports cannot attach another users conversation as evidence against an unrelated user', async (t) => {
  const f = await fixture(t);
  const { a, b } = await f.matchedPair('c_wrong_report');
  const unrelated = await f.user('unrelated-report-target');
  const id = (await f.openChat(a.cookie, 'c_wrong_report', b)).body.conversation.id;
  const result = await f.api(`/users/${unrelated.id}/reports`, {
    method: 'POST', cookie: a.cookie,
    body: { category: 'spam', details: 'wrong person', conversationId: id },
  });
  assert.equal(result.status, 404);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM reports').get().n, 0);
});

test('blocking and reporting nonexistent users return not found rather than foreign key errors', async (t) => {
  const f = await fixture(t);
  const a = await f.user('missing-report-target');
  assert.equal((await f.api('/users/missing/block', { method: 'PUT', cookie: a.cookie })).status, 404);
  assert.equal((await f.api('/users/missing/reports', {
    method: 'POST', cookie: a.cookie, body: { category: 'spam', details: 'unknown user' },
  })).status, 404);
});

test('chat requires current explicit Kaki participation even for stored mutual likes', async (t) => {
  const f = await fixture(t);
  const { a, b } = await f.matchedPair('c_chat_membership');
  const id = (await f.openChat(a.cookie, 'c_chat_membership', b)).body.conversation.id;
  await f.api(`/kaki/conversations/${id}/messages`, {
    method: 'POST', cookie: a.cookie, body: { body: 'old conversation' },
  });
  f.db.prepare('DELETE FROM concert_participants WHERE user_id=?').run(a.id);
  assert.equal((await f.api(`/kaki/conversations/${id}`, { cookie: b.cookie })).status, 403);
  assert.equal((await f.openChat(a.cookie, 'c_chat_membership', b)).status, 403);
  assert.deepEqual((await f.api('/kaki/conversations', { cookie: b.cookie })).body.conversations, []);
  assert.equal((await f.api('/kaki/unread', { cookie: b.cookie })).body.total, 0);
});
