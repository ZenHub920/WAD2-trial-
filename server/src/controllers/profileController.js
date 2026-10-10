const AGE_BANDS = ['18-20', '21-24', '25-29', '30-34', '35+'];
const REGIONS = ['north', 'north_east', 'east', 'west', 'central'];
const GENDERS = ['f', 'm', 'nb', 'unspecified'];
const PREFERENCES = ['any', 'same_only'];
const LANGUAGES = ['en', 'zh', 'ms', 'ta'];
const VIBE_AXES = ['singalong', 'photography', 'dancing', 'quiet', 'queue_early', 'merch'];
const FIELDS = ['displayName', 'ageBand', 'homeRegion', 'gender',
  'companionGenderPref', 'languages', 'vibe'];

function profile(user) {
  return {
    id: user.id,
    displayName: user.display_name,
    email: user.email,
    ageBand: user.age_band,
    homeRegion: user.home_region,
    gender: user.gender,
    companionGenderPref: user.companion_gender_pref,
    languages: user.languages,
    vibe: Object.fromEntries(VIBE_AXES.map((axis) => [axis, user.vibe[axis] ?? 0])),
    reliability: Math.round(user.reliability * 100) / 100,
    verified: Boolean(user.verified),
  };
}

function validProfile(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).some((key) => !FIELDS.includes(key))) return false;
  if ('displayName' in body && (typeof body.displayName !== 'string' || !body.displayName.trim())) return false;
  if ('ageBand' in body && !AGE_BANDS.includes(body.ageBand)) return false;
  if ('homeRegion' in body && !REGIONS.includes(body.homeRegion)) return false;
  if ('gender' in body && !GENDERS.includes(body.gender)) return false;
  if ('companionGenderPref' in body && !PREFERENCES.includes(body.companionGenderPref)) return false;
  if ('languages' in body && (!Array.isArray(body.languages) || !body.languages.length
    || body.languages.some((language) => !LANGUAGES.includes(language)))) return false;
  if ('vibe' in body && (!body.vibe || typeof body.vibe !== 'object' || Array.isArray(body.vibe)
    || Object.entries(body.vibe).some(([axis, score]) => !VIBE_AXES.includes(axis)
      || !Number.isInteger(score) || score < 0 || score > 4))) return false;
  return true;
}

export function createProfileController(repos) {
  return {
    get(req, res) {
      res.json({ profile: profile(req.user) });
    },
    update(req, res) {
      if (!validProfile(req.body)) return res.status(400).json({ error: 'invalid_profile' });
      const changes = { ...req.body };
      if ('displayName' in changes) changes.displayName = changes.displayName.trim();
      if ('vibe' in changes) {
        changes.vibe = Object.fromEntries(VIBE_AXES.map((axis) => [axis, changes.vibe[axis] ?? 0]));
      }
      res.json({ profile: profile(repos.users.updateProfile(req.user.id, changes)) });
    },
  };
}
