import express from 'express';
import cors from 'cors';

import { getDb } from './db/connection.js';
import { createRepositories } from './db/repositories.js';
import { createMatchingService } from './services/matchingService.js';
import { createSessionService } from './services/sessions.js';
import { createRoutes } from './routes/index.js';
import { createTicketmasterRoutes } from './routes/ticketmaster.js';

export function createApp({ db = getDb() } = {}) {
  const repos = createRepositories(db);
  const matching = createMatchingService({ db, repos });
  const sessions = createSessionService(repos);

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (req, res) => {
    res.json({ ok: true, time: new Date().toISOString() });
  });

  app.use('/api', createTicketmasterRoutes());
  app.use('/api', createRoutes({ repos, matching, sessions }));

  app.use((req, res) => res.status(404).json({ error: 'not_found', path: req.path }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: 'internal_error', detail: err.message });
  });

  return { app, repos, matching, db };
}
