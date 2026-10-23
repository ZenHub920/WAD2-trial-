import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import express from 'express';
import { createTestDb } from '../src/db/connection.js';
import { createRepositories } from '../src/db/repositories.js';
import { migrateAccountSecurity } from '../src/db/accountSecurityRepository.js';
import { createAccountSecurity, trustedAppOrigin } from '../src/services/accountSecurity.js';
import { createSessionService } from '../src/services/sessions.js';
import { createUserController } from '../src/controllers/userController.js';
import { registerAccountSecurityRoutes } from '../src/routes/accountSecurity.js';
import { hashPassword, verifyPassword } from '../src/services/passwords.js';
import { createSmtpMailer } from '../src/services/accountMailer.js';
import { createApiRateLimiter, ratePolicy } from '../src/services/apiRateLimiter.js';

const registration = (name) => ({ display_name: name, email: `${name}@example.test`, password: 'test-password' });
const cookieOf = (result) => result.cookie?.split(';')[0];
const tokenFrom = (mail) => new URLSearchParams(new URL(mail.text.match(/https?:\/\/\S+/)[0]).hash.slice(1)).get('token');

async function setup({ mailer, origin = 'https://encore.example', policies } = {}) {
  const db = createTestDb();
  migrateAccountSecurity(db);
  let clock = Date.now();
  const now = () => clock;
  const sent = [];
  const delivery = mailer ?? { configured: true, async send(message) { sent.push(message); return true; } };
  const security = createAccountSecurity({ db, mailer: delivery, appOrigin: origin, now });
  const repos = createRepositories(db);
  const sessions = createSessionService(repos, { isAllowed: security.isAllowed });
  const controller = createUserController(repos, sessions);
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.user = sessions.current(req); next(); });
  if (policies) app.use(createApiRateLimiter({ db, policies, now }));
  app.post('/auth/register', controller.register);
  app.post('/auth/login', controller.login);
  app.get('/auth/me', (req, res) => req.user ? controller.current(req, res)
    : res.status(401).json({ error: 'authentication_required' }));
  registerAccountSecurityRoutes(app, { security, sessions });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    db, repos, security, sessions, sent, advance(ms) { clock += ms; },
    async request(path, { cookie, method = 'GET', body, headers = {} } = {}) {
      const response = await fetch(base + path, {
        method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...headers },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie'),
        retryAfter: response.headers.get('retry-after') };
    },
    async register(name) { return this.request('/auth/register', { method: 'POST', body: registration(name) }); },
    async close() { await security.close(); await new Promise((resolve) => server.close(resolve)); db.close(); },
  };
}

test('account migration repeats and existing users retain access without email verification', async () => {
  const api = await setup();
  try {
    const alice = await api.register('legacy');
    const cookie = cookieOf(alice);
    migrateAccountSecurity(api.db);
    migrateAccountSecurity(api.db);
    const state = await api.request('/auth/security', { cookie });
    assert.equal(state.status, 200);
    assert.equal(state.body.emailVerified, false);
    assert.equal(state.body.emailConfigured, true);
    assert.equal(state.body.sessionCount, 1);
    assert.equal(state.body.email, 'legacy@example.test');
    assert.equal(state.body.password_hash, undefined);
    assert.equal(api.db.prepare('SELECT verified FROM users WHERE id=?').get(alice.body.user.id).verified, 0);
    assert.equal((await api.request('/auth/me', { cookie })).status, 200);
  } finally { await api.close(); }
});

test('reset request is enumeration-safe and sends only configured-origin fragment token links', async () => {
  const api = await setup();
  try {
    await api.register('alice');
    const unknown = await api.request('/auth/password-reset/request', { method: 'POST', body: { email: 'missing@example.test' } });
    const known = await api.request('/auth/password-reset/request', {
      method: 'POST', body: { email: 'ALICE@example.test', userId: 'attacker' }, headers: { host: 'attacker.example' },
    });
    await api.security.flushMail();
    assert.equal(known.status, 202);
    assert.deepEqual(known.body, unknown.body);
    assert.equal(api.sent.length, 1);
    assert.match(api.sent[0].text, /https:\/\/encore\.example\/account\/security\?mode=reset#token=/);
    assert.doesNotMatch(api.sent[0].text, /attacker/);
    const rawToken = tokenFrom(api.sent[0]);
    const stored = api.db.prepare('SELECT * FROM account_action_tokens').get();
    assert.equal(stored.token_hash, createHash('sha256').update(rawToken).digest('hex'));
    assert.notEqual(stored.token_hash, rawToken);
    assert.equal(JSON.stringify(stored).includes(rawToken), false);
    await api.request('/auth/password-reset/request', { method: 'POST', body: { email: 'alice@example.test' } });
    await api.security.flushMail();
    assert.equal(api.sent.length, 1, 'per-account cooldown prevents email flooding');
  } finally { await api.close(); }
});

test('reset is single-use, revokes every device and never signs in the token bearer', async () => {
  const api = await setup();
  try {
    const alice = await api.register('reset');
    const cookie1 = cookieOf(alice);
    const login = await api.request('/auth/login', { method: 'POST', body: registration('reset') });
    const cookie2 = cookieOf(login);
    await api.request('/auth/password-reset/request', { method: 'POST', body: { email: 'reset@example.test' } });
    await api.security.flushMail();
    const token = tokenFrom(api.sent[0]);
    const confirmed = await api.request('/auth/password-reset/confirm', {
      method: 'POST', body: { token, password: 'changed-password', userId: 'someone-else' },
    });
    assert.equal(confirmed.status, 200);
    assert.equal(confirmed.body.signInRequired, true);
    assert.equal(api.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 0);
    assert.equal((await api.request('/auth/me', { cookie: cookie1 })).status, 401);
    assert.equal((await api.request('/auth/me', { cookie: cookie2 })).status, 401);
    assert.equal((await api.request('/auth/password-reset/confirm', { method: 'POST', body: { token, password: 'hijack-password' } })).status, 400);
    assert.equal((await api.request('/auth/login', { method: 'POST', body: registration('reset') })).status, 401);
    assert.equal((await api.request('/auth/login', { method: 'POST', body: { email: 'reset@example.test', password: 'changed-password' } })).status, 200);
  } finally { await api.close(); }
});

test('expired, wrong-purpose, superseded and malformed reset tokens cannot change passwords', async () => {
  const api = await setup();
  try {
    const user = await api.register('tokens');
    api.security.requestReset('tokens@example.test');
    await api.security.flushMail();
    const first = tokenFrom(api.sent[0]);
    api.advance(61_000);
    api.security.requestReset('tokens@example.test');
    await api.security.flushMail();
    const second = tokenFrom(api.sent[1]);
    assert.throws(() => api.security.confirmReset(first, 'test-password2'), /invalid_or_expired_token/);
    assert.throws(() => api.security.confirmVerification(second), /invalid_or_expired_token/);
    api.advance(31 * 60_000);
    assert.throws(() => api.security.confirmReset(second, 'test-password2'), /invalid_or_expired_token/);
    assert.throws(() => api.security.confirmReset({}, 'test-password2'), /invalid_or_expired_token/);
    assert.throws(() => api.security.confirmReset('a'.repeat(64), 'x'.repeat(1025)), /password_must/);
    assert.ok(verifyPassword('test-password', api.security.repo.account(user.body.user.id).password_hash));
  } finally { await api.close(); }
});

test('verification requires own authenticated request and updates only the email verification flag', async () => {
  const api = await setup();
  try {
    const user = await api.register('verify');
    assert.equal((await api.request('/auth/email-verification/request', { method: 'POST', body: {} })).status, 401);
    const requested = await api.request('/auth/email-verification/request', { method: 'POST', cookie: cookieOf(user), body: { userId: 'forged' } });
    assert.equal(requested.status, 202);
    await api.security.flushMail();
    const token = tokenFrom(api.sent[0]);
    assert.equal((await api.request('/auth/email-verification/confirm', { method: 'POST', body: { token } })).status, 200);
    const state = await api.request('/auth/security', { cookie: cookieOf(user) });
    assert.equal(state.body.emailVerified, true);
    assert.equal(api.db.prepare('SELECT verified FROM users WHERE id=?').get(user.body.user.id).verified, 0);
    assert.equal((await api.request('/auth/email-verification/confirm', { method: 'POST', body: { token } })).status, 400);
  } finally { await api.close(); }
});

test('changing password requires current password, revokes sessions and invalidates old reset links', async () => {
  const api = await setup();
  try {
    const user = await api.register('change');
    const cookie = cookieOf(user);
    api.security.requestReset('change@example.test');
    await api.security.flushMail();
    const token = tokenFrom(api.sent[0]);
    assert.equal((await api.request('/auth/password/change', { method: 'POST', cookie,
      body: { currentPassword: 'wrong', password: 'new-password' } })).status, 401);
    assert.equal((await api.request('/auth/me', { cookie })).status, 200);
    assert.equal((await api.request('/auth/password/change', { method: 'POST', cookie,
      body: { currentPassword: 'test-password', password: 'new-password' } })).status, 200);
    assert.equal((await api.request('/auth/me', { cookie })).status, 401);
    assert.throws(() => api.security.confirmReset(token, 'token-password'), /invalid_or_expired_token/);
    assert.ok(verifyPassword('new-password', api.security.repo.account(user.body.user.id).password_hash));
  } finally { await api.close(); }
});

test('global sign-out revokes only the caller and ignores body identifiers', async () => {
  const api = await setup();
  try {
    const alice = await api.register('logout');
    const bob = await api.register('stay');
    const result = await api.request('/auth/sessions', { method: 'DELETE', cookie: cookieOf(alice), body: { userId: bob.body.user.id } });
    assert.equal(result.status, 200);
    assert.equal((await api.request('/auth/me', { cookie: cookieOf(alice) })).status, 401);
    assert.equal((await api.request('/auth/me', { cookie: cookieOf(bob) })).status, 200);
  } finally { await api.close(); }
});

test('unconfigured, unsafe-origin and failed SMTP requests expose no account existence or token', async () => {
  for (const options of [{ origin: 'https://attacker.example/path' }, { mailer: { configured: false } },
    { mailer: { configured: true, async send() { throw new Error('smtp private connection detail'); } } }]) {
    const api = await setup(options);
    try {
      await api.register('mail');
      const known = await api.request('/auth/password-reset/request', { method: 'POST', body: { email: 'mail@example.test' } });
      const unknown = await api.request('/auth/password-reset/request', { method: 'POST', body: { email: 'missing@example.test' } });
      await api.security.flushMail();
      assert.equal(known.status, 202);
      assert.deepEqual(known.body, unknown.body);
      assert.equal(api.db.prepare('SELECT COUNT(*) AS n FROM account_action_tokens WHERE consumed_at IS NULL').get().n, 0);
      assert.doesNotMatch(JSON.stringify(known), /private connection detail|token=/);
    } finally { await api.close(); }
  }
});

test('trusted origin rejects injected credentials, paths, unsafe protocols and remote HTTP', () => {
  for (const value of ['http://encore.example', 'javascript:alert(1)', 'https://name:pass@example.com',
    'https://example.com/x', 'https://example.com/?x=1', 'https://example.com/#hash', 'garbage'])
    assert.equal(trustedAppOrigin(value), null);
  assert.equal(trustedAppOrigin('https://encore.example/'), 'https://encore.example');
  assert.equal(trustedAppOrigin('http://localhost:5173'), 'http://localhost:5173');
});

test('SMTP transport requires TLS, bounded timeouts and server-only credentials', async () => {
  let options, sent;
  const mailer = createSmtpMailer({ SMTP_HOST: 'smtp.example.test', SMTP_FROM: 'Encore <noreply@example.test>',
    SMTP_USER: 'test-user', SMTP_PASS: 'test-private-password' }, { createTransport(value) {
    options = value;
    return { async sendMail(message) { sent = message; } };
  } });
  assert.equal(await mailer.send({ to: 'user@example.test', subject: 'Subject', text: 'Private message' }), true);
  assert.equal(options.requireTLS, true);
  assert.equal(options.tls.rejectUnauthorized, true);
  assert.equal(options.connectionTimeout, 10_000);
  assert.equal(options.disableFileAccess, true);
  assert.equal(sent.from, 'Encore <noreply@example.test>');
  assert.equal(await mailer.send({ to: 'x@example.test\r\nBcc: victim@example.test', subject: 'x', text: 'x' }), false);
  assert.equal(await createSmtpMailer({}).send({}), false);
});

test('password helpers reject oversized input and malformed stored hashes without exceptions', () => {
  assert.equal(verifyPassword('password', 'invalid'), false);
  assert.equal(verifyPassword('x'.repeat(1025), 'invalid'), false);
  assert.throws(() => hashPassword('short'), /password_must/);
  assert.equal(verifyPassword('correct-password', hashPassword('correct-password')), true);
});

test('persisted rate limits survive middleware replacement, reset on expiry and separate policies', async () => {
  const api = await setup({ policies: { login: { limit: 2, windowMs: 60_000 }, registration: { limit: 0 } } });
  try {
    const attempt = () => api.request('/auth/login', { method: 'POST', body: { email: 'unknown@example.test', password: 'wrong-password' } });
    assert.equal((await attempt()).status, 401);
    assert.equal((await attempt()).status, 401);
    const limited = await attempt();
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.retryAfter) > 0);
    const replacement = createApiRateLimiter({ db: api.db, now: () => Date.now(), policies: { login: { limit: 2, windowMs: 60_000 } } });
    let responseCode;
    const response = { set() {}, status(code) { responseCode = code; return this; }, json() {} };
    replacement({ method: 'POST', path: '/api/auth/login', ip: '127.0.0.1' }, response, () => { throw new Error('should be limited'); });
    assert.equal(responseCode, 429);
    assert.equal((await api.register('unlimited-registration')).status, 201);
    api.advance(61_000);
    assert.equal((await attempt()).status, 401);
    assert.equal(api.db.prepare('SELECT bucket FROM api_rate_limits').get().bucket.includes('127.0.0.1'), false);
  } finally { await api.close(); }
});

test('rate policies cover each message channel, report, recovery and planning API without limiting reads', () => {
  for (const path of ['/kaki/conversations/id/messages', '/group-channels/id/messages', '/conversations/id/messages'])
    assert.equal(ratePolicy('POST', path), 'chat');
  assert.equal(ratePolicy('POST', '/users/id/reports'), 'reports');
  assert.equal(ratePolicy('POST', '/auth/password-reset/confirm'), 'recovery');
  assert.equal(ratePolicy('GET', '/meetups/id/weather'), 'provider');
  assert.equal(ratePolicy('GET', '/meetups/id/places/search'), 'provider');
  assert.equal(ratePolicy('GET', '/kaki/conversations/id/messages'), null);
});

async function moderationFixture(api) {
  const operator = await api.register('operator');
  const reporter = await api.register('reporter');
  const reported = await api.register('reported');
  api.db.prepare('UPDATE users SET is_operator=1 WHERE id=?').run(operator.body.user.id);
  api.db.prepare(`INSERT INTO concerts(id,artist,venue,city,event_date)
    VALUES('moderation-concert','Act','Venue','Singapore','2030-01-01')`).run();
  const pair = [reporter.body.user.id, reported.body.user.id].sort();
  api.db.prepare(`INSERT INTO conversations(id,concert_id,user_a_id,user_b_id)
    VALUES('reported-conversation','moderation-concert',?,?)`).run(...pair);
  api.db.prepare(`INSERT INTO messages(id,conversation_id,sender_user_id,body,deleted_at)
    VALUES('reported-message','reported-conversation',?,'Retained evidence',datetime('now'))`).run(reported.body.user.id);
  api.db.prepare(`INSERT INTO reports(id,reporter_user_id,reported_user_id,reason_category,details,conversation_id,message_id)
    VALUES('reported-case',?,?,'harassment','A reported message','reported-conversation','reported-message')`)
    .run(reporter.body.user.id, reported.body.user.id);
  return { operator, reporter, reported };
}

test('report queue and retained deleted-message evidence are operator-only and bounded', async () => {
  const api = await setup();
  try {
    const { operator, reporter } = await moderationFixture(api);
    assert.equal((await api.request('/operator/reports')).status, 401);
    assert.equal((await api.request('/operator/reports/reported-case', { cookie: cookieOf(reporter) })).status, 403);
    const queue = await api.request('/operator/reports?limit=1', { cookie: cookieOf(operator) });
    assert.equal(queue.status, 200);
    assert.equal(queue.body.reports.length, 1);
    assert.equal(queue.body.reports[0].id, 'reported-case');
    const detail = await api.request('/operator/reports/reported-case', { cookie: cookieOf(operator) });
    assert.equal(detail.status, 200);
    assert.equal(detail.body.evidence.body, 'Retained evidence');
    assert.ok(detail.body.evidence.deletedAt);
    assert.equal(detail.body.audit.length, 0);
    assert.equal((await api.request('/operator/reports?limit=101', { cookie: cookieOf(operator) })).status, 400);
    assert.equal((await api.request('/operator/reports?status=imaginary', { cookie: cookieOf(operator) })).status, 400);
    assert.equal((await api.request('/operator/reports/missing', { cookie: cookieOf(operator) })).status, 404);
  } finally { await api.close(); }
});

test('operator warning resolves report atomically, creates an account notice and preserves audit', async () => {
  const api = await setup();
  try {
    const { operator, reporter, reported } = await moderationFixture(api);
    const resolve = (cookie, action, note) => api.request('/operator/reports/reported-case/resolve', {
      method: 'POST', cookie, body: { action, note, userId: reporter.body.user.id },
    });
    assert.equal((await resolve(cookieOf(reporter), 'warn', 'Forged action')).status, 403);
    assert.equal((await resolve(cookieOf(operator), 'warn', '')).status, 400);
    assert.equal((await resolve(cookieOf(operator), 'arbitrary', 'Bad action')).status, 400);
    assert.equal((await resolve(cookieOf(operator), 'review', 'Evidence reviewed')).status, 200);
    assert.equal(api.db.prepare('SELECT status FROM reports WHERE id=?').get('reported-case').status, 'reviewed');
    assert.equal((await resolve(cookieOf(operator), 'warn', 'Please follow the community rules')).status, 200);
    assert.equal(api.db.prepare('SELECT status FROM reports WHERE id=?').get('reported-case').status, 'closed');
    assert.equal((await resolve(cookieOf(operator), 'suspend', 'Duplicate resolution')).status, 409);
    const details = await api.request('/operator/reports/reported-case', { cookie: cookieOf(operator) });
    assert.deepEqual(details.body.audit.map((entry) => entry.action), ['review', 'warn']);
    const notice = api.db.prepare('SELECT * FROM notifications WHERE user_id=?').get(reported.body.user.id);
    assert.equal(notice.resource_path, '/account/security');
    const security = await api.request('/auth/security', { cookie: cookieOf(reported) });
    assert.equal(security.body.warnings[0].note, 'Please follow the community rules');
    assert.equal(security.body.warnings[0].operatorId, undefined);
    assert.equal((await api.request('/auth/me', { cookie: cookieOf(reported) })).status, 200);
  } finally { await api.close(); }
});

test('suspension revokes every session, blocks new sessions and password recovery, and can be audited and lifted', async () => {
  const api = await setup();
  try {
    const { operator, reported } = await moderationFixture(api);
    const otherLogin = await api.request('/auth/login', { method: 'POST', body: registration('reported') });
    api.security.requestReset('reported@example.test');
    await api.security.flushMail();
    const reset = tokenFrom(api.sent[0]);
    const result = await api.request('/operator/reports/reported-case/resolve', { method: 'POST', cookie: cookieOf(operator),
      body: { action: 'suspend', note: 'Repeated documented harassment' } });
    assert.equal(result.status, 200);
    assert.equal(api.security.isAllowed(reported.body.user.id), false);
    for (const cookie of [cookieOf(reported), cookieOf(otherLogin)])
      assert.equal((await api.request('/auth/me', { cookie })).status, 401);
    assert.equal((await api.request('/auth/login', { method: 'POST', body: registration('reported') })).status, 401);
    assert.throws(() => api.security.confirmReset(reset, 'new-password'), /invalid_or_expired_token/);
    api.advance(61_000);
    api.security.requestReset('reported@example.test');
    await api.security.flushMail();
    assert.equal(api.sent.length, 1, 'suspension cannot be bypassed by recovery');
    assert.throws(() => api.sessions.start({ get() {} }, {}, reported.body.user.id), /account_unavailable/);
    const resumed = await api.request(`/operator/users/${reported.body.user.id}/unsuspend`, {
      method: 'POST', cookie: cookieOf(operator), body: { note: 'Reviewed successful appeal' },
    });
    assert.equal(resumed.status, 200);
    assert.equal(api.security.isAllowed(reported.body.user.id), true);
    assert.equal((await api.request('/auth/login', { method: 'POST', body: registration('reported') })).status, 200);
    assert.deepEqual(api.db.prepare('SELECT action FROM moderation_actions ORDER BY id').all().map((row) => row.action), ['suspend', 'unsuspend']);
  } finally { await api.close(); }
});

test('moderators cannot change themselves, other operators or a different report target', async () => {
  const api = await setup();
  try {
    const { operator, reporter, reported } = await moderationFixture(api);
    const operatorId = operator.body.user.id;
    assert.throws(() => api.security.repo.moderate({ operatorId, userId: operatorId,
      action: 'suspend', reportId: 'reported-case', note: 'Unsafe action' }), /operator_accounts_require_local_review/);
    assert.throws(() => api.security.repo.moderate({ operatorId, userId: reporter.body.user.id,
      action: 'suspend', reportId: 'reported-case', note: 'Wrong target' }), /report_target_mismatch/);
    assert.throws(() => api.security.repo.moderate({ operatorId: reporter.body.user.id, userId: reported.body.user.id,
      action: 'suspend', reportId: 'reported-case', note: 'Nonoperator' }), /operator_required/);
    api.db.prepare('UPDATE users SET is_operator=1 WHERE id=?').run(reported.body.user.id);
    const result = await api.request('/operator/reports/reported-case/resolve', {
      method: 'POST', cookie: cookieOf(operator), body: { action: 'suspend', note: 'Cannot moderate operators remotely' },
    });
    assert.equal(result.status, 403);
    assert.equal(api.db.prepare('SELECT count(*) AS n FROM moderation_actions').get().n, 0);
    assert.equal(api.db.prepare('SELECT status FROM reports WHERE id=?').get('reported-case').status, 'open');
    assert.equal(api.security.isAllowed(operatorId), true);
  } finally { await api.close(); }
});
