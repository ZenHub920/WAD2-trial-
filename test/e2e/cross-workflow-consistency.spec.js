import { test, expect } from '../support/playwright.mjs';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { api, fixture, person, origin, chatPair } from './support.js';

async function capture(page, name) {
  if (!process.env.ENCORE_UX_CAPTURE_DIR) return;
  mkdirSync(process.env.ENCORE_UX_CAPTURE_DIR, { recursive: true });
  await page.screenshot({ path: join(process.env.ENCORE_UX_CAPTURE_DIR, `final-cross-workflow-${name}.png`), animations: 'disabled' });
}

test('completed concerts close new coordination without hiding existing groups, all chat types or meetup records', async ({ browser, request }) => {
  const data = await fixture(request);
  const host = await person(browser, data, 'hostA'), otherHost = await person(browser, data, 'hostB');
  const seeker = await person(browser, data, 'seeker'), outsider = await person(browser, data, 'outsider');
  try {
    const { connection } = await api(host.context, '/group-connections', 'POST', { fromPartyId: data.parties.a, toPartyId: data.parties.b });
    await api(otherHost.context, `/group-connections/${connection.id}/respond`, 'POST', { action: 'accept' });
    const pairId = await chatPair(data, seeker, outsider);
    const { meetup } = await api(host.context, '/meetups', 'POST', { partyId: data.parties.a, title: 'Retained historical meetup', startsAt: '2030-01-01T16:00:00+08:00', endsAt: '2030-01-01T17:00:00+08:00' });
    const finished = await request.post('http://127.0.0.1:3105/__test/finish-concert', { data: { concertId: data.concertId } });
    expect(finished.ok()).toBeTruthy();
    for (const [actor, path, method, body] of [
      [host, `/concerts/${data.concertId}/participation`, 'POST', { sectionPref: 'pit', arrivalPref: 'doors' }],
      [seeker, `/kaki/decisions/${data.concertId}/${outsider.id}`, 'PUT', { decision: 'like' }],
      [seeker, `/groups/${data.parties.a}/join-requests`, 'POST', { note: 'Too late' }],
    ]) {
      const response = await actor.context.request.fetch(`${origin}/api${path}`, { method, headers: { Origin: origin }, data: body });
      expect(response.status()).toBe(409); expect(await response.json()).toEqual({ error: 'concert_finished' });
    }
    await host.page.goto('/groups/connect');
    await expect(host.page.getByRole('heading', { name: 'No upcoming groups you own' })).toBeVisible();
    await host.page.locator('#historical-groups summary').click();
    await expect(host.page.locator('.historical-group')).toContainText('Supper crew');
    await expect(host.page.getByRole('link', { name: 'Open shared chat', exact: true })).toBeVisible();
    await expect(host.page.getByRole('button', { name: 'View meetup history' })).toBeVisible();
    await capture(host.page, 'historical-workspace');
    for (const theme of ['light', 'dark']) {
      await host.page.evaluate(value => localStorage.setItem('encore-theme', value), theme);
      await host.page.reload(); await host.page.locator('#historical-groups summary').click();
      for (const width of [320, 360, 390, 768, 1024, 1440]) {
        await host.page.setViewportSize({ width, height: width < 600 ? 844 : 1000 });
        await expect(host.page.locator('.historical-group .btn').first()).toBeVisible();
        expect(await host.page.evaluate(() => document.documentElement.scrollWidth - innerWidth), `historical ${theme} ${width}`).toBeLessThanOrEqual(1);
        if ([390, 1440].includes(width)) { await host.page.locator('#historical-groups').scrollIntoViewIfNeeded(); await capture(host.page, `historical-${theme}-${width}`); }
      }
    }
    await host.page.goto(`/groups/${data.parties.a}/channel`);
    await expect(host.page.getByLabel('Message the group', { exact: true })).toBeVisible();
    await host.page.goto(`/groups/connections/${connection.id}/channel`);
    await expect(host.page.locator('.connection-channel')).toBeVisible();
    await seeker.page.goto(`/kaki/chat/${pairId}`);
    await expect(seeker.page.getByLabel('Message', { exact: true })).toBeVisible();
    expect((await api(seeker.context, `/kaki/conversations/${pairId}`)).conversation.id).toBe(pairId);
    await host.page.goto(`/meetups/${meetup.id}`);
    await expect(host.page.getByRole('heading', { name: 'Retained historical meetup', exact: true })).toBeVisible();
    await seeker.page.goto(`/groups?concertId=${data.concertId}`);
    await expect(seeker.page.getByText(/This concert has finished. New group matching is closed/)).toBeVisible();
    await expect(seeker.page.getByRole('button', { name: 'Join the match list', exact: true })).toHaveCount(0);
    await expect(seeker.page.getByRole('button', { name: 'Save my answers', exact: true })).toHaveCount(0);
    await seeker.page.goto('/kaki');
    await expect(seeker.page.getByText(/Join an upcoming or ongoing concert/)).toBeVisible();
  } finally { await Promise.all([host.context.close(), otherHost.context.close(), seeker.context.close(), outsider.context.close()]); }
});

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
    await host.page.getByRole('button', { name: 'Create draft group', exact: true }).click();
    await expect(host.page.getByText('A group you own for this concert was found.', { exact: false })).toBeVisible();
    await expect(host.page.getByRole('button', { name: 'Create draft group', exact: true })).toHaveCount(0);
    expect(creates).toBe(1);
    const groups = (await api(host.context, '/me/hosted-groups')).groups.filter(group => group.concertId === concert.id);
    expect(groups).toHaveLength(1);
    await capture(host.page, 'lost-response-recovered');
    await host.page.getByRole('button', { name: 'Open created group', exact: true }).click();
    await expect(host.page).toHaveURL(new RegExp(`/groups/${groups[0].id}/members$`));
    expect(creates).toBe(1);
  } finally { await host.context.close(); }
});
