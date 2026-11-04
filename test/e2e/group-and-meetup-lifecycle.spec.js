import { test, expect } from '../support/playwright.mjs';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fixture, person, api, chatPair, origin } from './support.js';

const timing = { title: 'Our revised concert plan', startsAt: '2030-01-01T16:00:00+08:00', endsAt: '2030-01-01T17:30:00+08:00' };
const point = { label: 'Stadium public entrance', latitude: 1.3028, longitude: 103.875, sheltered: true };
async function capture(page, name) {
  if (!process.env.ENCORE_UX_CAPTURE_DIR) return;
  mkdirSync(process.env.ENCORE_UX_CAPTURE_DIR, { recursive: true });
  await page.screenshot({ path: join(process.env.ENCORE_UX_CAPTURE_DIR, `${process.env.ENCORE_UX_CAPTURE_PHASE ?? 'final'}-teammate-${name}.png`), animations: 'disabled' });
}
const read = async (actor, id) => (await api(actor.context, `/meetups/${id}`)).meetup;
async function stage(page, name) { await page.locator(`#meetup-tab-${name}`).click(); }
async function confirmReopen(actor) {
  await actor.page.getByRole('button', { name: /^(Withdraw proposal and reopen planning|Reopen planning)$/ }).click();
  const dialog = actor.page.getByRole('dialog');
  await expect(dialog).toContainText('Availability, places, votes and discussion are kept.');
  await dialog.getByRole('button', { name: 'Reopen planning', exact: true }).click();
  await expect(actor.page.locator('.meetup-context')).toContainText('Collecting availability');
}

test('groups: past concert guard, draft creation, invitation, publication and origin-aware planner return', async ({ browser, request }) => {
  const data = await fixture(request), host = await person(browser, data, 'hostA'), friend = await person(browser, data, 'outsider');
  const errors = []; host.page.on('pageerror', error => errors.push(error.message));
  try {
    const groupName = `Our new group ${data.suffix} with a longer name for the entire crew`;
    const past = (await api(host.context, '/concerts', 'POST', { artist: `Past show ${data.suffix}`, venue: 'Indoor Stadium', event_date: '2020-01-01' })).concert;
    const future = (await api(host.context, '/concerts', 'POST', { artist: `Future show ${data.suffix}`, venue: 'Indoor Stadium', event_date: '2030-01-01' })).concert;
    await host.page.goto(`/groups/connect?view=create&concertId=${past.id}`);
    await expect(host.page.getByText('This concert has already finished. Choose another upcoming concert.', { exact: true })).toBeVisible();
    const concertSelect = host.page.getByLabel(/^Concert/);
    await expect(concertSelect).toBeVisible();
    await expect(concertSelect.locator(`option[value="${past.id}"]`)).toHaveCount(0);
    await expect(host.page.getByRole('button', { name: 'Create draft group', exact: true })).toBeDisabled();
    await capture(host.page, 'past-concert-blocked');
    const rejected = await host.context.request.post(`${origin}/api/concerts/${past.id}/parties`, { headers: { Origin: origin }, data: { name: 'Bypass attempt', capacity: 2, section: 'standing_pen', spend_band: 2, arrival_plan: 'doors', plans: {} } });
    expect(rejected.status()).toBe(409); expect(await rejected.json()).toEqual({ error: 'concert_no_longer_upcoming' });
    await concertSelect.selectOption(future.id);
    await host.page.getByLabel(/^Group name/).fill(groupName);
    await host.page.getByRole('button', { name: 'Create draft group', exact: true }).click();
    await expect(host.page).toHaveURL(/\/groups\/[^/]+\/members$/);
    const groupId = new URL(host.page.url()).pathname.split('/')[2];
    await host.page.getByRole('spinbutton', { name: "Friends you'll invite", exact: true }).fill('1');
    await host.page.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(host.page.getByText('All changes saved.', { exact: true })).toBeVisible();
    await host.page.getByText('Create a friend invitation', { exact: false }).click();
    await host.page.getByRole('button', { name: 'Create single-use friend link', exact: true }).click();
    const invitation = await host.page.getByLabel('Copy and share privately', { exact: true }).inputValue();
    await friend.page.goto(new URL(invitation).pathname);
    await friend.page.getByRole('button', { name: 'Accept invitation', exact: true }).click();
    await expect(friend.page.getByRole('heading', { name: 'Members (2)', exact: true })).toBeVisible();
    await host.page.reload();
    await host.page.getByRole('button', { name: 'Publish group', exact: true }).click();
    await expect(host.page.getByText('Group published.', { exact: true })).toBeVisible();
    expect((await api(host.context, `/groups/${groupId}/membership`)).group.settings.published).toBe(1);

    await host.page.goto('/groups/connect');
    await expect(host.page.locator('.owned-card')).toHaveCount(2);
    const cards = host.page.locator('.owned-card');
    // Independent sources can still finish above these already usable cards.
    // Measure paired rows in one frame, never across separate layout shifts.
    for (const selector of [null, '.owned-card__concert', '.owned-card__concert > span', ':scope > p:not(.owned-card__concert)', '.owned-card__actions']) {
      await expect.poll(() => cards.evaluateAll((elements, selector) => {
        const rows = elements.map(card => (selector ? [...card.querySelectorAll(selector)] : [card]).map(element => element.getBoundingClientRect().y));
        if (!rows[0]?.length || rows[0].length !== rows[1]?.length) return Infinity;
        return Math.max(...rows[0].map((y, index) => Math.abs(y - rows[1][index])));
      }, selector), { message: `shared card row ${selector ?? 'card top'}` }).toBeLessThanOrEqual(1);
    }
    await cards.first().scrollIntoViewIfNeeded();
    await capture(host.page, 'owned-cards-aligned-long-title');
    const card = host.page.locator('.owned-card').filter({ has: host.page.getByRole('heading', { name: groupName, exact: true }) });
    await card.getByRole('button').click();
    await expect(host.page).toHaveURL(/from=groups/);
    await host.page.getByLabel('Title', { exact: true }).fill(timing.title);
    await host.page.getByLabel('Earliest meeting time', { exact: false }).fill('2030-01-01T16:00');
    await host.page.getByLabel('Latest meeting time', { exact: false }).fill('2030-01-01T17:30');
    await host.page.getByRole('button', { name: 'Create planning board', exact: true }).click();
    await expect(host.page.getByRole('heading', { name: timing.title, exact: true })).toBeVisible();
    await stage(host.page, 'places'); await stage(host.page, 'review');
    await host.page.getByRole('link', { name: 'Back to My groups', exact: true }).click();
    await expect(host.page).toHaveURL(/\/groups\/connect$/);
    await host.page.goto(`/groups/${groupId}/members`);
    await host.page.locator('.member-workspace__primary button').click();
    await expect(host.page).toHaveURL(/from=manage-group/);
    await host.page.getByRole('link', { name: 'Back to Manage group', exact: true }).click();
    await expect(host.page).toHaveURL(new RegExp(`/groups/${groupId}/members$`));
    expect(errors).toEqual([]);
  } finally { await host.context.close(); await friend.context.close(); }
});

for (const scope of ['hosted', 'connected', 'kaki']) test(`${scope} planning: explicit submission, approval integrity, visible recovery, preserved contributions and fresh confirmation`, async ({ browser, request }) => {
  const data = await fixture(request);
  const a = await person(browser, data, scope === 'kaki' ? 'seeker' : 'hostA');
  const b = await person(browser, data, scope === 'connected' ? 'hostB' : scope === 'kaki' ? 'outsider' : 'friendA');
  const stranger = await person(browser, data, scope === 'kaki' ? 'hostB' : 'outsider');
  const errors = []; for (const actor of [a,b]) actor.page.on('pageerror', error => errors.push(error.message));
  try {
    let target;
    if (scope === 'connected') {
      const { connection } = await api(a.context, '/group-connections', 'POST', { fromPartyId: data.parties.a, toPartyId: data.parties.b });
      await api(b.context, `/group-connections/${connection.id}/respond`, 'POST', { action: 'accept' }); target = { connectionId: connection.id };
    } else if (scope === 'kaki') target = { kakiConversationId: await chatPair(data, a, b) };
    else target = { partyId: data.parties.a };
    const { meetup } = await api(a.context, '/meetups', 'POST', { ...timing, ...target });
    for (const actor of [a,b]) await api(actor.context, `/meetups/${meetup.id}/availability`, 'PUT', { windows: [{ startsAt: timing.startsAt, endsAt: timing.endsAt, travelMode: 'transit' }] });
    const { place } = await api(b.context, `/meetups/${meetup.id}/places`, 'POST', point);
    await api(b.context, `/meetups/${meetup.id}/vote`, 'PUT', { placeId: place.id });
    await api(b.context, `/meetups/${meetup.id}/comments`, 'POST', { body: 'Keep this meeting discussion.' });
    const path = `/meetups/${meetup.id}`;
    await a.page.goto(`${path}#meetup-places`); await b.page.goto(`${path}#meetup-review`);
    const before = await read(a, meetup.id);
    expect(before.status).toBe('planning');
    await a.page.getByRole('button', { name: scope === 'hosted' ? 'Confirm this time & place' : 'Propose this time & place', exact: true }).first().click();
    await expect(a.page.locator('#meetup-review')).toBeVisible();
    let proposal = await read(a, meetup.id);
    expect(proposal.status).toBe(scope === 'hosted' ? 'confirmed' : 'proposed');
    expect(proposal.approvals).toHaveLength(scope === 'hosted' ? 1 : 0);
    if (scope !== 'hosted') {
      await expect(a.page.getByText('Your approval is still needed for this version of the plan.', { exact: true })).toBeVisible();
      await a.page.getByRole('button', { name: 'Approve plan', exact: true }).click();
      await expect(a.page.getByText('Your approval is saved. Waiting for the other required organizer.', { exact: true })).toBeVisible();
      expect((await read(a, meetup.id)).status).toBe('proposed');
      await capture(a.page, `${scope}-pending-partial-approval`);
    } else await expect(a.page.getByRole('button', { name: 'Approve plan', exact: true })).toHaveCount(0);
    await stage(a.page, 'availability');
    await expect(a.page.locator('[data-availability-start]').first()).toBeDisabled();
    await capture(a.page, `${scope}-visible-recovery`);
    await confirmReopen(a);
    const reopened = await read(a, meetup.id);
    expect(reopened.version).toBeGreaterThan(proposal.version);
    expect(reopened.approvals).toHaveLength(0); expect(reopened.selected_place_id).toBeNull();
    expect(reopened.availability).toEqual(before.availability);
    expect(reopened.places).toEqual(before.places); expect(reopened.comments).toEqual(before.comments);
    await expect(b.page.locator('.meetup-context')).toContainText('Collecting availability');
    const stale = await a.context.request.post(`${origin}/api${path}/approve`, { headers: { Origin: origin }, data: { version: proposal.version } });
    expect(stale.status()).toBe(409);
    await stage(a.page, 'places');
    await a.page.getByRole('button', { name: scope === 'hosted' ? 'Confirm this time & place' : 'Propose this time & place', exact: true }).first().click();
    await expect(a.page.locator('#meetup-review')).toBeVisible();
    proposal = await read(a, meetup.id);
    if (scope !== 'hosted') {
      expect(proposal.approvals).toHaveLength(0);
      const unauthorized = await stranger.context.request.post(`${origin}/api${path}/approve`, { headers: { Origin: origin }, data: { version: proposal.version } });
      expect([403,404]).toContain(unauthorized.status());
      await a.page.getByRole('button', { name: 'Approve plan', exact: true }).click();
      await expect(b.page.getByRole('button', { name: 'Approve plan', exact: true })).toBeVisible();
      await b.page.getByRole('button', { name: 'Approve plan', exact: true }).click();
    }
    await expect(a.page.locator('.meetup-context')).toContainText('Meetup confirmed');
    expect((await read(a, meetup.id)).approvals).toHaveLength(scope === 'hosted' ? 1 : 2);
    await capture(a.page, `${scope}-confirmed`);
    await a.page.reload();
    await expect(a.page.locator('.meetup-context')).toContainText('Meetup confirmed');
    await expect(a.page.getByRole('button', { name: 'Approve plan', exact: true })).toHaveCount(0);
    await stage(a.page, 'review');
    const management = a.page.getByRole('region', { name: 'Manage this meetup', exact: true });
    await management.getByRole('button', { name: 'Cancel meetup', exact: true }).click();
    await a.page.getByRole('dialog').getByRole('button', { name: 'Cancel meetup', exact: true }).click();
    await expect(a.page.locator('.meetup-context')).toContainText('Meetup cancelled');
    await expect(b.page.locator('.meetup-context')).toContainText('Meetup cancelled');
    expect((await read(a, meetup.id)).places).toHaveLength(1);
    expect(errors).toEqual([]);
  } finally { for (const actor of [a,b,stranger]) await actor.context.close(); }
});
