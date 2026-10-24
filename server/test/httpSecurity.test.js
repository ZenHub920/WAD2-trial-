import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createTestDb } from '../src/db/connection.js';
import { createApp } from '../src/app.js';

const APP_ORIGIN = 'https://encore.example';
const FOREIGN_ORIGIN = 'https://untrusted.example';
const registration = (name) => ({ display_name: name, email: `${name}@example.test`, password: 'mock-password-for-test' });
function removeFixture(directory) {
  const absolute = resolve(directory);
  assert.equal(dirname(absolute), resolve(tmpdir()));
  assert.ok(basename(absolute).startsWith('encore-http-security-'));
  rmSync(absolute, { recursive: true, force: true });
}

async function setup(t, { env = {}, ratePolicies } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'encore-http-security-'));
  const imageDir = join(directory, 'images'), avatarDir = join(directory, 'avatars');
  mkdirSync(imageDir); mkdirSync(avatarDir);
  // Static image handling needs an actual file; it never touches application data.
  writeFileSync(join(avatarDir, 'sample.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aHLsAAAAASUVORK5CYII=', 'base64'));
  const db = createTestDb(), logs = [];
  const services = createApp({
    db, env: { NODE_ENV: 'test', APP_ORIGIN, ...env }, ratePolicies, imageDir, avatarDir,
    mailer: { configured: false, async send() { throw new Error('unexpected_test_email'); } },
    async fetchImpl() { throw new Error('unexpected_external_request'); },
    logger: { error: (...args) => logs.push(args), warn: (...args) => logs.push(args) },
  });
  const server = services.app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await services.delivery.stop();
    await services.security.close();
    db.close();
    removeFixture(directory);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const user = services.repos.users.create({ display_name: 'Owner', age_band: '21-24', home_region: 'central',
    gender: 'unspecified', vibe: {}, email: 'owner@example.test' });
  function session(owner = user) {
    const token = randomBytes(32).toString('hex');
    services.repos.sessions.create(createHash('sha256').update(token).digest('hex'), owner.id, Date.now() + 3600000);
    return `encore_session=${token}`;
  }
  return {
    ...services, db, logs, user, session, cookie: session(),
    async request(path, { method = 'GET', cookie, json, body, headers = {} } = {}) {
      const response = await fetch(base + '/api' + path, {
        method,
        headers: { ...(cookie ? { cookie } : {}), ...(json !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
        ...(json !== undefined ? { body: JSON.stringify(json) } : body !== undefined ? { body } : {}),
      });
      const text = await response.text();
      return { status: response.status, headers: response.headers, text,
        body: text && response.headers.get('content-type')?.includes('json') ? JSON.parse(text) : undefined };
    },
  };
}

test('foreign, opaque and lookalike Origins cannot mutate cookie-backed sessions', async (t) => {
  const api = await setup(t);
  for (const origin of [FOREIGN_ORIGIN, 'null', 'https://encore.example.untrusted.example']) {
    const response = await api.request('/auth/logout', { method: 'POST', cookie: api.cookie, json: {}, headers: { origin } });
    assert.equal(response.status, 403);
    assert.equal(response.body.error, 'origin_not_allowed');
    assert.equal(response.headers.get('access-control-allow-origin'), null);
    assert.equal((await api.request('/auth/me', { cookie: api.cookie })).status, 200);
  }
});

test('forged Host and forwarded Host never add a trusted request origin', async (t) => {
  const api = await setup(t);
  const response = await api.request('/auth/logout', { method: 'POST', cookie: api.cookie, json: {}, headers: {
    origin: FOREIGN_ORIGIN, host: 'untrusted.example', 'x-forwarded-host': 'encore.example',
  } });
  assert.equal(response.status, 403);
  const originless = await api.request('/auth/logout', { method: 'POST', cookie: api.cookie,
    headers: { host: 'encore.example', 'x-forwarded-host': 'encore.example' } });
  assert.equal(originless.status, 403);
  assert.equal((await api.request('/auth/me', { cookie: api.cookie })).status, 200);
});

test('originless cookie forms and text requests cannot reach bodyless state changes', async (t) => {
  const api = await setup(t);
  for (const contentType of [undefined, 'application/x-www-form-urlencoded', 'text/plain', 'multipart/form-data; boundary=test']) {
    const response = await api.request('/auth/logout', { method: 'POST', cookie: api.cookie,
      headers: contentType ? { 'content-type': contentType } : {} });
    assert.equal(response.status, 403, contentType ?? 'missing content type');
  }
  assert.equal((await api.request('/auth/me', { cookie: api.cookie })).status, 200);
});

test('untrusted Referer is rejected even for JSON and same-site metadata', async (t) => {
  const api = await setup(t);
  const response = await api.request('/auth/logout', { method: 'POST', cookie: api.cookie, json: {},
    headers: { referer: FOREIGN_ORIGIN + '/page', 'sec-fetch-site': 'same-site' } });
  assert.equal(response.status, 403);
  assert.equal((await api.request('/auth/me', { cookie: api.cookie })).status, 200);
});

test('cross-site Fetch Metadata rejects mutations and private thread reads', async (t) => {
  const api = await setup(t);
  const headers = { 'sec-fetch-site': 'cross-site' };
  assert.equal((await api.request('/auth/logout', { method: 'POST', cookie: api.cookie, json: {}, headers })).status, 403);
  assert.equal((await api.request('/kaki/conversations/not-a-thread', { cookie: api.cookie, headers })).status, 403);
  assert.equal((await api.request('/me/profile', { cookie: api.cookie, headers })).status, 403);
  assert.equal((await api.request('/health', { headers })).status, 200, 'anonymous public GET remains available');
  assert.equal((await api.request('/auth/me', { cookie: api.cookie })).status, 200);
});

test('trusted origin, trusted Referer, JSON and custom-header bodyless logout remain compatible', async (t) => {
  const api = await setup(t);
  const variants = [
    { origin: APP_ORIGIN },
    { referer: APP_ORIGIN + '/profile' },
    { 'content-type': 'application/json' },
    { 'x-requested-with': 'Encore' },
    { 'sec-fetch-site': 'same-origin' },
  ];
  for (const headers of variants) {
    const cookie = api.session();
    const response = await api.request('/auth/logout', { method: 'POST', cookie, headers });
    assert.equal(response.status, 204, JSON.stringify(headers));
    assert.equal((await api.request('/auth/me', { cookie })).status, 401);
  }
});

test('originless non-simple DELETE preserves authenticated global sign-out', async (t) => {
  const api = await setup(t);
  const response = await api.request('/auth/sessions', { method: 'DELETE', cookie: api.cookie });
  assert.equal(response.status, 200);
  assert.equal((await api.request('/auth/me', { cookie: api.cookie })).status, 401);
});

test('CORS preflight allows only exact configured origins and explicit credentialed headers', async (t) => {
  const extra = 'https://another-trusted.example';
  const api = await setup(t, { env: { CORS_ALLOWED_ORIGINS: extra } });
  for (const origin of [APP_ORIGIN, extra, 'http://localhost:5173']) {
    const response = await api.request('/auth/logout', { method: 'OPTIONS', headers: {
      origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type,x-requested-with',
    } });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('access-control-allow-origin'), origin);
    assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
    assert.match(response.headers.get('vary'), /Origin/);
    assert.doesNotMatch(response.headers.get('access-control-allow-origin'), /\*/);
    assert.match(response.headers.get('access-control-allow-headers'), /X-Requested-With/i);
  }
  const rejected = await api.request('/auth/logout', { method: 'OPTIONS', headers: {
    origin: FOREIGN_ORIGIN, 'access-control-request-method': 'POST',
  } });
  assert.equal(rejected.status, 403);
  assert.equal(rejected.headers.get('access-control-allow-origin'), null);
});

test('API security headers preserve public image embedding and private-response caching rules', async (t) => {
  const api = await setup(t);
  const response = await api.request('/health');
  assert.equal(response.headers.get('x-powered-by'), null);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.match(response.headers.get('content-security-policy'), /default-src 'none'/);
  assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(response.headers.get('cross-origin-resource-policy'), 'same-site');
  assert.match(response.headers.get('cache-control'), /no-store/);
  assert.match(response.headers.get('x-request-id'), /^[0-9a-f-]{36}$/);
  const image = await api.request('/avatars/sample.png');
  assert.equal(image.status, 200);
  assert.match(image.headers.get('content-type'), /image\/png/);
  assert.equal(image.headers.get('cross-origin-resource-policy'), 'cross-origin');
  assert.doesNotMatch(image.headers.get('cache-control'), /no-store/);
});

test('production origins fail closed instead of trusting a Host header or an insecure URL', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'encore-http-security-'));
  t.after(() => removeFixture(directory));
  for (const env of [{ NODE_ENV: 'production' }, { NODE_ENV: 'production', APP_ORIGIN: 'http://encore.example' },
    { NODE_ENV: 'production', APP_ORIGIN: APP_ORIGIN + '/unexpected/path' }]) {
    const db = createTestDb();
    try {
      assert.throws(() => createApp({ db, env, mailer: { configured: false },
        imageDir: join(directory, 'images'), avatarDir: join(directory, 'avatars') }),
        /production_app_origin_required|invalid_trusted_origin/);
    } finally { db.close(); }
  }
});

test('HSTS trusts only configured proxy topology and production HTTPS', async (t) => {
  const trusted = await setup(t, { env: { NODE_ENV: 'production', TRUST_PROXY: 'loopback' } });
  const secure = await trusted.request('/health', { headers: { 'x-forwarded-proto': 'https' } });
  assert.equal(secure.headers.get('strict-transport-security'), 'max-age=31536000');
  assert.equal((await trusted.request('/health')).headers.get('strict-transport-security'), null);
  const direct = await setup(t, { env: { NODE_ENV: 'production' } });
  const forged = await direct.request('/health', { headers: { 'x-forwarded-proto': 'https' } });
  assert.equal(forged.headers.get('strict-transport-security'), null);
  assert.equal((await direct.request('/health', { headers: { origin: 'http://localhost:5173' } })).status, 403);
});

test('production session cookies are Secure/HttpOnly/Lax and login replaces the old session', async (t) => {
  const api = await setup(t, { env: { NODE_ENV: 'production', TRUST_PROXY: 'loopback' } });
  const credentials = registration('cookie-security');
  const registered = await api.request('/auth/register', { method: 'POST', json: credentials,
    headers: { origin: APP_ORIGIN, 'x-forwarded-proto': 'https' } });
  assert.equal(registered.status, 201);
  const fullCookie = registered.headers.get('set-cookie');
  assert.match(fullCookie, /; HttpOnly/i);
  assert.match(fullCookie, /; Secure/i);
  assert.match(fullCookie, /; SameSite=Lax/i);
  assert.match(fullCookie, /; Path=\/api/i);
  const oldCookie = fullCookie.split(';')[0];
  const login = await api.request('/auth/login', { method: 'POST', cookie: oldCookie, json: credentials });
  assert.equal(login.status, 200);
  const nextCookie = login.headers.get('set-cookie').split(';')[0];
  assert.notEqual(nextCookie, oldCookie);
  assert.equal((await api.request('/auth/me', { cookie: oldCookie })).status, 401);
  assert.equal((await api.request('/auth/me', { cookie: nextCookie })).status, 200);
});

test('unexpected errors and credential-bearing 4xx messages cannot leak through responses or logs', async (t) => {
  const mockSecret = 'mock_credential_for_error_test';
  const api = await setup(t, { env: { LTA_ACCOUNT_KEY: mockSecret } });
  const failures = [
    { status: 400, message: `provider response https://provider.example/?key=${mockSecret}` },
    { status: 400, message: mockSecret },
    { status: 500, message: `private provider body ${mockSecret}` },
  ];
  for (const failure of failures) {
    api.repos.concerts.findById = () => { throw Object.assign(new Error(failure.message), { status: failure.status, code: 'ECONNRESET' }); };
    const response = await api.request(`/concerts/test?access_token=${mockSecret}`);
    assert.equal(response.status, failure.status);
    assert.equal(response.body.error, failure.status === 400 ? 'request_rejected' : 'internal_error');
    assert.equal(response.text.includes(mockSecret), false);
  }
  assert.equal(api.logs.length, 1);
  const logged = JSON.stringify(api.logs);
  assert.equal(logged.includes(mockSecret), false);
  assert.equal(logged.includes('provider.example'), false);
  assert.equal(logged.includes('access_token'), false);
  assert.equal(api.logs[0][0].event, 'api_request_failed');
  assert.equal(api.logs[0][0].code, 'ECONNRESET');
  api.repos.concerts.findById = () => { throw Object.assign(new Error('invalid_coordinates'), { status: 400 }); };
  assert.equal((await api.request('/concerts/test')).body.error, 'invalid_coordinates', 'stable domain codes remain useful');
});

test('malformed and compressed JSON fail safely without reflecting the request body', async (t) => {
  const api = await setup(t);
  const marker = 'mock-private-request-marker';
  const malformed = await api.request('/auth/login', { method: 'POST', body: `{"password":"${marker}"`,
    headers: { 'content-type': 'application/json' } });
  assert.equal(malformed.status, 400);
  assert.deepEqual(malformed.body, { error: 'invalid_json' });
  const compressed = await api.request('/auth/login', { method: 'POST', body: gzipSync(JSON.stringify({ password: marker })),
    headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' } });
  assert.equal(compressed.status, 415);
  assert.equal(compressed.body.error, 'compressed_requests_not_supported');
  assert.equal(JSON.stringify([malformed.body, compressed.body, api.logs]).includes(marker), false);
});

test('push read budgets apply per user across IPs and per IP across accounts', async (t) => {
  const options = { env: { TRUST_PROXY: 'loopback' }, ratePolicies: { pushRead: { limit: 2, windowMs: 60000 } } };
  const api = await setup(t, options);
  const get = (cookie, ip) => api.request('/me/push/config', { cookie, headers: { 'x-forwarded-for': ip } });
  assert.equal((await get(api.cookie, '192.0.2.1')).status, 200);
  assert.equal((await get(api.cookie, '192.0.2.2')).status, 200);
  const userBlocked = await get(api.cookie, '192.0.2.3');
  assert.equal(userBlocked.status, 429);
  assert.equal(userBlocked.body.error, 'rate_limit_exceeded');
  assert.ok(Number(userBlocked.headers.get('retry-after')) >= 1);
  const users = [1, 2, 3].map((id) => api.repos.users.create({ display_name: `Budget ${id}`, age_band: '21-24',
    home_region: 'central', gender: 'unspecified', vibe: {} }));
  const cookies = users.map((user) => api.session(user));
  assert.equal((await get(cookies[0], '192.0.2.9')).status, 200);
  assert.equal((await get(cookies[1], '192.0.2.9')).status, 200);
  assert.equal((await get(cookies[2], '192.0.2.9')).status, 429);
  const stored = JSON.stringify(api.db.prepare('SELECT bucket FROM api_rate_limits').all());
  assert.equal(stored.includes('192.0.2.'), false, 'raw IP addresses are not retained in budgets');
  assert.equal(stored.includes(api.user.id), false, 'raw user identifiers are not retained in budgets');
});

test('controller-local error wrappers cannot bypass API-wide secret redaction', async (t) => {
  const secret = 'mock_secret_in_controller_wrapper';
  const api = await setup(t, { env: { ONEMAP_PASSWORD: secret } });
  api.repos.meetups.list = () => { throw Object.assign(new Error(`provider_${secret}`), { status: 400 }); };
  const response = await api.request('/me/meetups', { cookie: api.cookie });
  assert.equal(response.status, 400);
  assert.equal(response.body.error, 'request_rejected');
  assert.equal(response.text.includes(secret), false);
});
