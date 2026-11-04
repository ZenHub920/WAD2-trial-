import { test, expect } from '../support/playwright.mjs';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fixture, person, api } from './support.js';

async function capture(page, name) {
  if (!process.env.ENCORE_UX_CAPTURE_DIR) return;
  mkdirSync(process.env.ENCORE_UX_CAPTURE_DIR, { recursive: true });
  await page.screenshot({ path: join(process.env.ENCORE_UX_CAPTURE_DIR, `${process.env.ENCORE_UX_CAPTURE_PHASE ?? 'final'}-${name}.png`), animations: 'disabled' });
}
test('Kaki keeps a joined artist/date selectable when no other profiles exist', async ({ browser, request }) => {
  const data = await fixture(request), fan = await person(browser, data, 'outsider');
  const errors = []; fan.page.on('pageerror', error => errors.push(error.message));
  try {
    const { concert } = await api(fan.context, '/concerts', 'POST', { artist: `Solo artist ${data.suffix}`, venue: 'Stadium', event_date: '2030-01-01' });
    await api(fan.context, `/concerts/${concert.id}/participation`, 'POST', { sectionPref: 'pit', arrivalPref: 'doors' });
    await fan.page.goto(`/kaki?concertId=${concert.id}`);
    const artist = fan.page.getByLabel(/^Artist/), date = fan.page.getByLabel(/^Concert date/);
    await expect(artist).toHaveValue(concert.artist); await expect(date).toHaveValue('2030-01-01');
    await expect(artist.locator('option', { hasText: concert.artist })).toHaveCount(1);
    await expect(fan.page.locator('.kaki__empty-note')).toContainText('No companion profiles are currently available for this concert.');
    await expect(fan.page.getByRole('button', { name: 'Find people', exact: true })).toBeDisabled();
    await capture(fan.page, 'kaki-joined-artist-zero-profiles');
    await fan.page.getByRole('button', { name: 'Reset', exact: true }).click();
    await expect(artist).toHaveValue('');
    await artist.selectOption(concert.artist); await date.selectOption('2030-01-01');
    await fan.page.reload();
    await expect(artist).toHaveValue(concert.artist);
    expect((await api(fan.context, '/kaki/pool')).people).toHaveLength(0);
    expect(errors).toEqual([]);
  } finally { await fan.context.close(); }
});

for (const days of [1, 2]) test(`${days}-day availability fills its workspace in both themes at six widths`, async ({ browser, request }) => {
  const data = await fixture(request), host = await person(browser, data, 'hostA');
  try {
    const { meetup } = await api(host.context, '/meetups', 'POST', { partyId: data.parties.a, title: `${days}-day calendar`,
      startsAt: days === 1 ? '2030-01-01T16:00:00+08:00' : '2029-12-31T16:00:00+08:00', endsAt: '2030-01-01T17:30:00+08:00' });
    for (const theme of ['light','dark']) for (const width of [320,360,390,768,1024,1440]) {
      await host.page.addInitScript(value => localStorage.setItem('encore-theme', value), theme);
      await host.page.setViewportSize({ width, height: width < 600 ? 844 : 1000 });
      await host.page.goto(`/meetups/${meetup.id}`);
      const scroll = host.page.locator('.availability-grid__scroll'), table = scroll.getByRole('table');
      await expect(table).toBeVisible();
      await expect(table.locator('thead th')).toHaveCount(days+1);
      const viewport = await scroll.boundingBox(), grid = await table.boundingBox();
      expect(Math.abs(grid.width - viewport.width), `${theme}/${width}: use available calendar width`).toBeLessThanOrEqual(2);
      expect(await host.page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
      const first = scroll.locator('[data-availability-start]').first();
      expect((await first.boundingBox()).width).toBeGreaterThanOrEqual(44);
      expect((await first.boundingBox()).height).toBeGreaterThanOrEqual(days === 1 || width < 600 ? 44 : 25);
      await first.focus(); await host.page.keyboard.press('Space'); await expect(first).toHaveAttribute('aria-pressed','true');
      await host.page.keyboard.press('Space'); await expect(first).toHaveAttribute('aria-pressed','false');
      if ([390,1440].includes(width)) { await scroll.scrollIntoViewIfNeeded(); await capture(host.page, `calendar-${days}day-${theme}-${width}`); }
    }
  } finally { await host.context.close(); }
});

test('legacy many-day calendar retains horizontal scrolling without relaxing real creation date limits', async ({ browser, request }) => {
  const data = await fixture(request), host = await person(browser, data, 'hostA');
  try {
    const { meetup } = await api(host.context, '/meetups', 'POST', { partyId: data.parties.a, title: 'Legacy window rendering', startsAt: '2030-01-01T16:00:00+08:00', endsAt: '2030-01-01T17:30:00+08:00' });
    // Only this authorized GET response receives a legacy rendering fixture.
    // No database writes or server creation-date validation are bypassed.
    const saved = (await api(host.context, `/meetups/${meetup.id}`)).meetup;
    const start = Date.parse('2029-12-26T08:00:00Z');
    await host.page.route(`**/api/meetups/${meetup.id}`, route => route.fulfill({ json: { meetup: { ...saved,
      grid: Array.from({ length: 7*3 }, (_, index) => ({ startsAt: start + Math.floor(index/3)*86400000 + index%3*1800000, availableCount: index%2 })),
    } } }));
    await host.page.setViewportSize({ width: 390, height: 844 });
    await host.page.goto(`/meetups/${meetup.id}`);
    const scroll = host.page.locator('.availability-grid__scroll');
    await expect(scroll.locator('thead th')).toHaveCount(8);
    await expect(host.page.locator('.availability-grid__scroll-hint')).toBeVisible();
    expect(await scroll.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
    await scroll.evaluate(element => { element.scrollLeft = element.scrollWidth; });
    expect(await scroll.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
    await scroll.scrollIntoViewIfNeeded(); await capture(host.page, 'calendar-legacy-seven-day-scroll');
  } finally { await host.context.close(); }
});
