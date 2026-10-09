/** Route declarations only; controllers own HTTP responses and validation. */
import { Router } from 'express';
import { createConcertController } from '../controllers/concertController.js';
import { createMatchController } from '../controllers/matchController.js';
import { createUserController } from '../controllers/userController.js';

export function createRoutes({ repos, matching, sessions }) {
  const router = Router();

  const concerts = createConcertController(repos);
  const matches = createMatchController({ repos, matching });
  const users = createUserController(repos, sessions);

  router.use((req, res, next) => {
    req.user = sessions.current(req);
    next();
  });
  const requireUser = (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'authentication_required' });
    next();
  };

  router.get('/concerts', concerts.list);
  router.get('/concerts/:id', concerts.detail);
  router.get('/concerts/:id/parties', concerts.parties);
  router.post('/concerts/:id/parties', requireUser, concerts.createParty);
  router.get('/concerts/:id/requests', concerts.requests);
  router.post('/concerts/:id/requests', requireUser, concerts.createRequest);

  router.get('/concerts/:id/match/preview', matches.preview);
  router.post('/concerts/:id/match', requireUser, matches.run);
  router.get('/rounds/:id', matches.round);
  router.get('/solvers', matches.solvers);
  router.get('/rounds/:id/trace', matches.trace);
  router.get('/rounds/:id/parties/:partyId', matches.roster);
  router.get('/rounds/:id/verify', matches.verify);
  router.get('/concerts/:id/explain/:requestId', matches.explain);

  router.post('/auth/register', users.register);
  router.post('/auth/login', users.login);
  router.get('/auth/me', requireUser, users.current);
  router.post('/auth/logout', users.logout);
  router.get('/users/:id', users.get);

  return router;
}
