// @vitest-environment node
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const source = readFileSync(new URL('../../../client/public/sw.js', import.meta.url), 'utf8');
const origin = 'https://encore.test';

/** Run sw.js against a fake ServiceWorkerGlobalScope and return its listeners. */
function loadWorker({ fetchResult, windows = [] } = {}) {
  const listeners = {};
  const self = {
    location: { origin },
    addEventListener: (type, fn) => { listeners[type] = fn; },
    registration: { showNotification: vi.fn(async () => {}) },
    clients: { matchAll: vi.fn(async () => windows), openWindow: vi.fn(async () => {}) },
  };
  const fetch = vi.fn(async () => fetchResult);
  new Function('self', 'fetch', source)(self, fetch);
  const fire = async (type, event) => {
    let pending;
    listeners[type]({ ...event, waitUntil: p => { pending = p; } });
    await pending;
  };
  return { self, fetch, fire };
}
const pushEvent = payload => ({ data: { json: () => payload } });
const okResponse = notification => ({ ok: true, json: async () => ({ notification }) });

describe('push handling', () => {
  let note;
  beforeEach(() => { note = { id: 'n1', title: 'You have a new message', path: '/kaki/chat/c1', category: 'chat' }; });

  it('looks the notification up by id and shows the server-provided title', async () => {
    const w = loadWorker({ fetchResult: okResponse(note) });
    await w.fire('push', pushEvent({ notificationId: 'n1', subscriptionId: 's1' }));
    expect(w.fetch).toHaveBeenCalledWith('/api/me/push/notifications/n1?subscriptionId=s1', expect.objectContaining({ credentials: 'same-origin' }));
    expect(w.self.registration.showNotification).toHaveBeenCalledWith('Encore', expect.objectContaining({
      body: 'You have a new message', tag: 'encore:n1', data: { path: '/kaki/chat/c1' },
    }));
  });

  it('tells open windows so the bell can refresh', async () => {
    const tab = { postMessage: vi.fn(), url: `${origin}/` };
    const w = loadWorker({ fetchResult: okResponse(note), windows: [tab] });
    await w.fire('push', pushEvent({ notificationId: 'n1', subscriptionId: 's1' }));
    expect(tab.postMessage).toHaveBeenCalledWith({ type: 'encore-notification' });
  });

  it.each([
    ['a malformed payload', pushEvent({ notificationId: 5 }), okResponse(note)],
    ['a revoked or read notification', pushEvent({ notificationId: 'n1', subscriptionId: 's1' }), { ok: false }],
    ['an off-site link', pushEvent({ notificationId: 'n1', subscriptionId: 's1' }), okResponse({ ...note, path: '//evil.test/x' })],
  ])('shows nothing for %s', async (_label, event, fetchResult) => {
    const w = loadWorker({ fetchResult });
    await w.fire('push', event);
    expect(w.self.registration.showNotification).not.toHaveBeenCalled();
  });
});

describe('notification click', () => {
  const clickEvent = path => ({ notification: { close: vi.fn(), data: { path } } });

  it('focuses an existing tab and navigates it to the notification', async () => {
    const tab = { url: `${origin}/concerts`, navigate: vi.fn(async () => {}), focus: vi.fn(async () => {}) };
    const w = loadWorker({ windows: [tab] });
    const event = clickEvent('/kaki/chat/c1');
    await w.fire('notificationclick', event);
    expect(event.notification.close).toHaveBeenCalled();
    expect(tab.navigate).toHaveBeenCalledWith(`${origin}/kaki/chat/c1`);
    expect(tab.focus).toHaveBeenCalled();
  });

  it('opens a new window when none is open', async () => {
    const w = loadWorker();
    await w.fire('notificationclick', clickEvent('/groups'));
    expect(w.self.clients.openWindow).toHaveBeenCalledWith(`${origin}/groups`);
  });
});
