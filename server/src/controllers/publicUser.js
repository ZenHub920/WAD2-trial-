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
    // null when the user has not set a picture. The interface draws a grey
    // silhouette in that case rather than an initial, so declining a photo
    // is a neutral choice rather than a visibly incomplete profile.
    avatarUrl: user.avatar_path ? `/api/avatars/${user.avatar_path}` : null,
  };
}
