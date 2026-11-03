import { test, expect } from '../support/playwright.mjs';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { api, fixture, person, origin } from './support.js';

const live = page => page.evaluate(async () => (await import('/src/chatLive.js')).connectionState.value);
async function capture(page, name) {
  if (!process.env.ENCORE_UX_CAPTURE_DIR) return;
  mkdirSync(process.env.ENCORE_UX_CAPTURE_DIR, { recursive: true });
  await page.screenshot({ path: join(process.env.ENCORE_UX_CAPTURE_DIR,
    `${process.env.ENCORE_UX_CAPTURE_PHASE ?? 'final'}-group-realtime-${name}.png`), animations: 'disabled' });
}
async function send(actor, text) {
  await actor.page.getByLabel('Message the group', { exact: true }).fill(text);
  await actor.page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(actor.page.locator('.msg__text', { hasText: text })).toBeVisible();
}

test('reading a group in one authenticated context immediately clears the same user chat and inbox badges in another', async ({ browser, request }) => {
  const data = await fixture(request);
  const host = await person(browser, data, 'hostA');
  const reader = await person(browser, data, 'friendA');
  const secondTab = await person(browser, data, 'friendA');
  try {
    for (const actor of [reader, secondTab]) {
      await actor.page.goto('/concerts');
      await expect.poll(() => live(actor.page)).toBe('live');
    }
    await host.page.goto(`/groups/${data.parties.a}/channel`);
    await send(host, 'Same account read synchronization');
    for (const actor of [reader, secondTab]) {
      await expect(actor.page.getByLabel('1 unread chat', { exact: true })).toBeVisible();
      await actor.page.locator('.notification-bell__button').click();
      await expect(actor.page.locator('#notification-popover')).toContainText('Message from hostA');
      await expect(actor.page.locator('.notification-bell__button')).toHaveAttribute('aria-label', 'Notifications, 1 unread');
      await actor.page.keyboard.press('Escape');
    }
    await capture(secondTab.page, 'before-read');
    await reader.page.goto(`/groups/${data.parties.a}/channel`);
    await expect(reader.page.locator('.msg__text', { hasText: 'Same account read synchronization' })).toBeVisible();
    await expect(secondTab.page.getByLabel(/unread chat/)).toHaveCount(0);
    await expect(secondTab.page.locator('.notification-bell__button')).toHaveAttribute('aria-label', 'Notifications');
    expect((await api(secondTab.context, '/group-channels/unread')).total).toBe(0);
    expect((await api(secondTab.context, '/me/notifications/unread')).unread).toBe(0);
    await capture(secondTab.page, 'after-read');
  } finally { await Promise.all([host.context.close(), reader.context.close(), secondTab.context.close()]); }
});

test('native EventSource reconnect recovers messages missed while offline without duplicating previously displayed messages', async ({ browser, request }) => {
  const data = await fixture(request), host = await person(browser, data, 'hostA'), member = await person(browser, data, 'friendA');
  try {
    await host.page.goto(`/groups/${data.parties.a}/channel`);
    await member.page.goto(`/groups/${data.parties.a}/channel`);
    await expect.poll(() => live(member.page)).toBe('live');
    await send(host, 'Visible before disconnect');
    await expect(member.page.locator('.msg__text', { hasText: 'Visible before disconnect' })).toBeVisible();
    await member.page.evaluate(async () => {
      window.encoreReconnects = 0;
      (await import('/src/chatLive.js')).onChatEvent(type => { if (type === 'ready') window.encoreReconnects++; });
    });
    await member.context.setOffline(true);
    // Chromium's offline emulation does not terminate an already-open SSE
    // socket. End the real test server streams, then let EventSource retry.
    const dropped = await request.post('http://127.0.0.1:3105/__test/disconnect-streams');
    expect(dropped.ok()).toBeTruthy();
    expect((await dropped.json()).disconnected).toBeGreaterThanOrEqual(2);
    await expect.poll(() => live(member.page)).toBe('connecting');
    await send(host, 'Persisted while the member is offline');
    await expect(member.page.locator('.msg__text', { hasText: 'Persisted while the member is offline' })).toHaveCount(0);
    await member.context.setOffline(false);
    await expect.poll(() => live(member.page), { timeout: 20000 }).toBe('live');
    await expect.poll(() => member.page.evaluate(() => window.encoreReconnects)).toBeGreaterThan(0);
    await expect(member.page.locator('.msg__text', { hasText: 'Persisted while the member is offline' })).toBeVisible();
    await expect(member.page.locator('.msg__text', { hasText: 'Visible before disconnect' })).toHaveCount(1);
    await expect(member.page.locator('.msg')).toHaveCount(2);
    await member.page.reload();
    await expect(member.page.locator('.msg')).toHaveCount(2);
    await capture(member.page, 'reconnected-persisted-messages');
  } finally { await member.context.setOffline(false); await Promise.all([host.context.close(), member.context.close()]); }
});

test('a group departure invalidates an already open room and prevents later private events and direct reads', async ({ browser, request }) => {
  const data = await fixture(request), host = await person(browser, data, 'hostA'), member = await person(browser, data, 'friendA');
  try {
    await host.page.goto(`/groups/${data.parties.a}/channel`);
    await member.page.goto(`/groups/${data.parties.a}/channel`);
    await expect.poll(() => live(member.page)).toBe('live');
    await send(host, 'Authorized history before departure');
    await expect(member.page.locator('.msg__text', { hasText: 'Authorized history before departure' })).toBeVisible();
    await member.page.evaluate(async () => {
      window.encorePrivateGroupEvents = [];
      (await import('/src/chatLive.js')).onChatEvent((type, data) => {
        if (type === 'group-message') window.encorePrivateGroupEvents.push(data);
      });
    });
    await api(member.context, `/groups/${data.parties.a}/leave`, 'POST');
    await expect(member.page.getByRole('heading', { name: 'This channel is not open to you' })).toBeVisible();
    await expect(member.page.getByLabel('Message the group', { exact: true })).toHaveCount(0);
    await send(host, 'Private content after departure');
    const response = await member.context.request.get(`${origin}/api/group-channels/${data.parties.a}`);
    expect(response.status()).toBe(404);
    await expect(member.page.locator('.msg__text', { hasText: 'Private content after departure' })).toHaveCount(0);
    expect(await member.page.evaluate(() => window.encorePrivateGroupEvents)).toEqual([]);
    expect((await api(member.context, '/group-channels/unread')).total).toBe(0);
    await capture(member.page, 'revoked-room');
  } finally { await Promise.all([host.context.close(), member.context.close()]); }
});
