/** Mirror these headers on the production static host/reverse proxy. */
export function frontendSecurityHeaders({ development = false } = {}) {
  return {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': [
      "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com", "img-src 'self' data: blob: https:",
      `connect-src 'self'${development ? ' ws: wss:' : ''}`, "worker-src 'self'", "object-src 'none'",
      // Setlist previews embed Spotify's own player. One host, https only, no
      // wildcard: the frame address is rebuilt server-side from a validated
      // track id (see server/src/services/spotifyLinks.js), so nothing an
      // operator pastes can point this frame anywhere else.
      'frame-src https://open.spotify.com',
      "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'",
    ].join('; '),
  };
}
