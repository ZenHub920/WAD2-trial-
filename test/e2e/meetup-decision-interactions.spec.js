import { test, expect } from '../support/playwright.mjs';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { api, fixture, person, origin } from './support.js';

const timing = { title: 'Decide before the show', startsAt: '2030-01-01T16:00:00+08:00', endsAt: '2030-01-01T17:30:00+08:00' };
const read = async (actor, id) => (await api(actor.context, `/meetups/${id}`)).meetup;
async function capture(page, name) {
  const directory = process.env.ENCORE_UX_CAPTURE_DIR;
  if (!directory) return;
  mkdirSync(directory, { recursive: true });
  await page.screenshot({ path: join(directory, `after-decision-${name}.png`), fullPage: true, animations: 'disabled' });
}
async function paint(page) {
  const cells = page.locator('[data-availability-start]');
  await expect(cells).toHaveCount(3);
  await cells.first().scrollIntoViewIfNeeded();
  const first = await cells.first().boundingBox(), last = await cells.last().boundingBox();
  await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2);
  await page.mouse.down();
  await page.mouse.move(last.x + last.width / 2, last.y + last.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('[data-availability-start][aria-pressed="true"]')).toHaveCount(3);
}
async function originDraft(page, label, lat, lon, mode) {
  const journey = page.locator('.meetup-journey');
  await journey.locator(':scope > summary').click();
  await journey.getByLabel(/^Travel method/).first().selectOption(mode);
  const manual = journey.locator('.meetup-manual-entry');
  await manual.locator(':scope > summary').click();
  await manual.getByLabel('Location label', { exact: true }).fill(label);
  await manual.getByLabel('Latitude', { exact: true }).fill(String(lat));
  await manual.getByLabel('Longitude', { exact: true }).fill(String(lon));
  await journey.getByRole('button', { name: 'Apply to selected times', exact: true }).click();
}
async function addPlace(page, name, lat, lon, sheltered = false) {
  const form = page.locator('.meetup-place-editor');
  await form.getByLabel('Place name', { exact: true }).fill(name);
  const manual = form.locator('.meetup-manual-entry');
  if (await manual.getAttribute('open') === null) await manual.locator(':scope > summary').click();
  await manual.getByLabel('Latitude', { exact: true }).fill(String(lat));
  await manual.getByLabel('Longitude', { exact: true }).fill(String(lon));
  await form.getByLabel('Sheltered (optional)', { exact: true }).setChecked(sheltered);
  await form.getByRole('button', { name: 'Add place', exact: true }).click();
  await expect(page.locator('.meetup-place-row').filter({ has: page.getByRole('heading', { name, exact: true }) })).toBeVisible();
}
const placeRow = (page, label) => page.locator('.meetup-place-row').filter({ has: page.getByRole('heading', { name: label, exact: true }) });

test('two hosts: create, paint availability, switch/remove votes, inspect partial travel coverage, review and approve a revised meetup live', async ({ browser, request }) => {
  const data = await fixture(request), a = await person(browser, data, 'hostA'), b = await person(browser, data, 'hostB');
  const errors = []; for (const actor of [a, b]) actor.page.on('pageerror', error => errors.push(error.message));
  try {
    const { connection } = await api(a.context, '/group-connections', 'POST', { fromPartyId: data.parties.a, toPartyId: data.parties.b });
    await api(b.context, `/group-connections/${connection.id}/respond`, 'POST', { action: 'accept' });
    await a.page.goto(`/meetups?connectionId=${connection.id}`);
    await a.page.getByLabel('Title', { exact: true }).fill(timing.title);
    await a.page.getByLabel('Earliest meeting time', { exact: false }).fill('2030-01-01T16:00');
    await a.page.getByLabel('Latest meeting time', { exact: false }).fill('2030-01-01T17:30');
    const saved = a.page.waitForResponse(response => response.url().endsWith('/api/meetups') && response.request().method() === 'POST');
    await a.page.getByRole('button', { name: 'Create planning board', exact: true }).click();
    const id = (await (await saved).json()).meetup.id, path = `/meetups/${id}`;
    await expect(a.page).toHaveURL(new RegExp(path)); await b.page.goto(path);
    await paint(a.page);
    await originDraft(a.page, 'A private starting area', 1.31, 103.84, 'transit');
    await a.page.getByRole('button', { name: 'Save my times', exact: true }).click();
    await expect(b.page.locator('[data-availability-start]').first()).toHaveAttribute('aria-label', /1 of 4 available/);
    await paint(b.page);
    await b.page.getByRole('button', { name: 'Save my times', exact: true }).click();
    await expect(a.page.locator('[data-availability-start]').first()).toHaveAttribute('aria-label', /2 of 4 available/);
    for (const actor of [a, b]) await actor.page.locator('[data-planner-step="places"]').click();
    await addPlace(a.page, 'Funan', 1.2913, 103.85, true);
    await addPlace(b.page, 'Raffles Building', 1.286, 103.852);
    // Observe B's committed suggestion in A's live view before A votes against
    // that version. Otherwise the server correctly rejects a stale-version vote.
    await expect(placeRow(a.page, 'Raffles Building')).toBeVisible();
    const preferred = placeRow(a.page, 'Funan'), other = placeRow(b.page, 'Raffles Building');
    await preferred.getByRole('button', { name: 'Vote for place', exact: true }).click();
    await expect(placeRow(b.page, 'Funan')).toContainText('1 vote');
    await placeRow(b.page, 'Funan').getByRole('button', { name: 'Vote for place', exact: true }).click();
    await expect(preferred).toContainText('2 votes');
    await other.getByRole('button', { name: 'Vote for place', exact: true }).click();
    await expect(preferred).toContainText('1 vote'); await expect(other).toContainText('1 vote');
    await other.getByRole('button', { name: 'Remove vote', exact: true }).click();
    await expect(other).toContainText('0 votes'); expect((await read(b, id)).currentVotePlaceId).toBeNull();
    await expect(b.page.locator('#meetup-tab-review')).toHaveAttribute('aria-disabled', 'false');
    await placeRow(b.page, 'Funan').getByRole('button', { name: 'Vote for place', exact: true }).click();
    await expect(preferred).toContainText('2 votes');
    await expect(a.page.locator('.meetup-recommendations').getByRole('button', { name: /^(Vote for place|Remove vote)$/ })).toHaveCount(0);
    await expect(a.page.locator('.meetup-option')).toHaveCount(2);
    await expect(a.page.locator('.meetup-time-option')).toHaveCount(6);
    await expect(a.page.locator('.meetup-recommendations')).toContainText('1 of 2');
    await a.page.getByRole('button', { name: 'Compare travel options', exact: true }).click();
    await expect(a.page.locator('.meetup-ranking-context')).toContainText('Transport choices do not affect straight-line estimates');
    await expect(a.page.locator('.meetup-ranking-context')).toContainText('bounded shortlist');
    await capture(a.page, 'partial-origins-and-votes');
    await b.page.locator('[data-planner-step="availability"]').click();
    await originDraft(b.page, 'B private driving origin', 1.32, 103.86, 'drive');
    await b.page.getByRole('button', { name: 'Save my times', exact: true }).click();
    await expect.poll(async () => (await read(b, id)).availability.filter(row => row.label === 'B private driving origin').length).toBe(3);
    expect((await read(b, id)).availability.every(row => row.travel_mode === 'drive')).toBe(true);
    expect(JSON.stringify(await read(a, id))).not.toContain('B private driving origin');
    await expect(a.page.locator('.meetup-recommendations')).toContainText('2 of 2');
    await a.page.getByLabel('Only places marked sheltered', { exact: true }).check();
    await expect(a.page.locator('.meetup-option')).toHaveCount(1);
    await expect(a.page.locator('.meetup-option')).toContainText('Funan');
    const option = a.page.getByRole('button', { name: 'Propose this time & place', exact: true }).first();
    await option.click();
    const review = a.page.getByRole('dialog', { name: /Not everyone is available/ });
    await expect(review).toContainText('Funan'); await expect(review).toContainText('Only 2 of 4');
    await expect(review).toContainText('2 place votes'); await expect(review).toContainText('formal proposal');
    expect((await read(a, id)).status).toBe('planning');
    await capture(a.page, 'partial-attendance-proposal-review');
    await review.getByRole('button', { name: 'Keep comparing', exact: true }).click();
    expect((await read(a, id)).status).toBe('planning');
    await option.click(); await review.getByRole('button', { name: 'Submit proposal for approval', exact: true }).click();
    await expect(a.page.locator('.meetup-context')).toContainText('Awaiting required approvals');
    await a.page.getByRole('button', { name: 'Approve plan', exact: true }).click();
    expect((await read(a, id)).status).toBe('proposed');
    await b.page.locator('[data-planner-step="review"]').click();
    await b.page.getByRole('button', { name: 'Approve plan', exact: true }).click();
    await expect(a.page.locator('.meetup-context')).toContainText('Meetup confirmed');
    await expect(a.page.locator('.meetup-approval-progress')).toContainText('2/2');
    const confirmed = await read(a, id);
    await a.page.getByRole('button', { name: 'Reopen planning', exact: true }).click();
    await a.page.getByRole('dialog').getByRole('button', { name: 'Reopen planning', exact: true }).click();
    await expect(b.page.locator('.meetup-context')).toContainText('Collecting availability');
    const reopened = await read(a, id);
    expect(reopened.approvals).toEqual([]); expect(reopened.version).toBeGreaterThan(confirmed.version);
    expect(reopened.places.map(p => [p.id, p.votes])).toEqual(confirmed.places.map(p => [p.id, p.votes]));
    await a.page.locator('[data-planner-step="places"]').click();
    await a.page.getByRole('button', { name: 'Propose this time & place', exact: true }).last().click();
    await a.page.getByRole('dialog').getByRole('button', { name: 'Submit proposal for approval', exact: true }).click();
    await a.page.getByRole('button', { name: 'Approve plan', exact: true }).click();
    await b.page.getByRole('button', { name: 'Approve plan', exact: true }).click();
    await expect(a.page.locator('.meetup-context')).toContainText('Meetup confirmed');
    expect((await read(a, id)).approvals).toHaveLength(2);
    await a.page.locator('[data-planner-step="places"]').click();
    await expect(a.page.getByRole('button', { name: /^(Vote for place|Remove vote|Correct place|Remove place)$/ })).toHaveCount(0);
    await expect(placeRow(a.page, 'Funan')).toContainText('Your vote');
    await capture(a.page, 'locked-votes-after-fresh-approval');
    expect(errors).toEqual([]);
  } finally { await a.context.close(); await b.context.close(); }
});

test('sheltered recommendations survive original top-20 truncation and correction clears votes before safe removal', async ({ browser, request }) => {
  const data = await fixture(request), a = await person(browser, data, 'hostA'), b = await person(browser, data, 'friendA');
  try {
    const { meetup } = await api(a.context, '/meetups', 'POST', { ...timing, partyId: data.parties.a });
    const path = `/meetups/${meetup.id}`;
    await api(a.context, `${path}/availability`, 'PUT', { windows: [{ startsAt: timing.startsAt, endsAt: timing.endsAt, latitude: 1.3, longitude: 103.85 }] });
    for (let index = 0; index < 8; index++) await api(a.context, `${path}/places`, 'POST', { label: `Nearby unsheltered ${index}`, latitude: 1.3 + index / 10000, longitude: 103.85 });
    const { place } = await api(a.context, `${path}/places`, 'POST', { label: 'Farther sheltered choice', latitude: 1.4, longitude: 103.95, sheltered: true });
    await api(a.context, `${path}/vote`, 'PUT', { placeId: place.id });
    await api(b.context, `${path}/vote`, 'PUT', { placeId: place.id });
    const before = await read(a, meetup.id);
    expect(before.suggestions).toHaveLength(20); expect(before.suggestions.some(s => s.placeId === place.id)).toBe(false);
    await a.page.goto(`${path}#meetup-places`);
    await a.page.getByLabel('Only places marked sheltered', { exact: true }).check();
    await expect(a.page.locator('.meetup-option')).toHaveCount(1);
    await expect(a.page.locator('.meetup-option')).toContainText('Farther sheltered choice');
    const row = placeRow(a.page, 'Farther sheltered choice');
    await row.getByRole('button', { name: 'Correct place', exact: true }).click();
    await expect(a.page.locator('.meetup-place-editor')).toContainText('Existing votes for this place will be cleared');
    await a.page.locator('.meetup-place-editor').getByLabel('Place name', { exact: true }).fill('Corrected sheltered entrance');
    await a.page.getByRole('button', { name: 'Save place correction', exact: true }).click();
    await expect(placeRow(a.page, 'Corrected sheltered entrance')).toContainText('0 votes');
    expect((await read(b, meetup.id)).currentVotePlaceId).toBeNull();
    await placeRow(a.page, 'Corrected sheltered entrance').getByRole('button', { name: 'Remove place', exact: true }).click();
    const dialog = a.page.getByRole('dialog', { name: 'Remove your suggested place?', exact: true });
    await dialog.getByRole('button', { name: 'Keep place', exact: true }).click();
    expect((await read(a, meetup.id)).places).toHaveLength(9);
    await placeRow(a.page, 'Corrected sheltered entrance').getByRole('button', { name: 'Remove place', exact: true }).click();
    await dialog.getByRole('button', { name: 'Remove suggested place', exact: true }).click();
    await expect(placeRow(a.page, 'Corrected sheltered entrance')).toHaveCount(0);
    expect((await read(a, meetup.id)).places).toHaveLength(8);
    await expect(a.page.locator('.meetup-empty-state')).toContainText('filter excludes all suggested places');
  } finally { await a.context.close(); await b.context.close(); }
});

for (const theme of ['light', 'dark']) test(`decision cards and review modal remain usable in ${theme} at six widths`, async ({ browser, request }) => {
  const data = await fixture(request), host = await person(browser, data, 'hostA');
  try {
    await host.context.addInitScript(value => localStorage.setItem('encore-theme', value), theme);
    const { meetup } = await api(host.context, '/meetups', 'POST', { ...timing, partyId: data.parties.a });
    await api(host.context, `/meetups/${meetup.id}/availability`, 'PUT', { windows: [{ startsAt: timing.startsAt, endsAt: timing.endsAt, latitude: 1.31, longitude: 103.84 }] });
    const { place } = await api(host.context, `/meetups/${meetup.id}/places`, 'POST', { label: 'Funan sheltered entrance with a longer landmark description', latitude: 1.2913, longitude: 103.85, sheltered: true });
    await api(host.context, `/meetups/${meetup.id}/vote`, 'PUT', { placeId: place.id });
    for (const width of [320, 360, 390, 768, 1024, 1440]) {
      await host.page.setViewportSize({ width, height: width < 600 ? 844 : 1000 });
      await host.page.goto(`/meetups/${meetup.id}#meetup-places`);
      await expect(host.page.locator('.meetup-time-option')).toHaveCount(3);
      expect(await host.page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
      const button = host.page.getByRole('button', { name: 'Confirm this time & place', exact: true }).first();
      await button.click();
      const dialog = host.page.getByRole('dialog', { name: /Not everyone is available/ });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Keep comparing', exact: true })).toBeFocused();
      await expect(dialog).toContainText('immediately confirms');
      await host.page.keyboard.press('Tab');
      await expect(dialog.getByRole('button', { name: 'Confirm meetup now', exact: true })).toBeFocused();
      await host.page.keyboard.press('Tab');
      await expect(dialog.getByRole('button', { name: 'Keep comparing', exact: true })).toBeFocused();
      expect(await host.page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
      await capture(host.page, `review-${theme}-${width}`);
      await host.page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0); await expect(button).toBeFocused();
      expect((await read(host, meetup.id)).status).toBe('planning');
    }
  } finally { await host.context.close(); }
});
