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

export function createApp({
  db = getDb(),
  imageDir = process.env.ENCORE_TICKET_IMAGE_DIR ?? join(dirname(fileURLToPath(import.meta.url)), '../data/ticket-images'),
} = {}) {
  const repos = createRepositories(db);
  const matching = createMatchingService({ db, repos });
  const sessions = createSessionService(repos);
  const images = createTicketImages(imageDir);

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '4mb' }));

  app.get('/api/health', (req, res) => {
    res.json({ ok: true, time: new Date().toISOString() });
  });

  app.use('/api/ticket-images', express.static(imageDir));
  app.use('/api', createTicketmasterRoutes());
  app.use('/api', createRoutes({ repos, matching, sessions, images }));

  app.use((req, res) => res.status(404).json({ error: 'not_found', path: req.path }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: 'internal_error', detail: err.message });
  });

  return { app, repos, matching, db };
}
