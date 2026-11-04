import { test, expect } from '../support/playwright.mjs';
import { api, chatPair, fixture, person } from './support.js';

const bell = page => page.locator('.notification-bell__button');

test('a chat message shows in the bell, links to the thread, and clears once read', async ({ browser, request }) => {
  const data = await fixture(request);
  const alice = await person(browser, data, 'hostA');
  const bob = await person(browser, data, 'seeker');
  try {
    const conversationId = await chatPair(data, alice, bob);
    await api(alice.context, `/kaki/conversations/${conversationId}/messages`, 'POST', { body: 'hello' });

    await bob.page.goto('/concerts');
    await expect(bell(bob.page)).toHaveAttribute('aria-label', 'Notifications, 1 unread');
    await bell(bob.page).click();
    const item = bob.page.locator('#notification-popover').getByRole('link', { name: 'Message from hostA' });
    await expect(item).toBeVisible();

    await item.click();
    await expect(bob.page).toHaveURL(new RegExp(`/kaki/chat/${conversationId}$`));
    await expect(bob.page.locator('.bubble__body', { hasText: 'hello' })).toBeVisible();

    // Opening the thread removes the chat notification.
    await expect.poll(async () => (await api(bob.context, '/me/notifications/unread')).unread).toBe(0);
    await bob.page.reload();
    await expect(bell(bob.page)).toHaveAttribute('aria-label', 'Notifications');
  } finally { await alice.context.close(); await bob.context.close(); }
});

test('several messages from one person are a single notification', async ({ browser, request }) => {
  const data = await fixture(request);
  const alice = await person(browser, data, 'hostA');
  const bob = await person(browser, data, 'seeker');
  try {
    const conversationId = await chatPair(data, alice, bob);
    for (const body of ['one', 'two', 'three']) {
      await api(alice.context, `/kaki/conversations/${conversationId}/messages`, 'POST', { body });
    }
    await bob.page.goto('/concerts');
    await expect(bell(bob.page)).toHaveAttribute('aria-label', 'Notifications, 1 unread');
  } finally { await alice.context.close(); await bob.context.close(); }
});

test('mark read keeps a non-chat notification as history', async ({ browser, request }) => {
  const data = await fixture(request);
  const host = await person(browser, data, 'hostA');
  const other = await person(browser, data, 'hostB');
  try {
    // A group invite notifies the receiving group's host.
    await api(host.context, '/group-connections', 'POST', { fromPartyId: data.parties.a, toPartyId: data.parties.b });
    await other.page.goto('/concerts');
    await expect(bell(other.page)).toHaveAttribute('aria-label', /1 unread/);
    await bell(other.page).click();
    const popover = other.page.locator('#notification-popover');
    await expect(popover.locator('.notification-popover__meta').filter({ hasText: /· Unread$/ })).toBeVisible();
    await popover.getByRole('button', { name: 'Mark read' }).click();
    await expect(popover.getByRole('button', { name: 'Mark read' })).toHaveCount(0);
    await expect(popover.getByText(/· Read/)).toBeVisible();
    await expect(bell(other.page)).toHaveAttribute('aria-label', 'Notifications');
  } finally { await host.context.close(); await other.context.close(); }
});

test('turning off chat notifications in the profile stops new ones', async ({ browser, request }) => {
  const data = await fixture(request);
  const alice = await person(browser, data, 'hostA');
  const bob = await person(browser, data, 'seeker');
  try {
    const conversationId = await chatPair(data, alice, bob);
    await bob.page.goto('/profile#notifications');
    await bob.page.getByLabel(/Companion and ticket messages/).uncheck();
    await bob.page.getByRole('button', { name: 'Save notification preferences' }).click();
    await expect(bob.page.getByText('Notification preferences saved.')).toBeVisible();

    await api(alice.context, `/kaki/conversations/${conversationId}/messages`, 'POST', { body: 'muted?' });
    expect((await api(bob.context, '/me/notifications/unread')).unread).toBe(0);
  } finally { await alice.context.close(); await bob.context.close(); }
});
