/**
 * Kaki chat — HTTP layer.
 *
 * Every endpoint re-checks the right to talk. A conversation id is not a
 * capability: holding one proves nothing, because the mutual like behind it
 * can be withdrawn and either person can block at any moment.
 *
 * NOT-FOUND OVER FORBIDDEN
 * ------------------------
 * A non-participant gets 404, never 403. 403 would confirm that the id names a
 * real conversation, which lets someone enumerate ids to learn who is talking
 * to whom. The same reasoning applies to messages inside a thread.
 *
 * WHAT A BLOCK DOES
 * -----------------
 * Either direction freezes the thread for BOTH sides: no sending, no editing,
 * no deleting, and the thread drops out of both listings. The blocked person
 * is not told they were blocked — the conversation simply stops being
 * available, the same as if the match had been withdrawn. Telling someone
 * invites retaliation, and is why `chatBarrier` collapses both causes into one
 * message for the person who did not act.
 */

import { publicUser } from './publicUser.js';

const MAX_BODY = 2000;

/** Backgrounds the client offers. Server-side allowlist, not a free text field. */
const BACKGROUNDS = ['default', 'dusk', 'neon', 'paper', 'forest', 'mono'];

const REPORT_CATEGORIES = ['harassment', 'misleading_profile', 'spam', 'other'];

export function createKakiChatController(repos, realtime = null) {
  const chat = repos.kakiChat;

  /** Push an event to both participants, when a realtime bus is wired up. */
  const push = (conversation, type, payload) => {
    for (const userId of [conversation.user_a_id, conversation.user_b_id]) {
      realtime?.emitTo([userId], type, typeof payload === 'function' ? payload(userId) : payload);
    }
  };

  /** The other participant's id, or null if the viewer is not in this thread. */
  const counterpartOf = (conversation, userId) => {
    if (!conversation) return null;
    if (conversation.user_a_id === userId) return conversation.user_b_id;
    if (conversation.user_b_id === userId) return conversation.user_a_id;
    return null;
  };

  /**
   * Load a conversation and confirm the caller may still use it.
   * Returns { conversation, other } or sends a response and returns null.
   */
  const open = (req, res) => {
    const conversation = chat.findById(req.params.id);
    const other = counterpartOf(conversation, req.user.id);
    if (!other) {
      res.status(404).json({ error: 'conversation_not_found' });
      return null;
    }
    if (!chat.canChat(req.user.id, other, conversation.concert_id)) {
      // Deliberately the same shape whether the cause is a block or an
      // un-matched pair, so neither reveals the other.
      res.status(403).json({ error: 'conversation_closed' });
      return null;
    }
    return { conversation, other };
  };

  return {
    /** Open (or reopen) the thread with a mutual match. */
    start(req, res) {
      const { concertId, userId } = req.params;
      if (userId === req.user.id) {
        return res.status(409).json({ error: 'cannot_chat_with_yourself' });
      }

      const barrier = chat.chatBarrier(req.user.id, userId, concertId);
      if (barrier === 'not_matched') {
        return res.status(403).json({ error: 'not_matched' });
      }
      if (barrier) {
        return res.status(403).json({ error: 'conversation_closed' });
      }

      const conversation = chat.openFor({ concertId, me: req.user.id, other: userId });
      res.status(201).json({
        conversation: shapeConversation(conversation, req.user.id, chat),
      });
    },

    list(req, res) {
      res.json({
        conversations: chat.forUser(req.user.id)
          // A thread survives in the listing only while the match does, so a
          // withdrawn like removes it exactly as a block does.
          .filter((c) => chat.canChat(
            req.user.id,
            c.user_a_id === req.user.id ? c.user_b_id : c.user_a_id,
            c.concert_id,
          ))
          .map((c) => shapeConversation(c, req.user.id, chat)),
      });
    },

    /**
     * Opening a thread marks it read. The other side is told immediately so
     * their ticks turn double without waiting for a poll.
     */
    detail(req, res) {
      const ctx = open(req, res);
      if (!ctx) return undefined;

      const before = chat.lastReadRowid(ctx.conversation.id, req.user.id);
      const after = chat.markReadToLatest(ctx.conversation.id, req.user.id);
      if (after > before) {
        push(ctx.conversation, 'read', {
          conversationId: ctx.conversation.id,
          readerId: req.user.id,
          lastReadSeq: after,
        });
      }

      const theirLastRead = chat.lastReadRowid(ctx.conversation.id, ctx.other);
      return res.json({
        conversation: shapeConversation(ctx.conversation, req.user.id, chat),
        messages: chat.messages(ctx.conversation.id)
          .map((m) => shapeMessage(m, req.user.id, theirLastRead)),
      });
    },

    /** Explicit read acknowledgement, for when the tab regains focus. */
    markRead(req, res) {
      const ctx = open(req, res);
      if (!ctx) return undefined;

      const before = chat.lastReadRowid(ctx.conversation.id, req.user.id);
      const after = chat.markReadToLatest(ctx.conversation.id, req.user.id);
      if (after > before) {
        push(ctx.conversation, 'read', {
          conversationId: ctx.conversation.id,
          readerId: req.user.id,
          lastReadSeq: after,
        });
      }
      return res.json({ lastReadSeq: after, unreadTotal: chat.unreadTotal(req.user.id) });
    },

    /** Badge count for the navbar. Cheap enough to call on every page load. */
    unread(req, res) {
      res.json({ total: chat.unreadTotal(req.user.id) });
    },

    send(req, res) {
      const ctx = open(req, res);
      if (!ctx) return undefined;

      const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
      if (!body) return res.status(400).json({ error: 'message_required' });
      if (body.length > MAX_BODY) return res.status(400).json({ error: 'message_too_long' });

      // A reply must point at a message in THIS thread, or a quote could be
      // used to surface text from a conversation the caller cannot read.
      const replyTo = typeof req.body?.replyTo === 'string' ? req.body.replyTo : null;
      if (replyTo && !chat.messageIsIn(replyTo, ctx.conversation.id)) {
        return res.status(400).json({ error: 'reply_target_invalid' });
      }

      const message = chat.addMessage(ctx.conversation.id, req.user.id, body, replyTo);

      // The sender has by definition read their own message, so advance their
      // marker too — otherwise sending would leave the thread looking unread.
      chat.markReadToLatest(ctx.conversation.id, req.user.id);

      const theirLastRead = chat.lastReadRowid(ctx.conversation.id, ctx.other);
      push(ctx.conversation, 'message', (viewerId) => ({
        conversationId: ctx.conversation.id,
        message: shapeMessage(message, viewerId,
          chat.lastReadRowid(ctx.conversation.id, viewerId === req.user.id ? ctx.other : req.user.id)),
        // Each recipient needs their own unread total, so the raw counts go
        // out and the client picks the one addressed to it.
        unreadFor: {
          [ctx.other]: chat.unreadTotal(ctx.other),
          [req.user.id]: chat.unreadTotal(req.user.id),
        },
      }));

      return res.status(201).json({ message: shapeMessage(message, req.user.id, theirLastRead) });
    },

    /** Edit own message only. Enforced in SQL as well as here. */
    edit(req, res) {
      const ctx = open(req, res);
      if (!ctx) return undefined;

      const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
      if (!body) return res.status(400).json({ error: 'message_required' });
      if (body.length > MAX_BODY) return res.status(400).json({ error: 'message_too_long' });

      const existing = chat.messageById(req.params.messageId);
      if (!existing || existing.conversation_id !== ctx.conversation.id) {
        return res.status(404).json({ error: 'message_not_found' });
      }
      if (existing.sender_user_id !== req.user.id) {
        return res.status(403).json({ error: 'not_your_message' });
      }
      if (existing.deleted_at) {
        return res.status(409).json({ error: 'message_deleted' });
      }

      chat.editMessage(req.params.messageId, req.user.id, body);
      const theirLastRead = chat.lastReadRowid(ctx.conversation.id, ctx.other);
      const message = chat.messages(ctx.conversation.id).find((m) => m.id === req.params.messageId);
      const updated = shapeMessage(message, req.user.id, theirLastRead);
      push(ctx.conversation, 'message-updated', (viewerId) => ({
        conversationId: ctx.conversation.id,
        message: shapeMessage(message, viewerId,
          chat.lastReadRowid(ctx.conversation.id, viewerId === req.user.id ? ctx.other : req.user.id)),
      }));
      return res.json({ message: updated });
    },

    /**
     * Delete own message only, and only as a tombstone. The text stays in the
     * database so a report filed afterwards still has its evidence; it is
     * never returned to either participant again.
     */
    remove(req, res) {
      const ctx = open(req, res);
      if (!ctx) return undefined;

      const existing = chat.messageById(req.params.messageId);
      if (!existing || existing.conversation_id !== ctx.conversation.id) {
        return res.status(404).json({ error: 'message_not_found' });
      }
      if (existing.sender_user_id !== req.user.id) {
        return res.status(403).json({ error: 'not_your_message' });
      }

      chat.deleteMessage(req.params.messageId, req.user.id);
      const theirLastRead = chat.lastReadRowid(ctx.conversation.id, ctx.other);
      const message = chat.messages(ctx.conversation.id).find((m) => m.id === req.params.messageId);
      const updated = shapeMessage(message, req.user.id, theirLastRead);
      push(ctx.conversation, 'message-updated', (viewerId) => ({
        conversationId: ctx.conversation.id,
        message: shapeMessage(message, viewerId,
          chat.lastReadRowid(ctx.conversation.id, viewerId === req.user.id ? ctx.other : req.user.id)),
      }));
      return res.json({ message: updated });
    },

    /** Chat background. Personal to the caller; the other side is unaffected. */
    setBackground(req, res) {
      const ctx = open(req, res);
      if (!ctx) return undefined;

      const background = req.body?.background;
      if (!BACKGROUNDS.includes(background)) {
        return res.status(400).json({ error: 'invalid_background', allowed: BACKGROUNDS });
      }
      chat.setBackground(ctx.conversation.id, req.user.id, background);
      return res.json({ background });
    },

    backgrounds(req, res) {
      res.json({ backgrounds: BACKGROUNDS });
    },

    // ---------------------------------------------------------------- blocks

    block(req, res) {
      if (req.params.userId === req.user.id) {
        return res.status(400).json({ error: 'cannot_block_yourself' });
      }
      if (!repos.users.findById(req.params.userId)) {
        return res.status(404).json({ error: 'user_not_found' });
      }
      chat.block(req.user.id, req.params.userId);
      // 200 rather than 201 even on a repeat: blocking is idempotent, and the
      // caller should not be able to tell whether it was already in place.
      return res.json({ blocked: true });
    },

    unblock(req, res) {
      chat.unblock(req.user.id, req.params.userId);
      return res.json({ blocked: false });
    },

    blockedList(req, res) {
      res.json({ blocked: chat.blockedBy(req.user.id) });
    },

    // --------------------------------------------------------------- reports

    /**
     * Report a user, optionally citing a conversation and a specific message.
     * Filing a report never tells the reported person anything.
     */
    report(req, res) {
      const reported = req.params.userId;
      if (reported === req.user.id) {
        return res.status(400).json({ error: 'cannot_report_yourself' });
      }
      if (!repos.users.findById(reported)) {
        return res.status(404).json({ error: 'user_not_found' });
      }

      const category = req.body?.category;
      if (!REPORT_CATEGORIES.includes(category)) {
        return res.status(400).json({ error: 'invalid_category', allowed: REPORT_CATEGORIES });
      }

      const details = typeof req.body?.details === 'string' ? req.body.details.trim() : '';
      if (!details) return res.status(400).json({ error: 'details_required' });
      if (details.length > 1000) return res.status(400).json({ error: 'details_too_long' });

      // Evidence is accepted only from a thread the reporter is actually in.
      let conversationId = null;
      let messageId = null;
      const cited = typeof req.body?.conversationId === 'string' ? req.body.conversationId : null;
      if (cited) {
        const conversation = chat.findById(cited);
        if (!conversation || counterpartOf(conversation, req.user.id) !== reported) {
          return res.status(404).json({ error: 'conversation_not_found' });
        }
        conversationId = conversation.id;

        const citedMessage = typeof req.body?.messageId === 'string' ? req.body.messageId : null;
        if (citedMessage) {
          if (!chat.messageIsIn(citedMessage, conversation.id)) {
            return res.status(400).json({ error: 'message_not_in_conversation' });
          }
          messageId = citedMessage;
        }
      }

      const id = chat.report({
        reporter: req.user.id,
        reported,
        category,
        details,
        conversationId,
        messageId,
      });

      // Reporting harassment and continuing to receive it is a bad outcome, so
      // a harassment report blocks the person as well. Said plainly in the
      // response so the reporter knows what just happened.
      let alsoBlocked = false;
      if (category === 'harassment') {
        chat.block(req.user.id, reported);
        alsoBlocked = true;
      }

      return res.status(201).json({ reportId: id, blocked: alsoBlocked });
    },
  };
}

/** Shaped from the viewer's side: `other` is whoever they are talking to. */
function shapeConversation(c, viewerId, chat) {
  const viewerIsA = c.user_a_id === viewerId;
  return {
    id: c.id,
    // Echoed so the client can tell its own bubbles from theirs without
    // inferring it from the message list — which fails on an empty thread.
    me: viewerId,
    concert: {
      id: c.concert_id,
      artist: c.concert_artist ?? null,
      eventDate: c.concert_date ?? null,
    },
    other: {
      id: viewerIsA ? c.user_b_id : c.user_a_id,
      displayName: viewerIsA ? c.user_b_name : c.user_a_name,
      avatarUrl: avatarUrl(viewerIsA ? c.user_b_avatar : c.user_a_avatar),
    },
    background: chat.background(c.id, viewerId),
    lastMessage: c.last_at
      ? {
          body: c.last_deleted_at ? null : c.last_body,
          deleted: Boolean(c.last_deleted_at),
          createdAt: c.last_at,
          mine: c.last_sender_id === viewerId,
        }
      : null,
    // Present on the list query; absent on a single findById, where the
    // caller is opening the thread and is about to mark it read anyway.
    unread: c.unread_count ?? 0,
    messageCount: c.message_count ?? 0,
    createdAt: c.created_at,
  };
}

/** A stored filename becomes a served path; no picture stays null. */
export function avatarUrl(path) {
  return path ? `/api/avatars/${path}` : null;
}

/**
 * A deleted message keeps its position and authorship so the thread still
 * reads coherently, but carries no text — the tombstone is all the client gets.
 */
function shapeMessage(m, viewerId = null, otherLastReadSeq = 0) {
  if (!m) return null;
  const deleted = Boolean(m.deleted_at);
  const mine = viewerId !== null && m.sender_user_id === viewerId;
  return {
    id: m.id,
    seq: m.seq,
    senderId: m.sender_user_id,
    body: deleted ? null : m.body,
    deleted,
    edited: Boolean(m.edited_at) && !deleted,
    createdAt: m.created_at,
    editedAt: deleted ? null : m.edited_at,
    /**
     * Tick state, and only ever on your OWN messages — showing a read receipt
     * on someone else's message would be telling them what you have read.
     *   'sent' → one tick, it is stored
     *   'read' → two ticks, the other person's read marker has passed it
     */
    status: mine ? (m.seq <= otherLastReadSeq ? 'read' : 'sent') : null,
    replyTo: m.reply_to_message_id
      ? {
          id: m.reply_to_message_id,
          senderId: m.reply_sender_id ?? null,
          body: m.reply_deleted_at ? null : m.reply_body,
          deleted: Boolean(m.reply_deleted_at),
        }
      : null,
  };
}

export { publicUser };
