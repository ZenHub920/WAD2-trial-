/**
 * Reading a Spotify track id out of whatever an operator pasted.
 *
 * WHY THIS IS ITS OWN MODULE
 * --------------------------
 * The setlist player embeds a frame from open.spotify.com, and the site's
 * Content-Security-Policy allows that one host for exactly that reason. The
 * danger in allowing a frame at all is the frame's address: if it were built
 * by pasting an operator's text straight into a src attribute, a wrong or
 * hostile value would point the frame somewhere nobody intended.
 *
 * So nothing pasted is ever used as a URL. This module extracts the 22
 * character track id and discards everything else — host, path, query, locale
 * prefix — and `spotifyEmbedUrl` rebuilds a known-good address from that id
 * alone. A link to another site, to an album or playlist rather than a track,
 * or to anything that is not plain base62 cannot survive the trip.
 */

/** Spotify ids are 22 base62 characters; anything else is not an id. */
const TRACK_ID = /^[A-Za-z0-9]{22}$/;

/**
 * @param  {unknown} value a pasted link, URI or bare id
 * @returns {string|null}  the track id, or null when it is not a Spotify track
 */
export function spotifyTrackId(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text) return null;

  // Already an id.
  if (TRACK_ID.test(text)) return text;

  // Desktop app URI: spotify:track:<id>
  if (text.toLowerCase().startsWith('spotify:')) {
    const parts = text.split(':');
    return parts.length === 3 && parts[1].toLowerCase() === 'track' && TRACK_ID.test(parts[2])
      ? parts[2]
      : null;
  }

  let url;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  // https only, and only Spotify's own host: a http link or a look-alike
  // domain is rejected rather than coerced.
  if (url.protocol !== 'https:') return null;
  if (url.hostname !== 'open.spotify.com') return null;

  // Share links may carry a locale: /intl-pt/track/<id>. Anything deeper than
  // one leading segment is not a track link we recognise.
  const segments = url.pathname.split('/').filter(Boolean);
  const at = segments.indexOf('track');
  if (at === -1 || at > 1) return null;
  const id = segments[at + 1];
  return TRACK_ID.test(id) ? id : null;
}

/**
 * The player's address, built from a validated id and nothing else.
 * Never pass unvalidated text to this.
 */
export const spotifyEmbedUrl = (trackId) =>
  (TRACK_ID.test(trackId ?? '') ? `https://open.spotify.com/embed/track/${trackId}` : null);

/** Where a song opens if somebody would rather leave the site. */
export const spotifyTrackUrl = (trackId) =>
  (TRACK_ID.test(trackId ?? '') ? `https://open.spotify.com/track/${trackId}` : null);
