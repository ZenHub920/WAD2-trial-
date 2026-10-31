import { test, expect } from '@playwright/test';

const origin = 'http://127.0.0.1:5175';
async function fixture(request, mode = 'direct') {
  const response = await request.post('http://127.0.0.1:3105/__test/fixture', { data: { mode } });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}
async function person(browser, data, who) {
  const context = await browser.newContext({ reducedMotion: 'reduce', timezoneId: 'UTC' });
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
async function connect(context, receiver, data) {
  const { connection } = await api(context, '/group-connections', 'POST', { fromPartyId: data.parties.a, toPartyId: data.parties.b });
  await api(receiver, `/group-connections/${connection.id}/respond`, 'POST', { action: 'accept' });
  return connection.id;
}

test('direct search: comparing sends no request; applying waits for host approval and persists membership', async ({ browser, request }) => {
  const data = await fixture(request);
  const seeker = await person(browser, data, 'seeker');
  const host = await person(browser, data, 'hostA');
  try {
    await seeker.page.goto(`/groups?concertId=${data.concertId}&mode=direct`);
    await seeker.page.getByRole('button', { name: 'Start comparing', exact: true }).click();
    await expect(seeker.page.getByRole('button', { name: 'Prefer this group', exact: true })).toHaveCount(2);
    await seeker.page.getByRole('button', { name: 'Prefer this group', exact: true }).first().click();
    expect((await api(seeker.context, '/me/group-join-requests?scope=own')).requests).toHaveLength(0);
    // Select hostA's actual card, independent of its compatibility tie-break order.
    const card = seeker.page.locator('[data-comparison-slot]').filter({ hasText: `Supper crew ${data.suffix}` });
    // A local comparison may have skipped that card; restarting restores the list.
    if (!await card.count()) await seeker.page.getByRole('button', { name: 'Review this page again', exact: true }).click();
    await seeker.page.locator('[data-comparison-slot]').filter({ hasText: `Supper crew ${data.suffix}` }).getByRole('button', { name: 'Request to join', exact: true }).click();
    await expect(seeker.page.getByText(/Request sent\./).first()).toBeVisible();
    const requests = (await api(seeker.context, '/me/group-join-requests?scope=own')).requests;
    expect(requests).toHaveLength(1);
    expect(requests[0].seatReserved).toBe(true);
    expect((await api(seeker.context, '/me/current-group-memberships')).groups).toHaveLength(0);
    await host.page.goto('/groups/connect');
    await host.page.getByRole('button', { name: 'Approve group place', exact: true }).click();
    await seeker.page.reload();
    await expect(seeker.page.getByRole('heading', { name: `Supper crew ${data.suffix}`, exact: true })).toBeVisible();
    expect((await api(seeker.context, '/me/current-group-memberships')).groups[0].partyId).toBe(data.parties.a);
  } finally { await seeker.context.close(); await host.context.close(); }
});

test('automatic matching: joining pool produces an offer; both approvals are required', async ({ browser, request }) => {
  const data = await fixture(request);
  const seeker = await person(browser, data, 'seeker');
  const hosts = {};
  try {
    await seeker.page.goto(`/groups?concertId=${data.concertId}&mode=algorithm`);
    await seeker.page.getByRole('button', { name: 'Switch to matching', exact: true }).click();
    await expect(seeker.page.getByRole('button', { name: 'Leave the match list', exact: true })).toBeVisible();
    const round = await request.post('http://127.0.0.1:3105/__test/round', { data: { concertId: data.concertId } });
    expect(round.ok(), await round.text()).toBeTruthy();
    await seeker.page.getByRole('button', { name: 'Check for updates', exact: true }).click();
    await expect(seeker.page.getByText('Both approvals confirm the group place. Either person can approve first.')).toBeVisible();
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

test('group connection: invitation acceptance opens one shared room for both groups and their friends', async ({ browser, request }) => {
  const data = await fixture(request);
  const a = await person(browser, data, 'hostA'), b = await person(browser, data, 'hostB');
  const friend = await person(browser, data, 'friendB'), outsider = await person(browser, data, 'outsider');
  try {
    await a.page.goto(`/groups/connect?view=connections&groupId=${data.parties.a}&concertId=${data.concertId}`);
    await a.page.getByRole('button', { name: 'Invite group to connect', exact: true }).click();
    await b.page.goto('/groups/connect');
    await b.page.getByRole('button', { name: 'Accept the invitation from hostA', exact: true }).click();
    const link = b.page.getByRole('link', { name: 'Open shared chat', exact: true });
    await expect(link).toBeVisible();
    const path = await link.getAttribute('href');
    await link.click();
    await expect(b.page.getByRole('textbox', { name: 'Message both groups' })).toBeVisible();
    await friend.page.goto(path);
    await expect(friend.page.getByRole('textbox', { name: 'Message both groups' })).toBeVisible();
    await outsider.page.goto(path);
    await expect(outsider.page.getByText(/This shared chat is unavailable/)).toBeVisible();
    await expect(outsider.page.getByRole('textbox', { name: 'Message both groups' })).toHaveCount(0);
  } finally { await Promise.all([a, b, friend, outsider].map(p => p.context.close())); }
});

test('shared chat: send, cross-user reply, edit and deletion survive reload', async ({ browser, request }) => {
  const data = await fixture(request);
  const a = await person(browser, data, 'hostA'), b = await person(browser, data, 'friendB'), hostB = await person(browser, data, 'hostB');
  try {
    const id = await connect(a.context, hostB.context, data), path = `/groups/connections/${id}/channel`;
    await a.page.goto(path);
    await a.page.getByRole('textbox', { name: 'Message both groups' }).fill('Meet at the north entrance');
    await a.page.getByRole('button', { name: 'Send', exact: true }).click();
    await b.page.goto(path);
    await expect(b.page.getByText('Meet at the north entrance', { exact: true })).toBeVisible();
    await b.page.getByRole('button', { name: 'Reply', exact: true }).click();
    await b.page.getByRole('textbox', { name: 'Message both groups' }).fill('See you there');
    await b.page.getByRole('button', { name: 'Send', exact: true }).click();
    await b.page.getByRole('button', { name: 'Edit', exact: true }).click();
    await b.page.getByRole('textbox', { name: 'Message both groups' }).fill('See you at six');
    await b.page.getByRole('button', { name: 'Save edit', exact: true }).click();
    await b.page.reload();
    await expect(b.page.getByText('See you at six', { exact: true })).toBeVisible();
    await b.page.getByRole('button', { name: 'Delete', exact: true }).click();
    await b.page.getByRole('button', { name: 'Delete message', exact: true }).click();
    await a.page.reload();
    await expect(a.page.getByText('Message deleted', { exact: true })).toBeVisible();
    await expect(a.page.getByText('See you at six', { exact: true })).toHaveCount(0);
  } finally { await Promise.all([a, b, hostB].map(p => p.context.close())); }
});

test('meeting planner: create, save car availability, suggest a place, fallback travel and require both hosts', async ({ browser, request }) => {
  const data = await fixture(request);
  const a = await person(browser, data, 'hostA'), b = await person(browser, data, 'hostB');
  try {
    const connectionId = await connect(a.context, b.context, data);
    await a.page.goto(`/meetups?connectionId=${connectionId}`);
    await a.page.getByLabel('Title', { exact: true }).fill('Before the show');
    await a.page.getByLabel('First possible meeting time').fill('2030-01-01T16:00');
    await a.page.getByLabel('End of availability window').fill('2030-01-01T17:00');
    await a.page.getByRole('button', { name: 'Create planning board', exact: true }).click();
    await expect(a.page.getByRole('heading', { name: 'Before the show' })).toBeVisible();
    const availability = a.page.locator('section').filter({ has: a.page.getByRole('heading', { name: 'When are you available?', exact: true }) });
    await availability.locator('[data-availability-start]').first().click();
    await a.page.getByLabel('Travel method for selected times').selectOption('drive');
    await a.page.getByRole('button', { name: 'Apply travel method to selected times', exact: true }).click();
    await availability.getByLabel('Location label', { exact: true }).first().fill('City Hall MRT');
    await availability.getByLabel('Latitude', { exact: true }).first().fill('1.293');
    await availability.getByLabel('Longitude', { exact: true }).first().fill('103.852');
    await a.page.getByRole('button', { name: 'Apply this location to selected times', exact: true }).click();
    await a.page.getByRole('button', { name: 'Save selected availability', exact: true }).click();
    await expect(a.page.getByText('Meetup updated.', { exact: true })).toBeVisible();
    const path = new URL(a.page.url()).pathname;
    const { meetup: saved } = await api(a.context, path);
    expect(saved.availability[0]).toMatchObject({ travel_mode: 'drive', latitude: 1.293, longitude: 103.852, starts_at: Date.parse('2030-01-01T08:00:00Z') });
    await a.page.getByLabel('Place name', { exact: true }).fill('Stadium sheltered entrance');
    const placeForm = a.page.locator('form').filter({ has: a.page.getByRole('heading', { name: 'Suggest a meeting place', exact: true }) });
    await placeForm.getByLabel('Latitude', { exact: true }).fill('1.3028');
    await placeForm.getByLabel('Longitude', { exact: true }).fill('103.8743');
    await a.page.getByRole('button', { name: 'Add place', exact: true }).click();
    await a.page.getByRole('button', { name: 'Compare travel options', exact: true }).click();
    await expect(a.page.getByText('Straight-line distance estimate. Fresh route times are unavailable for this option.').first()).toBeVisible();
    await a.page.getByRole('button', { name: 'Propose this time & place', exact: true }).first().click();
    await a.page.getByRole('button', { name: 'Approve plan', exact: true }).click();
    await expect(a.page.getByText(/participants — Awaiting required approvals/)).toBeVisible();
    await b.page.goto(path);
    await b.page.getByRole('button', { name: 'Approve plan', exact: true }).click();
    await expect(b.page.getByText(/participants — Meetup confirmed/)).toBeVisible();
    await b.page.reload();
    await expect(b.page.getByText(/participants — Meetup confirmed/)).toBeVisible();
  } finally { await a.context.close(); await b.context.close(); }
});

test('notifications: a real chat event appears in the inbox, can be marked read and opens its room', async ({ browser, request }) => {
  const data = await fixture(request);
  const a = await person(browser, data, 'hostA'), b = await person(browser, data, 'hostB');
  try {
    const id = await connect(a.context, b.context, data);
    await api(a.context, `/connection-channels/${id}/messages`, 'POST', { body: 'Ready for the concert?' });
    await b.page.goto('/groups/connect');
    await b.page.getByRole('button', { name: /^Notifications/ }).click();
    const panel = b.page.getByRole('region', { name: 'Notifications', exact: true });
    const message = panel.locator('li').filter({ hasText: /message/i }).first();
    await expect(message).toBeVisible();
    await message.getByRole('button', { name: 'Mark read', exact: true }).click();
    await expect(message).toHaveCount(0);
    expect((await api(b.context, '/me/notifications')).notifications.filter(n => n.category === 'chat')).toHaveLength(0);
    await api(a.context, `/connection-channels/${id}/messages`, 'POST', { body: 'Another message after clearing the notification' });
    await panel.getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(message).toBeVisible();
    await message.getByRole('link').click();
    await expect(b.page.getByRole('textbox', { name: 'Message both groups' })).toBeVisible();
    await expect(b.page.getByText('Ready for the concert?', { exact: true })).toBeVisible();
  } finally { await a.context.close(); await b.context.close(); }
});

test('availability heatmap: drag paints/erases and updates another member live without losing their draft', async ({ browser, request }) => {
  const data = await fixture(request);
  const a = await person(browser, data, 'hostA'), b = await person(browser, data, 'hostB');
  try {
    const connectionId = await connect(a.context, b.context, data);
    const { meetup } = await api(a.context, '/meetups', 'POST', {
      connectionId, title: 'Live heatmap plan', startsAt: '2030-01-01T08:00:00Z', endsAt: '2030-01-01T09:30:00Z',
    });
    const path = `/meetups/${meetup.id}`;
    await a.page.goto(`/groups/connections/${connectionId}/channel`);
    await a.page.getByRole('button', { name: 'Plan meetup', exact: true }).click();
    await a.page.getByRole('button', { name: 'Open planner', exact: true }).click();
    await expect(a.page).toHaveURL(new RegExp(path));
    await b.page.goto(path);
    const cells = a.page.locator('[data-availability-start]');
    await expect(cells).toHaveCount(3);
    await expect(cells.first()).toHaveAttribute('aria-label', /16:00–16:30/);
    await cells.first().scrollIntoViewIfNeeded();
    await cells.last().scrollIntoViewIfNeeded();
    const first = await cells.first().boundingBox(), last = await cells.last().boundingBox();
    await a.page.mouse.move(first.x + first.width / 2, first.y + first.height / 2);
    await a.page.mouse.down();
    await a.page.mouse.move(last.x + last.width / 2, last.y + last.height / 2, { steps: 8 });
    await a.page.mouse.up();
    await expect(a.page.locator('[data-availability-start][aria-pressed="true"]')).toHaveCount(3);
    await a.page.getByRole('button', { name: 'Save selected availability', exact: true }).click();
    const other = b.page.locator('[data-availability-start]');
    await expect(other.first()).toHaveText('1/4');
    await a.page.locator('.meetup-availability').screenshot({ path: test.info().outputPath('heatmap-desktop.png') });
    // Keep an unsaved member selection and discussion while the host erases.
    await other.nth(1).click();
    await b.page.getByLabel('Message', { exact: true }).fill('My unsaved discussion');
    await cells.first().click();
    await a.page.getByRole('button', { name: 'Save selected availability', exact: true }).click();
    await expect(other.first()).toHaveText('0/4');
    await expect(other.nth(1)).toHaveAttribute('aria-pressed', 'true');
    await expect(b.page.getByLabel('Message', { exact: true })).toHaveValue('My unsaved discussion');
    await expect(b.page.getByText('Unsaved changes', { exact: true })).toBeVisible();
    await a.page.reload();
    await expect(a.page.locator('[data-availability-start][aria-pressed="true"]')).toHaveCount(2);
    // A phone-sized view retains native keyboard/tap controls and usable cells.
    await b.page.setViewportSize({ width: 390, height: 844 });
    await expect(other.first()).toBeVisible();
    await other.first().focus(); await b.page.keyboard.press('Space');
    await expect(other.first()).toHaveAttribute('aria-pressed', 'true');
    await b.page.locator('.availability-grid').screenshot({ path: test.info().outputPath('heatmap-mobile.png') });
  } finally { await a.context.close(); await b.context.close(); }
});

test('nearby transport: before-meetup checks use the meeting place and after-concert checks use the venue', async ({ browser, request }) => {
  const data = await fixture(request), host = await person(browser, data, 'hostA');
  try {
    const { meetup } = await api(host.context, '/meetups', 'POST', { partyId: data.parties.a, title: 'Transport plan', startsAt: '2030-01-01T08:00:00Z', endsAt: '2030-01-01T09:00:00Z' });
    const { place } = await api(host.context, `/meetups/${meetup.id}/places`, 'POST', { label: 'City Hall meeting place', latitude: 1.293, longitude: 103.852, sheltered: true });
    const version = (await api(host.context, `/meetups/${meetup.id}`)).meetup.version;
    await api(host.context, `/meetups/${meetup.id}/propose`, 'POST', { placeId: place.id, startsAt: '2030-01-01T08:00:00Z', version });
    await host.page.goto(`/meetups/${meetup.id}`);
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
