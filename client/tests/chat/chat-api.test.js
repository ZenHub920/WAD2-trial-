// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startServer } from '../serverHarness.js';

let s;
beforeEach(async () => { s = await startServer(); });
afterEach(async () => { await s.stop(); });

/** Open the SSE stream and collect parsed events until `stop()` is called. */
async function stream(person) {
  const controller = new AbortController();
  const response = await fetch(`${s.base}/kaki/stream`, { headers: { cookie: person.cookie }, signal: controller.signal });
  const events = [];
  const waiters = [];
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        let end;
        while ((end = buffer.indexOf('\n\n')) !== -1) {
          const chunk = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const type = /^event: (.+)$/m.exec(chunk)?.[1];
          const data = /^data: (.+)$/m.exec(chunk)?.[1];
          if (!type) continue;
          events.push({ type, data: JSON.parse(data) });
          waiters.splice(0).forEach(w => w());
        }
      }
    } catch { /* aborted */ }
  })();
  const next = async (type, timeout = 2000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const found = events.find(e => e.type === type);
      if (found) return found;
      await new Promise(resolve => { waiters.push(resolve); setTimeout(resolve, 50); });
    }
    throw new Error(`no ${type} event; saw ${events.map(e => e.type).join(',')}`);
  };
  return { response, events, next, stop: () => controller.abort() };
}

describe('sending and reading messages', () => {
  it('both participants see a sent message in the thread', async () => {
    const { a, b, conversationId } = await s.chatPair('c1');
    const sent = await s.send(a, conversationId, 'See you at the gate');
    expect(sent.status).toBe(201);
    expect(sent.body.message.body).toBe('See you at the gate');

    for (const person of [a, b]) {
      const detail = await s.api(`/kaki/conversations/${conversationId}`, { cookie: person.cookie });
      expect(detail.status).toBe(200);
      expect(JSON.stringify(detail.body)).toContain('See you at the gate');
    }
  });

  it('counts unread conversations for the recipient only, and reading clears it', async () => {
    const { a, b, conversationId } = await s.chatPair('c2');
    await s.send(a, conversationId, 'one');
    await s.send(a, conversationId, 'two');
    // The badge counts conversations with something unread, not messages.
    expect((await s.api('/kaki/unread', { cookie: b.cookie })).body.total).toBe(1);
    expect((await s.api('/kaki/unread', { cookie: a.cookie })).body.total).toBe(0);

    await s.api(`/kaki/conversations/${conversationId}/read`, { method: 'POST', cookie: b.cookie });
    expect((await s.api('/kaki/unread', { cookie: b.cookie })).body.total).toBe(0);
  });

  it('rejects an empty message', async () => {
    const { a, conversationId } = await s.chatPair('c3');
    expect((await s.send(a, conversationId, '   ')).status).toBe(400);
  });

  it('hides a thread from a non-participant with 404', async () => {
    const { conversationId } = await s.chatPair('c4');
    const outsider = await s.user('outsider-c4');
    expect((await s.api(`/kaki/conversations/${conversationId}`, { cookie: outsider.cookie })).status).toBe(404);
    expect((await s.send(outsider, conversationId, 'let me in')).status).toBe(404);
  });

  it('a block closes the thread for both sides', async () => {
    const { a, b, conversationId } = await s.chatPair('c5');
    expect((await s.api(`/users/${a.id}/block`, { method: 'PUT', cookie: b.cookie })).status).toBeLessThan(300);
    expect((await s.send(a, conversationId, 'still there?')).status).toBeGreaterThanOrEqual(400);
    expect((await s.send(b, conversationId, 'bye')).status).toBeGreaterThanOrEqual(400);
  });
});

describe('live delivery over the stream', () => {
  it('requires a session', async () => {
    const response = await fetch(`${s.base}/kaki/stream`);
    expect(response.status).toBe(401);
  });

  it('pushes a new message to the recipient with their unread total', async () => {
    const { a, b, conversationId } = await s.chatPair('l1');
    const live = await stream(b);
    try {
      expect(live.response.headers.get('content-type')).toContain('text/event-stream');
      await live.next('ready');
      await s.send(a, conversationId, 'live hello');
      const { data } = await live.next('message');
      expect(data.conversationId).toBe(conversationId);
      expect(data.message.body).toBe('live hello');
      expect(data.unreadFor[b.id]).toBe(1);
    } finally { live.stop(); }
  });

  it('does not push to someone outside the conversation', async () => {
    const { a, conversationId } = await s.chatPair('l2');
    const outsider = await s.user('outsider-l2');
    const live = await stream(outsider);
    try {
      await live.next('ready');
      await s.send(a, conversationId, 'private');
      await new Promise(resolve => setTimeout(resolve, 300));
      expect(live.events.map(e => e.type)).not.toContain('message');
    } finally { live.stop(); }
  });
});
