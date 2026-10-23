/** Route declarations only; controllers own HTTP responses and validation. */
import { Router } from 'express';
import { registerGroupDiscoveryRoutes } from './groupDiscovery.js';
import { registerCommunityRoutes } from './community.js';

import { registerEnhancementRoutes } from './enhancements.js';
import { createConcertController } from '../controllers/concertController.js';
import { createMatchController } from '../controllers/matchController.js';
import { createUserController } from '../controllers/userController.js';
import { createTicketController } from '../controllers/ticketController.js';
import { createKakiController } from '../controllers/kakiController.js';
import { createKakiChatController } from '../controllers/kakiChatController.js';
import { createProfileController } from '../controllers/profileController.js';
import { createParticipationController } from '../controllers/participationController.js';
import { createOrderController } from '../controllers/orderController.js';
import { createChatController } from '../controllers/chatController.js';
import { createAdminController } from '../controllers/adminController.js';
import { createAvatarController } from '../controllers/avatarController.js';
import { createGroupIdentityController } from '../controllers/groupIdentityController.js';
import { openStream } from '../services/realtime.js';
import { createGroupChannelController } from '../controllers/groupChannelController.js';
import { registerAccountSecurityRoutes } from './accountSecurity.js';
import { registerPushRoutes } from './push.js';
import { registerMeetupIntegrationRoutes } from './meetupIntegrations.js';

export function createRoutes({
  db,
  repos,
  matching,
  sessions,
  images,
  avatars = null,
  realtime = null,
  security = null,
  delivery = null,
  meetupIntegrations = null,
})  {
  const router = Router();
  const concerts = createConcertController(repos);
  const matches = createMatchController({ repos, matching });
  const users = createUserController(repos, sessions, avatars);
  const tickets = createTicketController(repos, images);
  const kaki = createKakiController(repos);
  const kakiChat = createKakiChatController(repos, realtime);
  const groupChannels = createGroupChannelController(repos, realtime);
  const avatar = avatars ? createAvatarController(repos, avatars) : null;
  const groupIdentity = createGroupIdentityController(repos, avatars);
  const profile = createProfileController(repos);
  const participation = createParticipationController(repos);
  const orders = createOrderController(repos);
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
  if (security) registerAccountSecurityRoutes(router, { security, sessions });
  if (delivery) registerPushRoutes(router, { delivery, requireUser });
  if (meetupIntegrations) registerMeetupIntegrationRoutes(router, { integrations: meetupIntegrations });
  const requireOperator = (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'authentication_required' });
    if (!req.user.is_operator) return res.status(403).json({ error: 'operator_required' });
    next();
  };

  router.get('/tickets', tickets.list);
  router.get('/tickets/:id', tickets.detail);
  router.post('/tickets', requireUser, tickets.create);
  router.patch('/tickets/:id', requireUser, tickets.update);
  router.delete('/tickets/:id', requireUser, tickets.delete);
  router.get('/me/tickets', requireUser, tickets.mine);
  router.post('/me/tickets/:id/proof', requireUser, tickets.submitProof);

  router.post('/tickets/:id/orders', requireUser, orders.buy);
  router.get('/orders/:id', requireUser, orders.get);

  router.post('/tickets/:id/conversations', requireUser, chat.start);
  router.get('/conversations', requireUser, chat.list);
  router.get('/conversations/:id', requireUser, chat.detail);
  router.post('/conversations/:id/messages', requireUser, chat.send);

  router.get('/operator/verifications', requireOperator, admin.queue);
  router.post('/operator/verifications/:id', requireOperator, admin.review);
  router.get('/operator/issued-tickets', requireOperator, admin.issuedSummary);
  router.post('/operator/concerts/:id/issued-tickets', requireOperator, admin.importIssued);

  router.get('/me/profile', requireUser, profile.get);
  router.patch('/me/profile', requireUser, profile.update);
  router.get('/me/concerts', requireUser, participation.mine);
  router.get('/concerts/:id/participation', requireUser, participation.get);
  router.post('/concerts/:id/participation', requireUser, participation.join);
  router.delete('/concerts/:id/participation', requireUser, participation.leave);

  router.get('/kaki/pool', requireUser, kaki.pool);
  // Ranked by the questionnaire; falls back to the filtered pool without one.
  router.get('/kaki/recommendations', requireUser, kaki.recommendations);
  router.get('/kaki/decisions', requireUser, kaki.decisions);
  router.put('/kaki/decisions/:concertId/:targetUserId', requireUser, kaki.setDecision);
  router.delete('/kaki/decisions/:concertId/:targetUserId', requireUser, kaki.deleteDecision);
  router.get('/kaki/matches', requireUser, kaki.matches);

  // ---- Kaki chat -----------------------------------------------------------
  // Only reachable between two people who liked each other for the same
  // concert, and only while neither has blocked the other. Every handler
  // re-checks; holding a conversation id grants nothing on its own.
  /**
   * Live updates, over Server-Sent Events.
   *
   * Events are addressed to the authenticated user by the server, so there is
   * nothing to subscribe to and no way to listen in on a thread you are not
   * part of. Registered before the other chat routes only for readability.
   */
  if (realtime) {
    router.get('/kaki/stream', requireUser, (req, res) => {
      const close = openStream(realtime, req, res, req.user.id,
        () => sessions.current(req)?.id === req.user.id);
      // Fires on tab close, navigation and network loss alike; without it the
      // heartbeat interval would keep a dead connection alive forever.
      req.on('close', close);
    });
  }

  router.get('/kaki/unread', requireUser, kakiChat.unread);
  router.get('/kaki/conversations', requireUser, kakiChat.list);
  router.get('/kaki/chat-backgrounds', requireUser, kakiChat.backgrounds);
  // Opening a thread is namespaced under the concert rather than sitting at
  // /kaki/conversations/:concertId/:userId — that shape also matches
  // /kaki/conversations/<id>/messages, so every send would have been routed
  // here instead.
  router.post('/kaki/concerts/:concertId/conversations/:userId', requireUser, kakiChat.start);
  router.get('/kaki/conversations/:id', requireUser, kakiChat.detail);
  router.post('/kaki/conversations/:id/messages', requireUser, kakiChat.send);
  router.patch('/kaki/conversations/:id/messages/:messageId', requireUser, kakiChat.edit);
  router.delete('/kaki/conversations/:id/messages/:messageId', requireUser, kakiChat.remove);

  /* ---- Group channels ---------------------------------------------------
   * The group's shared room. Listed before the :partyId routes so `unread`
   * is never read as a party id.
   */
  router.get('/group-channels/unread', requireUser, groupChannels.unread);
  router.get('/me/group-channels', requireUser, groupChannels.list);
  router.get('/group-channels/:partyId', requireUser, groupChannels.open);
  router.post('/group-channels/:partyId/read', requireUser, groupChannels.markRead);
  router.post('/group-channels/:partyId/messages', requireUser, groupChannels.send);
  router.delete('/group-channels/:partyId/messages/:messageId', requireUser, groupChannels.remove);
  router.get('/group-channels/:partyId/candidates', requireUser, groupChannels.candidates);
  router.post('/group-channels/:partyId/members', requireUser, groupChannels.addMember);
  router.delete('/group-channels/:partyId/members/me', requireUser, groupChannels.leave);
  router.put('/kaki/conversations/:id/background', requireUser, kakiChat.setBackground);
  router.post('/kaki/conversations/:id/read', requireUser, kakiChat.markRead);

  // Profile picture. Optional throughout — no picture is a valid state, not a
  // setup step to be completed.
  if (avatar) {
    router.put('/me/avatar', requireUser, avatar.set);
    router.delete('/me/avatar', requireUser, avatar.clear);
    router.put('/groups/:id/image', requireUser, groupIdentity.setImage);
    router.delete('/groups/:id/image', requireUser, groupIdentity.clearImage);
  }
  router.put('/groups/:id/name', requireUser, groupIdentity.setName);

  // Safety. Blocking is mutual in effect — it closes the thread for both
  // sides — but only the blocker can lift it.
  router.get('/me/blocked', requireUser, kakiChat.blockedList);
  router.put('/users/:userId/block', requireUser, kakiChat.block);
  router.delete('/users/:userId/block', requireUser, kakiChat.unblock);
  router.post('/users/:userId/reports', requireUser, kakiChat.report);

  router.get('/concerts', concerts.list);
  router.post('/concerts', concerts.create);
  router.get('/concerts/:id', concerts.detail);
  router.get('/concerts/:id/parties', concerts.parties);
  router.post('/concerts/:id/parties', requireUser, concerts.createParty);
  router.get('/concerts/:id/requests', concerts.requests);
  router.post('/concerts/:id/requests', requireUser, concerts.createRequest);

  router.get('/concerts/:id/match/preview', matches.preview);
  router.post('/concerts/:id/match', requireOperator, matches.run);
  router.get('/me/concerts/:id/result', requireUser, matches.myResult);
  router.get('/me/concerts/:id/matching', requireUser, matches.managedState);
  router.post('/me/concerts/:id/matching', requireUser, matches.matchManaged);
  router.delete('/me/concerts/:id/matching', requireUser, matches.leaveManaged);
  router.get('/rounds/:id', requireOperator, matches.round);
  router.get('/solvers', matches.solvers);
  router.get('/rounds/:id/trace', requireOperator, matches.trace);
  router.get('/rounds/:id/parties/:partyId', requireOperator, matches.roster);
  router.get('/rounds/:id/verify', requireOperator, matches.verify);
  router.get('/concerts/:id/explain/:requestId', requireOperator, matches.explain);

  router.post('/auth/register', users.register);
  router.post('/auth/login', users.login);
  router.get('/auth/me', requireUser, users.current);
  router.post('/auth/logout', requireUser, users.logout);
  router.get('/users/:id', users.get);

  registerEnhancementRoutes(router, { repos, requireUser });


  registerGroupDiscoveryRoutes(router, { repos, requireUser });
  registerCommunityRoutes(router, { repos, requireUser,requireOperator,db, weather: meetupIntegrations?.weather });
  return router;
}
