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
      "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'",
    ].join('; '),
  };
}
