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

test('automatic matching reports failed enrollment and reversible priorities without starting a search', async ({ browser, request }) => {
  const data = await fixture(request), seeker = await person(browser, data, 'seeker');
  let automaticRounds = 0;
  seeker.page.on('request', request => {
    if (request.method() === 'POST' && [
      `/api/concerts/${data.concertId}/match`, `/api/me/concerts/${data.concertId}/matching/find`,
    ].includes(new URL(request.url()).pathname)) automaticRounds++;
  });
  try {
    await seeker.page.goto(`/groups?concertId=${data.concertId}&mode=algorithm`);
    // The route is lazy-loaded; wait for that navigation before exercising it.
    await expect(seeker.page.getByRole('heading', { name: 'Find your people for the show', exact: true })).toBeVisible({ timeout: 60000 });
    const switchMode = seeker.page.getByRole('button', { name: 'Join automatic matching', exact: true });
    expect((await api(seeker.context, `/me/concerts/${data.concertId}/matching`)).matching.optedIn).toBe(false);
    const modeEndpoint = `**/api/me/seeker-requests/${data.concertId}/joining-mode`;
    await seeker.page.route(modeEndpoint, route => route.fulfill({ status: 409, json: { error: 'save_discovery_preferences_first' } }));
    await switchMode.click();
    await seeker.page.getByRole('dialog').getByRole('button', { name: 'Join automatic matching', exact: true }).click();
    await expect(seeker.page.getByRole('alert')).toContainText('Save your private preferences');
    await expect(seeker.page.getByRole('dialog')).toBeVisible();
    expect((await api(seeker.context, `/me/concerts/${data.concertId}/matching`)).matching.optedIn).toBe(false);
    await seeker.page.unroute(modeEndpoint);
    await seeker.page.getByRole('dialog').getByRole('button', { name: 'Join automatic matching', exact: true }).click();
    const progress = seeker.page.getByRole('region', { name: 'Automatic matching progress', exact: true });
    await expect(progress.getByRole('heading', { name: 'Ready to find a match', exact: true })).toBeVisible();
    await expect(progress.getByRole('button', { name: 'Find a match', exact: true })).toBeEnabled();
    await expect(seeker.page.getByRole('button', { name: 'Join automatic matching', exact: true })).toHaveCount(0);
    const card = seeker.page.locator(`[data-group-id="${data.parties.a}"]`);
    await card.getByRole('button', { name: 'Prioritise for matching', exact: true }).click();
    await expect(card.getByRole('status')).toContainText('Priority saved. No application sent and no matching round started.');
    await expect(card.getByRole('button', { name: 'Remove priority', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(progress.getByRole('heading', { name: 'Saved priority groups (1)', exact: true })).toBeVisible();
    expect((await api(seeker.context, `/me/group-preferences/${data.concertId}`)).preferences.map(item => item.partyId)).toContain(data.parties.a);
    expect((await api(seeker.context, '/me/group-join-requests?scope=own')).requests).toEqual([]);
    expect((await api(seeker.context, '/me/proposals')).proposals).toEqual([]);
    await capture(seeker.page, 'automatic-priority-saved');
    await seeker.page.reload();
    await expect(card.getByRole('button', { name: 'Remove priority', exact: true })).toHaveAttribute('aria-pressed', 'true');
    const preferenceEndpoint = `**/api/group-preferences/${data.parties.a}`;
    await seeker.page.route(preferenceEndpoint, route => route.fulfill({ status: 503, json: { error: 'synthetic_priority_failure' } }));
    await card.getByRole('button', { name: 'Remove priority', exact: true }).click();
    await expect(card.getByRole('status')).toContainText('Priority was not changed');
    await expect(card.getByRole('button', { name: 'Remove priority', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await seeker.page.unroute(preferenceEndpoint);
    await card.getByRole('button', { name: 'Remove priority', exact: true }).click();
    await expect(card.getByRole('button', { name: 'Prioritise for matching', exact: true })).toHaveAttribute('aria-pressed', 'false');
    expect((await api(seeker.context, `/me/group-preferences/${data.concertId}`)).preferences).toEqual([]);
    expect(automaticRounds).toBe(0);
  } finally { await seeker.context.close(); }
});

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
    await host.page.goto('/groups/connect');
    await host.page.getByRole('button', { name: 'Approve companion', exact: true }).click();
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
    await progress.getByRole('button', { name: 'Browse and choose groups', exact: true }).click();
    await expect(seeker.page.getByRole('group', { name: 'How to show groups', exact: true })).toBeVisible();
    expect((await api(seeker.context, `/me/concerts/${data.concertId}/matching`)).matching.optedIn).toBe(true);
    const modeEndpoint = `**/api/me/seeker-requests/${data.concertId}/joining-mode`;
    await seeker.page.route(modeEndpoint, route => route.fulfill({ status: 503, json: { error: 'synthetic_mode_failure' } }));
    await seeker.page.getByRole('button', { name: 'Switch to Browse and choose', exact: true }).click();
    await seeker.page.getByRole('dialog').getByRole('button', { name: 'Switch active method', exact: true }).click();
    await expect(seeker.page.getByRole('alert')).toContainText('Something went wrong');
    expect((await api(seeker.context, `/me/concerts/${data.concertId}/matching`)).matching.optedIn).toBe(true);
    await seeker.page.unroute(modeEndpoint);
    await seeker.page.getByRole('dialog').getByRole('button', { name: 'Switch active method', exact: true }).click();
    await expect(seeker.page.getByRole('dialog')).toHaveCount(0);
    const current = (await api(seeker.context, `/me/concerts/${data.concertId}/matching`)).matching;
    expect(current.optedIn).toBe(false); expect(current.state).toBe('idle');
    const direct = seeker.page.locator('.joining-mode').filter({ has: seeker.page.getByRole('heading', { name: 'Browse and choose', exact: true }) });
    await expect(direct).toContainText('Saved method');
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
    expect((await api(seeker.context, `/me/concerts/${data.concertId}/matching`)).matching.optedIn).toBe(true);
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
    const next = member.page.getByRole('region', { name: 'What should I do next?', exact: true });
    await expect(next).toContainText('Share when you can meet');
    await expect(next).toContainText('You can explore the other steps first');
    await member.page.getByRole('tab', { name: /Suggest places/ }).click();
    await expect(member.page.locator('.meetup-suggested-places')).toContainText('Funan first meeting point');
    await expect(member.page.locator('.meetup-recommendations')).toHaveCount(0);
    await member.page.getByRole('tab', { name: /Finalise meetup/ }).click();
    await expect(member.page.locator('.meetup-discussion')).toBeVisible();
    expect((await api(member.context, path)).meetup.availability).toEqual([]);
    await next.getByRole('button', { name: 'Choose my available times', exact: true }).click();
    await expect(member.page.locator('[data-availability-start]').first()).toBeFocused();
    await member.page.locator('[data-availability-start]').first().click();
    await expect(next).toContainText('Save your time changes');
    await member.page.getByRole('button', { name: 'Save my times', exact: true }).click();
    await expect(next).toContainText('Help choose a meeting place');
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

test('first connection explains separate memberships and opens the acknowledged shared room when refresh fails', async ({ browser, request }) => {
  const data = await fixture(request), sender = await person(browser, data, 'hostA'), receiver = await person(browser, data, 'hostB');
  try {
    const before = await Promise.all([sender, receiver].map(actor => api(actor.context, '/me/current-group-memberships')));
    await sender.page.goto(`/groups/connect?view=connections&groupId=${data.parties.a}&concertId=${data.concertId}`);
    await expect(sender.page.getByText(/Connecting groups does not merge their members/).first()).toBeVisible();
    await sender.page.getByRole('button', { name: 'Invite group to connect', exact: true }).click();
    await expect(sender.page.locator('.connection-action-feedback')).toContainText('Waiting for the other host');
    await expect(sender.page.getByRole('status').filter({ hasText: `Singalong crew ${data.suffix}` }).first()).toBeVisible();
    await expect(sender.page.getByText('Invitation sent — waiting for the other host', { exact: true }).first()).toBeVisible();

    await receiver.page.goto('/groups/connect');
    await expect(receiver.page.getByText('Invitation received — your reply is needed', { exact: true })).toBeVisible();
    await receiver.page.route('**/api/me/group-connections', route => route.fulfill({ status: 503, json: { error: 'synthetic_refresh_failure' } }));
    await receiver.page.getByRole('button', { name: 'Accept the invitation from hostA', exact: true }).click();
    const next = receiver.page.locator('.connection-action-feedback');
    await expect(next).toContainText('Your shared chat is ready.');
    const link = next.getByRole('link', { name: 'Open shared chat', exact: true });
    await expect(link).toBeVisible();
    await link.click();
    await expect(receiver.page.getByRole('textbox', { name: 'Message both groups', exact: true })).toBeVisible();
    await expect(receiver.page.locator('.connection-channel')).toContainText(/both.*host|two.*host/i);
    const after = await Promise.all([sender, receiver].map(actor => api(actor.context, '/me/current-group-memberships')));
    expect(after.map(result => result.groups.map(group => group.partyId))).toEqual(before.map(result => result.groups.map(group => group.partyId)));
    await capture(receiver.page, 'connected-shared-chat');
  } finally { await sender.context.close(); await receiver.context.close(); }
});

for (const action of ['decline', 'withdraw']) test(`a first-time host can ${action} an invitation with an explicit final state`, async ({ browser, request }) => {
  const data = await fixture(request), sender = await person(browser, data, 'hostA'), receiver = await person(browser, data, 'hostB');
  try {
    await sender.page.goto(`/groups/connect?view=connections&groupId=${data.parties.a}&concertId=${data.concertId}`);
    await sender.page.getByRole('button', { name: 'Invite group to connect', exact: true }).click();
    const actor = action === 'decline' ? receiver : sender;
    if (action === 'decline') await receiver.page.goto('/groups/connect');
    await actor.page.getByRole('button', { name: action === 'decline' ? 'Decline the invitation from hostA' : 'Cancel your invitation to hostB', exact: true }).click();
    const dialog = actor.page.getByRole('dialog');
    await expect(dialog).toContainText(action === 'decline' ? 'will not be connected' : 'will be withdrawn');
    await dialog.getByRole('button', { name: action === 'decline' ? 'Decline' : 'Cancel invitation', exact: true }).click();
    await expect(actor.page.locator('.connection-action-feedback')).toContainText(action === 'decline' ? 'Invitation declined' : 'Invitation withdrawn');
    await expect(actor.page.getByRole('link', { name: 'Open shared chat', exact: true })).toHaveCount(0);
    const actual = (await api(actor.context, '/me/group-connections')).connections;
    expect(actual.filter(connection => connection.status === 'pending')).toHaveLength(0);
    expect(actual.filter(connection => connection.status === 'accepted')).toHaveLength(0);
    if (action === 'decline') {
      expect(actual[0].status).toBe('declined');
      await actor.page.getByText('Declined invitations (1)', { exact: true }).click();
      await expect(actor.page.getByText('This invitation is closed. Your groups were not connected.', { exact: true })).toBeVisible();
    } else expect(actual).toEqual([]);
  } finally { await sender.context.close(); await receiver.context.close(); }
});

test('host setup identifies the missing friend, then exposes publishing and connection navigation', async ({ browser, request }) => {
  const data = await fixture(request), host = await person(browser, data, 'hostA'), friend = await person(browser, data, 'outsider');
  try {
    const { concert } = await api(host.context, '/concerts', 'POST', { artist: `First host setup ${data.suffix}`, venue: 'Hall', event_date: '2030-01-02' });
    const { party } = await api(host.context, `/concerts/${concert.id}/parties`, 'POST', { name: 'Our first concert group', capacity: 2, section: 'standing_pen', spend_band: 2, arrival_plan: 'doors', plans: {} });
    await api(host.context, `/groups/${party.id}/settings`, 'PUT', { expectedFriends: 1, strangerPlaces: 1 });
    await host.page.goto(`/groups/${party.id}/members`);
    const setup = host.page.locator('.group-setup');
    await expect(setup).toContainText('0 of 1 expected friends joined');
    await expect(setup).toContainText('1 of 1 members saved preferences');
    await expect(host.page.getByRole('button', { name: 'Publish group', exact: true })).toBeDisabled();
    await setup.getByRole('button', { name: 'Invite your friends', exact: true }).click();
    await host.page.getByRole('button', { name: 'Create single-use friend link', exact: true }).click();
    const invitation = await host.page.getByLabel('Copy and share privately', { exact: true }).inputValue();
    await friend.page.goto(new URL(invitation).pathname);
    await friend.page.getByRole('button', { name: 'Accept invitation', exact: true }).click();
    await host.page.reload();
    await expect(setup).toContainText('Ready to publish');
    await expect(setup).toContainText('1 of 1 expected friends joined');
    await host.page.getByLabel('Open to meeting other groups', { exact: true }).check();
    await host.page.getByRole('button', { name: 'Publish group', exact: true }).click();
    await expect(setup).toContainText('Published · connections on');
    const discover = setup.getByRole('link', { name: 'Discover groups to connect', exact: true });
    await expect(discover).toHaveAttribute('href', new RegExp(`groupId=${party.id}`));
    await capture(host.page, 'host-publication-ready');
  } finally { await host.context.close(); await friend.context.close(); }
});
