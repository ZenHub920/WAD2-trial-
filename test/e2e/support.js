import { expect } from '../support/playwright.mjs';

export const origin = 'http://127.0.0.1:5175';

export async function fixture(request, mode = 'direct') {
  const response = await request.post('http://127.0.0.1:3105/__test/fixture', { data: { mode } });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}

export async function person(browser, data, who) {
  const context = await browser.newContext({ reducedMotion: 'reduce', timezoneId: 'UTC' });
  // Remote fonts/images are outside these tests; app API traffic stays real.
  await context.route(/^https:\/\//, route => route.abort());
  await context.addCookies([{ name: 'encore_session', value: data.sessions[who], domain: '127.0.0.1', path: '/api' }]);
  return { context, page: await context.newPage(), id: data.users[who] };
}

export async function api(context, path, method = 'GET', body) {
  const response = await context.request.fetch(`${origin}/api${path}`, {
    method, headers: { Origin: origin, 'X-Requested-With': 'Encore' }, ...(body === undefined ? {} : { data: body }),
  });
  expect(response.ok(), `${method} ${path}: ${await response.text()}`).toBeTruthy();
  return response.json();
}

/** Both people join the fixture concert, like each other, and get a shared thread. */
export async function chatPair(data, a, b) {
  for (const p of [a, b]) {
    await api(p.context, `/concerts/${data.concertId}/participation`, 'POST', { sectionPref: 'pit', arrivalPref: 'doors' });
  }
  await api(a.context, `/kaki/decisions/${data.concertId}/${b.id}`, 'PUT', { decision: 'like' });
  await api(b.context, `/kaki/decisions/${data.concertId}/${a.id}`, 'PUT', { decision: 'like' });
  const { conversation } = await api(a.context, `/kaki/concerts/${data.concertId}/conversations/${b.id}`, 'POST');
  return conversation.id;
}
