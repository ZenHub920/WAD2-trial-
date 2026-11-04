import { test, expect } from '../support/playwright.mjs';

const origin = 'http://127.0.0.1:5175';
const window = { title: 'Before the show', startsAt: '2030-01-01T16:00:00+08:00', endsAt: '2030-01-01T17:30:00+08:00' };
const place = { label: 'Stadium MRT entrance', latitude: 1.3028, longitude: 103.875, sheltered: true };
async function fixture(request) {
  const response = await request.post('http://127.0.0.1:3105/__test/fixture', { data: {} });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}
async function actor(browser, data, who) {
  const context = await browser.newContext({ reducedMotion: 'reduce', timezoneId: 'UTC' });
  await context.addInitScript(() => localStorage.setItem('encore-theme', 'dark'));
  await context.route(/^https:\/\//, route => route.abort());
  await context.addCookies([{ name: 'encore_session', value: data.sessions[who], domain: '127.0.0.1', path: '/api' }]);
  return { context, page: await context.newPage() };
}
async function api(context, path, method = 'GET', data) {
  const response = await context.request.fetch(`${origin}/api${path}`, {
    method, headers: { Origin: origin }, ...(data === undefined ? {} : { data }),
  });
  expect(response.ok(), `${path}: ${await response.text()}`).toBeTruthy();
  return response.json();
}
const board = async (person, id) => (await api(person.context, `/meetups/${id}`)).meetup;
async function prepare(person, id) {
  await api(person.context, `/meetups/${id}/availability`, 'PUT', { windows: [{ startsAt: window.startsAt, endsAt: window.endsAt, travelMode: 'drive', latitude: 1.31, longitude: 103.83, label: 'private-origin-marker' }] });
  return (await api(person.context, `/meetups/${id}/places`, 'POST', place)).place.id;
}
async function propose(person, id, placeId) {
  return api(person.context, `/meetups/${id}/propose`, 'POST', { placeId, startsAt: window.startsAt, version: (await board(person, id)).version });
}

test('meetup navigation: chat status, duplicate protection, private origins, overview and authorized return links', async ({ browser, request }) => {
  const data = await fixture(request), host = await actor(browser, data, 'hostA'), member = await actor(browser, data, 'friendA');
  const chat = `/groups/${data.parties.a}/channel`;
  try {
    // Group membership and room membership are separate in the existing chat
    // feature: the host first opens the room and adds their invited friend.
    await api(host.context, `/group-channels/${data.parties.a}`);
    await api(host.context, `/group-channels/${data.parties.a}/members`, 'POST', { userId: data.users.friendA });
    await member.page.goto(chat);
    const memberCard = member.page.getByRole('region', { name: 'Meetup planner for this group', exact: true });
    await expect(memberCard.getByText('Planning has not started', { exact: true })).toBeVisible();
    await expect(memberCard.getByRole('link', { name: 'Create meetup plan', exact: true })).toHaveCount(0);
    await host.page.goto(chat);
    const hostCard = host.page.getByRole('region', { name: 'Meetup planner for this group', exact: true });
    await hostCard.getByRole('link', { name: 'Create meetup plan', exact: true }).click();
    await host.page.getByLabel('Title', { exact: true }).fill(window.title);
    await host.page.getByLabel('Earliest meeting time (Singapore time)', { exact: true }).fill('2030-01-01T16:00');
    await host.page.getByLabel('Latest meeting time (Singapore time)', { exact: true }).fill('2030-01-01T17:30');
    const saved = host.page.waitForResponse(response => response.url().endsWith('/api/meetups') && response.request().method() === 'POST');
    await host.page.getByRole('button', { name: 'Create planning board', exact: true }).evaluate(element => { element.click(); element.click(); });
    const created = await saved;
    expect(created.ok()).toBeTruthy();
    const id = (await created.json()).meetup.id;
    await expect(host.page).toHaveURL(new RegExp(`/meetups/${id}`));
    expect((await api(host.context, `/me/meetups?partyId=${data.parties.a}`)).meetups).toHaveLength(1);
    const duplicate = await api(host.context, '/meetups', 'POST', { ...window, partyId: data.parties.a });
    expect(duplicate.meetup).toEqual({ id, reused: true });
    await expect(memberCard.getByRole('link', { name: 'Share availability', exact: true })).toBeVisible();
    await memberCard.getByRole('link', { name: 'Share availability', exact: true }).click();
    await expect(member.page).toHaveURL(new RegExp(`/meetups/${id}.*#meetup-availability`));
    const placeId = await prepare(host, id);
    const own = await board(member, id);
    expect(own.availability).toEqual([]);
    expect(JSON.stringify(own)).not.toContain('private-origin-marker');
    expect(JSON.stringify((await api(member.context, '/me/meetups')).meetups)).not.toContain('private-origin-marker');
    // Preparation writes availability and then a place. Observe the final
    // contribution too, so the member saves against the fully refreshed plan.
    await member.page.getByRole('tab', { name: /Choose a place/ }).click();
    await expect(member.page.locator('.meetup-suggested-places').getByRole('heading', { name: place.label, exact: true })).toBeVisible();
    await member.page.getByRole('tab', { name: /Find a time/ }).click();
    await expect(member.page.locator('[data-availability-start]').first()).toHaveAttribute('aria-label', /1 of 2 available/);
    await member.page.locator('[data-availability-start]').first().click();
    await member.page.getByRole('button', { name: 'Save my times', exact: true }).click();
    await expect(member.page.getByText('Your availability and journey have been saved.', { exact: true })).toBeVisible();
    await member.page.getByRole('tab', { name: /Choose a place/ }).click();
    await expect(member.page).toHaveURL(/#meetup-places$/);
    await member.page.reload();
    await expect(member.page.locator('#meetup-places')).toBeVisible();
    await propose(host, id, placeId);
    await host.page.goto(chat);
    await hostCard.getByRole('link', { name: 'View meetup details', exact: true }).click();
    await expect(host.page.locator('#meetup-review')).toBeVisible();
    await expect(host.page.getByRole('button', { name: 'Approve plan', exact: true })).toHaveCount(0);
    expect((await board(host, id)).approvals).toHaveLength(1);
    await member.page.goto(chat);
    await expect(memberCard.getByText('Confirmed', { exact: true })).toBeVisible();
    await expect(memberCard.getByText(/Stadium MRT entrance/)).toBeVisible();
    await memberCard.getByRole('link', { name: 'View meetup details', exact: true }).click();
    await member.page.getByRole('link', { name: 'Back to conversation', exact: true }).click();
    await expect(member.page).toHaveURL(new RegExp(`${chat}$`));
    await member.page.goto('/meetups');
    await expect(member.page.getByRole('heading', { name: 'My meetups', exact: true })).toBeVisible();
    await expect(member.page.getByText(`Test concert ${data.suffix}`, { exact: false }).first()).toBeVisible();
    await member.page.getByRole('link', { name: 'View meetup details', exact: true }).click();
    await member.page.getByRole('link', { name: 'Back to My meetups', exact: true }).click();
    await expect(member.page).toHaveURL(/\/meetups$/);
    const notifications = (await api(member.context, '/me/notifications')).notifications;
    const confirmation = notifications.find(item => item.path === `/meetups/${id}#meetup-review`);
    expect(confirmation).toBeTruthy();
    await member.page.goto(confirmation.path);
    await expect(member.page.locator('#meetup-review')).toBeVisible();
    // A bookmark cannot inject a different return destination.
    await member.page.goto(`/meetups/${id}?from=https://example.invalid#meetup-review`);
    await expect(member.page.getByRole('link', { name: 'Back to conversation', exact: true })).toHaveAttribute('href', chat);
    await host.page.goto(`/meetups?partyId=${data.parties.a}`);
    await expect(host.page.getByRole('button', { name: 'Create planning board', exact: true })).toHaveCount(0);
    await host.page.getByRole('button', { name: 'Create a separate plan', exact: true }).click();
    await host.page.getByLabel('Title', { exact: true }).fill('An additional pre-show coffee');
    await host.page.getByRole('button', { name: 'Create planning board', exact: true }).click();
    await expect(host.page.getByRole('heading', { name: 'An additional pre-show coffee', exact: true })).toBeVisible();
    expect((await api(host.context, `/me/meetups?partyId=${data.parties.a}`)).meetups).toHaveLength(2);
  } finally { await host.context.close(); await member.context.close(); }
});

test('meetup status cards: both connected-group hosts and both Kaki partners retain their approval roles', async ({ browser, request }) => {
  const data = await fixture(request), a = await actor(browser, data, 'hostA'), b = await actor(browser, data, 'hostB');
  const seeker = await actor(browser, data, 'seeker'), other = await actor(browser, data, 'outsider');
  try {
    const { connection } = await api(a.context, '/group-connections', 'POST', { fromPartyId: data.parties.a, toPartyId: data.parties.b });
    await api(b.context, `/group-connections/${connection.id}/respond`, 'POST', { action: 'accept' });
    const { meetup } = await api(a.context, '/meetups', 'POST', { ...window, connectionId: connection.id });
    const pid = await prepare(a, meetup.id);
    await propose(a, meetup.id, pid);
    const path = `/groups/connections/${connection.id}/channel`;
    await b.page.goto(path);
    const region = b.page.getByRole('region', { name: 'Meetup planner for both connected groups', exact: true });
    await region.getByRole('link', { name: 'Review and approve', exact: true }).click();
    await b.page.getByRole('button', { name: 'Approve plan', exact: true }).click();
    await expect(b.page.getByText('Your approval has been recorded.', { exact: true })).toBeVisible();
    await expect(b.page.getByRole('button', { name: 'Approve plan', exact: true })).toHaveCount(0);
    expect((await board(a, meetup.id)).status).toBe('proposed');
    await b.page.goto(path);
    await expect(region.getByText(/Your approval is saved/)).toBeVisible();
    await expect(region.getByRole('link', { name: 'View proposed meetup', exact: true })).toBeVisible();
    await a.page.goto(path);
    await a.page.getByRole('region', { name: 'Meetup planner for both connected groups', exact: true }).getByRole('link', { name: 'Review and approve', exact: true }).click();
    await a.page.getByRole('button', { name: 'Approve plan', exact: true }).click();
    await expect(a.page.getByText('The meetup is confirmed.', { exact: true })).toBeVisible();
    expect((await board(a, meetup.id)).approvals).toHaveLength(2);
    for (const person of [seeker, other]) await api(person.context, `/concerts/${data.concertId}/participation`, 'POST', { sectionPref: 'ga_standing', arrivalPref: 'doors' });
    await api(seeker.context, `/kaki/decisions/${data.concertId}/${data.users.outsider}`, 'PUT', { decision: 'like' });
    await api(other.context, `/kaki/decisions/${data.concertId}/${data.users.seeker}`, 'PUT', { decision: 'like' });
    const { conversation } = await api(seeker.context, `/kaki/concerts/${data.concertId}/conversations/${data.users.outsider}`, 'POST');
    await seeker.page.goto(`/kaki/chat/${conversation.id}`);
    await seeker.page.getByRole('region', { name: 'Meetup planner for this pair', exact: true }).getByRole('link', { name: 'Create meetup plan', exact: true }).click();
    const pair = (await api(seeker.context, '/meetups', 'POST', { ...window, kakiConversationId: conversation.id })).meetup;
    const pairPlace = await prepare(seeker, pair.id);
    await propose(seeker, pair.id, pairPlace);
    await api(seeker.context, `/meetups/${pair.id}/approve`, 'POST', { version: (await board(seeker, pair.id)).version });
    expect((await board(other, pair.id)).status).toBe('proposed');
    await other.page.goto(`/kaki/chat/${conversation.id}`);
    await other.page.getByRole('region', { name: 'Meetup planner for this pair', exact: true }).getByRole('link', { name: 'Review and approve', exact: true }).click();
    await other.page.getByRole('button', { name: 'Approve plan', exact: true }).click();
    await expect(other.page.getByText('The meetup is confirmed.', { exact: true })).toBeVisible();
    expect((await board(other, pair.id)).approvals).toHaveLength(2);
  } finally { for (const person of [a, b, seeker, other]) await person.context.close(); }
});
