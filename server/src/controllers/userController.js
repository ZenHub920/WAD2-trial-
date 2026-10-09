import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { publicUser } from './publicUser.js';

const AGE_BANDS = ['18-20', '21-24', '25-29', '30-34', '35+'];

export function createUserController(repos) {
  return {
    register(req, res) {
      const error = validateRegistration(req.body);
      if (error) return res.status(400).json({ error });

      try {
        const user = repos.users.create({
          ...req.body,
          age_band: req.body.age_band ?? '21-24',
          home_region: req.body.home_region ?? 'central',
          gender: req.body.gender ?? 'unspecified',
          vibe: req.body.vibe ?? {},
          email: req.body.email.trim().toLowerCase(),
          password_hash: hashPassword(req.body.password),
        });
        res.status(201).json({ user: publicUser(user) });
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
      res.json({ user: publicUser(user) });
    },

    get(req, res) {
      const user = repos.users.findById(req.params.id);
      if (!user) return res.status(404).json({ error: 'user_not_found' });
      res.json({ user: publicUser(user) });
    },

    create(req, res) {
      const error = validateUser(req.body);
      if (error) return res.status(400).json({ error });
      try {
        res.status(201).json({ user: publicUser(repos.users.create(req.body)) });
      } catch (err) {
        res.status(409).json({ error: 'could_not_create_user', detail: err.message });
      }
    },
  };
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

function validateUser(body = {}) {
  if (!body.display_name) return 'display_name_required';
  if (!AGE_BANDS.includes(body.age_band)) return 'invalid_age_band';
  if (!body.home_region) return 'home_region_required';
  if (!body.gender) return 'gender_required';
  if (!body.vibe || typeof body.vibe !== 'object') return 'vibe_required';
  return null;
}
