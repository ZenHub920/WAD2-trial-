import { test, expect } from '../support/playwright.mjs';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { api, fixture, person, origin } from './support.js';

const timing = { title: 'Decide before the show', startsAt: '2030-01-01T16:00:00+08:00', endsAt: '2030-01-01T17:30:00+08:00' };
const read = async (actor, id) => (await api(actor.context, `/meetups/${id}`)).meetup;
async function compareAlternatives(page) {
  const toggle = page.locator('.meetup-compare-toggle');
  if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
  await expect(page.locator('.meetup-picker')).toBeVisible();
}
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

test('server shelter filtering precedes top-20 limits; owners correct and remove saved places independently of the picker', async ({ browser, request }) => {
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
    const sheltered = (await api(a.context, `${path}?shelteredOnly=true`)).meetup;
    expect(sheltered.suggestions).toHaveLength(3);
    expect(sheltered.suggestions.every(option => option.placeId === place.id)).toBe(true);
    await a.page.goto(`${path}#meetup-review`);
    await expect(a.page.locator('.meetup-option')).toHaveCount(1);
    // The teammate's picker uses the actual unfiltered top-ranked options.
    // Saved suggestions remain correctable even when absent from that shortlist.
    await expect(a.page.locator('.meetup-picker').getByRole('combobox', { name: 'Place', exact: true }).locator(`option[value="${place.id}"]`)).toHaveCount(0);
    await a.page.locator('[data-planner-step="places"]').click();
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
    expect((await api(a.context, `${path}?shelteredOnly=true`)).meetup.suggestions).toEqual([]);
    await a.page.locator('[data-planner-step="review"]').click();
    await compareAlternatives(a.page);
  } finally { await a.context.close(); await b.context.close(); }
});

test('organizer dropdowns preserve ranked choices, synchronize attendance and reject a changed review without submitting', async ({ browser, request }) => {
  const data = await fixture(request), host = await person(browser, data, 'hostA');
  const otherHostTab = await person(browser, data, 'hostA'), member = await person(browser, data, 'friendA');
  try {
    const { meetup } = await api(host.context, '/meetups', 'POST', { ...timing, partyId: data.parties.a });
    const path = `/meetups/${meetup.id}`, start = Date.parse(timing.startsAt);
    await api(host.context, `${path}/availability`, 'PUT', { windows: [{ startsAt: timing.startsAt, endsAt: timing.endsAt, latitude: 1.31, longitude: 103.84 }] });
    await api(member.context, `${path}/availability`, 'PUT', { windows: [{ startsAt: timing.startsAt, endsAt: new Date(start + 2 * 1800000).toISOString() }] });
    const a = (await api(host.context, `${path}/places`, 'POST', { label: 'Funan picker choice', latitude: 1.2913, longitude: 103.85, sheltered: true })).place;
    const b = (await api(host.context, `${path}/places`, 'POST', { label: 'Raffles picker choice', latitude: 1.2936, longitude: 103.8532, sheltered: true })).place;
    await host.page.goto(`${path}#meetup-review`);
    await compareAlternatives(host.page);
    const picker = host.page.locator('.meetup-picker'), place = picker.getByRole('combobox', { name: 'Place', exact: true });
    const time = picker.getByRole('combobox', { name: 'Time', exact: true }), selected = host.page.locator('.meetup-option');
    const initial = await read(host, meetup.id), expectedPlaces = [...new Set(initial.suggestions.map(option => option.placeId))];
    await expect(place).toHaveValue(initial.suggestions[0].placeId);
    await expect(time).toHaveValue(String(initial.suggestions[0].startsAt));
    expect(await place.locator('option').evaluateAll(options => options.map(option => option.value))).toEqual(expectedPlaces);
    let proposalRequests = 0;
    host.page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname === `/api${path}/propose`) proposalRequests++; });
    for (const placeId of [...expectedPlaces, expectedPlaces[0]]) {
      await place.selectOption(placeId);
      const options = initial.suggestions.filter(option => option.placeId === placeId);
      expect(await time.locator('option').evaluateAll(options => options.map(option => Number(option.value)))).toEqual(options.map(option => option.startsAt));
      await expect(place.locator('option:checked')).toContainText('up to 2 of 2');
      const last = options.find(option => option.availableCount === 1);
      await time.selectOption(String(last.startsAt));
      await expect(place).toHaveValue(placeId);
      await expect(selected).toContainText('1 of 2 available');
      await expect(selected).toContainText('Not everyone is available');
      await expect(selected.locator('.meetup-rank')).toContainText(`Rank ${initial.suggestions.findIndex(option => option.placeId === placeId && option.startsAt === last.startsAt) + 1}`);
    }
    expect(proposalRequests).toBe(0, 'Selecting places and times must not submit a proposal.');

    await member.page.goto(`${path}#meetup-review`);
    await expect(member.page.locator('.meetup-recommendations')).toHaveCount(0);
    await expect(member.page.locator('.meetup-picker')).toHaveCount(0);
    await expect(member.page.getByRole('button', { name: 'Confirm this time & place', exact: true })).toHaveCount(0);
    await member.page.locator('[data-planner-step="places"]').click();
    await placeRow(member.page, 'Funan picker choice').getByRole('button', { name: 'Vote for place', exact: true }).click();
    await host.page.locator('[data-planner-step="places"]').click();
    await expect(placeRow(host.page, 'Funan picker choice')).toContainText('1 vote');
    await host.page.locator('[data-planner-step="review"]').click();
    await compareAlternatives(host.page);

    await place.selectOption(b.id); await time.selectOption(String(start + 2 * 1800000));
    await host.page.getByRole('button', { name: 'Refresh planner', exact: true }).click();
    await expect(place).toHaveValue(b.id); await expect(time).toHaveValue(String(start + 2 * 1800000));
    const latest = await read(host, meetup.id);
    await api(otherHostTab.context, `${path}/places/${b.id}`, 'DELETE', { version: latest.version });
    const remaining = await read(host, meetup.id);
    await expect(place).toHaveValue(a.id);
    await expect(time).toHaveValue(String(remaining.suggestions[0].startsAt));
    await expect(selected.getByRole('heading', { name: 'Funan picker choice', exact: true })).toBeVisible();

    const submit = host.page.getByRole('button', { name: 'Confirm this time & place', exact: true });
    await submit.click();
    const review = host.page.getByRole('dialog');
    await expect(review).toContainText('Funan picker choice');
    const beforeChange = await read(host, meetup.id);
    await api(otherHostTab.context, `${path}/places/${a.id}`, 'PUT', { label: 'Updated Funan picker choice', latitude: 1.2913, longitude: 103.85, sheltered: true, version: beforeChange.version });
    await expect(selected.getByRole('heading', { name: 'Updated Funan picker choice', exact: true })).toBeVisible();
    await review.getByRole('button', { name: 'Confirm meetup now', exact: true }).click();
    await expect(review).toHaveCount(0);
    await expect(host.page.locator('.meetup-recommendations')).toContainText('This recommendation or plan has changed.');
    expect(proposalRequests).toBe(0, 'A changed review must require a fresh deliberate selection, without posting stale data.');
    expect((await read(host, meetup.id)).status).toBe('planning');
    const afterChange = await read(host, meetup.id);
    await api(otherHostTab.context, `${path}/places/${a.id}`, 'DELETE', { version: afterChange.version });
    await expect(picker).toHaveCount(0);
    await expect(submit).toHaveCount(0);
    await expect(host.page.locator('.meetup-empty-state')).toBeVisible();
    expect((await read(host, meetup.id)).selected_place_id).toBeNull();
  } finally { await Promise.all([host, otherHostTab, member].map(actor => actor.context.close())); }
});

for (const theme of ['light', 'dark']) test(`place/time dropdowns and review modal remain usable in ${theme} at six widths`, async ({ browser, request }) => {
  const data = await fixture(request), host = await person(browser, data, 'hostA');
  try {
    await host.context.addInitScript(value => localStorage.setItem('encore-theme', value), theme);
    const { meetup } = await api(host.context, '/meetups', 'POST', { ...timing, partyId: data.parties.a });
    await api(host.context, `/meetups/${meetup.id}/availability`, 'PUT', { windows: [{ startsAt: timing.startsAt, endsAt: timing.endsAt, latitude: 1.31, longitude: 103.84 }] });
    const { place } = await api(host.context, `/meetups/${meetup.id}/places`, 'POST', { label: 'Funan sheltered entrance with a longer landmark description', latitude: 1.2913, longitude: 103.85, sheltered: true });
    await api(host.context, `/meetups/${meetup.id}/vote`, 'PUT', { placeId: place.id });
    for (const width of [320, 360, 390, 768, 1024, 1440]) {
      await host.page.setViewportSize({ width, height: width < 600 ? 844 : 1000 });
      await host.page.goto(`/meetups/${meetup.id}#meetup-review`);
      await compareAlternatives(host.page);
      const picker = host.page.locator('.meetup-picker');
      await expect(picker.getByRole('combobox', { name: 'Place', exact: true }).locator('option')).toHaveCount(1);
      await expect(picker.getByRole('combobox', { name: 'Time', exact: true }).locator('option')).toHaveCount(3);
      await expect(host.page.locator('.meetup-option')).toHaveCount(1);
      const place = picker.getByRole('combobox', { name: 'Place', exact: true }), time = picker.getByRole('combobox', { name: 'Time', exact: true });
      await place.focus(); await expect(place).toBeFocused();
      await host.page.keyboard.press('Tab'); await expect(time).toBeFocused();
      const times = await time.locator('option').evaluateAll(options => options.map(option => option.value));
      await host.page.keyboard.press('End'); await expect(time).toHaveValue(times[times.length - 1]);
      await host.page.keyboard.press('Home'); await expect(time).toHaveValue(times[0]);
      expect(await host.page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
      const button = host.page.getByRole('button', { name: 'Confirm this time & place', exact: true });
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
