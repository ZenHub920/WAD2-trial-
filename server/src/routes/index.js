/** Route declarations only; controllers own HTTP responses and validation. */
import { Router } from 'express';
import { createConcertController } from '../controllers/concertController.js';
import { createMatchController } from '../controllers/matchController.js';
import { createUserController } from '../controllers/userController.js';
import { createTicketController } from '../controllers/ticketController.js';
import { createKakiController } from '../controllers/kakiController.js';
import { createProfileController } from '../controllers/profileController.js';
import { createParticipationController } from '../controllers/participationController.js';

export function createRoutes({ repos, matching, sessions, images }) {
  const router = Router();
  const concerts = createConcertController(repos);
  const matches = createMatchController({ repos, matching });
  const users = createUserController(repos, sessions);
  const tickets = createTicketController(repos, images);
  const kaki = createKakiController(repos);
  const profile = createProfileController(repos);
  const participation = createParticipationController(repos);

  router.use((req, res, next) => {
    req.user = sessions.current(req);
    next();
  });

  const requireUser = (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'authentication_required' });
    next();
  };

  router.get('/tickets', tickets.list);
  router.get('/tickets/:id', tickets.detail);
  router.post('/tickets', requireUser, tickets.create);
  router.patch('/tickets/:id', requireUser, tickets.update);
  router.delete('/tickets/:id', requireUser, tickets.delete);
  router.get('/me/tickets', requireUser, tickets.mine);
  router.get('/me/profile', requireUser, profile.get);
  router.patch('/me/profile', requireUser, profile.update);
  router.get('/me/concerts', requireUser, participation.mine);
  router.get('/concerts/:id/participation', requireUser, participation.get);
  router.post('/concerts/:id/participation', requireUser, participation.join);
  router.delete('/concerts/:id/participation', requireUser, participation.leave);

  router.get('/kaki/pool', requireUser, kaki.pool);
  router.get('/kaki/decisions', requireUser, kaki.decisions);
  router.put('/kaki/decisions/:concertId/:targetUserId', requireUser, kaki.setDecision);
  router.delete('/kaki/decisions/:concertId/:targetUserId', requireUser, kaki.deleteDecision);
  router.get('/kaki/matches', requireUser, kaki.matches);

  router.get('/concerts', concerts.list);
  router.post('/concerts', concerts.create);
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
  router.post('/auth/logout', requireUser, users.logout);
  router.get('/users/:id', users.get);

  return router;
}
