import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { nextTick } from 'vue';

vi.mock('../../../client/src/api.js', async () => ({ notificationRevision: (await import('vue')).ref(0), api: {
  kakiUnread: vi.fn(), groupChannelsUnread: vi.fn(),
} }));

/** Minimal EventSource stand-in that lets a test emit server events. */
class FakeEventSource {
  static instances = [];
  constructor(url) { this.url = url; this.listeners = {}; this.closed = false; FakeEventSource.instances.push(this); }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  close() { this.closed = true; }
  emit(type, data) { for (const fn of this.listeners[type] ?? []) fn({ data: typeof data === 'string' ? data : JSON.stringify(data) }); }
}

let api, auth, live;
beforeEach(async () => {
  vi.resetModules();
  FakeEventSource.instances = [];
  vi.stubGlobal('EventSource', FakeEventSource);
  ({ api } = await import('../../../client/src/api.js'));
  api.kakiUnread.mockResolvedValue({ total: 2 });
  api.groupChannelsUnread.mockResolvedValue({ total: 1 });
  auth = await import('../../../client/src/auth.js');
  live = await import('../../../client/src/chatLive.js');
});
afterEach(() => { vi.unstubAllGlobals(); });

async function signIn(id = 'me') {
  auth.currentUser.value = { id };
  await nextTick();
  await flushPromises();
  return FakeEventSource.instances.at(-1);
}

describe('live chat connection', () => {
  it('opens no stream while signed out', () => {
    expect(FakeEventSource.instances).toHaveLength(0);
    expect(live.connectionState.value).toBe('idle');
  });

  it('opens one stream on sign-in and sums unread across chat kinds', async () => {
    const source = await signIn();
    expect(source.url).toBe('/api/kaki/stream');
    expect(live.connectionState.value).toBe('connecting');
    source.emit('ready', {});
    await flushPromises();
    expect(live.connectionState.value).toBe('live');
    expect(live.unreadTotal.value).toBe(3);
  });

  it('refreshes the badge and notifies views when a message arrives', async () => {
    const source = await signIn();
    const seen = [];
    const off = live.onChatEvent((type, data) => seen.push([type, data]));
    api.kakiUnread.mockResolvedValue({ total: 5 });
    source.emit('message', { conversationId: 'c1', message: { body: 'hi' } });
    await flushPromises();
    expect(seen).toContainEqual(['message', { conversationId: 'c1', message: { body: 'hi' } }]);
    expect(live.unreadTotal.value).toBe(6);
    off();
    source.emit('message', { conversationId: 'c2' });
    expect(seen.filter(([, d]) => d.conversationId === 'c2')).toHaveLength(0);
  });

  it("only refreshes on a read receipt when it is the user's own read", async () => {
    const source = await signIn();
    await flushPromises();
    api.kakiUnread.mockClear();
    source.emit('read', { readerId: 'someone-else' });
    await flushPromises();
    expect(api.kakiUnread).not.toHaveBeenCalled();
    source.emit('read', { readerId: 'me' });
    await flushPromises();
    expect(api.kakiUnread).toHaveBeenCalledTimes(1);
  });

  it('ignores malformed event data', async () => {
    const source = await signIn();
    const handler = vi.fn();
    live.onChatEvent(handler);
    source.emit('message', '{not json');
    expect(handler).not.toHaveBeenCalled();
  });

  it('shows reconnecting on a dropped connection', async () => {
    const source = await signIn();
    source.emit('ready', {});
    source.emit('error', {});
    expect(live.connectionState.value).toBe('connecting');
  });

  it('closes the stream and clears the badge on sign-out', async () => {
    const source = await signIn();
    source.emit('ready', {});
    await flushPromises();
    auth.currentUser.value = null;
    await nextTick();
    expect(source.closed).toBe(true);
    expect(live.unreadTotal.value).toBe(0);
    expect(live.connectionState.value).toBe('idle');
  });

  it('resynchronizes the same user group read and inbox across tabs without forwarding an unrelated read', async () => {
    const source = await signIn();
    const { notificationRevision } = await import('../../../client/src/api.js');
    const revision = notificationRevision.value;
    api.groupChannelsUnread.mockResolvedValue({ total: 0 });
    source.emit('group-read', { partyId: 'group', readerId: 'me', lastReadSeq: 5 });
    await flushPromises();
    expect(live.unreadTotal.value).toBe(2);
    expect(notificationRevision.value).toBe(revision + 1);
    api.groupChannelsUnread.mockClear();
    source.emit('group-read', { partyId: 'group', readerId: 'other', lastReadSeq: 5 });
    await flushPromises();
    expect(api.groupChannelsUnread).not.toHaveBeenCalled();
    expect(notificationRevision.value).toBe(revision + 1);
  });

  it('ignores queued events from the previous account stream and stale unread responses after switching', async () => {
    const old = await signIn('old');
    const seen = vi.fn(); live.onChatEvent(seen);
    let resolveOld;
    api.groupChannelsUnread.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
    const stale = live.refreshUnread();
    await signIn('new');
    expect(old.closed).toBe(true);
    old.emit('message', { conversationId: 'private-old', message: { body: 'must be ignored' } });
    old.emit('ready', {}); old.emit('error', {});
    resolveOld({ total: 999 }); await stale; await flushPromises();
    expect(seen).not.toHaveBeenCalled();
    expect(live.unreadTotal.value).toBe(3);
    expect(live.connectionState.value).toBe('connecting');
  });
});
