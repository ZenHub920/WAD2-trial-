import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fixture, person, api } from './support.js';

test('creation retries: lost responses replay the committed payload, while edited definite rejections get a new identity', async ({ browser, request }) => {
  const data = await fixture(request), host = await person(browser, data, 'hostA');
  const payloads = [];
  let loseResponse = true, rejectNext = false;
  try {
    // Model an interrupted connection losing both the response and live events.
    // With SSE available, the valid active-plan refresh can resume the committed
    // board before a person needs to replay; existing navigation tests cover that.
    await host.page.route('**/api/kaki/stream', route => route.abort());
    await host.page.setViewportSize({ width: 390, height: 844 });
    await host.page.goto(`/meetups?partyId=${data.parties.a}`);
    const form = host.page.locator('#meetup-creation-area form');
    await expect(form).toBeVisible();
    await host.page.route('**/api/meetups', async route => {
      if (route.request().method() !== 'POST') return route.continue();
      payloads.push(route.request().postDataJSON());
      if (rejectNext) {
        rejectNext = false;
        return route.fulfill({ status: 400, json: { error: 'invalid_meetup_title' } });
      }
      if (loseResponse) {
        loseResponse = false;
        const response = await route.fetch();
        expect(response.ok()).toBe(true); // The real API committed before the response was lost.
        return route.abort('failed');
      }
      return route.continue();
    });
    await form.getByRole('button', { name: 'Create planning board', exact: true }).click();
    await expect(form.getByRole('button', { name: 'Check previous attempt', exact: true })).toBeVisible();
    await form.getByLabel('Title', { exact: true }).fill('This edit must not create another board');
    if (process.env.ENCORE_UX_CAPTURE_DIR) {
      mkdirSync(process.env.ENCORE_UX_CAPTURE_DIR, { recursive: true });
      await host.page.screenshot({ path: join(process.env.ENCORE_UX_CAPTURE_DIR, `${process.env.ENCORE_UX_CAPTURE_PHASE ?? 'final'}-hardening-creation-uncertain-390.png`) });
    }
    await form.getByRole('button', { name: 'Check previous attempt', exact: true }).click();
    await expect(host.page).toHaveURL(/\/meetups\/[^/?#]+/);
    expect(payloads).toHaveLength(2);
    expect(payloads[1]).toEqual(payloads[0]);
    expect((await api(host.context, `/me/meetups?partyId=${data.parties.a}`)).meetups).toHaveLength(1);

    await host.page.goto(`/meetups?partyId=${data.parties.a}`);
    await host.page.getByRole('button', { name: 'Create a separate plan', exact: true }).click();
    rejectNext = true;
    await form.getByLabel('Title', { exact: true }).fill('A rejected separate arrangement');
    await form.getByRole('button', { name: 'Create planning board', exact: true }).click();
    await expect(form.getByRole('alert')).toBeVisible();
    await expect(form.getByRole('button', { name: 'Create planning board', exact: true })).toBeEnabled();
    await form.getByLabel('Title', { exact: true }).fill('A different separate arrangement');
    await form.getByRole('button', { name: 'Create planning board', exact: true }).click();
    await expect(host.page).toHaveURL(/\/meetups\/[^/?#]+/);
    expect(payloads).toHaveLength(4);
    expect(payloads[2].createAnother).toBe(true);
    expect(payloads[3].creationRequestId).not.toBe(payloads[2].creationRequestId);
    expect(payloads[3].title).toBe('A different separate arrangement');
    expect((await api(host.context, `/me/meetups?partyId=${data.parties.a}`)).meetups).toHaveLength(2);
  } finally { await host.context.close(); }
});
