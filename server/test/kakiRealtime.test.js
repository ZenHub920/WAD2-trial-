/**
 * Read receipts, unread badges, avatars, and live delivery.
 *
 * The receipt rules are the ones worth pinning down, because getting them
 * subtly wrong leaks information: a tick must never reveal what the OTHER
 * person has read on their own messages, and sending must not leave your own
 * thread looking unread.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createApp } from '../src/app.js';
import { createTestDb } from '../src/db/connection.js';

/** A 1x1 PNG, structurally valid so the byte-level validator accepts it. */
const PNG_1PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function fixture(t) {
  const db = createTestDb();
  const avatarDir = mkdtempSync(join(tmpdir(), 'encore-avatars-'));
  const imageDir = mkdtempSync(join(tmpdir(), 'encore-images-'));
  const built = createApp({ db, avatarDir, imageDir });
  const server = built.app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    db.close();
    rmSync(avatarDir, { recursive: true, force: true });
    rmSync(imageDir, { recursive: true, force: true });
  });

  const base = () => `http://127.0.0.1:${server.address().port}/api`;

  async function api(path, { method = 'GET', cookie, body } = {}) {
    const response = await fetch(`${base()}${path}`, {
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

  async function user(name, extra = {}) {
    const r = await api('/auth/register', {
      method: 'POST',
      body: {
        display_name: name,
        email: `${name}@example.test`,
        password: 'test-password',
        ...extra,
      },
    });
    assert.equal(r.status, 201, `register ${name}: ${JSON.stringify(r.body)}`);
    return { id: r.body.user.id, cookie: r.cookie, user: r.body.user };
  }

  function concert(id) {
    db.prepare(`INSERT INTO concerts (id, artist, tour_name, venue, city, event_date)
                VALUES (?, ?, ?, ?, ?, ?)`)
      .run(id, `Artist ${id}`, 'Tour', 'Hall', 'Singapore', '2027-05-01');
  }

  function seeker(id, person, concertId) {
    db.prepare(`INSERT INTO seeker_requests
                (id, user_id, concert_id, section_pref, spend_band_max, arrival_pref)
                VALUES (?, ?, ?, 'pit', 2, 'doors')`)
      .run(id, person.id, concertId);
  }

  async function matchedPair(concertId) {
    const a = await user(`rt-a-${concertId}`);
    const b = await user(`rt-b-${concertId}`);
    concert(concertId);
    seeker(`s-a-${concertId}`, a, concertId);
    seeker(`s-b-${concertId}`, b, concertId);
    for (const [me, them] of [[a, b], [b, a]]) {
      // eslint-disable-next-line no-await-in-loop
      await api(`/kaki/decisions/${concertId}/${them.id}`, {
        method: 'PUT', cookie: me.cookie, body: { decision: 'like' },
      });
    }
    const opened = await api(`/kaki/concerts/${concertId}/conversations/${b.id}`, {
      method: 'POST', cookie: a.cookie,
    });
    assert.equal(opened.status, 201);
    return { a, b, id: opened.body.conversation.id };
  }

  const send = (who, id, body) =>
    api(`/kaki/conversations/${id}/messages`, { method: 'POST', cookie: who.cookie, body: { body } });

  /** Collect SSE events of a given type until `count` arrive, or time out. */
  function listen(cookie, { types, count, timeoutMs = 4000 }) {
    const controller = new AbortController();
    const received = [];
    const done = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        controller.abort();
        reject(new Error(`timed out with ${received.length}/${count} events`));
      }, timeoutMs);

      fetch(`${base()}/kaki/stream`, {
        headers: { cookie, accept: 'text/event-stream' },
        signal: controller.signal,
      }).then(async (response) => {
        if (response.status !== 200) {
          clearTimeout(timer);
          return reject(new Error(`stream status ${response.status}`));
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        // eslint-disable-next-line no-constant-condition
        while (true) {
          // eslint-disable-next-line no-await-in-loop
          const { value, done: finished } = await reader.read();
          if (finished) break;
          buffer += decoder.decode(value, { stream: true });
          let split = buffer.indexOf('\n\n');
          while (split !== -1) {
            const frame = buffer.slice(0, split);
            buffer = buffer.slice(split + 2);
            const type = /^event: (.+)$/m.exec(frame)?.[1];
            const data = /^data: (.+)$/m.exec(frame)?.[1];
            if (type && data && types.includes(type)) {
              received.push({ type, data: JSON.parse(data) });
              if (received.length >= count) {
                clearTimeout(timer);
                controller.abort();
                return resolve(received);
              }
            }
            split = buffer.indexOf('\n\n');
          }
        }
        return undefined;
      }).catch((err) => {
        if (controller.signal.aborted && received.length >= count) return;
        clearTimeout(timer);
        reject(err);
      });
    });
    return { done, stop: () => controller.abort() };
  }

  return { db, api, user, concert, seeker, matchedPair, send, listen, realtime: built.realtime };
}

test('the stream requires a session and announces itself when open', async (t) => {
  const f = await fixture(t);
  const alice = await f.user('stream-alice');
  const sub = f.listen(alice.cookie, { types: ['ready'], count: 1 });
  const events = await sub.done;
  assert.equal(events[0].type, 'ready');
  assert.equal(events[0].data.userId, alice.id);
});

test('the stream rejects an anonymous client', async (t) => {
  const f = await fixture(t);
  const r = await f.api('/kaki/stream');
  assert.equal(r.status, 401);
});

test('a sent message reaches the other person live', async (t) => {
  const f = await fixture(t);
  const { a, b, id } = await f.matchedPair('c_live');

  const sub = f.listen(b.cookie, { types: ['message'], count: 1 });
  // Give the subscription a moment to register before publishing.
  await new Promise((resolve) => setTimeout(resolve, 250));
  await f.send(a, id, 'live hello');

  const [event] = await sub.done;
  assert.equal(event.data.conversationId, id);
  assert.equal(event.data.message.body, 'live hello');
  assert.equal(event.data.unreadFor[b.id], 1, 'the recipient gains an unread');
  assert.equal(event.data.unreadFor[a.id], 0, 'the sender does not');
});

test('reading a thread notifies the sender so their ticks turn double', async (t) => {
  const f = await fixture(t);
  const { a, b, id } = await f.matchedPair('c_receipt');
  await f.send(a, id, 'did you see this');

  const sub = f.listen(a.cookie, { types: ['read'], count: 1 });
  await new Promise((resolve) => setTimeout(resolve, 250));
  await f.api(`/kaki/conversations/${id}`, { cookie: b.cookie });

  const [event] = await sub.done;
  assert.equal(event.data.conversationId, id);
  assert.equal(event.data.readerId, b.id);
});

test('tick status: sent until read, then read — and never on their messages', async (t) => {
  const f = await fixture(t);
  const { a, b, id } = await f.matchedPair('c_ticks');
  await f.send(a, id, 'first');

  // Before b opens it, a sees a single tick.
  let asA = await f.api(`/kaki/conversations/${id}`, { cookie: a.cookie });
  let mine = asA.body.messages.find((m) => m.senderId === a.id);
  assert.equal(mine.status, 'sent');

  // b opens the thread.
  const asB = await f.api(`/kaki/conversations/${id}`, { cookie: b.cookie });
  // b must not be told the read state of a's messages — that is a's business.
  assert.equal(asB.body.messages.find((m) => m.senderId === a.id).status, null);

  // Now a sees a double tick.
  asA = await f.api(`/kaki/conversations/${id}`, { cookie: a.cookie });
  mine = asA.body.messages.find((m) => m.senderId === a.id);
  assert.equal(mine.status, 'read');
});

test('a later message is unread again even though earlier ones were read', async (t) => {
  const f = await fixture(t);
  const { a, b, id } = await f.matchedPair('c_partial');
  await f.send(a, id, 'one');
  await f.api(`/kaki/conversations/${id}`, { cookie: b.cookie }); // b reads
  await f.send(a, id, 'two');

  const asA = await f.api(`/kaki/conversations/${id}`, { cookie: a.cookie });
  const byBody = Object.fromEntries(asA.body.messages.map((m) => [m.body, m.status]));
  assert.equal(byBody.one, 'read');
  assert.equal(byBody.two, 'sent', 'the read marker must not run ahead of what was shown');
});

test('unread totals count only the other person messages, and clear on open', async (t) => {
  const f = await fixture(t);
  const { a, b, id } = await f.matchedPair('c_unread');

  await f.send(a, id, 'one');
  await f.send(a, id, 'two');

  assert.equal((await f.api('/kaki/unread', { cookie: b.cookie })).body.total, 2);
  assert.equal((await f.api('/kaki/unread', { cookie: a.cookie })).body.total, 0,
    'your own messages are never unread to you');

  const list = await f.api('/kaki/conversations', { cookie: b.cookie });
  assert.equal(list.body.conversations[0].unread, 2);

  await f.api(`/kaki/conversations/${id}`, { cookie: b.cookie });
  assert.equal((await f.api('/kaki/unread', { cookie: b.cookie })).body.total, 0);
});

test('a blocked thread stops contributing to the unread badge', async (t) => {
  const f = await fixture(t);
  const { a, b, id } = await f.matchedPair('c_unread_block');
  await f.send(a, id, 'unread one');
  assert.equal((await f.api('/kaki/unread', { cookie: b.cookie })).body.total, 1);

  await f.api(`/users/${a.id}/block`, { method: 'PUT', cookie: b.cookie });
  assert.equal((await f.api('/kaki/unread', { cookie: b.cookie })).body.total, 0,
    'a blocked conversation must not keep nagging with a badge');
});

test('avatars are optional at registration and default to none', async (t) => {
  const f = await fixture(t);
  const plain = await f.user('no-picture');
  assert.equal(plain.user.avatarUrl, null, 'no picture is a valid state');

  const withPicture = await f.user('has-picture', { avatar: PNG_1PX });
  assert.match(withPicture.user.avatarUrl, /^\/api\/avatars\/.+\.png$/);
});

test('a forged image is rejected on its bytes, not its label', async (t) => {
  const f = await fixture(t);
  const bogus = await f.api('/auth/register', {
    method: 'POST',
    body: {
      display_name: 'forger',
      email: 'forger@example.test',
      password: 'test-password',
      // Claims to be a PNG; the payload is plain text.
      avatar: `data:image/png;base64,${Buffer.from('not an image at all').toString('base64')}`,
    },
  });
  assert.equal(bogus.status, 400);
  assert.equal(bogus.body.error, 'invalid_image');
  assert.equal(f.db.prepare("SELECT COUNT(*) n FROM users WHERE display_name = 'forger'").get().n,
    0, 'the account must not survive a rejected picture');
});

test('a picture can be changed and removed afterwards', async (t) => {
  const f = await fixture(t);
  const alice = await f.user('changer');

  const set = await f.api('/me/avatar', { method: 'PUT', cookie: alice.cookie, body: { image: PNG_1PX } });
  assert.equal(set.status, 200);
  const first = set.body.user.avatarUrl;
  assert.ok(first);

  const replaced = await f.api('/me/avatar', { method: 'PUT', cookie: alice.cookie, body: { image: PNG_1PX } });
  assert.notEqual(replaced.body.user.avatarUrl, first, 'replacing issues a new file');

  const cleared = await f.api('/me/avatar', { method: 'DELETE', cookie: alice.cookie });
  assert.equal(cleared.body.user.avatarUrl, null);

  assert.equal((await f.api('/me/avatar', { method: 'PUT', body: { image: PNG_1PX } })).status, 401,
    'changing a picture requires a session');
});

test('the other person avatar travels with the conversation', async (t) => {
  const f = await fixture(t);
  const { a, b, id } = await f.matchedPair('c_avatar');
  await f.api('/me/avatar', { method: 'PUT', cookie: b.cookie, body: { image: PNG_1PX } });

  const detail = await f.api(`/kaki/conversations/${id}`, { cookie: a.cookie });
  assert.match(detail.body.conversation.other.avatarUrl, /^\/api\/avatars\//);

  const list = await f.api('/kaki/conversations', { cookie: a.cookie });
  assert.match(list.body.conversations[0].other.avatarUrl, /^\/api\/avatars\//);
});
