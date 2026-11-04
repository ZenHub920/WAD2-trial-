// Real API + in-memory SQLite for backend unit tests. Files using it must run in
// the node environment (`// @vitest-environment node`), not jsdom.
import { createApp } from '../../server/src/app.js';
import { createTestDb } from '../../server/src/db/connection.js';

export async function startServer({ webPush, env } = {}) {
  const db = createTestDb();
  const application = createApp({ db, ...(webPush ? { webPush } : {}), ...(env ? { env } : {}) });
  const server = application.app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;

  async function api(path, { method = 'GET', cookie, body } = {}) {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        'X-Requested-With': 'Encore',
        ...(cookie ? { cookie } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null, cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }

  async function user(name) {
    const result = await api('/auth/register', {
      method: 'POST', body: { display_name: name, email: `${name}@example.test`, password: 'test-password' },
    });
    if (result.status !== 201) throw new Error(`register ${name}: ${JSON.stringify(result.body)}`);
    // A profile picture, so these users can join the companion finder.
    db.prepare('UPDATE users SET avatar_path = ? WHERE id = ?').run(`${name}.png`, result.body.user.id);
    return { id: result.body.user.id, name, cookie: result.cookie };
  }

  function concert(id) {
    db.prepare(`INSERT INTO concerts (id, artist, tour_name, venue, city, event_date) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(id, `Artist ${id}`, 'Tour', 'Hall', 'Singapore', '2030-05-01');
  }

  /** Two users who joined the same concert and liked each other, with an open thread. */
  async function chatPair(concertId, names = ['alice', 'bob']) {
    concert(concertId);
    const [a, b] = [await user(`${names[0]}-${concertId}`), await user(`${names[1]}-${concertId}`)];
    for (const person of [a, b]) {
      await api(`/concerts/${concertId}/participation`, { method: 'POST', cookie: person.cookie, body: { sectionPref: 'pit', arrivalPref: 'doors' } });
    }
    await api(`/kaki/decisions/${concertId}/${b.id}`, { method: 'PUT', cookie: a.cookie, body: { decision: 'like' } });
    await api(`/kaki/decisions/${concertId}/${a.id}`, { method: 'PUT', cookie: b.cookie, body: { decision: 'like' } });
    const opened = await api(`/kaki/concerts/${concertId}/conversations/${b.id}`, { method: 'POST', cookie: a.cookie });
    if (opened.status !== 201) throw new Error(`open chat: ${JSON.stringify(opened.body)}`);
    return { a, b, conversationId: opened.body.conversation.id };
  }

  const send = (person, conversationId, body) =>
    api(`/kaki/conversations/${conversationId}/messages`, { method: 'POST', cookie: person.cookie, body: { body } });
  const inbox = async person => (await api('/me/notifications', { cookie: person.cookie })).body.notifications;

  async function stop() {
    await application.delivery?.stop?.();
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
    db.close();
  }

  return { db, base, application, api, user, concert, chatPair, send, inbox, stop };
}
