import { test, expect } from '../support/playwright.mjs';

const origin = 'http://127.0.0.1:5175';
async function fixture(request, mode = 'direct') {
  const response = await request.post('http://127.0.0.1:3105/__test/fixture', { data: { mode } });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}
async function person(browser, data, who) {
  const context = await browser.newContext({ reducedMotion: 'reduce', timezoneId: 'UTC', colorScheme: 'dark',
    ...(process.env.ENCORE_RECORD_DEMO === '1' ? {
      reducedMotion: 'no-preference',
      viewport: { width: 1280, height: 900 },
      recordVideo: { dir: test.info().outputPath(`demo-${who}`), size: { width: 1280, height: 900 } },
    } : {}),
  });
  await context.addInitScript(() => localStorage.setItem('encore-theme', 'dark'));
  // Remote fonts/images are outside these feature tests. Application API traffic
  // remains real; blocking optional HTTPS assets avoids internet-dependent loads.
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
async function plannerSnippet(locator, name) {
  // Hide the fixed global header only during section captures, so it does not
  // overlap the middle of a taller-than-viewport screenshot.
  await locator.screenshot({ path: test.info().outputPath(name), style: '.header { visibility: hidden !important; }' });
}
async function submitReviewedProposal(page, immediate = false) {
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText(/participants marked themselves available/);
  await dialog.getByRole('button', { name: immediate ? 'Confirm meetup now' : 'Submit proposal for approval', exact: true }).click();
}

test('direct search: comparing sends no request; applying waits for host approval and persists membership', async ({ browser, request }) => {
  const data = await fixture(request);
  const seeker = await person(browser, data, 'seeker');
  const host = await person(browser, data, 'hostA');
  try {
    await seeker.page.goto(`/groups?concertId=${data.concertId}&mode=direct`);
    await seeker.page.getByRole('button', { name: 'Start comparing', exact: true }).click();
    await expect(seeker.page.getByRole('button', { name: 'Keep this group', exact: true })).toHaveCount(2);
    await seeker.page.getByRole('button', { name: 'Keep this group', exact: true }).first().click();
    expect((await api(seeker.context, '/me/group-join-requests?scope=own')).requests).toHaveLength(0);
    // Select hostA's actual card, independent of its compatibility tie-break order.
    const card = seeker.page.locator('[data-comparison-slot]').filter({ hasText: `Supper crew ${data.suffix}` });
    // A local comparison may have skipped that card; restarting restores the list.
    if (!await card.count()) await seeker.page.getByRole('button', { name: 'Review this page again', exact: true }).click();
    await seeker.page.locator('[data-comparison-slot]').filter({ hasText: `Supper crew ${data.suffix}` }).getByRole('button', { name: 'Request to join', exact: true }).click();
    await seeker.page.getByRole('dialog', { name: `Ask to join Supper crew ${data.suffix}?`, exact: true }).getByRole('button', { name: 'Send request', exact: true }).click();
    await expect(seeker.page.getByText(/Request sent\./).first()).toBeVisible();
    const requests = (await api(seeker.context, '/me/group-join-requests?scope=own')).requests;
    expect(requests).toHaveLength(1);
    expect(requests[0].seatReserved).toBe(true);
    expect((await api(seeker.context, '/me/current-group-memberships')).groups).toHaveLength(0);
    await host.page.goto(`/groups/${data.parties.a}/members#join-requests`);
    await host.page.locator('#join-requests').getByRole('button', { name: 'Accept', exact: true }).click();
    await seeker.page.reload();
    await expect(seeker.page.getByRole('heading', { name: `Supper crew ${data.suffix}`, exact: true })).toBeVisible();
    expect((await api(seeker.context, '/me/current-group-memberships')).groups[0].partyId).toBe(data.parties.a);
  } finally { await seeker.context.close(); await host.context.close(); }
});

test('Kaki finder: two people like each other, view a public vibe and open their conversation', async ({ browser, request }) => {
  const data = await fixture(request);
  const a = await person(browser, data, 'seeker'), b = await person(browser, data, 'outsider');
  try {
    for (const person of [a, b]) await api(person.context, `/concerts/${data.concertId}/participation`, 'POST', { sectionPref: 'ga_standing', arrivalPref: 'doors' });
    await a.page.goto('/kaki');
    await a.page.getByRole('button', { name: 'Find people', exact: true }).click();
    await a.page.getByRole('link', { name: 'View concert vibe →', exact: true }).first().click();
    await expect(a.page.getByRole('heading', { name: 'outsider', exact: true })).toBeVisible();
    await expect(a.page.getByRole('img', { name: /^Vibe profile:/ })).toBeVisible();
    await a.page.goto('/kaki');
    await a.page.getByRole('button', { name: 'Find people', exact: true }).click();
    await a.page.getByRole('button', { name: 'Like this profile', exact: true }).click();
    await expect(a.page.getByText('Waiting for them to like you back.', { exact: true })).toBeVisible();
    expect((await api(a.context, '/kaki/matches')).matches).toHaveLength(0);
    await b.page.goto('/kaki');
    await b.page.getByRole('button', { name: 'Find people', exact: true }).click();
    await b.page.getByRole('button', { name: 'Like this profile', exact: true }).click();
    await expect(b.page.getByText('You both liked each other.', { exact: true })).toBeVisible();
    expect((await api(a.context, '/kaki/matches')).matches).toHaveLength(1);
    await b.page.locator('.kaki__panel--centre').getByRole('link', { name: 'Messages', exact: true }).click();
    await b.page.getByRole('button').filter({ hasText: 'Start a conversation' }).first().click();
    await expect(b.page.getByRole('textbox', { name: 'Message', exact: true })).toBeVisible();
  } finally { await a.context.close(); await b.context.close(); }
});

test('private preference setup: registration opens the welcome questionnaire and answers show in Profile', async ({ browser, request }) => {
  const data = await fixture(request);
  const viewer = await person(browser, data, 'hostA');
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  await context.route(/^https:\/\//, route => route.abort());
  const page = await context.newPage();
  try {
    await page.goto('/login?redirect=%2Fgroups');
    await page.getByRole('tab', { name: 'Sign up', exact: true }).click();
    await page.locator('#display-name').fill('New concert friend');
    await page.locator('#email').fill(`setup-${data.suffix}@example.test`);
    await page.locator('#password').fill('Example-only-passphrase-2026!');
    await page.getByRole('button', { name: 'Create account', exact: true }).click();
    // Sign-up opens the welcome page, which goes straight to the questionnaire.
    await expect(page).toHaveURL(url => url.pathname === '/welcome');
    await expect(page.getByRole('heading', { name: 'Your matching preferences', exact: true })).toBeVisible();
    await expect(page.getByText('Private · Only you can see your answers', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Skip for now' })).toHaveCount(0);
    // Until preferences are saved, every other page leads back here, remembering where they were going.
    await page.getByRole('link', { name: 'Tickets', exact: true }).first().click();
    await expect(page).toHaveURL(url => url.pathname === '/welcome' && url.searchParams.get('next') === '/tickets');
    await page.goto('/groups');
    await expect(page).toHaveURL(url => url.pathname === '/welcome' && url.searchParams.get('next') === '/groups');
    await expect(page.getByRole('heading', { name: 'Your matching preferences', exact: true })).toBeVisible();
    await page.getByRole('button', { name: "meet someone I'd go to more concerts with", exact: true }).click();
    const save = page.waitForRequest(req => req.url().includes('/api/me/preferences') && req.method() === 'PUT');
    await page.getByRole('button', { name: 'Save preferences', exact: true }).click();
    expect(Object.keys((await save).postDataJSON()).sort()).toEqual(['about', 'avoid', 'dealbreakers', 'quiz', 'wants']);
    await expect(page.getByText('You can change your preferences anytime on your Profile page.')).toBeVisible();
    await page.getByRole('link', { name: 'Continue', exact: true }).click();
    // Group discovery can immediately add its selected concert to the query.
    await expect(page).toHaveURL(url => url.pathname === '/groups');
    const own = (await api(context, '/me/profile')).profile;
    const publicProfile = (await api(viewer.context, `/users/${own.id}/profile`)).profile;
    for (const privateField of ['email', 'quiz', 'traits', 'about', 'wants', 'avoid', 'dealbreakers']) expect(publicProfile).not.toHaveProperty(privateField);
    await page.goto('/profile#preferences');
    await page.getByRole('button', { name: 'Edit private preferences', exact: true }).click();
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await expect(page.getByRole('button', { name: "meet someone I'd go to more concerts with", exact: true })).toHaveAttribute('aria-pressed', 'true');
  } finally { await context.close(); await viewer.context.close(); }
});

test('automatic matching: joining the pool then finding a match produces an offer; both approvals are required', async ({ browser, request }) => {
  const data = await fixture(request);
  const seeker = await person(browser, data, 'seeker');
  const hosts = {};
  try {
    await seeker.page.goto(`/groups?concertId=${data.concertId}&mode=algorithm`);
    expect((await api(seeker.context, `/me/concerts/${data.concertId}/matching`)).matching.optedIn).toBe(false);
    await seeker.page.getByRole('button', { name: 'Join automatic matching', exact: true }).click();
    await seeker.page.getByRole('dialog').getByRole('button', { name: 'Join automatic matching', exact: true }).click();
    await expect(seeker.page.getByRole('button', { name: 'Leave the match list', exact: true })).toBeVisible();
    expect((await api(seeker.context, `/me/concerts/${data.concertId}/matching`)).matching.optedIn).toBe(true);
    await seeker.page.getByRole('button', { name: 'Find a match', exact: true }).click();
    await expect(seeker.page.getByText('Both approvals confirm the group spot. Either person can approve first.')).toBeVisible();
    await seeker.page.getByRole('button', { name: 'Accept group offer', exact: true }).click();
    expect((await api(seeker.context, '/me/current-group-memberships')).groups).toHaveLength(0);
    const proposal = (await api(seeker.context, '/me/proposals')).proposals.find(p => p.status === 'proposed');
    expect(proposal.seekerApproved).toBe(true);
    const who = proposal.partyId === data.parties.a ? 'hostA' : 'hostB';
    hosts[who] = await person(browser, data, who);
    await hosts[who].page.goto('/groups/connect');
    await hosts[who].page.getByRole('button', { name: 'Approve companion', exact: true }).click();
    await seeker.page.reload();
    await expect(seeker.page.getByRole('heading', { name: /crew/ }).first()).toBeVisible();
    const memberships = (await api(seeker.context, '/me/current-group-memberships')).groups;
    expect(memberships).toHaveLength(1);
    expect(memberships[0].partyId).toBe(proposal.partyId);
  } finally { await seeker.context.close(); for (const host of Object.values(hosts)) await host.context.close(); }
});

test('nearby transport: before-meetup checks use the meeting place and after-concert checks use the venue', async ({ browser, request }) => {
  const data = await fixture(request), host = await person(browser, data, 'hostA');
  try {
    const { meetup } = await api(host.context, '/meetups', 'POST', { partyId: data.parties.a, title: 'Transport plan', startsAt: '2030-01-01T08:00:00Z', endsAt: '2030-01-01T09:00:00Z' });
    const { place } = await api(host.context, `/meetups/${meetup.id}/places`, 'POST', { label: 'City Hall meeting place', latitude: 1.293, longitude: 103.852, sheltered: true });
    await api(host.context, `/meetups/${meetup.id}/availability`, 'PUT', { windows: [{ startsAt: '2030-01-01T08:00:00Z', endsAt: '2030-01-01T09:00:00Z' }] });
    const version = (await api(host.context, `/meetups/${meetup.id}`)).meetup.version;
    await api(host.context, `/meetups/${meetup.id}/propose`, 'POST', { placeId: place.id, startsAt: '2030-01-01T08:00:00Z', version });
    await host.page.goto(`/meetups/${meetup.id}`);
    await host.page.locator('[data-planner-step="review"]').click();
    const panel = host.page.locator('[data-transport-phase]');
    await panel.getByRole('button', { name: 'Check nearby transport', exact: true }).click();
    await expect(panel.getByRole('heading', { name: 'CITY HALL MRT STATION', exact: true })).toBeVisible();
    await expect(panel.getByText('Low crowding', { exact: true })).toBeVisible();
    await expect(panel.getByText('NS1', { exact: true })).toHaveCount(0);
    await panel.getByRole('button', { name: 'After the concert', exact: true }).click();
    await panel.getByRole('button', { name: 'Check nearby transport', exact: true }).click();
    await expect(panel.getByRole('heading', { name: 'STADIUM MRT STATION', exact: true })).toBeVisible();
    await expect(panel.getByText('High crowding', { exact: true })).toBeVisible();
    await expect(panel.getByText('Singapore Indoor Stadium bus stop', { exact: true })).toBeVisible();
    await panel.locator('summary').filter({ hasText: /Bus|service|crowd/i }).last().click();
    await expect(panel.getByText(/Limited standing space/)).toBeVisible();
    await expect(panel.getByRole('heading', { name: 'CITY HALL MRT STATION', exact: true })).toHaveCount(0);
    await panel.getByRole('button', { name: 'Before the meetup', exact: true }).click();
    await expect(panel.getByRole('heading', { name: 'CITY HALL MRT STATION', exact: true })).toBeVisible();
  } finally { await host.context.close(); }
});

test('meetup guardrails: members contribute, places stay visible and only the host can reopen a confirmed plan', async ({ browser, request }) => {
  const data = await fixture(request);
  const host = await person(browser, data, 'hostA'), member = await person(browser, data, 'friendA');
  try {
    // The creation context is resolved from real signed-in membership, never a
    // client-provided organizer flag. Also check a direct bypass of the UI.
    const unauthorized = await member.context.request.post(`${origin}/api/meetups`, {
      headers: { Origin: origin }, data: { partyId: data.parties.a, title: 'Not the organizer',
        startsAt: '2030-01-01T08:00:00Z', endsAt: '2030-01-01T09:30:00Z' },
    });
    expect(unauthorized.status()).toBe(403);
    await host.page.goto(`/meetups?partyId=${data.parties.a}`);
    await host.page.getByLabel('Title', { exact: true }).fill('Our concert meetup');
    const start = host.page.getByLabel('Earliest meeting time');
    const end = host.page.getByLabel('Latest meeting time');
    await expect(start).toHaveAttribute('min', /2029-12-31T/);
    await expect(end).toHaveAttribute('max', '2030-01-02T00:00');
    await start.fill('2030-01-02T16:00');
    await end.fill('2030-01-02T17:30');
    await expect(host.page.getByRole('button', { name: 'Create planning board', exact: true })).toBeDisabled();
    await plannerSnippet(host.page.locator('.meetup-page'), 'meetup-date-validation.png');
    await start.fill('2030-01-01T16:00');
    await end.fill('2030-01-01T17:30');
    await host.page.getByRole('button', { name: 'Create planning board', exact: true }).click();
    await expect(host.page.getByRole('heading', { name: 'Our concert meetup', exact: true })).toBeVisible();
    const path = new URL(host.page.url()).pathname;
    await member.page.goto(path);
    expect((await api(member.context, path)).meetup.availability).toHaveLength(0);

    // Persistent places exist independently of recommendations even before
    // anyone has saved availability; authorized participants can inspect step 2.
    const initial = (await api(member.context, `${path}/places`, 'POST', { label: 'Initial public entrance', latitude: 1.3, longitude: 103.85 })).place;
    let saved = (await api(host.context, path)).meetup;
    expect(saved.places).toHaveLength(1); expect(saved.suggestions).toHaveLength(0);
    await api(member.context, `${path}/places/${initial.id}`, 'DELETE', { version: saved.version });
    await member.page.locator('[data-availability-start]').last().click();
    await member.page.getByRole('button', { name: 'Save my times', exact: true }).click();
    await expect(member.page.getByText('Your availability has been saved.', { exact: true })).toBeVisible();
    await member.page.locator('[data-planner-step="places"]').click();
    const placeForm = member.page.locator('form').filter({ has: member.page.getByRole('heading', { name: 'Suggest a meeting place', exact: true }) });
    await placeForm.locator('.meetup-location-search input').fill('Indoor Stadium');
    await placeForm.getByRole('button', { name: 'Search OneMap', exact: true }).click();
    await placeForm.getByRole('button', { name: /SINGAPORE INDOOR STADIUM.*2 STADIUM WALK/ }).click();
    await expect(placeForm.getByText('Selected: SINGAPORE INDOOR STADIUM.', { exact: true })).toBeVisible();
    await placeForm.getByRole('button', { name: 'Add place', exact: true }).click();
    const suggested = member.page.locator('section').filter({ has: member.page.getByRole('heading', { name: 'Suggested meeting places', exact: true }) });
    await expect(suggested.getByText('SINGAPORE INDOOR STADIUM', { exact: true })).toBeVisible();
    await expect(member.page.getByRole('button', { name: 'Propose this time & place', exact: true })).toHaveCount(0);
    saved = (await api(host.context, path)).meetup;
    expect(saved.places).toHaveLength(1);
    expect(saved.suggestions).toHaveLength(1);
    await plannerSnippet(member.page.locator('#meetup-places'), 'meetup-place-before-availability.png');

    // Actual pointer dragging paints all three intervals. Applying a journey
    // changes a local draft; saving is a distinct request and persists on reload.
    const cells = host.page.locator('[data-availability-start]');
    await expect(cells).toHaveCount(3);
    await cells.last().scrollIntoViewIfNeeded();
    const first = await cells.first().boundingBox(), last = await cells.last().boundingBox();
    await host.page.mouse.move(first.x + first.width / 2, first.y + first.height / 2);
    await host.page.mouse.down();
    await host.page.mouse.move(last.x + last.width / 2, last.y + last.height / 2, { steps: 8 });
    await host.page.mouse.up();
    await expect(host.page.locator('[data-availability-start][aria-pressed="true"]')).toHaveCount(3);
    const journey = host.page.locator('.meetup-journey');
    await journey.locator('summary').first().click();
    await journey.getByRole('combobox').first().selectOption('drive');
    await journey.locator('.meetup-location-search input').fill('Indoor Stadium');
    await journey.getByRole('button', { name: 'Search OneMap', exact: true }).click();
    await journey.getByRole('button', { name: /SINGAPORE INDOOR STADIUM.*2 STADIUM WALK/ }).click();
    await host.page.getByRole('button', { name: 'Apply to selected times', exact: true }).click();
    await expect(host.page.getByText(/Journey details applied to 3 selected times/)).toBeVisible();
    expect((await api(host.context, path)).meetup.availability).toHaveLength(0);
    await plannerSnippet(journey, 'meetup-journey-draft.png');
    await host.page.setViewportSize({ width: 390, height: 844 });
    expect(await host.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await plannerSnippet(journey, 'meetup-journey-mobile.png');
    await host.page.setViewportSize({ width: 1280, height: 720 });
    await host.page.getByRole('button', { name: 'Save my times', exact: true }).click();
    await expect(host.page.getByText('Your availability has been saved.', { exact: true })).toBeVisible();
    await host.page.reload();
    await expect(host.page.locator('[data-availability-start][aria-pressed="true"]')).toHaveCount(3);
    saved = (await api(host.context, path)).meetup;
    expect(saved.availability).toHaveLength(3);
    expect(saved.availability.every(slot => slot.travel_mode === 'drive' && slot.latitude === 1.3028 && slot.longitude === 103.8743)).toBe(true);
    await plannerSnippet(host.page.locator('#meetup-availability'), 'meetup-availability-saved.png');
    await member.page.locator('[data-planner-step="availability"]').click();
    await member.page.locator('[data-availability-start]').first().click();
    await member.page.getByRole('button', { name: 'Save my times', exact: true }).click();
    await expect(member.page.getByText('Your availability has been saved.', { exact: true })).toBeVisible();
    await host.page.reload();
    await host.page.locator('[data-planner-step="review"]').click();
    await host.page.getByRole('button', { name: 'Confirm this time & place', exact: true }).click();
    await submitReviewedProposal(host.page, true);
    await host.page.locator('[data-planner-step="review"]').click();
    await expect(host.page.getByRole('button', { name: 'Approve plan', exact: true })).toHaveCount(0);
    await expect(host.page.locator('.meetup-context').getByText('Meetup confirmed', { exact: true })).toBeVisible();
    const confirmed = (await api(host.context, path)).meetup;
    await member.page.reload();
    await expect(member.page.getByRole('button', { name: 'Save my times', exact: true })).toBeDisabled();
    for (const [suffix, method, body] of [
      ['/availability', 'PUT', { version: confirmed.version, windows: [] }],
      ['/vote', 'PUT', { placeId: confirmed.selected_place_id }],
      ['/places', 'POST', { label: 'Should not replace the plan', latitude: 1.3, longitude: 103.85 }],
      ['/cancel', 'POST', { version: confirmed.version }],
      ['/reopen', 'POST', { version: confirmed.version }],
    ]) {
      const response = await member.context.request.fetch(`${origin}/api${path}${suffix}`, {
        method, headers: { Origin: origin }, data: body,
      });
      expect(response.ok(), `${suffix} must be refused`).toBe(false);
    }
    saved = (await api(host.context, path)).meetup;
    expect({ status: saved.status, version: saved.version, place: saved.selected_place_id, start: saved.selected_start })
      .toEqual({ status: 'confirmed', version: confirmed.version, place: confirmed.selected_place_id, start: confirmed.selected_start });
    await member.page.locator('[data-planner-step="review"]').click();
    await expect(member.page.getByRole('heading', { name: 'Discussion', exact: true })).toBeVisible();
    await member.page.getByLabel('Message', { exact: true }).fill('Could we meet half an hour later?');
    await member.page.getByRole('button', { name: 'Post', exact: true }).click();
    await expect(member.page.getByText('Your message was posted.', { exact: true })).toBeVisible();
    expect((await api(host.context, path)).meetup.status).toBe('confirmed');
    await plannerSnippet(member.page.locator('#meetup-review'), 'meetup-member-confirmed.png');
    await member.page.setViewportSize({ width: 390, height: 844 });
    await plannerSnippet(member.page.locator('.meetup-page'), 'meetup-member-mobile.png');

    // Reopening is an explicit, confirmed organizer operation. Old approval
    // rows must not count toward the next proposal's approval cycle.
    await host.page.getByRole('button', { name: 'Reopen planning', exact: true }).click();
    const dialog = host.page.getByRole('dialog');
    await expect(dialog).toContainText(/approval/i);
    await dialog.getByRole('button', { name: 'Reopen planning', exact: true }).click();
    await expect(host.page.locator('.meetup-context').getByText('Collecting availability', { exact: true })).toBeVisible();
    saved = (await api(host.context, path)).meetup;
    expect(saved.status).toBe('planning');
    expect(saved.version).toBeGreaterThan(confirmed.version);
    expect(saved.selected_place_id).toBeNull();
    expect(saved.approvals).toHaveLength(0);
    await host.page.locator('[data-planner-step="review"]').click();
    await host.page.getByRole('button', { name: 'Confirm this time & place', exact: true }).click();
    await submitReviewedProposal(host.page, true);
    await expect(host.page.locator('.meetup-context').getByText('Meetup confirmed', { exact: true })).toBeVisible();
    saved = (await api(host.context, path)).meetup;
    expect(saved.status).toBe('confirmed');
    expect(saved.approvals).toHaveLength(1);
    await expect(member.page.locator('.meetup-context').getByText('Meetup confirmed', { exact: true })).toBeVisible();
  } finally { await host.context.close(); await member.context.close(); }
});
