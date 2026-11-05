import { test, expect } from '../support/playwright.mjs';
import { api, fixture, person } from './support.js';

for (const layout of ['list', 'comparison']) test(`${layout} application review has real keyboard traversal and cancellation sends nothing`, async ({ browser, request }) => {
  const data = await fixture(request), seeker = await person(browser, data, 'seeker');
  try {
    await seeker.page.goto(`/groups?concertId=${data.concertId}&mode=direct`);
    await expect(seeker.page.getByRole('heading', { name: 'Find your people for the show', exact: true })).toBeVisible({ timeout: 60000 });
    if (layout === 'list') await seeker.page.getByRole('button', { name: 'See all', exact: true }).click();
    else await seeker.page.getByRole('button', { name: 'Start comparing', exact: true }).click();
    const opener = seeker.page.getByRole('button', { name: layout === 'list' ? 'Ask to join' : 'Request to join', exact: true }).first();
    await opener.focus(); await seeker.page.keyboard.press('Enter');
    const dialog = seeker.page.getByRole('dialog');
    const cancel = dialog.getByRole('button', { name: 'Not yet', exact: true });
    await expect(cancel).toBeFocused();
    expect((await api(seeker.context, '/me/group-join-requests?scope=own')).requests).toEqual([]);
    const controls = [cancel, dialog.getByRole('button', { name: 'Send request', exact: true }), dialog.getByRole('textbox', { name: 'Say hi to the host (optional)', exact: true })];
    const reached = new Set();
    for (let i = 0; i < 6; i++) {
      for (const [index, control] of controls.entries()) if (await control.evaluate(el => el === document.activeElement)) reached.add(index);
      expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true);
      await seeker.page.keyboard.press('Tab');
    }
    expect([...reached].sort()).toEqual([0, 1, 2]);
    await seeker.page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
    if (layout === 'comparison') await expect(seeker.page.getByRole('status').filter({ hasText: 'No request sent to' })).toBeVisible();
    expect((await api(seeker.context, '/me/group-join-requests?scope=own')).requests).toEqual([]);
  } finally { await seeker.context.close(); }
});

test('a committed automatic search with a lost response recovers by refresh without another POST', async ({ browser, request }) => {
  const data = await fixture(request, 'algorithm'), seeker = await person(browser, data, 'seeker');
  let posts = 0;
  const endpoint = `**/api/me/concerts/${data.concertId}/matching/find`;
  try {
    await seeker.page.route(endpoint, async route => {
      posts++;
      const committed = await route.fetch();
      expect(committed.ok()).toBe(true);
      await route.abort('failed');
    });
    await seeker.page.goto(`/groups?concertId=${data.concertId}&mode=algorithm`);
    await seeker.page.getByRole('button', { name: 'Find a match', exact: true }).click();
    await expect(seeker.page.getByRole('alert')).toContainText('couldn’t confirm the search result');
    const saved = (await api(seeker.context, `/me/concerts/${data.concertId}/matching`)).matching;
    expect(saved.latestAttempt.completed).toBe(true); expect(saved.latestAttempt.receivedProposal).toBe(true);
    await seeker.page.reload();
    await expect(seeker.page.getByRole('button', { name: 'Accept group offer', exact: true })).toBeVisible();
    await expect(seeker.page.getByText(/Latest matching attempt/)).toBeVisible();
    expect(posts).toBe(1);
    expect((await api(seeker.context, '/me/proposals')).proposals.filter(item => item.status === 'proposed')).toHaveLength(1);
    expect(await seeker.page.evaluate(({ userId, concertId }) => sessionStorage.getItem(`encore:matching-attempt:${encodeURIComponent(userId)}:${encodeURIComponent(concertId)}`), { userId: data.users.seeker, concertId: data.concertId })).toBe(null);
  } finally { await seeker.context.close(); }
});

test('direct request response loss recovers the actual request and route viewing preserves it', async ({ browser, request }) => {
  const data = await fixture(request), seeker = await person(browser, data, 'seeker');
  let posts = 0;
  try {
    await seeker.page.route(`**/api/groups/${data.parties.a}/join-requests`, async route => {
      if (route.request().method() !== 'POST') return route.continue();
      posts++;
      const committed = await route.fetch(); expect(committed.ok()).toBe(true);
      await route.abort('failed');
    });
    await seeker.page.goto(`/groups?concertId=${data.concertId}&mode=direct`);
    await seeker.page.getByRole('button', { name: 'See all', exact: true }).click();
    await seeker.page.locator(`[data-group-id="${data.parties.a}"]`).getByRole('button', { name: 'Ask to join', exact: true }).click();
    await seeker.page.getByRole('dialog').getByRole('button', { name: 'Send request', exact: true }).click();
    // The lost response is recovered: the request is found and shown in My groups.
    await expect(seeker.page).toHaveURL(url => url.pathname === '/groups/connect');
    await expect(seeker.page.getByRole('region', { name: 'Groups you’ve asked to join', exact: true })).toContainText(`Supper crew ${data.suffix}`);
    expect(posts).toBe(1);
    const before = (await api(seeker.context, '/me/group-join-requests?scope=own')).requests;
    expect(before).toHaveLength(1); expect(before[0].status).toBe('pending'); expect(before[0].seatReserved).toBe(true);
    await seeker.page.goto(`/groups?concertId=${data.concertId}&mode=direct`);
    await seeker.page.getByRole('button', { name: 'View automatic matching', exact: true }).click();
    await expect(seeker.page.getByRole('heading', { name: 'Resolve your current group request first', exact: true })).toBeVisible();
    const after = (await api(seeker.context, '/me/group-join-requests?scope=own')).requests;
    expect(after.map(item => [item.id, item.status, item.seatReserved])).toEqual(before.map(item => [item.id, item.status, item.seatReserved]));
    expect((await api(seeker.context, `/me/concerts/${data.concertId}/matching`)).matching.optedIn).toBe(false);
  } finally { await seeker.context.close(); }
});
