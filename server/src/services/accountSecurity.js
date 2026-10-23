import { randomBytes } from 'node:crypto';
import { createAccountSecurityRepo } from '../db/accountSecurityRepository.js';
import { createSmtpMailer } from './accountMailer.js';
import { hashPassword, validPassword, verifyPassword } from './passwords.js';

const TOKEN = /^[0-9a-f]{64}$/;
const failure = (status, message) => { throw Object.assign(new Error(message), { status }); };
const validEmail = (email) => typeof email === 'string' && email.length <= 254
  && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

export function trustedAppOrigin(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/') return null;
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) return null;
    return url.origin;
  } catch { return null; }
}

/** Mail runs after the response; only hashed tokens are persisted. Inject send() in tests. */
export function createAccountSecurity({ db, mailer = createSmtpMailer(), appOrigin = process.env.APP_ORIGIN,
  now = Date.now } = {}) {
  const repo = createAccountSecurityRepo(db, { now });
  const origin = trustedAppOrigin(appOrigin);
  const pending = new Set();
  let failedDeliveries = 0;

  function sendToken(account, purpose) {
    if (!origin || !mailer.configured || pending.size >= 50 || !account?.email) return;
    if (purpose === 'verify' && account.email_verified_at != null) return;
    const rawToken = randomBytes(32).toString('hex');
    if (!repo.issueToken({ userId: account.id, email: account.email, purpose, rawToken,
      lifetimeMs: purpose === 'reset' ? 30 * 60_000 : 24 * 60 * 60_000 })) return;
    const link = new URL('/account/security', origin);
    link.searchParams.set('mode', purpose);
    // Fragments are not sent to HTTP access logs or in Referer headers.
    link.hash = new URLSearchParams({ token: rawToken }).toString();
    const reset = purpose === 'reset';
    const task = Promise.resolve().then(() => mailer.send({
      to: account.email,
      subject: reset ? 'Reset your Encore password' : 'Verify your Encore email',
      text: `${reset ? 'Reset your Encore password' : 'Verify your Encore email'} using this single-use link:\n\n${link}\n\n`
        + `It expires in ${reset ? '30 minutes' : '24 hours'}. If you did not request this, ignore this email.`,
    })).then((sent) => {
      if (!sent) { repo.invalidateToken(rawToken); failedDeliveries += 1; }
    }).catch(() => {
      // Neither SMTP error text nor token-bearing payloads are logged or returned.
      try { repo.invalidateToken(rawToken); } catch { /* shutdown may have closed the database */ }
      failedDeliveries += 1;
    }).finally(() => pending.delete(task));
    pending.add(task);
  }

  return {
    repo,
    isAllowed: (id) => repo.isAllowed(id),
    requestReset(email) {
      // Same HTTP response for missing, suspended, unconfigured, throttled or existing accounts.
      if (validEmail(email)) {
        const account = repo.byEmail(email.trim().toLowerCase());
        if (account && account.suspended_at == null) sendToken(account, 'reset');
      }
    },
    requestVerification(userId) { sendToken(repo.account(userId), 'verify'); },
    confirmReset(token, password) {
      if (!validPassword(password)) failure(400, 'password_must_be_8_to_1024_characters');
      if (typeof token !== 'string' || !TOKEN.test(token)) failure(400, 'invalid_or_expired_token');
      // Avoid running the password KDF for unauthenticated random-token traffic.
      if (!repo.canUseToken(token, 'reset')) failure(400, 'invalid_or_expired_token');
      if (!repo.resetPassword(token, hashPassword(password))) failure(400, 'invalid_or_expired_token');
    },
    confirmVerification(token) {
      if (typeof token !== 'string' || !TOKEN.test(token) || !repo.verifyEmail(token)) failure(400, 'invalid_or_expired_token');
    },
    changePassword(userId, currentPassword, password) {
      if (!validPassword(password)) failure(400, 'password_must_be_8_to_1024_characters');
      if (!verifyPassword(currentPassword, repo.account(userId)?.password_hash)) failure(401, 'invalid_credentials');
      repo.changePassword(userId, hashPassword(password));
    },
    status(userId) {
      const account = repo.account(userId);
      if (!account) failure(404, 'user_not_found');
      return { email: account.email, emailVerified: account.email_verified_at != null,
        emailConfigured: Boolean(origin && mailer.configured), sessionCount: repo.sessionCount(userId),
        passwordChangedAt: account.password_changed_at, warnings: repo.warnings(userId) };
    },
    revokeSessions(userId) { return repo.revokeSessions(userId); },
    cleanup: () => repo.cleanup(),
    deliveryState: () => ({ pending: pending.size, failed: failedDeliveries }),
    async flushMail() { await Promise.allSettled([...pending]); },
    async close() { await Promise.allSettled([...pending]); mailer.close?.(); },
  };
}
