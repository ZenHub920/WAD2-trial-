/**
 * Buyer–seller chat. A conversation belongs to one ticket listing and its two people;
 * nobody else can read or post in it, and an outsider gets 404 rather than 403
 * so conversation ids cannot be probed.
 */

const MAX_BODY = 2000;

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
      const after = typeof req.query.after === 'string' ? req.query.after : null;
      const messages = repos.conversations.messages(conversation.id, after).map(publicMessage);
      const notificationsRead = repos.notifications.readConversation(req.user.id, `/chat/${conversation.id}`);
      res.json({
        notificationsRead,
        conversation: publicConversation(conversation, req.user.id),
        messages,
      });
    },

    send(req, res) {
      const conversation = repos.conversations.findById(req.params.id);
      if (!participantOf(conversation, req.user.id)) {
        return res.status(404).json({ error: 'conversation_not_found' });
      }
      const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
      if (!body) return res.status(400).json({ error: 'message_required' });
      if (body.length > MAX_BODY) return res.status(400).json({ error: 'message_too_long' });

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
