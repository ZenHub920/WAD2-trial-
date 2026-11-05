import { test, expect } from '../support/playwright.mjs';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { api, fixture, person, origin } from './support.js';

async function capture(page, name, region = null) {
  if (!process.env.ENCORE_UX_CAPTURE_DIR) return;
  mkdirSync(process.env.ENCORE_UX_CAPTURE_DIR, { recursive: true });
  const options = { path: join(process.env.ENCORE_UX_CAPTURE_DIR, `first-time-${name}.png`), animations: 'disabled' };
  if (region) await region.screenshot(options);
  else await page.screenshot({ ...options, fullPage: true });
}

test('a seeker finds an offer without an operator, gives consent, and opens the group after both approvals', async ({ browser, request }) => {
  const data = await fixture(request, 'algorithm'), seeker = await person(browser, data, 'seeker');
  let host;
  try {
    await seeker.page.goto(`/groups?concertId=${data.concertId}&mode=algorithm`);
    const progress = seeker.page.getByRole('region', { name: 'Automatic matching progress', exact: true });
    await expect(progress).toContainText('Ready to find a match');
    await progress.getByRole('button', { name: 'Find a match', exact: true }).click();
    await expect(progress).toContainText('Review your group offer');
    await seeker.page.getByRole('button', { name: 'Accept group offer', exact: true }).click();
    await expect(progress).toContainText('Waiting for the host’s approval');
    expect((await api(seeker.context, '/me/current-group-memberships')).groups).toHaveLength(0);
    const proposal = (await api(seeker.context, '/me/proposals')).proposals.find(item => item.status === 'proposed');
    expect(proposal.seekerApproved).toBe(true); expect(proposal.hostApproved).toBe(false);
    host = await person(browser, data, proposal.partyId === data.parties.a ? 'hostA' : 'hostB');
    // Hosts review matches in Manage group, under Pending join requests.
    await host.page.goto(`/groups/${proposal.partyId}/members`);
    const pending = host.page.locator('#join-requests');
    await expect(pending).toContainText('Matched for you');
    await pending.getByRole('button', { name: 'Accept', exact: true }).click();
    await expect(host.page.getByText(/You accepted .*They join once they accept too\.|joined your group/)).toBeVisible();
    await seeker.page.reload();
    await expect(progress).toContainText('Group membership confirmed');
    await expect(progress.getByRole('link', { name: 'Open your group', exact: true })).toHaveAttribute('href', `/groups/${proposal.partyId}/members`);
    const chat = progress.getByRole('link', { name: 'Group messages', exact: true });
    await expect(chat).toHaveAttribute('href', `/groups/${proposal.partyId}/channel`);
    await chat.click();
    await expect(seeker.page.getByRole('textbox', { name: 'Message the group', exact: true })).toBeVisible();
    await seeker.page.goBack();
    await progress.getByRole('button', { name: 'Plan meetup', exact: true }).click();
    await expect(seeker.page).toHaveURL(new RegExp(`/meetups\\?partyId=${proposal.partyId}`));
  } finally { await seeker.context.close(); await host?.context.close(); }
});

test('no suitable automatic group has an explicit message and a working return to direct browsing', async ({ browser, request }) => {
  const data = await fixture(request, 'algorithm'), seeker = await person(browser, data, 'seeker');
  const hosts = await Promise.all(['hostA', 'hostB'].map(who => person(browser, data, who)));
  try {
    for (const [index, host] of hosts.entries()) await api(host.context, `/groups/${index ? data.parties.b : data.parties.a}/settings`, 'PUT', { expectedFriends: 1, strangerPlaces: 0 });
    await seeker.page.goto(`/groups?concertId=${data.concertId}&mode=algorithm`);
    const progress = seeker.page.getByRole('region', { name: 'Automatic matching progress', exact: true });
    await progress.getByRole('button', { name: 'Find a match', exact: true }).click();
    await expect(progress.getByRole('heading', { name: 'No suitable group is available.', exact: true })).toBeVisible();
    expect((await api(seeker.context, '/me/proposals')).proposals).toEqual([]);
    await expect(progress.getByRole('button', { name: 'Browse and choose groups', exact: true })).toBeEnabled();
    await capture(seeker.page, 'no-suitable-group', progress);
    await seeker.page.reload();
    await expect(progress.getByRole('heading', { name: 'No suitable group is available.', exact: true })).toBeVisible();
    // Choosing Browse and choose switches to it; a failed switch keeps you on the match list.
    const modeEndpoint = `**/api/me/seeker-requests/${data.concertId}/joining-mode`;
    await seeker.page.route(modeEndpoint, route => route.fulfill({ status: 503, json: { error: 'synthetic_mode_failure' } }));
    await progress.getByRole('button', { name: 'Browse and choose groups', exact: true }).click();
    await expect(seeker.page.getByRole('alert')).toContainText('Something went wrong');
    expect((await api(seeker.context, `/me/concerts/${data.concertId}/matching`)).matching.optedIn).toBe(true);
    await seeker.page.unroute(modeEndpoint);
    const direct = seeker.page.locator('.joining-mode').filter({ has: seeker.page.getByRole('heading', { name: 'Browse and choose', exact: true }) });
    await direct.getByRole('button').click();
    await expect(seeker.page.getByText('Browse and choose is now how you find a group.', { exact: false })).toBeVisible();
    const current = (await api(seeker.context, `/me/concerts/${data.concertId}/matching`)).matching;
    expect(current.optedIn).toBe(false); expect(current.state).toBe('idle');
    await expect(direct).toContainText('Active');
    await expect(seeker.page.getByRole('group', { name: 'How to show groups', exact: true })).toBeVisible();
    expect((await api(seeker.context, '/me/group-join-requests?scope=own')).requests).toEqual([]);
  } finally { await seeker.context.close(); await Promise.all(hosts.map(host => host.context.close())); }
});

for (const theme of ['light', 'dark']) test(`automatic search and browsing fallback are keyboard usable on mobile in ${theme}`, async ({ browser, request }) => {
  const data = await fixture(request, 'algorithm'), seeker = await person(browser, data, 'seeker');
  const hosts = await Promise.all(['hostA', 'hostB'].map(who => person(browser, data, who)));
  try {
    for (const [index, host] of hosts.entries()) await api(host.context, `/groups/${index ? data.parties.b : data.parties.a}/settings`, 'PUT', { expectedFriends: 1, strangerPlaces: 0 });
    await seeker.context.addInitScript(value => localStorage.setItem('encore-theme', value), theme);
    await seeker.page.setViewportSize({ width: 390, height: 844 });
    await seeker.page.bringToFront();
    await seeker.page.goto(`/groups?concertId=${data.concertId}&mode=algorithm`);
    const progress = seeker.page.getByRole('region', { name: 'Automatic matching progress', exact: true });
    const find = progress.getByRole('button', { name: 'Find a match', exact: true });
    await expect(find).toBeEnabled();
    await find.focus(); await expect(find).toBeFocused();
    await seeker.page.keyboard.press('Enter');
    await expect(progress.getByRole('heading', { name: 'No suitable group is available.', exact: true })).toBeVisible();
    const browse = progress.getByRole('button', { name: 'Browse and choose groups', exact: true });
    await expect(browse).toBeEnabled();
    expect(await seeker.page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    await capture(seeker.page, `no-suitable-group-${theme}-390`, progress);
    await browse.focus(); await expect(browse).toBeFocused();
    await seeker.page.keyboard.press('Enter');
    await expect(seeker.page.getByRole('group', { name: 'How to show groups', exact: true })).toBeVisible();
    // Choosing to browse makes browsing the active method, which leaves automatic matching.
    await expect.poll(async () => (await api(seeker.context, `/me/concerts/${data.concertId}/matching`)).matching.optedIn).toBe(false);
    expect((await api(seeker.context, '/me/group-join-requests?scope=own')).requests).toEqual([]);
  } finally { await seeker.context.close(); await Promise.all(hosts.map(host => host.context.close())); }
});

test('first-time meetup members can explore without availability while guidance and organizer actions remain truthful', async ({ browser, request }) => {
  const data = await fixture(request), host = await person(browser, data, 'hostA'), member = await person(browser, data, 'friendA');
  const timing = { title: 'Our first shared plan', startsAt: '2030-01-01T16:00:00+08:00', endsAt: '2030-01-01T17:00:00+08:00' };
  try {
    const { meetup } = await api(host.context, '/meetups', 'POST', { ...timing, partyId: data.parties.a });
    const path = `/meetups/${meetup.id}`;
    await api(host.context, `${path}/availability`, 'PUT', { windows: [{ startsAt: timing.startsAt, endsAt: timing.endsAt }] });
    await api(host.context, `${path}/places`, 'POST', { label: 'Funan first meeting point', latitude: 1.2913, longitude: 103.85 });
    await member.page.goto(path);
    const saveState = member.page.locator('.meetup-save-state');
    await expect(saveState).toContainText('No response saved for you.');
    await expect(saveState).toContainText('You can explore the other steps first');
    await member.page.getByRole('tab', { name: /Suggest places/ }).click();
    await expect(member.page.locator('.meetup-suggested-places')).toContainText('Funan first meeting point');
    await expect(member.page.locator('.meetup-recommendations')).toHaveCount(0);
    await member.page.getByRole('tab', { name: /Finalise meetup/ }).click();
    await expect(member.page.locator('#meetup-review')).toContainText('Your organizers choose and propose the final time and place.');
    expect((await api(member.context, path)).meetup.availability).toEqual([]);
    await member.page.getByRole('tab', { name: /Share availability/ }).click();
    await member.page.locator('[data-availability-start]').first().click();
    await expect(saveState).toContainText('Save your changes to update the group.');
    await member.page.getByRole('button', { name: 'Save my times', exact: true }).click();
    await expect(member.page.getByText('Your availability has been saved.', { exact: true })).toBeVisible();
    await member.page.getByRole('button', { name: /Next: suggest places/ }).click();
    await expect(member.page.locator('#meetup-places')).toBeVisible();
    await host.page.goto(`${path}#meetup-review`);
    await expect(host.page.locator('.meetup-best-summary')).toContainText('Funan first meeting point');
    await expect(host.page.locator('.meetup-picker')).toBeHidden();
    await host.page.getByRole('button', { name: 'Compare other options', exact: true }).click();
    await expect(host.page.locator('.meetup-picker')).toBeVisible();
    await host.page.getByRole('button', { name: 'Hide alternative options', exact: true }).click();
    await expect(host.page.locator('.meetup-option')).toBeVisible();
    expect((await api(host.context, path)).meetup.status).toBe('planning');
    await capture(host.page, 'meetup-leading-recommendation');
  } finally { await host.context.close(); await member.context.close(); }
});

