import { test, expect } from '@playwright/test';
import { api, chatPair, fixture, person } from './support.js';

test('a message sent in the browser appears live for the other person and clears their badge on read', async ({ browser, request }) => {
  const data = await fixture(request);
  const alice = await person(browser, data, 'hostA');
  const bob = await person(browser, data, 'seeker');
  try {
    const conversationId = await chatPair(data, alice, bob);

    // Bob is elsewhere on the site with the live stream open.
    await bob.page.goto('/concerts');
    await expect(bob.page.getByLabel(/unread chat/)).toHaveCount(0);

    await alice.page.goto(`/kaki/chat/${conversationId}`);
    await alice.page.getByLabel('Message', { exact: true }).fill('Meet at gate 3?');
    await alice.page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(alice.page.locator('.bubble__body', { hasText: 'Meet at gate 3?' })).toBeVisible();

    // Delivered over the stream, without a reload.
    await expect(bob.page.getByLabel('1 unread chat')).toBeVisible();

    await bob.page.goto(`/kaki/chat/${conversationId}`);
    await expect(bob.page.locator('.bubble__body', { hasText: 'Meet at gate 3?' })).toBeVisible();
    await expect(bob.page.getByLabel(/unread chat/)).toHaveCount(0);

    // Reply arrives live in Alice's open thread.
    await bob.page.getByLabel('Message', { exact: true }).fill('Yes, 7pm');
    await bob.page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(alice.page.locator('.bubble__body', { hasText: 'Yes, 7pm' })).toBeVisible();
  } finally { await alice.context.close(); await bob.context.close(); }
});

test('the send button stays disabled for an empty message', async ({ browser, request }) => {
  const data = await fixture(request);
  const alice = await person(browser, data, 'hostA');
  const bob = await person(browser, data, 'seeker');
  try {
    const conversationId = await chatPair(data, alice, bob);
    await alice.page.goto(`/kaki/chat/${conversationId}`);
    const send = alice.page.getByRole('button', { name: 'Send', exact: true });
    await expect(send).toBeDisabled();
    await alice.page.getByLabel('Message', { exact: true }).fill('   ');
    await expect(send).toBeDisabled();
  } finally { await alice.context.close(); await bob.context.close(); }
});

test('someone outside the conversation cannot open it', async ({ browser, request }) => {
  const data = await fixture(request);
  const alice = await person(browser, data, 'hostA');
  const bob = await person(browser, data, 'seeker');
  const outsider = await person(browser, data, 'outsider');
  try {
    const conversationId = await chatPair(data, alice, bob);
    await api(alice.context, `/kaki/conversations/${conversationId}/messages`, 'POST', { body: 'private' });
    await outsider.page.goto(`/kaki/chat/${conversationId}`);
    await expect(outsider.page.locator('.bubble__body', { hasText: 'private' })).toHaveCount(0);
    const response = await outsider.context.request.get(`/api/kaki/conversations/${conversationId}`, { headers: { 'X-Requested-With': 'Encore' } });
    expect(response.status()).toBe(404);
  } finally { await alice.context.close(); await bob.context.close(); await outsider.context.close(); }
});
