/** Mirror these headers on the production static host/reverse proxy. */
export function frontendSecurityHeaders({ development = false } = {}) {
  return {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    // Send only the site's origin to other sites: Google Maps needs it to check
    // a referrer-restricted key, and no page path or query ever leaves.
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Content-Security-Policy': [
      "default-src 'self'",
      // Google Maps JavaScript API (Places search for meetup starting points).
      "script-src 'self' https://maps.googleapis.com", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com", "img-src 'self' data: blob: https:",
      `connect-src 'self' https://maps.googleapis.com https://places.googleapis.com${development ? ' ws: wss:' : ''}`, "worker-src 'self' blob:", "object-src 'none'",
      // Setlist previews embed Spotify's own player. One host, https only, no
      // wildcard: the frame address is rebuilt server-side from a validated
      // track id (see server/src/services/spotifyLinks.js), so nothing an
      // operator pastes can point this frame anywhere else.
      'frame-src https://open.spotify.com',
      "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'",
    ].join('; '),
  };
}
