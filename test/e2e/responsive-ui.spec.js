import { test, expect } from '../support/playwright.mjs';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const origin = 'http://127.0.0.1:5175';
const capturePhase = process.env.ENCORE_UX_CAPTURE_PHASE ?? 'after';
async function api(context, path, method = 'GET', data) {
  const response = await context.request.fetch(`${origin}/api${path}`, {
    method, headers: { Origin: origin }, ...(data === undefined ? {} : { data }),
  });
  expect(response.ok(), `${path}: ${await response.text()}`).toBeTruthy();
  return response.json();
}
async function actor(browser, fixture, who, theme) {
  const context = await browser.newContext({ reducedMotion: 'reduce', timezoneId: 'UTC', viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(value => localStorage.setItem('encore-theme', value), theme);
  await context.route(/^https:\/\//, route => route.abort());
  await context.addCookies([{ name: 'encore_session', value: fixture.sessions[who], domain: '127.0.0.1', path: '/api' }]);
  return { context, page: await context.newPage() };
}
async function capture(page, name) {
  const directory = process.env.ENCORE_UX_CAPTURE_DIR;
  if (!directory) return;
  mkdirSync(directory, { recursive: true });
  await page.screenshot({ path: join(directory, `${capturePhase}-${name}.png`), animations: 'disabled' });
}

test('visual audit: representative screens in light and dark desktop and mobile', async ({ browser, request }) => {
  test.setTimeout(300000);
  const response = await request.post('http://127.0.0.1:3105/__test/fixture', { data: {} });
  expect(response.ok()).toBeTruthy();
  const data = await response.json();
  for (const theme of ['light', 'dark']) {
    const host = await actor(browser, data, 'hostA', theme);
    const seeker = await actor(browser, data, 'seeker', theme);
    try {
      await api(host.context, '/tickets', 'POST', { concertId: data.concertId, priceCents: 15000, quantity: 2, section: 'Cat 2', description: 'Two seats together. Message to arrange transfer.' });
      const { meetup } = await api(host.context, '/meetups', 'POST', {
        partyId: data.parties.a, title: 'Meet before the show', startsAt: '2030-01-01T16:00:00+08:00', endsAt: '2030-01-01T17:30:00+08:00',
      });
      await api(host.context, `/meetups/${meetup.id}/places`, 'POST', { label: 'Stadium MRT entrance', latitude: 1.3028, longitude: 103.875, sheltered: true });
      await api(host.context, `/meetups/${meetup.id}/availability`, 'PUT', { windows: [{ startsAt: '2030-01-01T16:00:00+08:00', endsAt: '2030-01-01T17:00:00+08:00', travelMode: 'transit' }] });
      const screens = [
        ['concerts', host, '/concerts', 'Concerts'],
        ['tickets', seeker, '/tickets', 'Tickets'],
        ['planner', host, `/meetups/${meetup.id}`, 'Meet before the show'],
        ['group-chat', host, `/groups/${data.parties.a}/channel`, `Test concert ${data.suffix} group`],
      ];
      for (const width of [1440, 390]) for (const [name, person, path, heading] of screens) {
        await person.page.setViewportSize({ width, height: width < 600 ? 844 : 1000 });
        await person.page.goto(path);
        await expect(person.page.getByRole('heading', { name: heading, exact: true }).first()).toBeVisible();
        await expect(person.page.locator('.loading-state').filter({ visible: true })).toHaveCount(0);
        if (capturePhase !== 'before' && name === 'group-chat') {
          await expect(person.page.locator('.meetup-entry')).toHaveAttribute('aria-busy', 'false');
          await expect(person.page.locator('.meetup-entry')).toContainText('Meet before the show');
        }
        await capture(person.page, `${name}-${theme}-${width}`);
        if (capturePhase !== 'before') expect(await person.page.evaluate(() => document.documentElement.scrollWidth - innerWidth), `${name} ${theme} ${width}`).toBeLessThanOrEqual(1);
      }
    } finally { await host.context.close(); await seeker.context.close(); }
  }
});

async function opened(page, path, heading) {
  // Multiple actors use separate contexts. Keyboard/focus assertions must run
  // in the foreground page, as they would for the person using the app.
  await page.bringToFront();
  await page.goto(path);
  await expect(page.getByRole('heading', { name: heading, exact: true }).first()).toBeVisible();
  await expect(page.locator('.loading-state:visible')).toHaveCount(0);
}
async function fitsViewport(page, label) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), label).toBeLessThanOrEqual(1);
}
async function headerFits(page, width) {
  const controls = page.locator('.header .brand, .header .theme-btn, .header .notification-bell__button, .header .header__toggle');
  const boxes = [];
  for (const control of await controls.all()) {
    if (!await control.isVisible()) continue;
    const box = await control.boundingBox();
    expect(box.x, `header control left at ${width}`).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, `header control right at ${width}`).toBeLessThanOrEqual(width + 1);
    boxes.push(box);
  }
  boxes.sort((a, b) => a.x - b.x);
  for (let index = 1; index < boxes.length; index++) expect(boxes[index - 1].x + boxes[index - 1].width, `header controls overlap at ${width}`).toBeLessThanOrEqual(boxes[index].x + 1);
  if (width > 1100) {
    const utility = await page.locator('.header__utilities').boundingBox();
    for (const link of await page.locator('.header nav a').all()) expect((await link.boundingBox()).x + (await link.boundingBox()).width, 'desktop navigation stays clear of utilities').toBeLessThanOrEqual(utility.x + 1);
  }
}
async function keyboardHeader(page, width, theme) {
  expect(await page.evaluate(() => document.hasFocus()), 'keyboard checks require the active actor page').toBe(true);
  const opposite = theme === 'light' ? 'dark' : 'light';
  await page.getByRole('button', { name: `Switch to ${opposite} theme`, exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', opposite);
  expect(await page.evaluate(() => localStorage.getItem('encore-theme'))).toBe(opposite);
  await page.getByRole('button', { name: `Switch to ${theme} theme`, exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  if (width <= 1100) {
    const trigger = page.locator('button[aria-controls="main-navigation"]');
    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link').first()).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(trigger).toBeFocused();
  }
}
async function paintWithPointer(page, from, to) {
  await from.scrollIntoViewIfNeeded();
  const start = await from.boundingBox(), end = await to.boundingBox();
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 8 });
  await page.mouse.up();
}
async function checkAvailability(page, width) {
  await page.getByRole('table', { name: 'Group availability in Singapore time' }).scrollIntoViewIfNeeded();
  const cells = page.locator('[data-availability-start]');
  await expect(cells).toHaveCount(6);
  const first = cells.nth(0), middle = cells.nth(1), third = cells.nth(2);
  await first.focus();
  await page.keyboard.press('ArrowDown');
  await expect(middle).toBeFocused();
  await page.keyboard.press('Space');
  await expect(middle).toHaveAttribute('aria-pressed', 'true');
  expect(await middle.evaluate(element => getComputedStyle(element).outlineStyle)).not.toBe('none');
  await page.keyboard.press('Space');
  await expect(middle).toHaveAttribute('aria-pressed', 'false');
  await paintWithPointer(page, first, third);
  for (const cell of [first, middle, third]) await expect(cell).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText('Unsaved changes', { exact: true })).toBeVisible();
  await paintWithPointer(page, first, third);
  for (const cell of [first, middle, third]) await expect(cell).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'Discard my changes', exact: true }).click();
  await expect(page.getByText('Your saved availability', { exact: true })).toBeVisible();
  await expect(third).toHaveAttribute('aria-pressed', 'true');
  const geometry = await first.boundingBox();
  expect(geometry.width, `heatmap target width ${width}`).toBeGreaterThanOrEqual(40);
  expect(geometry.height, `heatmap target height ${width}`).toBeGreaterThanOrEqual(width <= 600 ? 30 : 25);
  const time = page.locator('#meetup-tab-availability');
  await time.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#meetup-tab-places')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowLeft');
  await expect(time).toHaveAttribute('aria-selected', 'true');
}
async function calendarCheck(page, width, theme) {
  const toggle = page.getByRole('button', { name: 'Choose a date from the calendar', exact: true });
  await toggle.focus();
  await page.keyboard.press('Enter');
  const calendar = page.getByRole('dialog', { name: 'Choose a date', exact: true });
  await expect(calendar).toBeVisible();
  await calendar.scrollIntoViewIfNeeded();
  const rectangle = await calendar.boundingBox();
  expect(rectangle.x, `calendar left ${theme} ${width}`).toBeGreaterThanOrEqual(0);
  expect(rectangle.x + rectangle.width, `calendar right ${theme} ${width}`).toBeLessThanOrEqual(width + 1);
  expect(await calendar.getByRole('grid').evaluate(element => element.scrollWidth - element.clientWidth), `calendar columns stay in panel ${theme} ${width}`).toBeLessThanOrEqual(1);
  const day = await calendar.getByRole('gridcell').first().boundingBox();
  expect(day.width, `calendar target width ${theme} ${width}`).toBeGreaterThanOrEqual(24);
  expect(day.height, `calendar target height ${theme} ${width}`).toBeGreaterThanOrEqual(36);
  const before = await calendar.locator('[role="gridcell"]:focus').getAttribute('data-iso');
  await page.keyboard.press('ArrowRight');
  await expect(calendar.locator('[role="gridcell"]:focus')).not.toHaveAttribute('data-iso', before);
  await fitsViewport(page, `calendar ${theme} ${width}`);
  await capture(page, `calendar-${theme}-${width}`);
  await page.keyboard.press('Escape');
  await expect(calendar).toHaveCount(0);
  await expect(toggle).toBeFocused();
}
function contrastRatio(first, second) {
  const luminance = css => css.match(/[\d.]+/g).slice(0, 3).map(Number).map(channel => channel / 255)
    .map(channel => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4)
    .reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index], 0);
  const a = luminance(first), b = luminance(second);
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
}
async function renderedContrast(page) {
  const pairs = await page.evaluate(() => {
    const panel = document.querySelector('.meetup-availability');
    const color = element => getComputedStyle(element).color;
    const background = getComputedStyle(panel).backgroundColor;
    const button = panel.querySelector('.btn--primary:not(:disabled)');
    return [
      ['panel body', color(panel.querySelector('h2')), background],
      ['panel secondary', color(panel.querySelector('.group-muted')), background],
      ...getComputedStyle(button).backgroundImage.match(/rgba?\([^)]+\)/g).map((fill, index) => [`primary gradient endpoint ${index}`, color(button), fill]),
    ];
  });
  for (const [name, text, background] of pairs) {
    expect(contrastRatio(text, background), `${name}: ${text} / ${background}`).toBeGreaterThanOrEqual(4.5);
  }
}
async function renderedControlEdges(page, name) {
  const selector = name === 'concerts' ? '.concert-filters__input, .datefield' : '.market-filters select, .market-filters input[type="search"]';
  const pairs = await page.locator(selector).evaluateAll(elements => elements.map(element => {
    const style = getComputedStyle(element);
    return [style.borderTopColor, style.backgroundColor];
  }));
  expect(pairs.length).toBeGreaterThan(0);
  for (const [edge, background] of pairs) {
    expect(contrastRatio(edge, background), `${name} input boundary: ${edge} / ${background}`).toBeGreaterThanOrEqual(3);
  }
}

for (const theme of ['light', 'dark']) test(`responsive visual audit: ${theme} layouts, keyboard controls and heatmap at six widths`, async ({ browser, request }) => {
  test.skip(capturePhase === 'before', 'Final responsive checks run against the completed implementation.');
  test.setTimeout(300000);
  const response = await request.post('http://127.0.0.1:3105/__test/fixture', { data: {} });
  expect(response.ok()).toBeTruthy();
  const data = await response.json();
  const host = await actor(browser, data, 'hostA', theme), seeker = await actor(browser, data, 'seeker', theme), other = await actor(browser, data, 'outsider', theme);
  const errors = [];
  for (const person of [host, seeker]) person.page.on('pageerror', error => errors.push(error.message));
  try {
    await api(host.context, '/tickets', 'POST', { concertId: data.concertId, priceCents: 15000, quantity: 2, section: 'Cat 2', description: 'Two seats together. Message to arrange transfer.' });
    for (const person of [seeker, other]) await api(person.context, `/concerts/${data.concertId}/participation`, 'POST', { sectionPref: 'ga_standing', arrivalPref: 'doors' });
    const { meetup } = await api(host.context, '/meetups', 'POST', { partyId: data.parties.a, title: 'Find our time before the show', startsAt: '2030-01-01T15:00:00+08:00', endsAt: '2030-01-01T18:00:00+08:00' });
    const { place } = await api(host.context, `/meetups/${meetup.id}/places`, 'POST', { label: 'Stadium MRT entrance', latitude: 1.3028, longitude: 103.875, sheltered: true });
    await api(host.context, `/meetups/${meetup.id}/availability`, 'PUT', { windows: [{ startsAt: '2030-01-01T16:00:00+08:00', endsAt: '2030-01-01T17:00:00+08:00', travelMode: 'transit' }] });
    await api(host.context, `/meetups/${meetup.id}/vote`, 'PUT', { placeId: place.id });
    await api(host.context, '/meetups', 'POST', { partyId: data.parties.a, title: 'Share your time with the crew', startsAt: '2030-01-01T14:00:00+08:00', endsAt: '2030-01-01T15:00:00+08:00', createAnother: true });
    const screens = {
      concerts: [host, '/concerts', 'Concerts'],
      messages: [host, '/messages', 'Messages'],
      tickets: [seeker, `/tickets?concert=${data.concertId}`, 'Tickets'],
      groups: [seeker, `/groups?concertId=${data.concertId}&mode=direct`, 'Find your people for the show'],
      'my-meetups': [host, '/meetups', 'My meetups'],
      kaki: [seeker, '/kaki', 'Find a companion'],
      dashboard: [host, '/groups/connect', 'My groups'],
    };
    const matrix = [320, 360, 390, 768, 1024, 1440].map(width => [width, Object.keys(screens)]);
    for (const [width, names] of matrix) {
      await test.step(`${theme} ${width}px`, async () => {
        const height = width < 600 ? 844 : 1000;
        await host.page.setViewportSize({ width, height });
        await opened(host.page, `/meetups/${meetup.id}`, 'Find our time before the show');
        await expect(host.page.getByRole('table', { name: 'Group availability in Singapore time' })).toBeVisible();
        await fitsViewport(host.page, `planner ${theme} ${width}`);
        await headerFits(host.page, width);
        await keyboardHeader(host.page, width, theme);
        await checkAvailability(host.page, width);
        if (width === 320) {
          await renderedContrast(host.page);
          expect(await host.page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
          const save = host.page.getByRole('button', { name: 'Save my times', exact: true });
          await save.hover();
          expect(await save.evaluate(element => getComputedStyle(element).transform)).toBe('none');
          const transition = await save.evaluate(element => getComputedStyle(element).transitionDuration.split(',').map(value => parseFloat(value)));
          expect(Math.max(...transition)).toBeLessThanOrEqual(.02);
          await host.page.getByRole('button', { name: /^Notifications/ }).click();
          const popover = host.page.getByRole('region', { name: 'Notifications', exact: true });
          await expect(popover).toBeVisible();
          await expect(popover).toBeFocused();
          await fitsViewport(host.page, `notifications ${theme} ${width}`);
          await capture(host.page, `notifications-${theme}-${width}`);
          const menu = host.page.locator('button[aria-controls="main-navigation"]');
          await menu.focus();
          await host.page.keyboard.press('Enter');
          await expect(popover).toHaveCount(0);
          await expect(menu).toHaveAttribute('aria-expanded', 'true');
          await expect(host.page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link').first()).toBeFocused();
          await host.page.keyboard.press('Escape');
          await host.page.getByRole('button', { name: /^Notifications/ }).click();
          await expect(popover).toBeFocused();
          await host.page.keyboard.press('Escape');
          await expect(host.page.getByRole('button', { name: /^Notifications/ })).toBeFocused();
        }
        await host.page.evaluate(() => scrollTo(0, 0));
        if ([320, 768].includes(width)) await capture(host.page, `planner-responsive-${theme}-${width}`);
        for (const name of names) {
          const [person, path, heading] = screens[name];
          await person.page.setViewportSize({ width, height });
          await opened(person.page, path, heading);
          if (name === 'kaki') {
            await person.page.getByRole('button', { name: 'Find people', exact: true }).click();
            await expect(person.page.getByRole('button', { name: 'Like this profile', exact: true })).toBeVisible();
            await expect(person.page.locator('.deck__card--top')).toBeVisible();
          }
          if (name === 'groups') {
            await person.page.getByRole('button', { name: 'Start comparing', exact: true }).click();
            await expect(person.page.getByRole('button', { name: 'Keep this group', exact: true })).toHaveCount(2);
          }
          if (name === 'my-meetups') {
            await expect(person.page.getByRole('heading', { name: 'Needs your attention', exact: true })).toBeVisible();
            await expect(person.page.getByRole('heading', { name: 'Share your time with the crew', exact: true })).toBeVisible();
          }
          if (name === 'dashboard') {
            const attention = person.page.locator('.workspace-overview a[href="/meetups"]');
            await expect(attention).toContainText('2 need your attention');
          }
          await fitsViewport(person.page, `${name} ${theme} ${width}`);
          await headerFits(person.page, width);
          if (['concerts', 'tickets'].includes(name)) await renderedControlEdges(person.page, name);
          if (['my-meetups', 'kaki', 'dashboard'].includes(name) && [390, 1440].includes(width)) await capture(person.page, `${name}-${theme}-${width}`);
          if (name === 'groups' && [320, 1024].includes(width)) await capture(person.page, `group-comparison-${theme}-${width}`);
          if (name === 'concerts' && [320, 390].includes(width)) await calendarCheck(person.page, width, theme);
        }
        if ([390, 1440].includes(width)) {
          await host.page.setViewportSize({ width, height });
          await opened(host.page, `/meetups/${meetup.id}`, 'Find our time before the show');
          for (const stage of ['places', 'review']) {
            await host.page.locator(`#meetup-tab-${stage}`).click();
            await expect(host.page.locator(`#meetup-${stage}`)).toBeVisible();
            await fitsViewport(host.page, `planner ${stage} ${theme} ${width}`);
            await capture(host.page, `planner-${stage}-${theme}-${width}`);
          }
        }
      });
    }
    expect(errors).toEqual([]);
  } finally { await Promise.all([host, seeker, other].map(person => person.context.close())); }
});
