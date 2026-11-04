import { test, expect } from '../support/playwright.mjs';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { api, fixture, person } from './support.js';

const emptyTitle = 'No suitable groups matching your preferences were found.';

async function capture(page, name) {
  if (!process.env.ENCORE_UX_CAPTURE_DIR) return;
  mkdirSync(process.env.ENCORE_UX_CAPTURE_DIR, { recursive: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: join(process.env.ENCORE_UX_CAPTURE_DIR, `group-results-${name}.png`),
    fullPage: true, animations: 'disabled' });
}

async function personalResultsFixture(browser, request) {
  const data = await fixture(request);
  const host = await person(browser, data, 'hostB');
  const outsider = await person(browser, data, 'outsider');
  try {
    // One ordinary settings change leaves exactly one publicly open group.
    await api(host.context, `/groups/${data.parties.b}/settings`, 'PUT', { expectedFriends: 1, strangerPlaces: 0 });
    // This account's own concert plans differ from the original seeker's plans.
    await api(outsider.context, `/concerts/${data.concertId}/requests`, 'POST', {
      section_pref: 'standing_pen', spend_band_max: 1, arrival_pref: 'doors', joining_mode: 'direct',
    });
    return { data, outsider };
  } catch (error) {
    await outsider.context.close(); throw error;
  } finally { await host.context.close(); }
}

test('the same concert-wide count can give two accounts different personalised results without exposing exclusion details', async ({ browser, request }) => {
  const { data, outsider } = await personalResultsFixture(browser, request);
  const seeker = await person(browser, data, 'seeker');
  try {
    for (const viewer of [seeker, outsider]) {
      const concert = (await api(viewer.context, '/concerts')).concerts.find(item => item.id === data.concertId);
      expect(concert.open_parties).toBe(1);
    }
    expect((await api(seeker.context, `/groups/discover/${data.concertId}`)).groups.map(item => item.id)).toEqual([data.parties.a]);
    const personal = await api(outsider.context, `/groups/discover/${data.concertId}`);
    expect(personal.groups).toEqual([]);
    expect(personal.discovery.state).toBe('groups_unavailable');
    await seeker.page.goto(`/groups?concertId=${data.concertId}&mode=direct`);
    await seeker.page.getByRole('button', { name: 'See all', exact: true }).click();
    await expect(seeker.page.locator(`[data-group-id="${data.parties.a}"]`)).toBeVisible();
    await outsider.page.goto(`/groups?concertId=${data.concertId}&mode=direct`);
    const empty = outsider.page.getByRole('region', { name: 'Group discovery status', exact: true });
    await expect(empty.getByRole('heading', { name: emptyTitle, exact: true })).toBeVisible();
    await expect(outsider.page.locator(`option[value="${data.concertId}"]`)).toContainText('1 open group overall');
    await expect(outsider.page.locator('.results-heading .key-figure')).toHaveText('0');
    const scope = outsider.page.locator('[aria-label="About your group results"]');
    await expect(scope).toContainText('Results are personalised.');
    await expect(scope.locator('details')).not.toHaveAttribute('open', '');
    await scope.getByText('Why these results?', { exact: true }).click();
    await expect(scope.locator('details')).toHaveAttribute('open', '');
    await expect(scope).toContainText('Two accounts can see different groups for the same concert.');
    await expect(empty.getByRole('link', { name: 'Create a group', exact: true })).toHaveAttribute('href', `/groups/connect?concertId=${data.concertId}&view=create`);
    await expect(outsider.page.locator('[data-group-id]')).toHaveCount(0);
    await expect(outsider.page.getByText(`Supper crew ${data.suffix}`, { exact: true })).toHaveCount(0);
    await capture(outsider.page, 'personalised-empty-desktop');
    expect((await api(outsider.context, '/me/group-join-requests?scope=own')).requests).toEqual([]);
  } finally { await seeker.context.close(); await outsider.context.close(); }
});

for (const theme of ['light', 'dark']) test(`personalised empty results and next actions remain usable at 390px in ${theme}`, async ({ browser, request }) => {
  const { data, outsider } = await personalResultsFixture(browser, request);
  let joiningWrites = 0;
  outsider.page.on('request', request => {
    if (request.method() !== 'GET' && /\/(?:matching(?:\/find)?|joining-mode|join-requests)(?:\?|$)/.test(new URL(request.url()).pathname)) joiningWrites++;
  });
  try {
    await outsider.context.addInitScript(value => localStorage.setItem('encore-theme', value), theme);
    await outsider.page.setViewportSize({ width: 390, height: 844 });
    await outsider.page.goto(`/groups?concertId=${data.concertId}&mode=direct`);
    await expect(outsider.page.locator('html')).toHaveAttribute('data-theme', theme);
    const empty = outsider.page.getByRole('region', { name: 'Group discovery status', exact: true });
    await expect(empty.getByRole('heading', { name: emptyTitle, exact: true })).toBeVisible();
    const summary = outsider.page.locator('[aria-label="About your group results"] summary');
    await summary.focus(); await outsider.page.keyboard.press('Enter');
    await expect(outsider.page.locator('[aria-label="About your group results"] details')).toHaveAttribute('open', '');
    await outsider.page.keyboard.press('Tab');
    await expect(outsider.page.getByRole('link', { name: 'Review my preferences', exact: true })).toBeFocused();
    const refreshed = outsider.page.waitForResponse(response => response.url().includes(`/api/groups/discover/${data.concertId}`) && response.request().method() === 'GET');
    await empty.getByRole('button', { name: 'Check again', exact: true }).focus();
    await outsider.page.keyboard.press('Enter'); await refreshed;
    await expect(empty.getByRole('heading', { name: emptyTitle, exact: true })).toBeVisible();
    await expect(empty.getByRole('link', { name: 'Create a group', exact: true })).toBeVisible();
    expect(await outsider.page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    expect((await api(outsider.context, `/me/concerts/${data.concertId}/matching`)).matching.optedIn).toBe(false);
    expect((await api(outsider.context, '/me/group-join-requests?scope=own')).requests).toEqual([]);
    expect(joiningWrites).toBe(0);
    await capture(outsider.page, `personalised-empty-${theme}-390`);
  } finally { await outsider.context.close(); }
});

test('failed discovery and priorities loads preserve a real offer and never claim a preference mismatch', async ({ browser, request }) => {
  const data = await fixture(request, 'algorithm'), seeker = await person(browser, data, 'seeker');
  try {
    await seeker.page.goto(`/groups?concertId=${data.concertId}&mode=algorithm`);
    await seeker.page.getByRole('button', { name: 'Find a match', exact: true }).click();
    await expect(seeker.page.getByRole('button', { name: 'Accept group offer', exact: true })).toBeVisible();
    const original = (await api(seeker.context, '/me/proposals')).proposals.find(item => item.status === 'proposed');
    const discoveryEndpoint = `**/api/groups/discover/${data.concertId}*`;
    const prioritiesEndpoint = `**/api/me/group-preferences/${data.concertId}`;
    for (const endpoint of [discoveryEndpoint, prioritiesEndpoint]) await seeker.page.route(endpoint, route => route.fulfill({ status: 503, json: { error: 'synthetic_read_failure' } }));
    // Browsing remains a viewing choice even while the automatic offer is active.
    await seeker.page.goto(`/groups?concertId=${data.concertId}&mode=direct`);
    await expect(seeker.page.locator('[data-read-error="groups"]')).toBeVisible();
    await expect(seeker.page.locator('[data-read-error="saved"]')).toBeVisible();
    await expect(seeker.page.getByRole('button', { name: 'Accept group offer', exact: true })).toBeVisible();
    await expect(seeker.page.getByRole('heading', { name: emptyTitle, exact: true })).toHaveCount(0);
    await expect(seeker.page.getByRole('heading', { name: 'No suitable group is available.', exact: true })).toHaveCount(0);
    const current = (await api(seeker.context, '/me/proposals')).proposals.find(item => item.status === 'proposed');
    expect([current.id, current.seekerApproved, current.hostApproved, current.seatReserved])
      .toEqual([original.id, false, false, original.seatReserved]);
    expect((await api(seeker.context, `/me/seeker-request/${data.concertId}`)).request.joining_mode).toBe('algorithm');
    await capture(seeker.page, 'offer-preserved-during-read-failure');
    await seeker.page.unroute(discoveryEndpoint); await seeker.page.unroute(prioritiesEndpoint);
    await seeker.page.getByRole('button', { name: 'Retry available groups', exact: true }).click();
    await expect(seeker.page.locator('[data-read-error="groups"]')).toHaveCount(0);
    await expect(seeker.page.getByRole('button', { name: 'Accept group offer', exact: true })).toBeVisible();
    expect((await api(seeker.context, '/me/proposals')).proposals.filter(item => item.status === 'proposed')).toHaveLength(1);
  } finally { await seeker.context.close(); }
});
