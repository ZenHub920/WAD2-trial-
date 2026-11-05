import { test, expect } from '../support/playwright.mjs';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { api, fixture, person, origin, chatPair } from './support.js';

async function capture(page, name) {
  if (!process.env.ENCORE_UX_CAPTURE_DIR) return;
  mkdirSync(process.env.ENCORE_UX_CAPTURE_DIR, { recursive: true });
  await page.screenshot({ path: join(process.env.ENCORE_UX_CAPTURE_DIR, `final-cross-workflow-${name}.png`), animations: 'disabled' });
}

test('a catalogue failure leaves owned and joined chats usable and retries only the failed read', async ({ browser, request }) => {
  const data = await fixture(request), host = await person(browser, data, 'hostA'), member = await person(browser, data, 'friendA');
  try {
    for (const actor of [host, member]) {
      await actor.page.route('**/api/concerts', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"synthetic_catalogue_failure"}' }));
      await actor.page.goto('/groups/connect');
      await expect(actor.page.getByText('Could not load concerts.', { exact: false })).toBeVisible();
      await expect(actor.page.locator(`a[href="/groups/${data.parties.a}/channel"]`)).toBeVisible();
      await actor.page.unroute('**/api/concerts');
      let unrelatedReads = 0;
      const count = req => { if (/\/api\/(me\/groups|group-connections)/.test(req.url())) unrelatedReads++; };
      actor.page.on('request', count);
      await actor.page.getByRole('button', { name: 'Retry concerts', exact: true }).click();
      await expect(actor.page.getByRole('button', { name: 'Retry concerts', exact: true })).toHaveCount(0);
      expect(unrelatedReads).toBe(0); actor.page.off('request', count);
      await actor.page.locator(`a[href="/groups/${data.parties.a}/channel"]`).click();
      await expect(actor.page.getByLabel('Message the group', { exact: true })).toBeVisible();
    }
  } finally { await Promise.all([host.context.close(), member.context.close()]); }
});

test('a lost successful creation response reconciles the existing group instead of creating a duplicate', async ({ browser, request }) => {
  const data = await fixture(request), host = await person(browser, data, 'hostA');
  try {
    const { concert } = await api(host.context, '/concerts', 'POST', { artist: `Creation recovery ${data.suffix}`, venue: 'Indoor Stadium', event_date: '2030-01-01' });
    let creates = 0;
    await host.page.route(`**/api/concerts/${concert.id}/parties`, async route => {
      if (route.request().method() !== 'POST') return route.continue();
      creates++; const response = await route.fetch(); expect(response.ok()).toBeTruthy();
      await route.abort('failed');
    });
    await host.page.goto(`/groups/connect?view=create&concertId=${concert.id}`);
    await host.page.getByLabel(/^Group name/).fill('Recovered crew');
    await host.page.getByRole('button', { name: 'Create group', exact: true }).click();
    await expect(host.page.getByText('A group you own for this concert was found.', { exact: false })).toBeVisible();
    await expect(host.page.getByRole('button', { name: 'Create group', exact: true })).toHaveCount(0);
    expect(creates).toBe(1);
    const groups = (await api(host.context, '/me/hosted-groups')).groups.filter(group => group.concertId === concert.id);
    expect(groups).toHaveLength(1);
    await capture(host.page, 'lost-response-recovered');
    await host.page.getByRole('button', { name: 'Open created group', exact: true }).click();
    await expect(host.page).toHaveURL(new RegExp(`/groups/${groups[0].id}/members$`));
    expect(creates).toBe(1);
  } finally { await host.context.close(); }
});
