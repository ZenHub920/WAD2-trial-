import { randomUUID } from 'node:crypto';
import cors from 'cors';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);
const originOf = (value) => {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.origin : null;
  } catch { return null; }
};
const configuredOrigin = (value, production) => {
  const origin = originOf(value);
  if (!origin || new URL(value).href !== `${origin}/`
    || (production && !origin.startsWith('https://'))) throw new Error('invalid_trusted_origin');
  return origin;
};

/** Exact origins, rather than trusting request Host/X-Forwarded-Host values. */
export function createHttpSecurity({ env = process.env } = {}) {
  const production = env.NODE_ENV === 'production';
  const configured = [env.APP_ORIGIN, ...(env.CORS_ALLOWED_ORIGINS ?? '').split(',')].map((v) => v?.trim()).filter(Boolean);
  if (production && !env.APP_ORIGIN) throw new Error('production_app_origin_required');
  const allowed = new Set(configured.map((value) => configuredOrigin(value, production)));
  if (!production) for (const value of ['http://localhost:5173', 'http://127.0.0.1:5173']) allowed.add(value);
  const trusted = (value) => typeof value === 'string' && allowed.has(value);
  const reject = (res, code = 'csrf_verification_failed') => res.status(403).json({ error: code });
  const headers = (req, res, next) => {
    const publicImage = /^(?:\/api)?\/(avatars|ticket-images)(?:\/|$)/.test(req.path);
    res.set({
      'X-Request-ID': randomUUID(),
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Resource-Policy': publicImage ? 'cross-origin' : 'same-site',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=(self)',
      'Content-Security-Policy': "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
    });
    if (production && req.secure) res.set('Strict-Transport-Security', 'max-age=31536000');
    if (!publicImage) res.set('Cache-Control', 'private, no-store');
    next();
  };
  const requestGuard = (req, res, next) => {
    const origin = req.get('origin');
    if (origin !== undefined && !trusted(origin)) return reject(res, 'origin_not_allowed');
    const unsafe = !SAFE.has(req.method);
    const session = /(?:^|;\s*)encore_session=/.test(req.get('cookie') ?? '');
    // Also guard private GET endpoints that update read markers as part of opening a thread.
    if ((unsafe || session) && req.get('sec-fetch-site') === 'cross-site' && !trusted(origin)) return reject(res);
    if (!unsafe) return next();
    if (origin && trusted(origin)) return next();
    const referer = req.get('referer');
    if (referer && !trusted(originOf(referer))) return reject(res);
    if (referer || req.get('sec-fetch-site') === 'same-origin') return next();
    // JSON/custom headers and non-simple methods require a successful browser
    // preflight, which the exact CORS allowlist above restricts. Keep CLI clients.
    const json = /^application\/json(?:\s*;|$)/i.test(req.get('content-type') ?? '');
    if (json || req.get('x-requested-with') === 'Encore' || req.method === 'DELETE') return next();
    // Anonymous bodyless requests cannot mutate authenticated data. Cookie-backed
    // form/text/plain POSTs must not reach handlers that accept URL-only actions.
    if (session || req.get('sec-fetch-site')) return reject(res);
    return next();
  };
  const corsMiddleware = cors({
    origin: (origin, done) => done(null, origin && trusted(origin) ? origin : false),
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-Requested-With', 'Idempotency-Key'],
    exposedHeaders: ['X-Request-ID', 'Retry-After'],
    maxAge: 600,
  });
  return { headers, requestGuard, cors: corsMiddleware };
}

/** Only stable machine codes enter responses or logs; never upstream messages/URLs. */
export function publicErrorCode(error, env = process.env) {
  const message = error?.message;
  if (typeof message !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_]{1,100}$/.test(message)) return 'request_rejected';
  for (const [key, value] of Object.entries(env))
    if (value && String(value).length >= 4 && /KEY|TOKEN|SECRET|PASSWORD|SMTP_PASS/i.test(key)
      && message.includes(String(value))) return 'request_rejected';
  return message;
}
export function errorResponseGuard(env = process.env) {
  return (_req, res, next) => {
    const json = res.json;
    res.json = function safeJson(body) {
      if (this.statusCode >= 400 && body && typeof body === 'object' && typeof body.error === 'string') {
        body = { ...body, error: publicErrorCode({ message: body.error }, env) };
        if (this.statusCode >= 500) delete body.detail;
        else if (typeof body.detail === 'string') body.detail = publicErrorCode({ message: body.detail }, env);
      }
      return json.call(this, body);
    };
    next();
  };
}
export function logServerError(logger, req, res, error) {
  const code = typeof error?.code === 'string' && /^(SQLITE_[A-Z_]+|E[A-Z]{2,25})$/.test(error.code)
    ? error.code : 'internal_error';
  logger.error?.({ event: 'api_request_failed', requestId: res.get('X-Request-ID'), method: req.method, code });
}
