import { randomUUID } from 'node:crypto';
import { readMessagePage } from './messagePage.js';

export function createConversationRepo(db) {
  const SUMMARY = `
    SELECT cv.*,
           c.artist AS concert_artist, t.section AS ticket_section,
           t.price_cents AS ticket_price_cents, t.status AS ticket_status,
           b.display_name AS buyer_name, s.display_name AS seller_name,
           (SELECT body FROM ticket_messages m WHERE m.conversation_id = cv.id
             ORDER BY m.created_at DESC, m.rowid DESC LIMIT 1) AS last_body,
           (SELECT created_at FROM ticket_messages m WHERE m.conversation_id = cv.id
             ORDER BY m.created_at DESC, m.rowid DESC LIMIT 1) AS last_at
    FROM ticket_conversations cv
    JOIN tickets t ON t.id = cv.ticket_id
    JOIN concerts c ON c.id = t.concert_id
    JOIN users b ON b.id = cv.buyer_user_id
    JOIN users s ON s.id = cv.seller_user_id
  `;

  return {
    /** Reopen the buyer's thread about this ticket, or start one. */
    openFor({ ticket_id, buyer_user_id, seller_user_id }) {
      db.prepare(`
        INSERT OR IGNORE INTO ticket_conversations (id, ticket_id, buyer_user_id, seller_user_id)
        VALUES (?, ?, ?, ?)
      `).run(`cv_${randomUUID().slice(0, 8)}`, ticket_id, buyer_user_id, seller_user_id);
      return db.prepare(`${SUMMARY} WHERE cv.ticket_id = ? AND cv.buyer_user_id = ?`)
        .get(ticket_id, buyer_user_id);
    },

    findById(id) {
      return db.prepare(`${SUMMARY} WHERE cv.id = ?`).get(id) ?? null;
    },

    /** The user's threads on either side, most recently active first. */
    forUser(userId) {
      return db.prepare(`
        ${SUMMARY}
        WHERE cv.buyer_user_id = @u OR cv.seller_user_id = @u
        ORDER BY COALESCE(last_at, cv.created_at) DESC
      `).all({ u: userId });
    },

    /** Thread-scoped cursor pagination shared with the other chat repositories. */
    messagePage(conversationId, options) { return readMessagePage(db, 'market', conversationId, options); },

    addMessage(conversationId, senderUserId, body) {
      const id = `m_${randomUUID().slice(0, 8)}`;
      db.prepare('INSERT INTO ticket_messages (id, conversation_id, sender_user_id, body) VALUES (?, ?, ?, ?)')
        .run(id, conversationId, senderUserId, body);
      return db.prepare('SELECT * FROM ticket_messages WHERE id = ?').get(id);
    },
  };
}
