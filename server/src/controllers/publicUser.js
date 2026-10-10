/** Keep private account fields out of listing and authentication responses. */
export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    displayName: user.display_name,
    ageBand: user.age_band,
    homeRegion: user.home_region,
    languages: user.languages,
    vibe: user.vibe,
    reliability: Math.round(user.reliability * 100) / 100,
    verified: Boolean(user.verified),
  };
}
