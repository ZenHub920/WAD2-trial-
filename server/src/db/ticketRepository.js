import { randomUUID } from 'node:crypto';
import { mapUser, prefixed, USER_COLUMNS } from './rowMappers.js';

function mapTicket(row) {
  if (!row) return null;
  return {
    id: row.id,
    seller_user_id: row.seller_user_id,
    concert: {
      id: row.concert_id, artist: row.artist, venue: row.venue,
      city: row.city, event_date: row.event_date,
    },
    seller: mapUser(prefixed(row, 'seller_')),
    priceCents: row.price_cents,
    quantity: row.quantity,
    section: row.section,
    description: row.description,
    imageUrl: row.image_path ? `/api/ticket-images/${row.image_path}` : null,
    status: row.status,
    createdAt: row.created_at,
    verified: Boolean(row.verified),
    image_path: row.image_path,
    // Private to the seller and operators; the ticket controller strips it from public views.
    verification: {
      status: row.verification_status ?? 'none',
      method: row.verification_method ?? null,
      note: row.review_note ?? null,
      reviewedAt: row.reviewed_at ?? null,
      hasProof: Boolean(row.has_proof),
    },
  };
}

export function createTicketRepo(db) {
  // Explicit columns so a proof-of-purchase upload is never dragged through list queries.
  const joined = `
    SELECT t.id, t.seller_user_id, t.concert_id, t.price_cents, t.quantity, t.section,
           t.description, t.image_path, t.status, t.created_at, t.verified,
           t.verification_status, t.verification_method, t.review_note, t.reviewed_at,
           (t.proof_data IS NOT NULL) AS has_proof,
           c.artist, c.venue, c.city, c.event_date,
           ${USER_COLUMNS('u', 'seller_')}
    FROM tickets t
    JOIN users u ON u.id = t.seller_user_id
    JOIN concerts c ON c.id = t.concert_id
  `;
  const get = db.prepare(`${joined} WHERE t.id = ? AND t.status <> 'deleted'`);

  return {
    /** List a ticket against an existing concert (`concertId`) or a new one (`concert`). */
    create({
      seller_user_id, concert, concertId: existingConcertId, priceCents, quantity, section,
      description, image_path, proof_data = null, verified = false, created_at = null,
    }) {
      const id = `t_${randomUUID()}`;
      db.transaction(() => {
        let concertId = existingConcertId;
        if (!concertId) {
          concertId = `c_${randomUUID()}`;
          db.prepare(`INSERT INTO concerts (id, artist, venue, city, event_date)
                      VALUES (?, ?, ?, ?, ?)`)
            .run(concertId, concert.artist, concert.venue, concert.city ?? 'Singapore', concert.event_date);
        }
        db.prepare(`INSERT INTO tickets
                    (id, seller_user_id, concert_id, price_cents, quantity, section, description, image_path,
                     verified, verification_status, verification_method, proof_data, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))`)
          .run(id, seller_user_id, concertId, priceCents, quantity, section, description, image_path,
            verified ? 1 : 0,
            verified ? 'approved' : proof_data ? 'pending' : null,
            verified ? 'proof' : null,
            proof_data, created_at);
      })();
      return this.findById(id);
    },

    /**
     * Seller submits (or replaces) proof of purchase. Re-submitting after a rejection
     * puts it back in the queue; an approved ticket cannot be re-opened this way.
     */
    submitProof(id, sellerId, proofData) {
      return db.prepare(`
        UPDATE tickets
        SET proof_data = ?, verification_status = 'pending', review_note = NULL,
            reviewed_by = NULL, reviewed_at = NULL
        WHERE id = ? AND seller_user_id = ? AND status = 'active'
          AND COALESCE(verification_status, '') != 'approved'
      `).run(proofData, id, sellerId).changes === 1;
    },

    /** Pending proofs, oldest first, so review happens in submission order. */
    pendingVerification() {
      return db.prepare(`${joined} WHERE t.verification_status = 'pending' AND t.status = 'active'
        ORDER BY t.created_at ASC`).all().map(mapTicket);
    },

    proofFor(id) {
      return db.prepare('SELECT proof_data FROM tickets WHERE id = ?').get(id)?.proof_data ?? null;
    },

    /** Operator decision. Only a pending ticket can be decided, so two operators cannot both act. */
    review(id, { approve, note, reviewerId }) {
      return db.prepare(`
        UPDATE tickets
        SET verification_status = @status, verified = @verified, review_note = @note,
            verification_method = CASE WHEN @verified = 1 THEN 'proof' ELSE NULL END,
            reviewed_by = @reviewerId, reviewed_at = datetime('now')
        WHERE id = @id AND verification_status = 'pending' AND status = 'active'
      `).run({
        id,
        status: approve ? 'approved' : 'rejected',
        verified: approve ? 1 : 0,
        note: approve ? null : note,
        reviewerId,
      }).changes === 1;
    },
    findById(id) {
      return mapTicket(get.get(id));
    },
    list() {
      return db.prepare(`${joined} WHERE t.status = 'active' ORDER BY t.created_at DESC, t.id DESC`)
        .all().map(mapTicket);
    },
    forSeller(userId) {
      return db.prepare(`${joined} WHERE t.seller_user_id = ? AND t.status <> 'deleted'
        ORDER BY t.created_at DESC, t.id DESC`).all(userId).map(mapTicket);
    },
    updateOwned(id, sellerId, fields) {
      return db.transaction(() => {
        const current = this.findById(id);
        if (!current || current.seller_user_id !== sellerId || current.status !== 'active') return null;
        const reviewChanged = fields.section !== current.section || fields.quantity !== current.quantity;
        const result = db.prepare(`UPDATE tickets
          SET price_cents = @priceCents, quantity = @quantity, section = @section,
              description = @description, image_path = @image_path,
              verified = CASE WHEN @reviewChanged THEN 0 ELSE verified END,
              verification_status = CASE WHEN @reviewChanged
                THEN CASE WHEN proof_data IS NOT NULL THEN 'pending' ELSE NULL END ELSE verification_status END,
              verification_method = CASE WHEN @reviewChanged THEN NULL ELSE verification_method END,
              review_note = CASE WHEN @reviewChanged THEN NULL ELSE review_note END,
              reviewed_by = CASE WHEN @reviewChanged THEN NULL ELSE reviewed_by END,
              reviewed_at = CASE WHEN @reviewChanged THEN NULL ELSE reviewed_at END
          WHERE id = @id AND seller_user_id = @sellerId AND status = 'active'`)
          .run({ ...fields, reviewChanged: reviewChanged ? 1 : 0, id, sellerId });
        return result.changes ? this.findById(id) : null;
      })();
    },
    deleteOwned(id, sellerId) {
      const result = db.prepare(`UPDATE tickets SET status = 'deleted'
        WHERE id = ? AND seller_user_id = ? AND status = 'active'`).run(id, sellerId);
      return result.changes > 0;
    },
  };
}

export function createOrderRepo(db) {
  const findById = (id) => db.prepare('SELECT * FROM orders WHERE id = ?').get(id) ?? null;


  return { findById };
}
