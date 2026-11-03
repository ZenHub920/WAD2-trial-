import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { createTestDb } from '../src/db/connection.js';

async function fixture(t) {
  const db = createTestDb();
  const server = createApp({ db }).app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); });
  async function request(path, { cookie, method = 'GET', body } = {}) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method, headers: { ...(cookie ? { cookie } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  async function person(name) {
    const result = await request('/auth/register', { method: 'POST', body: { display_name: name, email: `${name}@example.test`, password: 'example-password' } });
    assert.equal(result.status, 201);
    return { ...result.body.user, cookie: result.cookie };
  }
  return { db, request, person };
}

test('concert profile requires authentication and only publishes whitelisted self-description', async t => {
  const f = await fixture(t);
  const owner = await f.person('profile-owner'), viewer = await f.person('profile-viewer');
  f.db.prepare('UPDATE users SET vibe_json=?,companion_gender_pref=? WHERE id=?')
    .run(JSON.stringify({ singalong: 4, quiet: 2, custom_private_answer: 'secret' }), 'female', owner.id);
  assert.equal((await f.request(`/users/${owner.id}/profile`)).status, 401);
  const result = await f.request(`/users/${owner.id}/profile`, { cookie: viewer.cookie });
  assert.equal(result.status, 200);
  assert.deepEqual(Object.keys(result.body.profile).sort(), ['ageBand', 'avatarUrl', 'displayName', 'hasVibeRatings', 'id', 'languages', 'verified', 'vibe']);
  assert.equal(result.body.profile.hasVibeRatings, true);
  assert.deepEqual(result.body.profile.vibe, { singalong: 4, photography: 0, dancing: 0, quiet: 2, queue_early: 0, merch: 0 });
  for (const secret of ['email', 'password_hash', 'companionGenderPref', 'answers', 'wants', 'avoid', 'homeRegion', 'reliability'])
    assert.equal(Object.hasOwn(result.body.profile, secret), false, secret);
  assert.equal((await f.request(`/users/${owner.id}/profile`, { cookie: owner.cookie })).status, 200);
  const initialViewer = await f.request(`/users/${viewer.id}/profile`, { cookie: owner.cookie });
  assert.equal(initialViewer.body.profile.hasVibeRatings, false);
  // Zero is a valid explicit rating, rather than proof the user never answered.
  f.db.prepare('UPDATE users SET vibe_json=? WHERE id=?').run('{"singalong":0}', viewer.id);
  const zeroViewer = await f.request(`/users/${viewer.id}/profile`, { cookie: owner.cookie });
  assert.equal(zeroViewer.body.profile.hasVibeRatings, true);
});

test('concert profile uses the same neutral response for both block directions, suspension and missing people', async t => {
  const f = await fixture(t);
  const owner = await f.person('hidden-owner'), viewer = await f.person('hidden-viewer');
  const get = id => f.request(`/users/${id}/profile`, { cookie: viewer.cookie });
  const missing = await get('missing');
  assert.equal(missing.status, 404);
  for (const [blocker, blocked] of [[owner.id, viewer.id], [viewer.id, owner.id]]) {
    f.db.prepare('INSERT INTO blocks(blocker_user_id,blocked_user_id) VALUES (?,?)').run(blocker, blocked);
    assert.deepEqual(await get(owner.id), missing);
    f.db.prepare('DELETE FROM blocks').run();
  }
  f.db.prepare('UPDATE account_security SET suspended_at=? WHERE user_id=?').run(Date.now(), owner.id);
  assert.deepEqual(await get(owner.id), missing);
});
