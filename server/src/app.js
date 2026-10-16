import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';

import { getDb } from './db/connection.js';
import { createRepositories } from './db/repositories.js';
import { createMatchingService } from './services/matchingService.js';
import { createSessionService } from './services/sessions.js';
import { createRoutes } from './routes/index.js';
import { createTicketmasterRoutes } from './routes/ticketmaster.js';
import { createTicketImages } from './services/ticketImages.js';
import { createRealtime } from './services/realtime.js';

export function createApp({
  db = getDb(),
  imageDir = process.env.ENCORE_TICKET_IMAGE_DIR ?? join(dirname(fileURLToPath(import.meta.url)), '../data/ticket-images'),
  // Avatars live in their own directory so a ticket photo and a profile
  // picture can never collide, and so the two can be served with different
  // caching later without untangling them.
  avatarDir = process.env.ENCORE_AVATAR_DIR ?? join(dirname(fileURLToPath(import.meta.url)), '../data/avatars'),
} = {}) {
  const repos = createRepositories(db);
  const matching = createMatchingService({ db, repos });
  const sessions = createSessionService(repos);
  const images = createTicketImages(imageDir);
  // Same validator, different directory — it checks image bytes rather than
  // trusting the data-URI label, which matters for files served back to others.
  const avatars = createTicketImages(avatarDir);
  const realtime = createRealtime();

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '4mb' }));

  app.get('/api/health', (req, res) => {
    res.json({ ok: true, time: new Date().toISOString() });
  });

  app.use('/api/ticket-images', express.static(imageDir));
  app.use('/api/avatars', express.static(avatarDir));
  app.use('/api', createTicketmasterRoutes());
   // Pass the existing SQLite connection to the route registry.
  //
  // Reuse the same database instance for matching,
  // proposals, sessions and upcoming enhancements.

  app.use('/api', createRoutes({
    db,
    repos,
    matching,
    sessions,
    images,
    avatars,
    realtime,
  }));

  app.use((req, res) => res.status(404).json({ error: 'not_found', path: req.path }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'invalid_json' });
    }
    console.error(err);
    res.status(500).json({ error: 'internal_error', detail: err.message });
  });

  return { app, repos, matching, db, realtime };
}
