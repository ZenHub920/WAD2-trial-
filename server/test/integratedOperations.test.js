import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app.js';
import { createTestDb } from '../src/db/connection.js';

test('application wiring authenticates integrations, returns safe configuration errors, and starts no workers', async () => {
  const db = createTestDb();
  let externalCalls = 0;
  const runtime = createApp({ db, env: {}, fetchImpl: async () => { externalCalls++; throw new Error('must_not_fetch'); } });
  const server = runtime.app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  try {
    assert.equal((await fetch(`${base}/me/push/config`)).status, 401);
    const register = await fetch(`${base}/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ display_name: 'Alice', email: 'integrated@example.test', password: 'test-password' }) });
    assert.equal(register.status, 201);
    const cookie = register.headers.get('set-cookie').split(';')[0];
    const config = await fetch(`${base}/me/push/config`, { headers: { cookie } });
    assert.deepEqual(await config.json(), { configured: false, publicKey: null });
    const subscribe = await fetch(`${base}/me/push/subscriptions`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: '{}' });
    assert.equal(subscribe.status, 503);
    const place = await fetch(`${base}/meetups/unknown/locations?q=station`, { headers: { cookie } });
    assert.equal(place.status, 404);
    assert.equal((await fetch(`${base}/auth/security`, { headers: { cookie } })).status, 200);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM background_jobs').get().n, 0);
    assert.equal(externalCalls, 0);
  } finally {
    await runtime.delivery.stop();
    await runtime.security.close();
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }
});
