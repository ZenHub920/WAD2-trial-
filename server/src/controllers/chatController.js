/**
 * Buyer–seller chat. A conversation belongs to one ticket listing and its two people;
 * nobody else can read or post in it, and an outsider gets 404 rather than 403
 * so conversation ids cannot be probed.
 */

import { validateMessageBody } from '../db/messagePage.js';

export function createChatController(repos) {
  const participantOf = (conversation, userId) =>
    conversation &&
    (conversation.buyer_user_id === userId || conversation.seller_user_id === userId);

  return {
    /** Chat button on a listing: open (or reopen) the thread with its seller. */
    start(req, res) {
      const ticket = repos.tickets.findById(req.params.id);
      if (!ticket) return res.status(404).json({ error: 'listing_not_found' });
      if (ticket.seller_user_id === req.user.id) {
        return res.status(409).json({ error: 'cannot_chat_with_yourself' });
      }
      const conversation = repos.conversations.openFor({
        ticket_id: ticket.id,
        buyer_user_id: req.user.id,
        seller_user_id: ticket.seller_user_id,
      });
      res.status(201).json({ conversation: publicConversation(conversation, req.user.id) });
    },

    list(req, res) {
      res.json({
        conversations: repos.conversations.forUser(req.user.id)
          .map((c) => publicConversation(c, req.user.id)),
      });
    },

    detail(req, res) {
      const conversation = repos.conversations.findById(req.params.id);
      if (!participantOf(conversation, req.user.id)) {
        return res.status(404).json({ error: 'conversation_not_found' });
      }
      let paged;
      try { paged = repos.conversations.messagePage(conversation.id, req.query); }
      catch (error) {
        if (error.status) return res.status(error.status).json({ error: error.message });
        throw error;
      }
      const messages = paged.rows.map(publicMessage);
      const notificationsRead = repos.notifications.readConversation(req.user.id, `/chat/${conversation.id}`);
      res.json({
        notificationsRead,
        conversation: publicConversation(conversation, req.user.id),
        messages,
        page: paged.page,
      });
    },

    send(req, res) {
      const conversation = repos.conversations.findById(req.params.id);
      if (!participantOf(conversation, req.user.id)) {
        return res.status(404).json({ error: 'conversation_not_found' });
      }
      const { body, error } = validateMessageBody(req.body?.body);
      if (error) return res.status(400).json({ error });

      const message = repos.conversations.addMessage(conversation.id, req.user.id, body);
      res.status(201).json({ message: publicMessage(message) });
    },
  };
}

/** Shaped from the viewer's side: `other` is whoever they are talking to. */
function publicConversation(c, viewerId) {
  const viewerIsBuyer = c.buyer_user_id === viewerId;
  return {
    id: c.id,
    role: viewerIsBuyer ? 'buyer' : 'seller',
    other: {
      id: viewerIsBuyer ? c.seller_user_id : c.buyer_user_id,
      displayName: viewerIsBuyer ? c.seller_name : c.buyer_name,
    },
    listing: {
      id: c.ticket_id,
      title: `${c.concert_artist}, ${c.ticket_section}`,
      priceCents: c.ticket_price_cents,
      status: c.ticket_status,
    },
    lastMessage: c.last_body ? { body: c.last_body, createdAt: c.last_at } : null,
    createdAt: c.created_at,
  };
}

function publicMessage(m) {
  return { id: m.id, senderId: m.sender_user_id, body: m.body, createdAt: m.created_at };
}
