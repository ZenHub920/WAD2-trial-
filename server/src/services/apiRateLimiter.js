import { createHash } from 'node:crypto';

const minute = 60_000;
const defaults = {
  login: { limit: 20, windowMs: 15 * minute },
  registration: { limit: 30, windowMs: 60 * minute },
  recovery: { limit: 8, windowMs: 60 * minute },
  credentials: { limit: 10, windowMs: 15 * minute },
  chat: { limit: 120, windowMs: minute },
  reports: { limit: 10, windowMs: 60 * minute },
  provider: { limit: 60, windowMs: minute },
};

export function ratePolicy(method, rawPath) {
  const path = rawPath.replace(/^\/api(?=\/)/, '');
  if (method === 'POST' && path === '/auth/login') return 'login';
  if (method === 'POST' && path === '/auth/register') return 'registration';
  if (method === 'POST' && /^\/auth\/(password-reset|email-verification)\//.test(path)) return 'recovery';
  if (path === '/auth/password/change' || path === '/auth/sessions') return 'credentials';
  if (method === 'POST' && /\/messages$/.test(path)) return 'chat';
  if (method === 'POST' && /\/reports$/.test(path)) return 'reports';
  if (/\/(weather|environment|travel-suggestions|locations|transport)$|\/travel(?:\/|$)|\/places\/search$|\/concerts\/external$/.test(path)) return 'provider';
  if (method !== 'GET' && /^\/me\/push\//.test(path)) return 'provider';
  return null;
}

/** Persistent per-instance budget; trusted proxy configuration is owned by Express. */
export function createApiRateLimiter({ db, now = Date.now, policies = {} } = {}) {
  const memory = new Map();
  const configured = { ...defaults, ...policies };
  let requests = 0;
  const increment = db ? db.transaction((bucket, expiresAt, time) => {
    if (requests % 100 === 0) db.prepare('DELETE FROM api_rate_limits WHERE expires_at<=?').run(time);
    if (!db.prepare('SELECT 1 FROM api_rate_limits WHERE bucket=?').get(bucket)
        && db.prepare('SELECT count(*) AS count FROM api_rate_limits').get().count >= 50_000) return Infinity;
    db.prepare(`INSERT INTO api_rate_limits(bucket,count,expires_at) VALUES(?,1,?)
      ON CONFLICT(bucket) DO UPDATE SET count=count+1`).run(bucket, expiresAt);
    return db.prepare('SELECT count FROM api_rate_limits WHERE bucket=?').get(bucket).count;
  }) : (bucket, expiresAt, time) => {
    if (requests % 100 === 0) for (const [key, value] of memory) if (value.expiresAt <= time) memory.delete(key);
    if (!memory.has(bucket) && memory.size >= 50_000) return Infinity;
    const value = memory.get(bucket) ?? { count: 0, expiresAt };
    value.count += 1;
    memory.set(bucket, value);
    return value.count;
  };

  return function apiRateLimit(req, res, next) {
    const policyName = ratePolicy(req.method, req.path);
    const policy = configured[policyName];
    if (!policyName || !policy || policy.limit === 0) return next();
    const time = now();
    const window = Math.floor(time / policy.windowMs);
    const expiresAt = (window + 1) * policy.windowMs;
    // Always include IP, even when an attacker rotates their authenticated account.
    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
    const hash = createHash('sha256').update(String(ip)).digest('hex');
    requests += 1;
    const count = increment(`${policyName}:${hash}:${window}`, expiresAt, time);
    res.set('RateLimit-Limit', String(policy.limit));
    res.set('RateLimit-Remaining', String(Math.max(0, policy.limit - count)));
    res.set('RateLimit-Reset', String(Math.ceil(expiresAt / 1000)));
    if (count > policy.limit) {
      res.set('Retry-After', String(Math.max(1, Math.ceil((expiresAt - time) / 1000))));
      return res.status(429).json({ error: 'rate_limit_exceeded', retryAfter: Math.max(1, Math.ceil((expiresAt - time) / 1000)) });
    }
    return next();
  };
}
