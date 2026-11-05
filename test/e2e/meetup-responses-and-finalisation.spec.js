import { test, expect } from '../support/playwright.mjs';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { api, fixture, origin, person } from './support.js';

const timing = { title: 'Our concert meetup', startsAt: '2030-01-01T16:00:00+08:00', endsAt: '2030-01-01T17:30:00+08:00' };
const placeInput = { label: 'Public sheltered concert entrance', latitude: 1.3028, longitude: 103.875, sheltered: true };
const read = async (actor, id) => (await api(actor.context, `/meetups/${id}`)).meetup;
async function capture(page, name) {
  const directory = process.env.ENCORE_UX_CAPTURE_DIR;
  if (!directory) return;
  mkdirSync(directory, { recursive: true });
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({ path: join(directory, `meetup-responses-${name}.png`), fullPage: true, animations: 'disabled' });
}
async function openBoard(actor, id, stage = 'availability') {
  await actor.page.goto(`/meetups/${id}#meetup-${stage}`);
  await expect(actor.page.getByRole('heading', { name: timing.title, exact: true })).toBeVisible({ timeout: 60000 });
}

test('an explicit unavailable response stays distinct from no response, updates others live and can be revised or cleared', async ({ browser, request }) => {
  const data = await fixture(request), host = await person(browser, data, 'hostA'), member = await person(browser, data, 'friendA');
  try {
    const { meetup } = await api(host.context, '/meetups', 'POST', { ...timing, partyId: data.parties.a });
    await openBoard(host, meetup.id); await openBoard(member, meetup.id);
    const summary = host.page.getByLabel('Availability responses', { exact: true });
    await expect(summary).toContainText('0 of 2 participants responded');
    await expect(summary).not.toContainText('have not responded');
    const unavailable = member.page.getByRole('checkbox', { name: "I can't make any of these times", exact: true });
    await unavailable.check();
    await expect(member.page.locator('.meetup-save-state')).toContainText('Save your changes to update the group.');
    expect((await read(member, meetup.id)).availabilityResponse).toBe('unanswered');
    await member.page.getByRole('button', { name: 'Save my response', exact: true }).click();
    await expect(member.page.getByText('Your availability has been saved. The group knows you cannot make these times.', { exact: true })).toBeVisible();
    await expect(summary).toContainText('1 of 2 participants responded');
    await expect(summary).toContainText('1 cannot make these times');
    await expect(summary).not.toContainText('have not responded');
    let saved = await read(member, meetup.id);
    expect(saved.availabilityResponse).toBe('unavailable'); expect(saved.availability).toEqual([]);
    expect(saved.grid.every(slot => slot.availableCount === 0)).toBe(true);
    await capture(host.page, 'unavailable-versus-unanswered-live');
    await member.page.reload(); await expect(unavailable).toBeChecked();

    // Painting is a revised response; it removes the unavailable selection but
    // does not tell the group until the deliberate save.
    const first = member.page.locator('[data-availability-start]').first();
    await first.click(); await expect(first).toHaveAttribute('aria-pressed', 'true');
    await expect(unavailable).not.toBeChecked();
    expect((await read(member, meetup.id)).availabilityResponse).toBe('unavailable');
    await member.page.getByRole('button', { name: 'Save my times', exact: true }).click();
    // Nobody unavailable: the line is hidden rather than reading "0 cannot".
    await expect(summary).not.toContainText('cannot make these times');
    saved = await read(member, meetup.id);
    expect(saved.availabilityResponse).toBe('available'); expect(saved.availability).toHaveLength(1);
    await member.page.reload(); await expect(first).toHaveAttribute('aria-pressed', 'true');

    await first.click(); await expect(first).toHaveAttribute('aria-pressed', 'false');
    await member.page.getByRole('button', { name: 'Save my times', exact: true }).click();
    await expect(member.page.getByText('Your saved response has been cleared. You have not marked yourself unavailable.', { exact: true })).toBeVisible();
    await expect(summary).toContainText('0 of 2 participants responded');
    await expect(summary).not.toContainText('have not responded');
    await member.page.reload(); await expect(unavailable).not.toBeChecked();
    saved = await read(member, meetup.id);
    expect(saved.availabilityResponse).toBe('unanswered'); expect(saved.availability).toEqual([]);
    expect(saved.availabilityResponses.unavailableCount).toBe(0);
  } finally { await host.context.close(); await member.context.close(); }
});

test('an organizer can finalise recommendations without own availability while places and private starting points stay distinct', async ({ browser, request }) => {
  const data = await fixture(request), host = await person(browser, data, 'hostA'), member = await person(browser, data, 'friendA');
  try {
    const { meetup } = await api(host.context, '/meetups', 'POST', { ...timing, partyId: data.parties.a });
    await api(member.context, `/meetups/${meetup.id}/availability`, 'PUT', { windows: [{
      startsAt: timing.startsAt, endsAt: timing.endsAt, latitude: 1.31, longitude: 103.84, label: 'Member private starting area',
    }] });
    const { place } = await api(member.context, `/meetups/${meetup.id}/places`, 'POST', placeInput);
    await openBoard(host, meetup.id);
    await expect(host.page.locator('.meetup-save-state')).toContainText('No response saved for you.');
    await expect(host.page.locator('.meetup-journey > summary')).toContainText('My private starting point');
    await expect(host.page.locator('.meetup-audience--private')).toContainText('Only you');
    const hostState = await read(host, meetup.id);
    expect(hostState.availabilityResponse).toBe('unanswered'); expect(hostState.availability).toEqual([]);
    expect(JSON.stringify(hostState)).not.toContain('Member private starting area');
    await capture(host.page, 'optional-private-starting-point');

    await host.page.locator('#meetup-tab-places').click();
    await expect(host.page.locator('#meetup-places')).toBeVisible();
    await expect(host.page.locator('#meetup-review')).toBeHidden();
    await expect(host.page.locator('#meetup-places .meetup-recommendations')).toHaveCount(0);
    await expect(host.page.locator('#meetup-places').getByRole('button', { name: /^(Confirm|Propose) this time & place$/ })).toHaveCount(0);
    await expect(host.page.locator('.meetup-place-editor')).toContainText('separate from your private starting point');
    await openBoard(member, meetup.id, 'places');
    const suggestion = member.page.locator('.meetup-place-row').filter({ has: member.page.getByRole('heading', { name: placeInput.label, exact: true }) });
    await suggestion.getByRole('button', { name: 'Vote for place', exact: true }).click();
    await expect(host.page.locator('.meetup-place-row')).toContainText('1 vote');
    expect((await read(host, meetup.id)).status).toBe('planning');
    expect((await read(host, meetup.id)).selected_place_id).toBeNull();
    expect((await read(member, meetup.id)).currentVotePlaceId).toBe(place.id);
    await capture(host.page, 'shared-places-votes-not-finalisation');

    await host.page.locator('#meetup-tab-review').click();
    await expect(host.page.locator('#meetup-review')).toBeVisible();
    await expect(host.page.locator('.meetup-recommendations')).toBeVisible();
    await expect(host.page.locator('.meetup-option')).toContainText(placeInput.label);
    await expect(host.page.getByRole('button', { name: 'Confirm this time & place', exact: true })).toBeVisible();
    expect((await read(host, meetup.id)).availabilityResponse).toBe('unanswered');
    expect((await read(host, meetup.id)).status).toBe('planning');
    await member.page.locator('#meetup-tab-review').click();
    await expect(member.page.locator('.meetup-recommendations')).toHaveCount(0);
    await expect(member.page.getByRole('button', { name: /^(Confirm|Propose) this time & place$/ })).toHaveCount(0);
    await expect(member.page.locator('.meetup-role-note').filter({ hasText: 'Your organizers choose' })).toBeVisible();
    await capture(host.page, 'organizer-finalisation-stage');
  } finally { await host.context.close(); await member.context.close(); }
});

test('a zero-attendance time needs explicit acknowledgment from the API and is never recommended in the planner', async ({ browser, request }) => {
  const data = await fixture(request), host = await person(browser, data, 'hostA'), member = await person(browser, data, 'friendA');
  try {
    const { meetup } = await api(host.context, '/meetups', 'POST', { ...timing, partyId: data.parties.a });
    const { place } = await api(host.context, `/meetups/${meetup.id}/places`, 'POST', placeInput);
    const initial = await read(host, meetup.id), start = initial.grid[0].startsAt;
    expect(initial.grid.every(slot => slot.availableCount === 0)).toBe(true);
    const denied = await host.context.request.post(`${origin}/api/meetups/${meetup.id}/propose`, {
      headers: { Origin: origin }, data: { placeId: place.id, startsAt: new Date(start).toISOString(), version: initial.version,
        participationRevision: initial.participationRevision },
    });
    expect(denied.status()).toBe(400);
    expect(await denied.json()).toEqual({ error: 'meetup_no_availability_acknowledgement_required' });
    expect((await read(host, meetup.id)).version).toBe(initial.version);
    expect((await read(host, meetup.id)).selected_place_id).toBeNull();

    // The planner only recommends times someone can make, so this time is never offered there.
    await openBoard(host, meetup.id, 'review');
    await expect(host.page.locator('.meetup-option')).toHaveCount(0);
    await expect(host.page.locator('.meetup-recommendations .meetup-empty-state')).toBeVisible();
    await capture(host.page, 'zero-availability-not-recommended');
    // With the acknowledgment, an organizer can still confirm it deliberately.
    await api(host.context, `/meetups/${meetup.id}/propose`, 'POST', { placeId: place.id, startsAt: new Date(start).toISOString(),
      version: initial.version, participationRevision: initial.participationRevision, acknowledgeNoAvailability: true });
    await host.page.reload();
    await expect(host.page.getByText('This plan is confirmed.', { exact: false })).toBeVisible();
    const confirmed = await read(host, meetup.id);
    expect(confirmed.status).toBe('confirmed');
    expect(confirmed.selected_start).toBe(start); expect(confirmed.selected_place_id).toBe(place.id);
    expect(confirmed.approvals).toHaveLength(1);
    expect(confirmed.availabilityResponses.respondedCount).toBe(0);
    const notifications = (await api(member.context, '/me/notifications')).notifications;
    expect(notifications.some(notification => notification.path === `/meetups/${meetup.id}#meetup-review`
      && notification.title === 'Meetup time and place confirmed')).toBe(true);
    await capture(host.page, 'purposefully-confirmed-zero-availability-plan');
  } finally { await host.context.close(); await member.context.close(); }
});
