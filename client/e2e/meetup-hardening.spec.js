import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const origin = 'http://127.0.0.1:5175';
const shortWindow = { title: 'Hardening checks', startsAt: '2030-01-01T16:00:00+08:00', endsAt: '2030-01-01T17:30:00+08:00' };
async function fixture(request) {
  const response = await request.post('http://127.0.0.1:3105/__test/fixture', { data: {} });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}
async function person(browser, data, who = 'hostA', { theme = 'dark', width = 390, touch = false } = {}) {
  const context = await browser.newContext({ reducedMotion: 'reduce', timezoneId: 'UTC', viewport: { width, height: 844 }, hasTouch: touch, isMobile: touch });
  await context.addInitScript(value => localStorage.setItem('encore-theme', value), theme);
  await context.route(/^https:\/\//, route => route.abort());
  await context.addCookies([{ name: 'encore_session', value: data.sessions[who], domain: '127.0.0.1', path: '/api' }]);
  return { context, page: await context.newPage() };
}
async function api(context, path, method = 'GET', body) {
  const response = await context.request.fetch(`${origin}/api${path}`, {
    method, headers: { Origin: origin }, ...(body === undefined ? {} : { data: body }),
  });
  expect(response.ok(), `${path}: ${await response.text()}`).toBeTruthy();
  return response.json();
}
async function capture(page, name) {
  const directory = process.env.ENCORE_UX_CAPTURE_DIR;
  if (!directory) return;
  mkdirSync(directory, { recursive: true });
  await page.screenshot({ path: join(directory, `${process.env.ENCORE_UX_CAPTURE_PHASE ?? 'final'}-hardening-${name}.png`), animations: 'disabled' });
}
async function frameGrid(page) {
  await page.locator('.availability-grid__scroll').evaluate(element => {
    element.scrollTop = 0; element.scrollLeft = 0;
    const headerHeight = document.querySelector('.header')?.getBoundingClientRect().height ?? 0;
    scrollTo({ top: scrollY + element.getBoundingClientRect().top - headerHeight - 16, behavior: 'instant' });
  });
}
async function point(locator) {
  const box = await locator.boundingBox();
  expect(box).toBeTruthy();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
async function touch(cdp, type, location) {
  await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: location ? [{ ...location, id: 1, radiusX: 2, radiusY: 2, force: 1 }] : [] });
}
async function swipe(cdp, page, from, to) {
  await touch(cdp, 'touchStart', from);
  // This movement starts well before the hold threshold and must stay native.
  for (let step = 1; step <= 6; step++) {
    await touch(cdp, 'touchMove', { x: from.x + (to.x - from.x) * step / 6, y: from.y + (to.y - from.y) * step / 6 });
    await page.waitForTimeout(15);
  }
  await touch(cdp, 'touchEnd');
}
async function paint(cdp, page, first, last) {
  await touch(cdp, 'touchStart', await point(first));
  await expect(page.locator('.availability-grid__scroll')).toHaveAttribute('data-touch-painting', 'true');
  await touch(cdp, 'touchMove', await point(last));
  await touch(cdp, 'touchEnd');
  await expect(page.locator('.availability-grid__scroll')).toHaveAttribute('data-touch-painting', 'false');
}
async function headerFits(page, width) {
  const boxes = [];
  for (const control of await page.locator('.header .brand, .header .theme-btn, .header .notification-bell__button, .header .header__toggle').all()) {
    if (!await control.isVisible()) continue;
    const box = await control.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
    for (const previous of boxes) {
      const overlaps = Math.min(previous.x + previous.width, box.x + box.width) - Math.max(previous.x, box.x) > 1
        && Math.min(previous.y + previous.height, box.y + box.height) - Math.max(previous.y, box.y) > 1;
      expect(overlaps, 'Header controls must not overlap at increased text size').toBe(false);
    }
    boxes.push(box);
  }
}
async function wholeDayFits(scroll) {
  await scroll.evaluate(element => { element.scrollLeft = 0; });
  const viewport = await scroll.boundingBox();
  const time = await scroll.locator('thead th').first().boundingBox();
  const day = await scroll.locator('thead th').nth(1).boundingBox();
  expect(day.x, 'A whole day must remain reachable beside the sticky time column').toBeGreaterThanOrEqual(time.x + time.width - 1);
  expect(day.x + day.width, 'A whole day must fit within the horizontal scroll viewport').toBeLessThanOrEqual(viewport.x + viewport.width + 1);
}

test('mobile availability: real touch distinguishes scrolling, taps and hold painting at 320/360/390 in both themes and 200% text', async ({ browser, request }) => {
  test.setTimeout(300000);
  const data = await fixture(request);
  for (const theme of ['light', 'dark']) for (const width of [320, 360, 390]) {
    await test.step(`${theme}, ${width}px`, async () => {
      const host = await person(browser, data, 'hostA', { theme, width, touch: true });
      const cdp = await host.context.newCDPSession(host.page);
      try {
        const { meetup } = await api(host.context, '/meetups', 'POST', { ...shortWindow, partyId: data.parties.a, createAnother: true,
          startsAt: '2029-12-31T00:00:00+08:00', endsAt: '2030-01-01T18:00:00+08:00' });
        await host.page.goto(`/meetups/${meetup.id}`);
        const scroll = host.page.locator('.availability-grid__scroll');
        const cells = scroll.locator('[data-availability-start]');
        const selected = scroll.locator('[data-availability-start][aria-pressed="true"]');
        await expect(cells.first()).toBeVisible();
        await frameGrid(host.page);
        expect((await cells.first().boundingBox()).height).toBeGreaterThanOrEqual(44);
        expect((await cells.first().boundingBox()).width).toBeGreaterThanOrEqual(44);
        await wholeDayFits(scroll);

        await touch(cdp, 'touchStart', await point(cells.first()));
        await touch(cdp, 'touchEnd');
        await expect(selected).toHaveCount(1);
        await touch(cdp, 'touchStart', await point(cells.first()));
        await touch(cdp, 'touchEnd');
        await expect(selected).toHaveCount(0);
        const from = await point(cells.nth(8));
        await swipe(cdp, host.page, from, { x: from.x, y: from.y - 135 });
        await expect.poll(() => scroll.evaluate(element => element.scrollTop)).toBeGreaterThan(40);
        await expect(selected).toHaveCount(0);
        // Let the browser's native momentum finish before resetting the viewport.
        await host.page.waitForTimeout(250);
        await frameGrid(host.page);
        const beforePaint = await scroll.evaluate(element => element.scrollTop);
        // Two columns: indices 0,2,4 are three consecutive half-hours in one day.
        await paint(cdp, host.page, cells.nth(0), cells.nth(4));
        await expect(selected).toHaveCount(3);
        expect(await scroll.evaluate(element => element.scrollTop)).toBe(beforePaint);
        await capture(host.page, `touch-selected-${theme}-${width}`);
        await paint(cdp, host.page, cells.nth(0), cells.nth(4));
        await expect(selected).toHaveCount(0);

        const baseTextSize = await host.page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
        await host.page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
        expect(await host.page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize))).toBeGreaterThanOrEqual(baseTextSize * 1.99);
        await expect(host.page.locator('.availability-grid__scroll-hint')).toBeVisible();
        await frameGrid(host.page);
        expect((await cells.first().boundingBox()).height).toBeGreaterThanOrEqual(44);
        expect((await cells.first().boundingBox()).width).toBeGreaterThanOrEqual(44);
        await wholeDayFits(scroll);
        expect(await host.page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
        await headerFits(host.page, width);
        for (const header of await scroll.locator('thead th').all()) {
          expect(await header.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
        }
        const horizontalStart = await point(cells.first());
        await swipe(cdp, host.page, horizontalStart, { x: horizontalStart.x - 75, y: horizontalStart.y });
        await expect.poll(() => scroll.evaluate(element => element.scrollLeft)).toBeGreaterThan(20);
        await expect(selected).toHaveCount(0);
        expect(await scroll.locator('tbody th').first().evaluate(element => {
          const box = element.getBoundingClientRect();
          return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)?.closest('th') === element;
        }), 'Sticky time labels must stay above a focused, horizontally scrolled cell').toBe(true);
        // Capture the scroll boundary, where the final day's complete label is readable.
        await scroll.evaluate(element => { element.scrollLeft = element.scrollWidth; });
        const lastDay = await scroll.locator('thead th').last().boundingBox();
        const timeColumn = await scroll.locator('thead th').first().boundingBox();
        const viewport = await scroll.boundingBox();
        expect(lastDay.x).toBeGreaterThanOrEqual(timeColumn.x + timeColumn.width - 1);
        expect(lastDay.x + lastDay.width).toBeLessThanOrEqual(viewport.x + viewport.width + 1);
        await capture(host.page, `touch-text200-${theme}-${width}`);
      } finally { await cdp.detach(); await host.context.close(); }
    });
  }
});

test('planner drafts: stages, failed saves, internal navigation, browser Back and refresh preserve deliberate unsaved choices', async ({ browser, request }) => {
  const data = await fixture(request), host = await person(browser, data), friend = await person(browser, data, 'friendA');
  try {
    const { meetup } = await api(host.context, '/meetups', 'POST', { ...shortWindow, partyId: data.parties.a });
    await host.page.goto('/meetups');
    await host.page.getByRole('link', { name: 'Share availability', exact: true }).click();
    const cell = host.page.locator('[data-availability-start]').first();
    const dialog = host.page.getByRole('dialog', { name: 'Leave with unsaved changes?', exact: true });
    await cell.click();
    await host.page.getByRole('button', { name: /Continue to places/ }).click();
    await expect(dialog).toHaveCount(0);
    await expect(host.page.locator('#meetup-places')).toContainText('Recommendations use saved availability');
    await host.page.getByRole('tab', { name: /Agree on the plan/ }).click();
    await host.page.getByRole('tab', { name: /Find a time/ }).click();
    await expect(cell).toHaveAttribute('aria-pressed', 'true');
    expect((await api(host.context, `/meetups/${meetup.id}`)).meetup.availability).toEqual([]);

    let releaseSave;
    const saveGate = new Promise(resolve => { releaseSave = resolve; });
    const savePath = `**/api/meetups/${meetup.id}/availability`;
    await host.page.route(savePath, async route => {
      await saveGate;
      await route.fulfill({ status: 503, json: { error: 'temporarily_unavailable' } });
    });
    await host.page.getByRole('button', { name: 'Save availability and journey', exact: true }).click();
    await expect(host.page.getByRole('button', { name: 'Updating…', exact: true })).toBeDisabled();
    await expect(cell).toBeDisabled();
    await capture(host.page, 'availability-saving-disabled-dark-390');
    releaseSave();
    await expect(host.page.locator('.meetup-save-state')).toContainText('Availability was not saved. Your draft is kept.');
    await expect(cell).toHaveAttribute('aria-pressed', 'true');
    await expect(host.page.getByText('Your availability and journey have been saved.', { exact: true })).toHaveCount(0);
    await capture(host.page, 'availability-failed-dark-390');
    await host.page.unroute(savePath);

    await host.page.getByRole('button', { name: 'All plans', exact: true }).click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Keep editing', exact: true })).toBeFocused();
    await capture(host.page, 'unsaved-confirmation-dark-390');
    await dialog.getByRole('button', { name: 'Keep editing', exact: true }).click();
    await expect(cell).toHaveAttribute('aria-pressed', 'true');

    const back = host.page.goBack();
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Keep editing', exact: true }).click();
    await back;
    await expect(host.page).toHaveURL(new RegExp(`/meetups/${meetup.id}`));
    await expect(cell).toHaveAttribute('aria-pressed', 'true');

    const reloadDialog = host.page.waitForEvent('dialog');
    // A deliberately cancelled reload never emits `load`; bound that expected wait.
    const reload = host.page.reload({ timeout: 2000 }).then(() => null, error => error);
    const nativeDialog = await reloadDialog;
    expect(nativeDialog.type()).toBe('beforeunload');
    await nativeDialog.dismiss();
    await reload;
    await expect(cell).toHaveAttribute('aria-pressed', 'true');

    // A real notification link changes the board ID within the same route component.
    const second = (await api(host.context, '/meetups', 'POST', { ...shortWindow, title: 'Another arrangement', partyId: data.parties.a, createAnother: true })).meetup;
    await api(friend.context, `/meetups/${second.id}/availability`, 'PUT', { windows: [{ startsAt: shortWindow.startsAt, endsAt: shortWindow.endsAt, travelMode: 'transit' }] });
    await host.page.getByRole('button', { name: /^Notifications/ }).click();
    const notification = host.page.locator(`#notification-popover a[href="/meetups/${second.id}#meetup-availability"]`).first();
    await expect(notification).toBeVisible();
    await notification.click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Keep editing', exact: true }).click();
    await expect(host.page).toHaveURL(new RegExp(`/meetups/${meetup.id}`));
    await expect(cell).toHaveAttribute('aria-pressed', 'true');

    await host.page.getByRole('button', { name: 'Save availability and journey', exact: true }).click();
    await expect(host.page.getByText('Your availability and journey have been saved.', { exact: true })).toBeVisible();
    await expect(host.page.locator('.meetup-save-state')).toContainText('Showing your saved availability.');
    expect((await api(host.context, `/meetups/${meetup.id}`)).meetup.availability).toHaveLength(1);
    await capture(host.page, 'availability-saved-dark-390');
    await host.page.getByRole('button', { name: 'All plans', exact: true }).click();
    await expect(host.page.getByRole('heading', { name: 'My meetups', exact: true })).toBeVisible();
    await expect(dialog).toHaveCount(0);

    await host.page.locator('.meetup-overview-plan').filter({ has: host.page.getByRole('heading', { name: shortWindow.title, exact: true }) }).getByRole('link').click();
    await host.page.getByRole('tab', { name: /Find a time/ }).click();
    await cell.click();
    await host.page.getByRole('link', { name: 'Back to My meetups', exact: true }).click();
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Discard changes and leave', exact: true }).click();
    await expect(host.page.getByRole('heading', { name: 'My meetups', exact: true })).toBeVisible();
    // Discarding the new draft does not erase previously saved availability.
    expect((await api(host.context, `/meetups/${meetup.id}`)).meetup.availability).toHaveLength(1);
  } finally { await host.context.close(); await friend.context.close(); }
});

test('planner locations: query edits, stale responses and manual names cannot silently save old coordinates', async ({ browser, request }) => {
  const data = await fixture(request), host = await person(browser, data, 'hostA', { theme: 'light' });
  const a = { label: 'City Hall meeting point', latitude: 1.293, longitude: 103.852, address: 'North Bridge Road' };
  const b = { label: 'Stadium meeting point', latitude: 1.3028, longitude: 103.875, address: 'Stadium Walk' };
  let releaseOld;
  const oldGate = new Promise(resolve => { releaseOld = resolve; });
  try {
    const { meetup } = await api(host.context, '/meetups', 'POST', { ...shortWindow, partyId: data.parties.a });
    await host.page.goto(`/meetups/${meetup.id}#meetup-places`);
    const editor = host.page.locator('.meetup-place-editor');
    const lookup = editor.locator('.meetup-location-search');
    const query = lookup.getByRole('textbox');
    const manual = editor.locator('.meetup-manual-entry');
    await host.page.route(`**/api/meetups/${meetup.id}/locations?*`, async route => {
      const q = new URL(route.request().url()).searchParams.get('q');
      if (q === 'Old request') await oldGate;
      if (q === 'Failure') return route.fulfill({ status: 503, json: { error: 'unavailable' } });
      await route.fulfill({ json: { result: { status: 'available', locations: [q === 'Stadium' ? b : a] } } });
    });
    await query.fill('City Hall');
    await lookup.getByRole('button', { name: 'Search OneMap', exact: true }).click();
    await lookup.getByRole('button', { name: /City Hall meeting point/ }).click();
    await expect(editor.getByLabel('Place name', { exact: true })).toHaveValue(a.label);
    await capture(host.page, 'location-selected-light-390');
    await query.fill('Stadium');
    await expect(editor.getByLabel('Place name', { exact: true })).toHaveValue('');
    await expect(lookup.locator('.meetup-location-search__selection')).toHaveCount(0);
    await manual.getByText('Advanced/manual entry', { exact: true }).click();
    await expect(manual.getByLabel('Latitude', { exact: true })).toHaveValue('');
    await expect(manual.getByLabel('Longitude', { exact: true })).toHaveValue('');
    await lookup.getByRole('button', { name: 'Search OneMap', exact: true }).click();
    await lookup.getByRole('button', { name: /Stadium meeting point/ }).click();
    await expect(manual.getByLabel('Latitude', { exact: true })).toHaveValue(String(b.latitude));
    await expect(manual.getByLabel('Longitude', { exact: true })).toHaveValue(String(b.longitude));
    await editor.getByLabel('Place name', { exact: true }).fill('Our manually chosen entrance');
    await expect(manual.getByLabel('Latitude', { exact: true })).toHaveValue('');
    await expect(manual.getByLabel('Longitude', { exact: true })).toHaveValue('');
    await expect(lookup.locator('.meetup-location-search__selection')).toHaveCount(0);
    await manual.getByLabel('Latitude', { exact: true }).fill('1.304');
    await manual.getByLabel('Longitude', { exact: true }).fill('103.876');
    const saved = host.page.waitForRequest(request => request.url().endsWith(`/api/meetups/${meetup.id}/places`) && request.method() === 'POST');
    await editor.getByRole('button', { name: 'Add place', exact: true }).click();
    expect((await saved).postDataJSON()).toMatchObject({ label: 'Our manually chosen entrance', latitude: 1.304, longitude: 103.876 });
    await expect(host.page.locator('.meetup-suggested-places').getByRole('heading', { name: 'Our manually chosen entrance', exact: true })).toBeVisible();
    expect((await api(host.context, `/meetups/${meetup.id}`)).meetup.places[0]).toMatchObject({ label: 'Our manually chosen entrance', latitude: 1.304, longitude: 103.876 });

    await query.fill('Old request');
    const oldSent = host.page.waitForRequest(request => request.url().includes('/locations?q=Old+request'));
    await lookup.getByRole('button', { name: 'Search OneMap', exact: true }).click();
    await oldSent;
    await expect(lookup).toHaveAttribute('aria-busy', 'true');
    await query.fill('Stadium');
    await lookup.getByRole('button', { name: 'Search OneMap', exact: true }).click();
    await lookup.getByRole('button', { name: /Stadium meeting point/ }).click();
    const oldResponse = host.page.waitForResponse(response => response.url().includes('/locations?q=Old+request'));
    releaseOld();
    await oldResponse;
    await expect(editor.getByLabel('Place name', { exact: true })).toHaveValue(b.label);
    await expect(lookup.locator('.meetup-location-search__selection')).toContainText(b.label);

    await query.fill('Failure');
    await lookup.getByRole('button', { name: 'Search OneMap', exact: true }).click();
    await expect(lookup.getByRole('alert')).toContainText('Could not search places');
    await expect(editor.getByLabel('Place name', { exact: true })).toHaveValue('');
    await expect(lookup.locator('.meetup-location-search__selection')).toHaveCount(0);
    await capture(host.page, 'location-failed-cleared-light-390');
    await editor.getByLabel('Place name', { exact: true }).fill('Manual fallback');
    await manual.getByLabel('Latitude', { exact: true }).fill('1.3');
    await manual.getByLabel('Longitude', { exact: true }).fill('103.87');
    await query.fill('Failure again');
    await expect(editor.getByLabel('Place name', { exact: true })).toHaveValue('Manual fallback');
    await expect(manual.getByLabel('Latitude', { exact: true })).toHaveValue('1.3');
    await expect(manual.getByLabel('Longitude', { exact: true })).toHaveValue('103.87');
  } finally { releaseOld(); await host.context.close(); }
});
