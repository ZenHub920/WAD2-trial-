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

function marketError(code, detail) {
  return Object.assign(new Error(code), { code, detail });
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

  const numberOnActiveTicket = db.prepare(`
    SELECT 1 FROM ticket_numbers n JOIN tickets t ON t.id = n.ticket_id
    WHERE n.concert_id = ? AND n.ticket_number = ? AND t.status = 'active' AND t.id <> ?
  `);
  const lastBuyer = db.prepare(`
    SELECT o.buyer_user_id FROM ticket_numbers n JOIN orders o ON o.ticket_id = n.ticket_id
    WHERE n.concert_id = ? AND n.ticket_number = ? AND o.status = 'paid'
    ORDER BY o.created_at DESC, o.rowid DESC LIMIT 1
  `);
  const issuedCount = db.prepare('SELECT COUNT(*) AS n FROM issued_tickets WHERE concert_id = ?');
  const issued = db.prepare('SELECT category FROM issued_tickets WHERE concert_id = ? AND ticket_number = ?');

  /**
   * Check a listing's ticket numbers; returns whether they matched the issued list,
   * or throws a market error naming the offending number.
   *  - every number must be distinct and not on another active listing (no double-selling);
   *  - if the concert has an issued list, every number must be on it, in the same
   *    section when the list records one — and then the ticket is verified outright.
   */
  function checkNumbers(concertId, section, numbers, sellerId, excludeId = '') {
    const seen = new Set();
    for (const number of numbers) {
      if (seen.has(number)) throw marketError('duplicate_ticket_number', number);
      seen.add(number);
      if (numberOnActiveTicket.get(concertId, number, excludeId)) throw marketError('ticket_number_already_listed', number);
      const buyer = lastBuyer.get(concertId, number);
      if (buyer && buyer.buyer_user_id !== sellerId) throw marketError('ticket_number_not_owned', number);
    }
    if (!numbers.length || issuedCount.get(concertId).n === 0) return false;
    for (const number of numbers) {
      const row = issued.get(concertId, number);
      if (!row) throw marketError('ticket_number_not_issued', number);
      if (row.category && row.category.toLowerCase() !== section.trim().toLowerCase()) {
        throw marketError('ticket_category_mismatch', number);
      }
    }
    return true;
  }

  return {
    /**
     * List a ticket against an existing concert (`concertId`) or a new one (`concert`).
     * Only an existing concert can have an issued list, so only it can auto-verify.
     */
    create({
      seller_user_id, concert, concertId: existingConcertId, priceCents, quantity, section,
      description, image_path, ticket_numbers = [], proof_data = null, verified: seededVerified = false,
      created_at = null,
    }) {
      const id = `t_${randomUUID()}`;
      const numbers = ticket_numbers.map(normalizeTicketNumber);
      db.transaction(() => {
        let concertId = existingConcertId;
        if (!concertId) {
          concertId = `c_${randomUUID()}`;
          db.prepare(`INSERT INTO concerts (id, artist, venue, city, event_date)
                      VALUES (?, ?, ?, ?, ?)`)
            .run(concertId, concert.artist, concert.venue, concert.city ?? 'Singapore', concert.event_date);
        }
        const matched = checkNumbers(concertId, section, numbers, seller_user_id);
        const verified = matched || seededVerified;
        db.prepare(`INSERT INTO tickets
                    (id, seller_user_id, concert_id, price_cents, quantity, section, description, image_path,
                     verified, verification_status, verification_method, proof_data, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))`)
          .run(id, seller_user_id, concertId, priceCents, quantity, section, description, image_path,
            verified ? 1 : 0,
            verified ? 'approved' : proof_data ? 'pending' : null,
            matched ? 'ticket_number' : verified ? 'proof' : null,
            proof_data, created_at);
        const insertNumber = db.prepare(
          'INSERT INTO ticket_numbers (ticket_id, concert_id, ticket_number) VALUES (?, ?, ?)',
        );
        for (const number of numbers) insertNumber.run(id, concertId, number);
      })();
      return this.findById(id);
    },

    ticketNumbers(ticketId) {
      return db.prepare('SELECT ticket_number FROM ticket_numbers WHERE ticket_id = ? ORDER BY rowid')
        .all(ticketId).map((r) => r.ticket_number);
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
        if (fields.section !== current.section) {
          checkNumbers(current.concert.id, fields.section, this.ticketNumbers(id), sellerId, id);
        }
        const reviewChanged = current.verification.method !== 'ticket_number'
          && (fields.section !== current.section || fields.quantity !== current.quantity);
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

/** Canonical ticket number shared by listings and issued-ticket imports. */
export function normalizeTicketNumber(value) {
  return String(value).trim().toUpperCase().replace(/[\s-]+/g, '-');
}

export function createIssuedTicketRepo(db) {
  return {
    /** Add numbers to a concert's issued list. Re-importing the same number is a no-op. */
    import: db.transaction((concertId, rows) => {
      const insert = db.prepare(`
        INSERT OR IGNORE INTO issued_tickets (concert_id, ticket_number, category) VALUES (?, ?, ?)
      `);
      let added = 0;
      for (const { number, category } of rows) {
        added += insert.run(concertId, normalizeTicketNumber(number), category || null).changes;
      }
      return added;
    }),

    /** Every concert with its issued count and how many of those are on active listings. */
    summary() {
      return db.prepare(`
        SELECT c.id, c.artist, c.venue, c.event_date,
               (SELECT COUNT(*) FROM issued_tickets i WHERE i.concert_id = c.id) AS issued,
               (SELECT COUNT(*) FROM ticket_numbers n JOIN tickets t ON t.id = n.ticket_id
                 WHERE n.concert_id = c.id AND t.status = 'active'
                   AND EXISTS (SELECT 1 FROM issued_tickets i
                               WHERE i.concert_id = n.concert_id AND i.ticket_number = n.ticket_number)
               ) AS listed
        FROM concerts c
        ORDER BY c.event_date
      `).all();
    },
  };
}

export function createOrderRepo(db) {
  const findById = (id) => db.prepare('SELECT * FROM orders WHERE id = ?').get(id) ?? null;


  return { findById };
}
