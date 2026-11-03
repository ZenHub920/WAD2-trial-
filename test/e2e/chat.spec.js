import { test, expect } from '../support/playwright.mjs';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
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

test('chat message bubbles and compact option controls stay together despite global layout utilities', async ({ browser, request }) => {
  const data = await fixture(request);
  const alice = await person(browser, data, 'hostA');
  const bob = await person(browser, data, 'seeker');
  try {
    const conversationId = await chatPair(data, alice, bob);
    const messages = ['Meet at gate three', 'On my way'];
    await api(alice.context, `/kaki/conversations/${conversationId}/messages`, 'POST', { body: messages[0] });
    await api(bob.context, `/kaki/conversations/${conversationId}/messages`, 'POST', { body: messages[1] });
    for (const width of [390, 1440]) for (const [name, actor] of [['sender', alice], ['receiver', bob]]) {
      await test.step(`${name} at ${width}px`, async () => {
        await actor.page.setViewportSize({ width, height: 1000 });
        await actor.page.bringToFront();
        await actor.page.goto(`/kaki/chat/${conversationId}`);
        const stream = actor.page.locator('.scroll');
        await expect(stream).toBeVisible();
        for (const message of messages) {
          const body = actor.page.locator('.bubble__body').filter({ hasText: new RegExp(`^${message}$`) });
          await expect(body).toBeVisible();
          const bubble = body.locator('..');
          const row = bubble.locator('..');
          const options = row.getByRole('button', { name: 'Options for this message', exact: true });
          await options.focus();
          // Planner status can finish loading above the chat between awaits.
          // Read all three boxes in one frame so page movement cannot look
          // like the button and bubble are on different physical rows.
          const { control, content, viewport } = await row.evaluate(element => {
            const box = selector => selector.getBoundingClientRect().toJSON();
            return {
              control: box(element.querySelector('[aria-label="Options for this message"]')),
              content: box(element.querySelector('.bubble')),
              viewport: box(element.closest('.scroll')),
            };
          });
          expect(control.width, 'Message options remain a compact touch target').toBeGreaterThanOrEqual(44);
          expect(control.width, 'Global grid rules must not stretch message options to full width').toBeLessThanOrEqual(64);
          expect(control.height).toBeGreaterThanOrEqual(44);
          expect(Math.abs((control.y + control.height / 2) - (content.y + content.height / 2)), 'Options remain on the same physical row as the message bubble').toBeLessThanOrEqual(2);
          expect(control.x + control.width <= content.x + 1 || content.x + content.width <= control.x + 1, 'Options must not overlap message text').toBe(true);
          for (const box of [control, content]) {
            expect(box.x).toBeGreaterThanOrEqual(viewport.x - 1);
            expect(box.x + box.width).toBeLessThanOrEqual(viewport.x + viewport.width + 1);
            expect(box.x).toBeGreaterThanOrEqual(0);
            expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
          }
          await options.click();
          await expect(row.getByRole('menu').getByRole('button', { name: 'Reply', exact: true })).toBeVisible();
          await options.click();
        }
        expect(await stream.evaluate(element => element.scrollWidth - element.clientWidth), 'The conversation must not scroll sideways').toBeLessThanOrEqual(1);
        expect(await actor.page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
        const directory = process.env.ENCORE_UX_CAPTURE_DIR;
        if (directory) {
          mkdirSync(directory, { recursive: true });
          await actor.page.screenshot({ path: join(directory, `${process.env.ENCORE_UX_CAPTURE_PHASE ?? 'final'}-integration-chat-${name}-${width}.png`), animations: 'disabled' });
        }
      });
    }
  } finally { await alice.context.close(); await bob.context.close(); }
});
