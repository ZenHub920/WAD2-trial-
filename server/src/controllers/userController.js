import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { publicUser } from './publicUser.js';

export function createUserController(repos, sessions) {
  return {
    register(req, res) {
      const error = validateRegistration(req.body);
      if (error) return res.status(400).json({ error });

      try {
        const user = repos.users.create({
          display_name: req.body.display_name.trim(),
          age_band: req.body.age_band ?? '21-24',
          home_region: req.body.home_region ?? 'central',
          gender: req.body.gender ?? 'unspecified',
          vibe: req.body.vibe ?? {},
          languages: req.body.languages,
          companion_gender_pref: req.body.companion_gender_pref,
          email: req.body.email.trim().toLowerCase(),
          password_hash: hashPassword(req.body.password),
        });
        sessions.start(req, res, user.id);
        res.status(201).json({ user: ownUser(user) });
      } catch (err) {
        res.status(409).json({ error: 'could_not_create_user', detail: err.message });
      }
    },

    login(req, res) {
      const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      if (!email || !password) return res.status(400).json({ error: 'email_and_password_required' });

      const user = repos.users.findByEmail(email);
      if (!user?.password_hash || !verifyPassword(password, user.password_hash)) {
        return res.status(401).json({ error: 'invalid_credentials' });
      }
      sessions.start(req, res, user.id);
      res.json({ user: ownUser(repos.users.findById(user.id)) });
    },

    current(req, res) {
      res.json({ user: ownUser(req.user) });
    },

    logout(req, res) {
      sessions.end(req, res);
      res.status(204).end();
    },

    get(req, res) {
      const user = repos.users.findById(req.params.id);
      if (!user) return res.status(404).json({ error: 'user_not_found' });
      res.json({ user: publicUser(user) });
    },

  };
}

function ownUser(user) {
  return { ...publicUser(user), isOperator: Boolean(user.is_operator) };
}

function validateRegistration(body = {}) {
  if (!body.display_name || typeof body.display_name !== 'string' || !body.display_name.trim()) {
    return 'display_name_required';
  }
  if (typeof body.email !== 'string' || !body.email.trim()) return 'email_required';
  if (typeof body.password !== 'string' || body.password.length < 8) {
    return 'password_must_be_at_least_8_characters';
  }
  return null;
}

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  const [, salt, expectedHex] = stored.split('$');
  if (!salt || !expectedHex) return false;
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
