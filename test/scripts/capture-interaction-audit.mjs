// Run against the disposable test servers only; never reads real credentials.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { clientRequire } from '../support/client-dependencies.mjs';
const { chromium, request } = clientRequire('@playwright/test');
const phase = process.argv[2] ?? 'after';
const directory = process.env.ENCORE_UX_CAPTURE_DIR;
if (!directory) throw new Error('Set ENCORE_UX_CAPTURE_DIR to the local screenshot directory.');
mkdirSync(directory, { recursive: true });
const origin = 'http://127.0.0.1:5175';
const setup = await request.newContext();
const fixture = await setup.post('http://127.0.0.1:3105/__test/fixture', { data: {} });
if (!fixture.ok()) throw new Error(await fixture.text());
const data = await fixture.json();
const browser = await chromium.launch();
const evidence = [];
try {
  const host = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'UTC', reducedMotion: 'reduce' });
  await host.route(/^https:\/\//, route => route.abort());
  await host.addCookies([{ name: 'encore_session', value: data.sessions.hostA, domain: '127.0.0.1', path: '/api' }]);
  const api = async (path, method = 'GET', body, who = host) => {
    const res = await who.request.fetch(`${origin}/api${path}`, { method, headers: { Origin: origin, 'X-Requested-With': 'Encore' }, ...(body === undefined ? {} : { data: body }) });
    if (!res.ok()) throw new Error(`${path}: ${await res.text()}`);
    return res.json();
  };
  const { meetup } = await api('/meetups', 'POST', { partyId: data.parties.a, title: 'Before the show', startsAt: '2030-01-01T16:00:00+08:00', endsAt: '2030-01-01T18:00:00+08:00' });
  await api(`/meetups/${meetup.id}/availability`, 'PUT', { windows: [{ startsAt: '2030-01-01T16:00:00+08:00', endsAt: '2030-01-01T18:00:00+08:00', latitude: 1.31, longitude: 103.84, travelMode: 'transit' }] });
  const { place } = await api(`/meetups/${meetup.id}/places`, 'POST', { label: 'Funan', latitude: 1.2913, longitude: 103.85, sheltered: true });
  await api(`/meetups/${meetup.id}/places`, 'POST', { label: 'Raffles Building', latitude: 1.286, longitude: 103.852, sheltered: false });
  await api(`/meetups/${meetup.id}/vote`, 'PUT', { placeId: place.id });
  const page = await host.newPage();
  for (const theme of ['light', 'dark']) {
    await page.addInitScript(value => localStorage.setItem('encore-theme', value), theme);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 });
      await page.goto(`${origin}/meetups/${meetup.id}#meetup-places`);
      await page.getByRole('heading', { name: 'Before the show', exact: true }).waitFor();
      await page.locator('.meetup-suggested-places').waitFor();
      await page.locator('#meetup-places').screenshot({ path: join(directory, `${phase}-places-${theme}-${width}.png`), animations: 'disabled', style: '.header { visibility:hidden !important; }' });
      evidence.push({ phase, theme, width, voteButtons: await page.getByRole('button', { name: /^(Vote for place|Remove vote|Your vote)$/ }).count(), overflow: await page.evaluate(() => document.documentElement.scrollWidth - innerWidth) });
      if (phase !== 'before') {
        await page.locator('.meetup-suggested-places').screenshot({ path: join(directory, `after-vote-controls-${theme}-${width}.png`), animations: 'disabled', style: '.header { visibility:hidden !important; }' });
        await page.getByRole('button', { name: 'Confirm this time & place', exact: true }).first().click();
        const dialog = page.getByRole('dialog', { name: /Not everyone is available/ });
        await dialog.locator('.confirm__panel').screenshot({ path: join(directory, `after-proposal-review-${theme}-${width}.png`), animations: 'disabled' });
        await dialog.getByRole('button', { name: 'Keep comparing', exact: true }).click();
      }
      await page.goto(`${origin}/groups/${data.parties.a}/members`);
      await page.getByRole('heading', { name: /Supper crew/ }).waitFor();
      await page.getByText('Group settings', { exact: true }).click();
      await page.screenshot({ path: join(directory, `${phase}-manage-group-${theme}-${width}.png`), fullPage: true, animations: 'disabled' });
    }
  }
  await host.close();
} finally {
  await browser.close(); await setup.dispose();
}
writeFileSync(join(directory, `${phase}-interaction-evidence.json`), JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence));
