/** Route declarations only; controllers own HTTP responses and validation. */
import { Router } from 'express';
import { createAdminController, requireAdmin } from '../controllers/adminController.js';
import { createChatController } from '../controllers/chatController.js';
import { createConcertController } from '../controllers/concertController.js';
import { createMarketController } from '../controllers/marketController.js';
import { createMatchController } from '../controllers/matchController.js';
import { createUserController } from '../controllers/userController.js';

export function createRoutes({ repos, matching, sessions }) {
  const router = Router();
  const concerts = createConcertController(repos);
  const matches = createMatchController({ repos, matching });
  const users = createUserController(repos, sessions);
  const market = createMarketController(repos);
  const chat = createChatController(repos);
  const admin = createAdminController(repos);

  router.use((req, res, next) => {
    req.user = sessions.current(req);
    next();
  });

  const requireUser = (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'authentication_required' });
    next();
  };

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

  router.get('/listings', market.list);
  router.get('/listings/:id', market.detail);
  router.post('/listings/:id/orders', requireUser, market.buy);
  router.post('/listings', requireUser, market.create);
  router.get('/orders/:id', requireUser, market.order);

  router.post('/listings/:id/conversations', requireUser, chat.start);
  router.get('/conversations', requireUser, chat.list);
  router.get('/conversations/:id', requireUser, chat.detail);
  router.post('/conversations/:id/messages', requireUser, chat.send);

  router.post('/auth/register', users.register);
  router.post('/auth/login', users.login);
  router.get('/auth/me', requireUser, users.current);
  router.post('/auth/logout', requireUser, users.logout);
  router.get('/me/listings', requireUser, market.mine);
  router.delete('/me/listings/:id', requireUser, market.withdraw);
  router.post('/me/listings/:id/proof', requireUser, market.submitProof);

  router.get('/admin/verifications', requireUser, requireAdmin, admin.queue);
  router.post('/admin/verifications/:id', requireUser, requireAdmin, admin.review);
  router.get('/admin/issued-tickets', requireUser, requireAdmin, admin.issuedSummary);
  router.post('/admin/concerts/:id/issued-tickets', requireUser, requireAdmin, admin.importIssued);
  router.get('/users/:id', users.get);

  return router;
}
