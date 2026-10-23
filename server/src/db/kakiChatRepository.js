/**
 * Kaki chat — data access.
 *
 * Distinct from the buyer–seller chat in repositories.js (`repos.conversations`,
 * backed by ticket_conversations/ticket_messages). This one backs the
 * conversations/messages tables and serves the Kaki Finder, where the right to
 * talk comes from a mutual like rather than from a listing.
 *
 * THE GATE
 * --------
 * A pair may use a conversation only while all three hold:
 *
 *   1. mutual 'like' in kaki_decisions for that concert, and
 *   2. neither has blocked the other.
 *   3. neither person's current hard dealbreakers exclude the other.
 *
 * The gate is re-evaluated on every read and every write, not just when the
 * conversation is created. That matters: a block placed after matching, or a
 * like withdrawn later, has to close the thread immediately. Checking only at
 * creation would leave a permanent channel that neither person can shut.
 *
 * Conversations are keyed (concert_id, user_a_id, user_b_id) with a
 * `user_a_id < user_b_id` constraint, so the pair has exactly one thread per
 * concert no matter who opens it first.
 */

import { randomUUID } from 'node:crypto';
import { readMessagePage } from './messagePage.js';
import { createKakiPreferenceGate } from '../services/kakiPreferenceGate.js';

/** The two ids in the canonical order the table's CHECK constraint requires. */
function ordered(x, y) {
  return x < y ? [x, y] : [y, x];
}

/** SQL fragment: the two users mutually liked each other for this concert. */
const MUTUAL = `(
  EXISTS (SELECT 1 FROM kaki_decisions d
          WHERE d.concert_id = @concert AND d.actor_user_id = @me
            AND d.target_user_id = @other AND d.decision = 'like')
  AND
  EXISTS (SELECT 1 FROM kaki_decisions d
          WHERE d.concert_id = @concert AND d.actor_user_id = @other
            AND d.target_user_id = @me AND d.decision = 'like')
  AND EXISTS (SELECT 1 FROM concert_participants p
              WHERE p.concert_id = @concert AND p.user_id = @me AND p.status = 'joined')
  AND EXISTS (SELECT 1 FROM concert_participants p
              WHERE p.concert_id = @concert AND p.user_id = @other AND p.status = 'joined')
)`;

/** SQL fragment: neither has blocked the other, in either direction. */
const NOT_BLOCKED = `(
  NOT EXISTS (SELECT 1 FROM blocks b
              WHERE (b.blocker_user_id = @me AND b.blocked_user_id = @other)
                 OR (b.blocker_user_id = @other AND b.blocked_user_id = @me))
)`;

export function createKakiChatRepo(db) {
  const preferenceEligible = createKakiPreferenceGate(db);
  const mutualAndOpen = db.prepare(`SELECT 1 AS ok WHERE ${MUTUAL} AND ${NOT_BLOCKED}`);
  const mutualOnly = db.prepare(`SELECT 1 AS ok WHERE ${MUTUAL}`);
  const blockedEitherWay = db.prepare(`SELECT 1 AS ok WHERE NOT ${NOT_BLOCKED}`);
  const canChat = (me, other, concert) => Boolean(mutualAndOpen.get({ me, other, concert })?.ok)
    && preferenceEligible(me, other);

  const findPair = db.prepare(`
    SELECT * FROM conversations
    WHERE concert_id = @concert AND user_a_id = @a AND user_b_id = @b
  `);

  const insertConversation = db.prepare(`
    INSERT INTO conversations (id, concert_id, user_a_id, user_b_id)
    VALUES (@id, @concert, @a, @b)
  `);

  const findById = db.prepare(`
    SELECT c.*,
           ua.display_name AS user_a_name,
           ub.display_name AS user_b_name,
           ua.avatar_path AS user_a_avatar,
           ub.avatar_path AS user_b_avatar,
           ct.artist AS concert_artist,
           ct.event_date AS concert_date
    FROM conversations c
    JOIN users ua ON ua.id = c.user_a_id
    JOIN users ub ON ub.id = c.user_b_id
    JOIN concerts ct ON ct.id = c.concert_id
    WHERE c.id = ?
  `);

  /**
   * Threads for one user. Blocked pairs are filtered out entirely rather than
   * listed as disabled — a blocked person should disappear, not linger as a
   * greyed-out row that keeps reminding you they exist.
   */
  const listForUser = db.prepare(`
    SELECT c.*,
           ua.display_name AS user_a_name,
           ub.display_name AS user_b_name,
           ua.avatar_path AS user_a_avatar,
           ub.avatar_path AS user_b_avatar,
           ct.artist AS concert_artist,
           ct.event_date AS concert_date,
           last.body AS last_body,
           last.created_at AS last_at,
           last.deleted_at AS last_deleted_at,
           last.sender_user_id AS last_sender_id,
           (SELECT COUNT(*) FROM messages m
            WHERE m.conversation_id = c.id AND m.deleted_at IS NULL) AS message_count,
           (SELECT COUNT(*) FROM messages m
            WHERE m.conversation_id = c.id
              AND m.sender_user_id <> @me
              AND m.rowid > COALESCE((SELECT last_read_rowid FROM conversation_reads
                                      WHERE conversation_id = c.id AND user_id = @me), 0)
           ) AS unread_count
    FROM conversations c
    JOIN users ua ON ua.id = c.user_a_id
    JOIN users ub ON ub.id = c.user_b_id
    JOIN concerts ct ON ct.id = c.concert_id
    LEFT JOIN messages last ON last.id = (
      SELECT m2.id FROM messages m2
      WHERE m2.conversation_id = c.id
      -- Same reasoning as listMessages: rowid, not id.
      ORDER BY m2.created_at DESC, m2.rowid DESC LIMIT 1
    )
    WHERE (c.user_a_id = @me OR c.user_b_id = @me)
      AND NOT EXISTS (
        SELECT 1 FROM blocks b
        WHERE (b.blocker_user_id = @me
               AND b.blocked_user_id = CASE WHEN c.user_a_id = @me THEN c.user_b_id ELSE c.user_a_id END)
           OR (b.blocked_user_id = @me
               AND b.blocker_user_id = CASE WHEN c.user_a_id = @me THEN c.user_b_id ELSE c.user_a_id END)
      )
    ORDER BY COALESCE(last.created_at, c.created_at) DESC
  `);

  /**
   * Messages, newest last. The body of a deleted message is NOT selected —
   * the tombstone is built from deleted_at alone, so a deleted message cannot
   * leak through the API even if a caller forgets to mask it.
   */
  const MESSAGE_ROWS = `
    SELECT m.id, m.conversation_id, m.sender_user_id, m.created_at,
           m.edited_at, m.deleted_at, m.reply_to_message_id,
           m.rowid AS seq,
           CASE WHEN m.deleted_at IS NULL THEN m.body ELSE NULL END AS body,
           r.sender_user_id AS reply_sender_id,
           CASE WHEN r.deleted_at IS NULL THEN r.body ELSE NULL END AS reply_body,
           r.deleted_at AS reply_deleted_at
    FROM messages m
    LEFT JOIN messages r ON r.id = m.reply_to_message_id
  `;
  const listMessages = db.prepare(`
    ${MESSAGE_ROWS}
    WHERE m.conversation_id = ?
    -- Tie-break on rowid, NOT on id. created_at is datetime('now'), which has
    -- one-second granularity, so a burst of messages shares a timestamp — and
    -- ids are random UUIDs, so ordering by them scrambles the thread. rowid is
    -- monotonic in insertion order, which is exactly what a transcript needs.
    ORDER BY m.created_at ASC, m.rowid ASC
  `);

  const insertMessage = db.prepare(`
    INSERT INTO messages (id, conversation_id, sender_user_id, body, reply_to_message_id)
    VALUES (@id, @conversation, @sender, @body, @replyTo)
  `);

  const messageById = db.prepare(`${MESSAGE_ROWS} WHERE m.id = ?`);

  const inConversation = db.prepare(
    'SELECT 1 AS ok FROM messages WHERE id = ? AND conversation_id = ?',
  );

  const updateBody = db.prepare(`
    UPDATE messages SET body = @body, edited_at = datetime('now')
    WHERE id = @id AND sender_user_id = @sender AND deleted_at IS NULL
  `);

  const softDelete = db.prepare(`
    UPDATE messages SET deleted_at = datetime('now')
    WHERE id = @id AND sender_user_id = @sender AND deleted_at IS NULL
  `);

  const readSettings = db.prepare(
    'SELECT background FROM conversation_settings WHERE conversation_id = ? AND user_id = ?',
  );

  const upsertSettings = db.prepare(`
    INSERT INTO conversation_settings (conversation_id, user_id, background, updated_at)
    VALUES (@conversation, @user, @background, datetime('now'))
    ON CONFLICT (conversation_id, user_id)
    DO UPDATE SET background = excluded.background, updated_at = datetime('now')
  `);

  const insertBlock = db.prepare(`
    INSERT INTO blocks (blocker_user_id, blocked_user_id) VALUES (?, ?)
    ON CONFLICT (blocker_user_id, blocked_user_id) DO NOTHING
  `);

  const removeBlock = db.prepare(
    'DELETE FROM blocks WHERE blocker_user_id = ? AND blocked_user_id = ?',
  );

  const listBlocked = db.prepare(`
    SELECT b.blocked_user_id AS id, u.display_name AS displayName, b.created_at AS blockedAt
    FROM blocks b JOIN users u ON u.id = b.blocked_user_id
    WHERE b.blocker_user_id = ? ORDER BY b.created_at DESC
  `);

  // ---- read state --------------------------------------------------------

  const readRow = db.prepare(
    'SELECT last_read_rowid FROM conversation_reads WHERE conversation_id = ? AND user_id = ?',
  );

  /**
   * Advance the read marker. GREATEST-style guard via `MAX`: a late-arriving
   * request from an older tab must never pull the marker backwards and
   * resurrect messages as unread.
   */
  const markRead = db.prepare(`
    INSERT INTO conversation_reads (conversation_id, user_id, last_read_rowid, updated_at)
    VALUES (@conversation, @user, @rowid, datetime('now'))
    ON CONFLICT (conversation_id, user_id)
    DO UPDATE SET last_read_rowid = MAX(last_read_rowid, excluded.last_read_rowid),
                  updated_at = datetime('now')
  `);

  const latestRowid = db.prepare(
    'SELECT COALESCE(MAX(rowid), 0) AS seq FROM messages WHERE conversation_id = ?',
  );

  /** Messages the viewer has not seen. Their own never count as unread. */
  const unreadCount = db.prepare(`
    SELECT COUNT(*) AS n FROM messages m
    WHERE m.conversation_id = @conversation
      AND m.sender_user_id <> @user
      AND m.rowid > COALESCE(
        (SELECT last_read_rowid FROM conversation_reads
         WHERE conversation_id = @conversation AND user_id = @user), 0)
  `);

  /**
   * How many PEOPLE are waiting on a reply — not how many messages they sent.
   * Ten messages from one person is one thing to deal with, and counting them
   * individually made the nav badge disagree with the notification bell, which
   * raises one notification per conversation.
   */
  const unreadTotal = db.prepare(`
    SELECT DISTINCT c.id,c.user_a_id,c.user_b_id
    FROM messages m
    JOIN conversations c ON c.id = m.conversation_id
    WHERE (c.user_a_id = @user OR c.user_b_id = @user)
      AND m.sender_user_id <> @user
      AND m.rowid > COALESCE(
        (SELECT last_read_rowid FROM conversation_reads
         WHERE conversation_id = c.id AND user_id = @user), 0)
      AND EXISTS (SELECT 1 FROM kaki_decisions d
                  WHERE d.concert_id = c.concert_id AND d.actor_user_id = c.user_a_id
                    AND d.target_user_id = c.user_b_id AND d.decision = 'like')
      AND EXISTS (SELECT 1 FROM kaki_decisions d
                  WHERE d.concert_id = c.concert_id AND d.actor_user_id = c.user_b_id
                    AND d.target_user_id = c.user_a_id AND d.decision = 'like')
      AND EXISTS (SELECT 1 FROM concert_participants p
                  WHERE p.concert_id = c.concert_id AND p.user_id = c.user_a_id AND p.status = 'joined')
      AND EXISTS (SELECT 1 FROM concert_participants p
                  WHERE p.concert_id = c.concert_id AND p.user_id = c.user_b_id AND p.status = 'joined')
      AND NOT EXISTS (
        SELECT 1 FROM blocks b
        WHERE (b.blocker_user_id = @user
               AND b.blocked_user_id = CASE WHEN c.user_a_id = @user THEN c.user_b_id ELSE c.user_a_id END)
           OR (b.blocked_user_id = @user
               AND b.blocker_user_id = CASE WHEN c.user_a_id = @user THEN c.user_b_id ELSE c.user_a_id END)
      )
  `);

  const insertReport = db.prepare(`
    INSERT INTO reports (id, reporter_user_id, reported_user_id, reason_category,
                         details, conversation_id, message_id)
    VALUES (@id, @reporter, @reported, @category, @details, @conversation, @message)
  `);

  return {
    /** Mutual like AND not blocked — the full right to talk. */
    canChat(me, other, concert) {
      return canChat(me, other, concert);
    },

    /**
     * Why a pair cannot chat, for an honest error message. Distinguishes
     * "you never matched" from "someone blocked" WITHOUT revealing which
     * side blocked, since telling someone they were blocked invites
     * retaliation.
     */
    chatBarrier(me, other, concert) {
      if (blockedEitherWay.get({ me, other })?.ok) return 'blocked';
      if (!mutualOnly.get({ me, other, concert })?.ok) return 'not_matched';
      if (!preferenceEligible(me, other)) return 'preferences_changed';
      return null;
    },

    /** Idempotent: the pair gets one thread per concert, whoever opens it. */
    openFor({ concertId, me, other }) {
      if (!canChat(me, other, concertId)) throw Object.assign(new Error('conversation_closed'), { status: 403 });
      const [a, b] = ordered(me, other);
      const existing = findPair.get({ concert: concertId, a, b });
      if (existing) return findById.get(existing.id);

      const id = `kc_${randomUUID().slice(0, 12)}`;
      insertConversation.run({ id, concert: concertId, a, b });
      return findById.get(id);
    },

    findById: (id) => findById.get(id),
    forUser: (me) => listForUser.all({ me }).filter((c) => preferenceEligible(c.user_a_id, c.user_b_id)),
    messages: (conversationId) => listMessages.all(conversationId),
    messagePage(conversationId, options) {
      const { rows, page } = readMessagePage(db, 'kaki', conversationId, options);
      return { rows: rows.map((m) => messageById.get(m.id)), page };
    },

    addMessage(conversationId, senderId, body, replyTo = null) {
      const conversation = findById.get(conversationId);
      const other = conversation?.user_a_id === senderId ? conversation.user_b_id
        : conversation?.user_b_id === senderId ? conversation.user_a_id : null;
      if (!other || !canChat(senderId, other, conversation.concert_id))
        throw Object.assign(new Error('conversation_closed'), { status: 403 });
      const id = `km_${randomUUID().slice(0, 12)}`;
      insertMessage.run({
        id, conversation: conversationId, sender: senderId, body, replyTo,
      });
      return messageById.get(id);
    },

    messageById: (id) => messageById.get(id),
    messageIsIn: (messageId, conversationId) =>
      Boolean(inConversation.get(messageId, conversationId)?.ok),

    /** Returns false when the message is not the caller's, or already deleted. */
    editMessage(id, senderId, body) {
      return updateBody.run({ id, sender: senderId, body }).changes > 0;
    },

    deleteMessage(id, senderId) {
      return softDelete.run({ id, sender: senderId }).changes > 0;
    },

    // ---- read state ------------------------------------------------------

    lastReadRowid: (conversationId, userId) =>
      readRow.get(conversationId, userId)?.last_read_rowid ?? 0,

    /** Mark everything currently in the thread as read by this user. */
    markReadToLatest(conversationId, userId) {
      const seq = latestRowid.get(conversationId).seq;
      markRead.run({ conversation: conversationId, user: userId, rowid: seq });
      return seq;
    },

    unread: (conversationId, userId) =>
      unreadCount.get({ conversation: conversationId, user: userId }).n,

    unreadTotal: (userId) => unreadTotal.all({ user: userId })
      .filter((c) => preferenceEligible(c.user_a_id, c.user_b_id)).length,

    background: (conversationId, userId) =>
      readSettings.get(conversationId, userId)?.background ?? 'default',

    setBackground(conversationId, userId, background) {
      upsertSettings.run({ conversation: conversationId, user: userId, background });
      return background;
    },

    block: (me, other) => insertBlock.run(me, other).changes > 0,
    unblock: (me, other) => removeBlock.run(me, other).changes > 0,
    blockedBy: (me) => listBlocked.all(me),

    report({ reporter, reported, category, details, conversationId = null, messageId = null }) {
      const id = `rp_${randomUUID().slice(0, 12)}`;
      insertReport.run({
        id, reporter, reported, category, details,
        conversation: conversationId, message: messageId,
      });
      return id;
    },
  };
}
