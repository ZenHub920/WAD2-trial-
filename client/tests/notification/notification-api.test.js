// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startServer } from '../serverHarness.js';

let s;
beforeEach(async () => { s = await startServer(); });
afterEach(async () => { await s.stop(); });

describe('notification triggers', () => {
  it('a chat message notifies only the recipient, named after the sender', async () => {
    const { a, b, conversationId } = await s.chatPair('n1');
    expect((await s.send(a, conversationId, 'hello')).status).toBe(201);

    const received = await s.inbox(b);
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ category: 'chat', path: `/kaki/chat/${conversationId}`, readAt: null });
    expect(received[0].title).toBe(`Message from ${a.name}`);
    expect(await s.inbox(a)).toHaveLength(0);
  });

  it('many messages in one conversation collapse into one notification', async () => {
    const { a, b, conversationId } = await s.chatPair('n2');
    for (const text of ['one', 'two', 'three']) await s.send(a, conversationId, text);
    expect(await s.inbox(b)).toHaveLength(1);
    expect((await s.api('/me/notifications/unread', { cookie: b.cookie })).body.unread).toBe(1);
  });

  it('a disabled category creates no notification', async () => {
    const { a, b, conversationId } = await s.chatPair('n3');
    const saved = await s.api('/me/notification-preferences', { method: 'PUT', cookie: b.cookie, body: { chat: false } });
    expect(saved.status).toBe(200);
    await s.send(a, conversationId, 'hello');
    expect(await s.inbox(b)).toHaveLength(0);
    expect((await s.api('/me/notification-preferences', { cookie: b.cookie })).body.preferences.chat).toBe(false);
  });

  it('rejects unknown preference categories', async () => {
    const b = await s.user('prefs');
    const result = await s.api('/me/notification-preferences', { method: 'PUT', cookie: b.cookie, body: { email: true } });
    expect(result.status).toBe(400);
  });
});

describe('reading notifications', () => {
  it('opening the conversation clears its chat notification and re-arms it', async () => {
    const { a, b, conversationId } = await s.chatPair('r1');
    await s.send(a, conversationId, 'first');
    expect(await s.inbox(b)).toHaveLength(1);

    const read = await s.api(`/kaki/conversations/${conversationId}/read`, { method: 'POST', cookie: b.cookie });
    expect(read.body.notificationsRead).toBe(1);
    expect(await s.inbox(b)).toHaveLength(0);

    // The next message must notify again, not be swallowed by the unique key.
    await s.send(a, conversationId, 'second');
    expect(await s.inbox(b)).toHaveLength(1);
  });

  it('marking a chat notification read removes it; other categories stay as read history', async () => {
    const { a, b, conversationId } = await s.chatPair('r2');
    await s.send(a, conversationId, 'hi');
    const [chat] = await s.inbox(b);
    s.db.prepare(`INSERT INTO notifications(id,user_id,category,event_key,title,resource_path)
      VALUES('group-note',?, 'group','test:group','A group update','/groups')`).run(b.id);

    expect((await s.api(`/me/notifications/${chat.id}/read`, { method: 'POST', cookie: b.cookie })).status).toBe(200);
    expect((await s.api('/me/notifications/group-note/read', { method: 'POST', cookie: b.cookie })).status).toBe(200);

    const left = await s.inbox(b);
    expect(left.map(n => n.id)).toEqual(['group-note']);
    expect(left[0].readAt).not.toBeNull();
  });

  it('read-all zeroes the unread count', async () => {
    const { a, b, conversationId } = await s.chatPair('r3');
    await s.send(a, conversationId, 'hi');
    s.db.prepare(`INSERT INTO notifications(id,user_id,category,event_key,title,resource_path)
      VALUES('m1',?,'match','test:match','A match update','/concerts/r3')`).run(b.id);
    await s.api('/me/notifications/read-all', { method: 'POST', cookie: b.cookie });
    expect((await s.api('/me/notifications/unread', { cookie: b.cookie })).body.unread).toBe(0);
  });

  it("cannot read someone else's notification", async () => {
    const { a, b, conversationId } = await s.chatPair('r4');
    await s.send(a, conversationId, 'hi');
    const [note] = await s.inbox(b);
    const result = await s.api(`/me/notifications/${note.id}/read`, { method: 'POST', cookie: a.cookie });
    expect(result.status).toBe(404);
    expect(await s.inbox(b)).toHaveLength(1);
  });

  it('requires a session', async () => {
    expect((await s.api('/me/notifications')).status).toBe(401);
    expect((await s.api('/me/notifications/unread')).status).toBe(401);
  });

  it('rejects an out-of-range page size', async () => {
    const b = await s.user('limits');
    expect((await s.api('/me/notifications?limit=500', { cookie: b.cookie })).status).toBe(400);
  });
});

describe('browser push queue', () => {
  it('queues one push job per registered device when a notification is created', async () => {
    const { a, b, conversationId } = await s.chatPair('p1');
    const now = Date.now();
    s.db.prepare(`INSERT INTO push_subscriptions(id,user_id,endpoint,p256dh,auth,created_at,updated_at)
      VALUES('sub-1',?,'https://fcm.googleapis.com/x','k','a',?,?)`).run(b.id, now, now);
    await s.send(a, conversationId, 'hi');
    const jobs = s.db.prepare(`SELECT payload_json FROM background_jobs WHERE type='notification.push'`).all();
    expect(jobs).toHaveLength(1);
    expect(JSON.parse(jobs[0].payload_json)).toMatchObject({ subscriptionId: 'sub-1' });
  });

  it('the push lookup hides names and refuses an unlinked device', async () => {
    const { a, b, conversationId } = await s.chatPair('p2');
    const now = Date.now();
    s.db.prepare(`INSERT INTO push_subscriptions(id,user_id,endpoint,p256dh,auth,created_at,updated_at)
      VALUES('sub-2',?,'https://fcm.googleapis.com/y','k','a',?,?)`).run(b.id, now, now);
    await s.send(a, conversationId, 'hi');
    const [note] = await s.inbox(b);

    const ok = await s.api(`/me/push/notifications/${note.id}?subscriptionId=sub-2`, { cookie: b.cookie });
    expect(ok.status).toBe(200);
    expect(ok.body.notification.title).toBe('You have a new message');
    expect(ok.body.notification.title).not.toContain(a.name);

    const other = await s.api(`/me/push/notifications/${note.id}?subscriptionId=sub-2`, { cookie: a.cookie });
    expect(other.status).toBe(404);
  });
});
