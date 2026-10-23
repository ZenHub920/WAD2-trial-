import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { createTestDb } from '../src/db/connection.js';
import { createKakiPreferenceGate } from '../src/services/kakiPreferenceGate.js';

async function fixture(t) {
  const db = createTestDb();
  const built = createApp({ db });
  const server = built.app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); db.close(); });
  const api = async (path, user, method = 'GET', body) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method, headers: { 'content-type': 'application/json', ...(user ? { cookie: user.cookie } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: response.status === 204 ? null : await response.json(),
      cookie: response.headers.get('set-cookie')?.split(';')[0] };
  };
  const users = [];
  for (const name of ['singer', 'listener']) {
    const result = await api('/auth/register', null, 'POST', {
      display_name: name, email: `${name}@gate.test`, password: 'test-password',
    });
    assert.equal(result.status, 201);
    users.push({ id: result.body.user.id, cookie: result.cookie });
  }
  db.prepare(`INSERT INTO concerts(id,artist,venue,city,event_date)
    VALUES('preference-gate-concert','Artist','Venue','Singapore','2030-01-01')`).run();
  for (const user of users) assert.equal((await api('/concerts/preference-gate-concert/participation', user,
    'POST', { sectionPref: 'pit', arrivalPref: 'doors' })).status, 200);
  const [a, b] = users;
  return { db, repos: built.repos, realtime: built.realtime, api, a, b,
    async preferences(user, input) { assert.equal((await api('/me/preferences', user, 'PUT', input)).status, 200); },
    decision(user, other, decision = 'like') {
      return api(`/kaki/decisions/preference-gate-concert/${other.id}`, user, 'PUT', { decision });
    },
    chat(user, other) { return api(`/kaki/concerts/preference-gate-concert/conversations/${other.id}`, user, 'POST'); },
  };
}

test('Kaki likes enforce both directions of current hard dealbreakers while skip and withdrawal remain available', async (t) => {
  const f = await fixture(t);
  await f.preferences(f.a, { about: ['singalong'], wants: ['supper'] });
  await f.preferences(f.b, { about: ['quiet'], avoid: ['singalong'], dealbreakers: ['singalong'] });
  for (const [me, other] of [[f.a, f.b], [f.b, f.a]]) {
    const like = await f.decision(me, other);
    assert.equal(like.status, 404);
    assert.equal(like.body.error, 'not_eligible');
    assert.equal((await f.decision(me, other, 'skip')).status, 200);
    assert.equal((await f.api(`/kaki/decisions/preference-gate-concert/${other.id}`, me, 'DELETE')).status, 204);
  }
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM kaki_decisions').get().n, 0);
});

test('saved or forged mutual decisions cannot bypass a receiving person\'s veto to open a chat', async (t) => {
  const f = await fixture(t);
  await f.preferences(f.a, { about: ['singalong'] });
  await f.preferences(f.b, { about: ['quiet'], avoid: ['singalong'], dealbreakers: ['singalong'] });
  for (const [me, other] of [[f.a, f.b], [f.b, f.a]])
    f.db.prepare(`INSERT INTO kaki_decisions(concert_id,actor_user_id,target_user_id,decision,decided_at)
      VALUES('preference-gate-concert',?,?,'like',?)`).run(me.id, other.id, Date.now());
  assert.equal(f.repos.kakiChat.canChat(f.a.id, f.b.id, 'preference-gate-concert'), false);
  for (const [me, other] of [[f.a, f.b], [f.b, f.a]]) {
    assert.equal((await f.chat(me, other)).status, 403);
    assert.deepEqual((await f.api('/kaki/matches', me)).body.matches, []);
    const decisions = (await f.api('/kaki/decisions', me)).body.decisions;
    assert.equal(decisions[`preference-gate-concert:${other.id}`].mutual, false);
  }
  assert.throws(() => f.repos.kakiChat.openFor({ concertId: 'preference-gate-concert', me: f.a.id, other: f.b.id }), /conversation_closed/);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM conversations').get().n, 0);
});

test('changing a hard preference closes existing chat reads, writes, live delivery and unread badges immediately', async (t) => {
  const f = await fixture(t);
  await f.preferences(f.a, { about: ['singalong'] });
  await f.preferences(f.b, { about: ['quiet'] });
  assert.equal((await f.decision(f.a, f.b)).status, 200);
  assert.equal((await f.decision(f.b, f.a)).status, 200);
  const opened = await f.chat(f.a, f.b);
  const id = opened.body.conversation.id;
  const live = [];
  const unsubscribe = f.realtime.subscribe(f.b.id, (type, event) => live.push({ type, event }));
  t.after(unsubscribe);
  const sent = await f.api(`/kaki/conversations/${id}/messages`, f.a, 'POST', { body: 'Before the preference change' });
  assert.equal(sent.status, 201);
  assert.equal(live.filter((event) => event.type === 'message').length, 1);
  assert.equal((await f.api('/kaki/unread', f.b)).body.total, 1);
  await f.preferences(f.b, { about: ['quiet'], avoid: ['singalong'], dealbreakers: ['singalong'] });
  for (const me of [f.a, f.b]) {
    assert.equal((await f.api(`/kaki/conversations/${id}`, me)).status, 403);
    assert.equal((await f.api(`/kaki/conversations/${id}/messages`, me, 'POST', { body: 'Not delivered' })).status, 403);
    assert.equal((await f.api(`/kaki/conversations/${id}/read`, me, 'POST')).status, 403);
    assert.deepEqual((await f.api('/kaki/conversations', me)).body.conversations, []);
    assert.equal((await f.api('/kaki/unread', me)).body.total, 0);
  }
  assert.equal((await f.api(`/kaki/conversations/${id}/messages/${sent.body.message.id}`, f.a,
    'PATCH', { body: 'Not edited' })).status, 403);
  assert.equal(live.filter((event) => event.type === 'message').length, 1);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM messages').get().n, 1);
  assert.throws(() => f.repos.kakiChat.addMessage(id, f.a.id, 'Repository bypass'), /conversation_closed/);
  // Removing a stored decision remains possible, so nobody is trapped in an old consent state.
  assert.equal((await f.api(`/kaki/decisions/preference-gate-concert/${f.b.id}`, f.a, 'DELETE')).status, 204);
});

test('soft avoid preferences and unanswered questionnaires remain compatible, and removing a veto restores eligibility', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.decision(f.a, f.b)).status, 200);
  await f.preferences(f.a, { about: ['singalong'] });
  await f.preferences(f.b, { about: ['quiet'], avoid: ['singalong'] });
  assert.equal((await f.decision(f.b, f.a)).status, 200);
  const first = await f.chat(f.a, f.b);
  assert.equal(first.status, 201);
  await f.preferences(f.b, { about: ['quiet'], avoid: ['singalong'], dealbreakers: ['singalong'] });
  assert.equal(f.repos.kakiChat.canChat(f.a.id, f.b.id, 'preference-gate-concert'), false);
  await f.preferences(f.b, { about: ['quiet'], avoid: ['singalong'], dealbreakers: [] });
  assert.equal(f.repos.kakiChat.canChat(f.a.id, f.b.id, 'preference-gate-concert'), true);
  assert.equal((await f.chat(f.a, f.b)).body.conversation.id, first.body.conversation.id);
});

test('missing or corrupted accounts cannot silently bypass the repository preference gate', async (t) => {
  const f = await fixture(t);
  const gate = createKakiPreferenceGate(f.db);
  assert.equal(gate(f.a.id, f.b.id), true);
  assert.equal(gate(f.a.id, 'missing-user'), false);
  f.db.prepare('INSERT INTO user_group_preferences(user_id,answers_json) VALUES(?,?)').run(f.b.id, '{invalid');
  assert.equal(gate(f.a.id, f.b.id), false);
});
