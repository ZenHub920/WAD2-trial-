import { createHash, randomBytes } from 'node:crypto';

const COOKIE_NAME = 'encore_session';
const SESSION_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax',
  path: '/api',
};

function cookieToken(req) {
  const header = req.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const cookie = part.trim();
    if (cookie.startsWith(`${COOKIE_NAME}=`)) {
      const token = cookie.slice(COOKIE_NAME.length + 1);
      return /^[0-9a-f]{64}$/.test(token) ? token : null;
    }
  }
  return null;
}

function tokenHash(token) {
  return createHash('sha256').update(token).digest('hex');
}

function cookieOptions() {
  return { ...COOKIE_OPTIONS, secure: process.env.NODE_ENV === 'production' };
}

export function createSessionService(repos) {
  return {
    start(req, res, userId) {
      const previous = cookieToken(req);
      if (previous) repos.sessions.delete(tokenHash(previous));
      const token = randomBytes(32).toString('hex');
      repos.sessions.create(tokenHash(token), userId, Date.now() + SESSION_AGE_MS);
      res.cookie(COOKIE_NAME, token, { ...cookieOptions(), maxAge: SESSION_AGE_MS });
    },

    current(req) {
      const token = cookieToken(req);
      if (!token) return null;
      const userId = repos.sessions.findUserId(tokenHash(token), Date.now());
      return userId ? repos.users.findById(userId) : null;
    },

    end(req, res) {
      const token = cookieToken(req);
      if (token) repos.sessions.delete(tokenHash(token));
      res.clearCookie(COOKIE_NAME, cookieOptions());
    },
  };
}
