const AGE_BANDS = ['18-20', '21-24', '25-29', '30-34', '35+'];
const REGIONS = ['north', 'north_east', 'east', 'west', 'central'];
const GENDERS = ['f', 'm', 'nb', 'unspecified'];
const PREFERENCES = ['any', 'male', 'female'];
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

/** Public self-description only; matching answers and account data stay private. */
function publicProfile(user) {
  return {
    id: user.id,
    displayName: user.display_name,
    avatarUrl: user.avatar_path ? `/api/avatars/${user.avatar_path}` : null,
    ageBand: user.age_band,
    languages: user.languages,
    verified: Boolean(user.verified),
    hasVibeRatings: VIBE_AXES.some(axis => Number.isInteger(user.vibe?.[axis])
      && user.vibe[axis] >= 0 && user.vibe[axis] <= 4),
    vibe: Object.fromEntries(VIBE_AXES.map((axis) => {
      const score = user.vibe?.[axis];
      return [axis, Number.isInteger(score) && score >= 0 && score <= 4 ? score : 0];
    })),
  };
}

export function validProfile(body) {
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
    publicGet(req, res) {
      const user = repos.users.visibleProfile(req.user.id, req.params.id);
      if (!user) return res.status(404).json({ error: 'profile_unavailable' });
      // A block, suspension and missing account intentionally look identical.
      res.json({ profile: publicProfile(user) });
    },
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
