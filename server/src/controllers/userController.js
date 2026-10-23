import { publicUser } from './publicUser.js';
import { validProfile } from './profileController.js';
import { hashPassword, verifyPassword } from '../services/passwords.js';

export function createUserController(repos, sessions, images = null) {
  return {
    register(req, res) {
      const error = validateRegistration(req.body);
      if (error) return res.status(400).json({ error });

      // A picture is optional at sign-up. Validate it BEFORE creating the
      // account, so a bad image fails the request outright instead of leaving
      // a half-set-up user behind.
      let avatar = null;
      if (images && typeof req.body.avatar === 'string' && req.body.avatar) {
        try {
          avatar = images.save(req.body.avatar);
        } catch (err) {
          if (err.message === 'invalid_image') {
            return res.status(400).json({ error: 'invalid_image' });
          }
          throw err;
        }
      }

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
        if (avatar) repos.users.setAvatar(user.id, avatar);
        sessions.start(req, res, user.id);
        res.status(201).json({ user: ownUser(repos.users.findById(user.id)) });
      } catch {
        // The account was not created, so the saved image is now an orphan.
        if (avatar) images?.remove(avatar);
        res.status(409).json({ error: 'could_not_create_user' });
      }
    },

    login(req, res) {
      const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      if (!email || !password) return res.status(400).json({ error: 'email_and_password_required' });

      const user = repos.users.findByEmail(email);
      if (!user?.password_hash || !verifyPassword(password, user.password_hash) || sessions.allowed?.(user.id) === false) {
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
  if (body.password.length > 1024) return 'password_must_be_at_most_1024_characters';
  if (body.display_name.trim().length > 80) return 'display_name_must_be_at_most_80_characters';
  if (body.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim())) return 'invalid_email';
  const fields = {
    age_band: 'ageBand', home_region: 'homeRegion', gender: 'gender',
    companion_gender_pref: 'companionGenderPref', languages: 'languages', vibe: 'vibe',
  };
  const preferences = {};
  for (const [input, output] of Object.entries(fields)) {
    if (Object.hasOwn(body, input)) preferences[output] = body[input];
  }
  if (!validProfile(preferences)) return 'invalid_profile';
  return null;
}
