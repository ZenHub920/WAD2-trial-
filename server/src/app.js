import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

import { getDb } from './db/connection.js';
import { createRepositories } from './db/repositories.js';
import { createMatchingService } from './services/matchingService.js';
import { createSessionService } from './services/sessions.js';
import { createRoutes } from './routes/index.js';
import { createTicketmasterRoutes } from './routes/ticketmaster.js';
import { createTicketImages } from './services/ticketImages.js';
import { createRealtime } from './services/realtime.js';
import { createAccountSecurity } from './services/accountSecurity.js';
import { createSmtpMailer } from './services/accountMailer.js';
import { createApiRateLimiter } from './services/apiRateLimiter.js';
import { createConcertProvider } from './services/concertProvider.js';
import { createDeliveryService } from './services/delivery.js';
import { createMeetupIntegrations } from './services/meetupIntegrations.js';
import { createHttpSecurity, errorResponseGuard, logServerError, publicErrorCode } from './services/httpSecurity.js';

export function createApp({
  db = getDb(),
  env = process.env,
  fetchImpl = fetch,
  mailer = createSmtpMailer(env),
  ratePolicies,
  webPush,
  logger = console,
  imageDir = process.env.ENCORE_TICKET_IMAGE_DIR ?? join(dirname(fileURLToPath(import.meta.url)), '../data/ticket-images'),
  // Avatars live in their own directory so a ticket photo and a profile
  // picture can never collide, and so the two can be served with different
  // caching later without untangling them.
  avatarDir = process.env.ENCORE_AVATAR_DIR ?? join(dirname(fileURLToPath(import.meta.url)), '../data/avatars'),
} = {}) {
  const repos = createRepositories(db);
  const matching = createMatchingService({ db, repos });
  const security = createAccountSecurity({ db, appOrigin: env.APP_ORIGIN, mailer });
  const sessions = createSessionService(repos, { isAllowed: security.isAllowed, env });
  const concertProvider = createConcertProvider({ db, env, fetchImpl });
  const meetupIntegrations = createMeetupIntegrations({ db, repos, env, fetchImpl });
  const delivery = createDeliveryService({ db, repos, env, webPush, logger });
  delivery.registerWeatherChecks(meetupIntegrations.weather);
  delivery.registerTask('account.cleanup', () => security.cleanup(), { intervalMs: 3600000 });
  if (env.TICKETMASTER_API_KEY) delivery.registerTask('concert.sync', () => concertProvider.sync(),
    { intervalMs: Math.max(3600000, Number(env.CONCERT_SYNC_INTERVAL_MS) || 6 * 3600000) });
  const images = createTicketImages(imageDir);
  // Same validator, different directory — it checks image bytes rather than
  // trusting the data-URI label, which matters for files served back to others.
  const avatars = createTicketImages(avatarDir);
  const realtime = createRealtime();

  const app = express();
  const httpSecurity = createHttpSecurity({ env });
  app.disable('x-powered-by');
  // Configure only the actual proxy hops/subnets for the deployed topology.
  if (env.TRUST_PROXY) app.set('trust proxy', /^\d+$/.test(env.TRUST_PROXY) ? Number(env.TRUST_PROXY) : env.TRUST_PROXY.split(',').map((v) => v.trim()));
  app.use('/api', httpSecurity.headers);
  app.use('/api', errorResponseGuard(env));
  app.use('/api', httpSecurity.requestGuard);
  app.use('/api', httpSecurity.cors);
  app.use('/api', createApiRateLimiter({ db, policies: ratePolicies, identifyUser: (req) => sessions.current(req)?.id }));
  app.use(express.json({ limit: '4mb', inflate: false }));
  app.use('/api', (req, res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method))
      res.once('finish', () => { if (res.statusCode < 400) delivery.wake(); });
    next();
  });

  app.get('/api/health', (req, res) => {
    res.json({ ok: true, time: new Date().toISOString() });
  });

  app.use('/api/ticket-images', express.static(imageDir));
  app.use('/api/avatars', express.static(avatarDir));
  app.use('/api', createTicketmasterRoutes(db, concertProvider));
  app.use('/api', createRoutes({
    db,
    repos,
    matching,
    sessions,
    images,
    avatars,
    realtime,
    security,
    delivery,
    meetupIntegrations,
  }));

  app.use((req, res) => res.status(404).json({ error: 'not_found', path: req.path }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'invalid_json' });
    }
    if (err.type === 'entity.too.large') {
      return res.status(413).json({ error: 'request_too_large' });
    }
    if (err.type === 'encoding.unsupported') return res.status(415).json({ error: 'compressed_requests_not_supported' });
    if (Number.isInteger(err.status) && err.status >= 400 && err.status < 500) {
      return res.status(err.status).json({ error: publicErrorCode(err, env) });
    }
    if (err.message === 'push_not_configured') return res.status(503).json({ error: 'push_not_configured' });
    logServerError(logger, req, res, err);
    res.status(500).json({ error: 'internal_error' });
  });

  return { app, repos, matching, db, realtime, security, concertProvider, delivery, meetupIntegrations };
}
