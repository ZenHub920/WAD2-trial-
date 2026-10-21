/**
 * Data access.
 *
 * Repositories keep SQL here and return plain objects to controllers and services.
 *
 * Hydration note: the matching engine expects seekers and parties to arrive with
 * their user object attached (`.user` / `.host`) and JSON columns already parsed.
 * That is this module's job.
 */

import { createProposalRepo } from './proposalRepository.js';
import { createGroupDiscoveryRepo } from './groupDiscoveryRepository.js';
import { createMembershipRepo } from './membershipRepository.js';
import { reservedPlacesSql,availableCapacitySql } from './capacity.js';
import { createRecommendationRepo } from './recommendationRepository.js';
import { createNotificationRepo } from './notificationRepository.js';
import { createMeetupRepo } from './meetupRepository.js';
import { createFeedbackRepo } from './feedbackRepository.js';
import { createKakiChatRepo } from './kakiChatRepository.js';
import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

function mapUser(row) {
    if (!row) return null;
    return {
        id: row.id,
        display_name: row.display_name,
        email: row.email,
        age_band: row.age_band,
        home_region: row.home_region,
        gender: row.gender,
        companion_gender_pref: row.companion_gender_pref,
        languages: JSON.parse(row.languages_json),
        vibe: JSON.parse(row.vibe_json),
        reliability: row.reliability,
        verified: row.verified,
        // Carried through explicitly: this mapper enumerates columns rather
        // than spreading the row, so anything omitted here is invisible to
        // every caller even though it is stored.
        avatar_path: row.avatar_path ?? null,
        ...(Object.hasOwn(row, 'is_operator') ? { is_operator: Boolean(row.is_operator) } : {}),
        created_at: row.created_at,
    };
}

function mapParty(row) {
    if (!row) return null;
    return {
        id: row.id,
        host_user_id: row.host_user_id,
        concert_id: row.concert_id,

        capacity: row.capacity,

        // NEW: Available slots after previous assignments
        remaining_capacity: row.remaining_capacity ?? row.capacity,

        section: row.section,
        spend_band: row.spend_band,
        arrival_plan: row.arrival_plan,
        plans: JSON.parse(row.plans_json),
        strict_age_policy: row.strict_age_policy,
        min_age_band: row.min_age_band,
        // Lower quota. Read by classifyInstance; omitting it here would leave the
        // classifier permanently blind to the constraint even once it is stored.
        min_size: row.min_size ?? null,
        notes: row.notes,
        status: row.status,
        host: row.host_id ? mapUser(prefixed(row, 'host_')) : undefined,
    };
}

function mapSeeker(row) {
    if (!row) return null;
    return {
        id: row.id,
        user_id: row.user_id,
        concert_id: row.concert_id,
        section_pref: row.section_pref,
        spend_band_max: row.spend_band_max,
        arrival_pref: row.arrival_pref,
        plans_wanted: JSON.parse(row.plans_wanted_json),
        strict_age_policy: row.strict_age_policy,
        age_tolerance: row.age_tolerance,
        // All-or-nothing link to another request. Same reason as min_size above.
        linked_request_id: row.linked_request_id ?? null,
        notes: row.notes,
        status: row.status,
        matching_opt_in: row.matching_opt_in === 1,
        joining_mode: row.joining_mode ?? 'algorithm',
        joiningMode: row.joining_mode ?? 'algorithm',
        user: row.user_id_joined ? mapUser(prefixed(row, 'user_')) : undefined,
    };
}

/** Lift `prefix_col` keys out of a joined row into a bare row shape. */
function prefixed(row, prefix) {
    const out = {};
    for (const [key, value] of Object.entries(row)) {
        if (key.startsWith(prefix)) out[key.slice(prefix.length)] = value;
    }
    return out;
}

const USER_COLUMNS = (alias, prefix) => `
  ${alias}.id                    AS ${prefix}id,
  ${alias}.display_name          AS ${prefix}display_name,
  ${alias}.email                 AS ${prefix}email,
  ${alias}.age_band              AS ${prefix}age_band,
  ${alias}.home_region           AS ${prefix}home_region,
  ${alias}.gender                AS ${prefix}gender,
  ${alias}.companion_gender_pref AS ${prefix}companion_gender_pref,
  ${alias}.languages_json        AS ${prefix}languages_json,
  ${alias}.vibe_json             AS ${prefix}vibe_json,
  ${alias}.reliability           AS ${prefix}reliability,
  ${alias}.verified              AS ${prefix}verified,
  ${alias}.avatar_path           AS ${prefix}avatar_path,
  ${alias}.created_at            AS ${prefix}created_at
`;

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export function createUserRepo(db) {
    return {
        create(data) {
            const id = data.id ?? `u_${randomUUID().slice(0, 8)}`;
            db.prepare(`
        INSERT INTO users (id, display_name, email, password_hash, age_band, home_region, gender,
                           companion_gender_pref, languages_json, vibe_json,
                           reliability, verified)
        VALUES (@id, @display_name, @email, @password_hash, @age_band, @home_region, @gender,
                @companion_gender_pref, @languages_json, @vibe_json,
                @reliability, @verified)
      `).run({
                id,
                display_name: data.display_name,
                email: data.email ?? null,
                password_hash: data.password_hash ?? null,
                age_band: data.age_band,
                home_region: data.home_region,
                gender: data.gender,
                companion_gender_pref: data.companion_gender_pref ?? 'any',
                languages_json: JSON.stringify(data.languages ?? ['en']),
                vibe_json: JSON.stringify(data.vibe),
                reliability: data.reliability ?? 0.75,
                verified: data.verified ? 1 : 0,
            });
            return this.findById(id);
        },

        findById(id) {
            return mapUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id));
        },

        findByEmail(email) {
            return db.prepare('SELECT * FROM users WHERE lower(email) = lower(?)').get(email);
        },

        /** Stores the filename only; pass null to fall back to the silhouette. */
        setAvatar(id, filename) {
            db.prepare('UPDATE users SET avatar_path = ? WHERE id = ?').run(filename ?? null, id);
        },

        list(limit = 100) {
            return db.prepare('SELECT * FROM users ORDER BY created_at DESC LIMIT ?')
                .all(limit).map(mapUser);
        },
        updateProfile(id, changes) {
            const columns = {
                displayName: 'display_name',
                ageBand: 'age_band',
                homeRegion: 'home_region',
                gender: 'gender',
                companionGenderPref: 'companion_gender_pref',
                languages: 'languages_json',
                vibe: 'vibe_json',
            };
            const entries = Object.entries(changes).map(([key, value]) => [columns[key], key === 'languages' || key === 'vibe' ? JSON.stringify(value) : value]);
            if (entries.length) {
                db.prepare(`UPDATE users SET ${entries.map(([column]) => `${column} = ?`).join(', ')} WHERE id = ?`)
          .run(...entries.map(([, value]) => value), id);
      }
      return this.findById(id);
    },

    /** Recompute the cached reliability projection from the feedback view. */
    refreshReliability(userId) {
      const row = db.prepare('SELECT derived_reliability FROM user_reliability WHERE user_id = ?')
        .get(userId);
      if (!row) return null;
      db.prepare('UPDATE users SET reliability = ? WHERE id = ?')
        .run(row.derived_reliability, userId);
      return row.derived_reliability;
    },

    blocklist() {
      const rows = db.prepare('SELECT blocker_user_id, blocked_user_id FROM blocks').all();
      return new Set(rows.map((r) => `${r.blocker_user_id}:${r.blocked_user_id}`));
    },

    block(blockerId, blockedId) {
      db.prepare('INSERT OR IGNORE INTO blocks (blocker_user_id, blocked_user_id) VALUES (?, ?)')
        .run(blockerId, blockedId);
    },
  };
}

// ---------------------------------------------------------------------------
// Concerts
// ---------------------------------------------------------------------------

export function createConcertRepo(db) {
  return {
    create(data) {
      const id = data.id ?? `c_${randomUUID().slice(0, 8)}`;
      db.prepare(`
        INSERT INTO concerts (id, artist, tour_name, venue, city, event_date,
                              doors_time, hero_image_url, blurb, matching_closes_at)
        VALUES (@id, @artist, @tour_name, @venue, @city, @event_date,
                @doors_time, @hero_image_url, @blurb, @matching_closes_at)
      `).run({
        id,
        artist: data.artist,
        tour_name: data.tour_name ?? null,
        venue: data.venue,
        city: data.city,
        event_date: data.event_date,
        doors_time: data.doors_time ?? null,
        hero_image_url: data.hero_image_url ?? null,
        blurb: data.blurb ?? null,
        matching_closes_at: data.matching_closes_at ?? null,
      });
      return this.findById(id);
    },

    findById(id) {
      return db.prepare('SELECT * FROM concerts WHERE id = ?').get(id) ?? null;
    },

    /**
     * Concert list with live counts. The counts come from the same query rather
     * than N+1 follow-ups, which is what keeps the landing page a single round trip.
     */
    listWithCounts() {
      return db.prepare(`
        SELECT
          c.*,
          (SELECT COUNT(*) FROM parties p
            WHERE p.concert_id = c.id AND p.status = 'open'
              AND ${availableCapacitySql()} > ${reservedPlacesSql('p.id')}
              AND NOT EXISTS(SELECT 1 FROM group_settings gs WHERE gs.party_id=p.id AND gs.published=0)
              AND NOT EXISTS (SELECT 1 FROM tickets t WHERE t.source_party_id = p.id)) AS open_parties,
          /*
           * IMPROVEMENT #6:
           *
           * Available concert capacity must account for reservations
           * created in previous matching rounds.
           *
           * Only proposed and confirmed proposals reserve seats.
           *
           * Declined, expired and cancelled offers do not.
           */
          (
            SELECT COALESCE(
              SUM(
                ${availableCapacitySql()} - ${reservedPlacesSql('p.id')}
              ),
              0
            )

            FROM parties p

            WHERE p.concert_id = c.id
              AND p.status = 'open'
              AND NOT EXISTS(SELECT 1 FROM group_settings gs WHERE gs.party_id=p.id AND gs.published=0)

              AND NOT EXISTS (
                SELECT 1
                FROM tickets t
                WHERE t.source_party_id = p.id
              )

          ) AS open_slots,
          (SELECT COUNT(*) FROM seeker_requests s
            WHERE s.concert_id = c.id AND s.status = 'open')            AS open_seekers
        FROM concerts c
        ORDER BY c.event_date ASC
      `).all();
    },
  };
}

// ---------------------------------------------------------------------------
// Explicit Kaki participation (independent of seeker requests)
// ---------------------------------------------------------------------------

export function createParticipationRepo(db) {
  const byUserConcert = db.prepare(`
    SELECT concert_id AS concertId, section_pref AS sectionPref, arrival_pref AS arrivalPref
    FROM concert_participants WHERE user_id = ? AND concert_id = ? AND status = 'joined'
  `);
  const mine = db.prepare(`
    SELECT c.*, p.section_pref AS sectionPref, p.arrival_pref AS arrivalPref
    FROM concert_participants p
    JOIN concerts c ON c.id = p.concert_id
    WHERE p.user_id = ? AND p.status = 'joined'
    ORDER BY c.event_date, c.id
  `);
  const upsert = db.prepare(`
    INSERT INTO concert_participants (user_id, concert_id, section_pref, arrival_pref)
    VALUES (?, ?, ?, ?)
    ON CONFLICT (user_id, concert_id) DO UPDATE SET
      section_pref = excluded.section_pref, arrival_pref = excluded.arrival_pref,
      status = 'joined', joined_at = datetime('now')
  `);
  const withdraw = db.prepare(`
    UPDATE concert_participants SET status = 'withdrawn'
    WHERE user_id = ? AND concert_id = ?
  `);
  const removeLikes = db.prepare(`
    DELETE FROM kaki_decisions
    WHERE actor_user_id = ? AND concert_id = ? AND decision = 'like'
  `);
  return {
    find(userId, concertId) {
      return byUserConcert.get(userId, concertId) ?? null;
    },
    mine(userId) {
      return mine.all(userId).map(({ sectionPref, arrivalPref, ...concert }) => ({
        concert, participation: { concertId: concert.id, sectionPref, arrivalPref },
      }));
    },
    join: db.transaction((userId, concertId, sectionPref, arrivalPref) => {
      upsert.run(userId, concertId, sectionPref, arrivalPref);
      return byUserConcert.get(userId, concertId);
    }),
    leave: db.transaction((userId, concertId) => {
      withdraw.run(userId, concertId);
      removeLikes.run(userId, concertId);
    }),
  };
}

// ---------------------------------------------------------------------------
// Parties
// ---------------------------------------------------------------------------

export function createPartyRepo(db) {
  return {
    create(data) {
      const id = data.id ?? `p_${randomUUID().slice(0, 8)}`;
      db.prepare(`
        INSERT INTO parties (id, host_user_id, concert_id, capacity, section, spend_band,
                             arrival_plan, plans_json, strict_age_policy, min_age_band, notes)
        VALUES (@id, @host_user_id, @concert_id, @capacity, @section, @spend_band,
                @arrival_plan, @plans_json, @strict_age_policy, @min_age_band, @notes)
      `).run({
        id,
        host_user_id: data.host_user_id,
        concert_id: data.concert_id,
        capacity: data.capacity,
        section: data.section,
        spend_band: data.spend_band,
        arrival_plan: data.arrival_plan,
        plans_json: JSON.stringify(data.plans ?? {}),
        strict_age_policy: data.strict_age_policy ? 1 : 0,
        min_age_band: data.min_age_band ?? null,
        notes: data.notes ?? null,
      });
      return this.findById(id);
    },

    findById(id) {
      const row = db.prepare(`
        SELECT p.*, ${availableCapacitySql()} AS capacity, ${USER_COLUMNS('u', 'host_')}
        FROM parties p JOIN users u ON u.id = p.host_user_id
        WHERE p.id = ?
      `).get(id);
      if (row) row.remaining_capacity = Math.max(0, row.capacity - db.prepare(`SELECT ${reservedPlacesSql('@id')} AS n`).get({id}).n);
      return mapParty(row);
    },
  
    /** Hydrated open parties for one concert — the left side of the instance. */
    /** Hydrated open parties with their remaining available capacity. */
/**
 * PURPOSE:
 * Only return groups with genuinely available slots.
 *
 * Previously the query counted every historical matched result.
 * That would permanently reserve a slot even after a decline.
 *
 * Now only 'proposed' and 'confirmed' proposals reserve capacity.
 */

openForConcert(concertId) {

  const rows = db.prepare(`
    SELECT
      p.*, ${availableCapacitySql()} AS capacity,
      ${USER_COLUMNS('u', 'host_')},

      ${availableCapacitySql()} - ${reservedPlacesSql('p.id')} AS remaining_capacity

    FROM parties p
    JOIN users u ON u.id = p.host_user_id

    WHERE p.concert_id = ?
      AND p.status = 'open'

      AND NOT EXISTS (
        SELECT 1
        FROM tickets t
        WHERE t.source_party_id = p.id
      )

      AND ${availableCapacitySql()} > ${reservedPlacesSql('p.id')}
      AND NOT EXISTS(SELECT 1 FROM group_settings gs WHERE gs.party_id=p.id AND gs.published=0)

    ORDER BY p.id
  `).all(concertId);

  return rows.map(mapParty);
  }
    ,
  /**
   * Update a hosted party's operational status.
   *
   * Used by matchingService.run() after creating
   * proposals for a successful matching round.
   *
   * A fully reserved party becomes 'matched'.
   *
   * A party with available capacity remains 'open'.
   */

  setStatus(id, status) {

    db.prepare(`
      UPDATE parties
      SET status = ?
      WHERE id = ?
    `).run(status, id);

  }
};
}
// ---------------------------------------------------------------------------
// Ticket inventory — intentionally separate from matchmaking parties
// ---------------------------------------------------------------------------

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

/**
 * Ticket numbers are compared trimmed and upper-cased, with any run of spaces or
 * dashes read as one dash — so "ta 0001", "TA-0001" and "TA - 0001" are the same ticket.
 */
export function normalizeTicketNumber(value) {
  return String(value).trim().toUpperCase().replace(/[\s-]+/g, '-');
}

/** An error the API layer can map to a status code without string-matching messages. */
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

// ---------------------------------------------------------------------------
// Seeker requests
// ---------------------------------------------------------------------------

export function createSeekerRepo(db) {
  return {
    create(data) {
      const id = data.id ?? `s_${randomUUID().slice(0, 8)}`;
      db.prepare(`
        INSERT INTO seeker_requests (id, user_id, concert_id, section_pref, spend_band_max,
                                     arrival_pref, plans_wanted_json, strict_age_policy,
                                     age_tolerance, notes, joining_mode)
        VALUES (@id, @user_id, @concert_id, @section_pref, @spend_band_max,
                @arrival_pref, @plans_wanted_json, @strict_age_policy,
                @age_tolerance, @notes, @joining_mode)
      `).run({
        id,
        user_id: data.user_id,
        concert_id: data.concert_id,
        section_pref: data.section_pref,
        spend_band_max: data.spend_band_max,
        arrival_pref: data.arrival_pref,
        plans_wanted_json: JSON.stringify(data.plans_wanted ?? {}),
        strict_age_policy: data.strict_age_policy ? 1 : 0,
        age_tolerance: data.age_tolerance ?? 1,
        notes: data.notes ?? null,
        joining_mode: data.joining_mode ?? 'algorithm',
      });
      return this.findById(id);
    },

    findById(id) {
      const row = db.prepare(`
        SELECT s.*, u.id AS user_id_joined, ${USER_COLUMNS('u', 'user_')}
        FROM seeker_requests s JOIN users u ON u.id = s.user_id
        WHERE s.id = ?
      `).get(id);
      return mapSeeker(row);
    },

    /** Hydrated open requests for one concert — the right side of the instance. */
    openForConcert(concertId) {
      const rows = db.prepare(`
        SELECT s.*, u.id AS user_id_joined, ${USER_COLUMNS('u', 'user_')}
        FROM seeker_requests s JOIN users u ON u.id = s.user_id
        WHERE s.concert_id = ? AND s.status = 'open'
        ORDER BY s.id
      `).all(concertId);
      return rows.map(mapSeeker);
    },

    setStatus(id, status) {
      db.prepare(`UPDATE seeker_requests SET status = ?,
        matching_opt_in = CASE WHEN ? = 'withdrawn' THEN 0 ELSE matching_opt_in END WHERE id = ?`)
        .run(status, status, id);
    },
  };
}

// ---------------------------------------------------------------------------
// Match rounds
// ---------------------------------------------------------------------------

export function createRoundRepo(db) {
  return {
    /**
     * Persist a complete round in ONE transaction. Round header, per-seeker results
     * and the trace either all land or none do — a half-written round would be a
     * matching whose stability proof no longer describes its contents.
     */
    save({
      concertId,
      profile,
      result,
      metrics,
      timings,
      trace = [],
      algorithm = 'gale_shapley_hr',
      ledger = null,
      batchKey = null,
    }) {
      const roundId = `r_${randomUUID().slice(0, 8)}`;

      const insertRound = db.prepare(`
        INSERT INTO match_rounds (id, concert_id, algorithm, is_stable, blocking_pair_count,
                                  seeker_count, party_count, total_capacity, feasible_pairs,
                                  matched_count, metrics_json, timings_json,
                                  preference_snapshot_json,
                                  solver_id, instance_class, stability_promise,
                                  relaxations_json, ledger_json, batch_key)
        VALUES (@id, @concert_id, @algorithm, @is_stable, @blocking_pair_count,
                @seeker_count, @party_count, @total_capacity, @feasible_pairs,
                @matched_count, @metrics_json, @timings_json, @preference_snapshot_json,
                @solver_id, @instance_class, @stability_promise,
                @relaxations_json, @ledger_json, @batch_key)
      `);

            // ============================================================
      // IMPROVEMENT #12: HISTORICAL MATCH EXPLANATIONS
      // ============================================================
      //
      // Save the compatibility-score components calculated
      // during the matching round.
      //
      // User profiles may change later, so explanations
      // must use this snapshot rather than recalculating.

      const insertResult = db.prepare(`
        INSERT INTO match_results (
          id,
          round_id,
          seeker_request_id,
          party_id,
          seeker_rank,
          party_rank,
          seeker_score,
          party_score,
          outcome,
          score_breakdown_json
        )

        VALUES (
          @id,
          @round_id,
          @seeker_request_id,
          @party_id,
          @seeker_rank,
          @party_rank,
          @seeker_score,
          @party_score,
          @outcome,
          @score_breakdown_json
        )
      `);

      const insertTrace = db.prepare(`
        INSERT INTO match_trace (round_id, step, event_type, seeker_request_id, party_id,
                                 rank, evicted_seeker_id)
        VALUES (@round_id, @step, @event_type, @seeker_request_id, @party_id,
                @rank, @evicted_seeker_id)
      `);

      const tx = db.transaction(() => {
        insertRound.run({
          id: roundId,
          concert_id: concertId,
          batch_key : batchKey,
          algorithm,
          is_stable: metrics.stable ? 1 : 0,
          blocking_pair_count: metrics.blockingPairs,
          seeker_count: profile.stats.seekers,
          party_count: profile.stats.parties,
          total_capacity: profile.stats.totalCapacity,
          feasible_pairs: profile.stats.feasiblePairs,
          matched_count: metrics.matched,
          metrics_json: JSON.stringify(metrics),
          timings_json: JSON.stringify(timings),
          preference_snapshot_json: JSON.stringify({
            seekerPrefs: Object.fromEntries(profile.seekerPrefs),
            partyPrefs: Object.fromEntries(profile.partyPrefs),
            capacities: Object.fromEntries(profile.capacities),
          }),
          // The ledger's own columns are duplicated out of ledger_json so a
          // round can be filtered by solver or promise in SQL without parsing
          // every blob. The JSON stays authoritative.
          solver_id: ledger?.solver ?? null,
          instance_class: ledger?.instanceClass ?? null,
          stability_promise: ledger?.promised?.stability ?? null,
          relaxations_json: ledger ? JSON.stringify(ledger.relaxations ?? []) : null,
          ledger_json: ledger ? JSON.stringify(ledger) : null,
        });

        for (const seekerId of profile.seekerPrefs.keys()) {
          const partyId = result.assignments.get(seekerId) ?? null;
          const scored = partyId
            ? profile.pairScores.get(`${seekerId}|${partyId}`)
            : null;
          insertResult.run({
            id: `mr_${randomUUID().slice(0, 8)}`,
            round_id: roundId,
            seeker_request_id: seekerId,
            party_id: partyId,
            seeker_rank: partyId ? profile.seekerRanks.get(seekerId).get(partyId) + 1 : null,
            party_rank: partyId ? profile.partyRanks.get(partyId).get(seekerId) + 1 : null,
            seeker_score: scored?.seekerToParty ?? null,
            party_score: scored?.partyToSeeker ?? null,
            outcome: partyId ? 'matched' : 'unmatched',
                        // Preserve the exact compatibility calculation.
            //
            // This is the original scoring object from
            // profile.pairScores.
            //
            // It must not depend on future profile edits.

            score_breakdown_json: scored
              ? JSON.stringify(scored)
              : null,
          });
        }

        for (const event of trace) {
          insertTrace.run({
            round_id: roundId,
            step: event.step,
            event_type: event.type,
            seeker_request_id: event.seekerId,
            party_id: event.partyId,
            rank: event.rank ?? null,
            evicted_seeker_id: event.evictedSeekerId ?? null,
          });
        }
      });

      tx();
      return roundId;
    },

    /**
     * ============================================================
     * LEGACY MATCHING RECONCILIATION CHECK
     * ============================================================
     *
     * PURPOSE:
     *
     * Detect assignments made before the proposal lifecycle
     * was introduced.
     *
     * WHY?
     *
     * Old versions of encore could mark seeker requests and
     * parties as matched using historical match_results.
     *
     * The new implementation counts only active proposals.
     *
     * If an old confirmed arrangement has no corresponding
     * proposal record, blindly switching accounting could
     * accidentally release an occupied seat.
     *
     * This method therefore detects suspicious legacy states.
     *
     * It does not automatically modify the database.
     */

    hasUnreconciledLegacyAssignments(concertId) {

      // Find matched seekers without active proposal records.

      const oldSeekers = db.prepare(`
        SELECT COUNT(*) AS n

        FROM seeker_requests s

        WHERE s.concert_id = ?
          AND s.status = 'matched'

          AND NOT EXISTS (
            SELECT 1
            FROM active_seat_claims sc
            WHERE sc.seeker_request_id=s.id AND
              (sc.status='confirmed' OR(sc.status='proposed' AND sc.expires_at>unixepoch('subsec')*1000))
          )
          AND NOT EXISTS (
            SELECT 1 FROM group_memberships gm JOIN parties p ON p.id=gm.party_id
            WHERE gm.user_id=s.user_id AND gm.concert_id=s.concert_id
              AND gm.status='active' AND p.status<>'cancelled'
          )
      `).get(concertId).n;

      // Find matched parties without active proposal records.

      const oldParties = db.prepare(`
        SELECT COUNT(*) AS n

        FROM parties p

        WHERE p.concert_id = ?
          AND p.status = 'matched'
          AND NOT EXISTS (SELECT 1 FROM group_settings gs WHERE gs.party_id = p.id)

          AND NOT EXISTS (
            SELECT 1
            FROM active_seat_claims sc
            WHERE sc.party_id=p.id AND
              (sc.status='confirmed' OR(sc.status='proposed' AND sc.expires_at>unixepoch('subsec')*1000))
          )
      `).get(concertId).n;

      // Require explicit reconciliation if legacy states exist.

      return oldSeekers > 0 || oldParties > 0;
    },


    findById(roundId) {
      const round = db.prepare('SELECT * FROM match_rounds WHERE id = ?').get(roundId);
      if (!round) return null;
      return {
        ...round,
        metrics: JSON.parse(round.metrics_json),
        timings: JSON.parse(round.timings_json),
      };
    },
    // ============================================================
    // FIND MATCHING ROUND BY IDEMPOTENCY KEY
    // Improvement #4 — NEW METHOD
    // ============================================================

    /**
     * PURPOSE:
     * Find a matching round that was previously executed
     * using the same idempotency key.
     *
     * WHY IS THIS NECESSARY?
     *
     * Suppose an operator clicks "Run Matching".
     *
     * The backend successfully executes Gale-Shapley and
     * saves Round 1, but the HTTP response is lost.
     *
     * The operator retries the same request.
     *
     * Without this method:
     * The backend may execute another matching round.
     *
     * With this method:
     * The backend finds Round 1 and returns its result
     * without executing Gale-Shapley again.
     *
     * PARAMETERS:
     * concertId = ID of the concert being matched.
     * batchKey  = Unique identifier for the matching operation.
     *
     * RETURNS:
     * - The previously saved matching round, if found.
     * - null if this is a new matching operation.
     */

    findByBatch(concertId, batchKey) {

      // STEP 1:
      // Search the match_rounds table for a round
      // with this concert ID and idempotency key.

      const row = db.prepare(`
        SELECT id
        FROM match_rounds
        WHERE concert_id = ?
          AND batch_key = ?
      `).get(concertId, batchKey);


      // STEP 2:
      // If a matching round exists, retrieve its
      // full information using the existing findById().
      //
      // Otherwise return null.
      //
      // This avoids duplicating the JSON parsing logic
      // already implemented in findById().

      return row ? this.findById(row.id) : null;

    },
    

    latestForConcert(concertId) {
      const round = db.prepare(`
        SELECT * FROM match_rounds WHERE concert_id = ? ORDER BY ran_at DESC, rowid DESC LIMIT 1
      `).get(concertId);
      if (!round) return null;
      return {
        ...round,
        metrics: JSON.parse(round.metrics_json),
        timings: JSON.parse(round.timings_json),
      };
      
    },

    /** Active proposals across all rounds, restricted to the session account. */
        /**
     * ============================================================
     * IMPROVEMENT #5: CURRENT OPERATIONAL MATCH RETRIEVAL
     * ============================================================
     *
     * PURPOSE:
     *
     * Return the user's current matching state for a concert,
     * regardless of which historical matching round created it.
     *
     * IMPORTANT:
     *
     * match_results = historical algorithm assignments.
     *
     * match_proposals = operational assignment status.
     *
     * Only proposals with status:
     *   - proposed
     *   - confirmed
     *
     * count as active assignments.
     *
     * This method preserves the existing /me/concerts/:id/result
     * API for backward compatibility.
     *
     * The dedicated proposal APIs remain the preferred way to
     * retrieve all current and historical proposal records.
     */

    resultForUser(concertId, userId) {

      // ----------------------------------------------------------
      // STEP 1: CHECK WHETHER THE USER IS AN ACTIVE SEEKER
      // ----------------------------------------------------------
      //
      // Search operational proposals across ALL rounds.
      //
      // Do not restrict the search to the latest match_rounds
      // record.
      //
      // The active-proposal unique index guarantees that one
      // seeker request cannot hold multiple active offers.

      const seekerProposal = db.prepare(`
        SELECT
          mp.id AS proposal_id,
          mp.status AS proposal_status,

          mp.round_id,
          r.ran_at,

          p.id AS party_id,
          p.section,
          p.host_user_id

        FROM match_proposals mp

        JOIN match_rounds r
          ON r.id = mp.round_id

        JOIN seeker_requests sr
          ON sr.id = mp.seeker_request_id

        JOIN parties p
          ON p.id = mp.party_id

        WHERE sr.user_id = ?
          AND p.concert_id = ?

          AND mp.status IN (
            'proposed',
            'confirmed'
          )

        ORDER BY
          CASE mp.status
            WHEN 'confirmed' THEN 0
            ELSE 1
          END,
          mp.created_at DESC

        LIMIT 1
      `).get(userId, concertId);

      // ----------------------------------------------------------
      // STEP 2: RETURN THE SEEKER'S ACTIVE ASSIGNMENT
      // ----------------------------------------------------------

      if (seekerProposal) {

        // Reuse the existing mapUser() function.
        //
        // This preserves the expected user object structure
        // used by publicUser() in matchController.js.

        const host = mapUser(
          db.prepare(`
            SELECT *
            FROM users
            WHERE id = ?
          `).get(seekerProposal.host_user_id)
        );

        return {
          role: 'seeker',

          // This may be 'proposed' or 'confirmed'.
          // Neither should be incorrectly labelled as
          // a final confirmed match.
          outcome: seekerProposal.proposal_status,

          proposalId: seekerProposal.proposal_id,

          round: {
            id: seekerProposal.round_id,
            ranAt: seekerProposal.ran_at
          },

          group: {
            id: seekerProposal.party_id,
            section: seekerProposal.section,
            host
          }
        };
      }

      // ----------------------------------------------------------
      // STEP 3: CHECK WHETHER THE USER HOSTS A PARTY
      // ----------------------------------------------------------

      const party = db.prepare(`
        SELECT *
        FROM parties
        WHERE concert_id = ?
          AND host_user_id = ?
      `).get(concertId, userId);

      if (!party) {
        return null;
      }

      // ----------------------------------------------------------
      // STEP 4: RETRIEVE THE HOST'S ACTIVE MEMBERS
      // ----------------------------------------------------------
      //
      // Unlike historical match_results, these members may
      // come from different matching rounds.
      //
      // This query correctly combines them.

      const members = db.prepare(`
        SELECT u.*

        FROM match_proposals mp

        JOIN seeker_requests sr
          ON sr.id = mp.seeker_request_id

        JOIN users u
          ON u.id = sr.user_id

        WHERE mp.party_id = ?

          AND mp.status IN (
            'proposed',
            'confirmed'
          )

        ORDER BY
          mp.created_at ASC,
          mp.id ASC
      `).all(party.id).map(mapUser);

      // ----------------------------------------------------------
      // STEP 5: RETURN THE HOST'S CURRENT GROUP
      // ----------------------------------------------------------
      //
      // There is deliberately no single historical round here.
      // Members can originate from multiple rounds.
      //
      // For the exact status and round of each member,
      // use /me/concerts/:id/proposals or /matches.

      return {
        role: 'host',

        outcome: members.length > 0
          ? 'matched'
          : 'no_members',

        round: null,

        group: {
          id: party.id,
          section: party.section,

          host: mapUser(
            db.prepare(`
              SELECT *
              FROM users
              WHERE id = ?
            `).get(userId)
          )
        },

        members
      };
    },
    /** Full results for a round, joined out to human-readable names. */
    resultsForRound(roundId) {
      return db.prepare(`
        SELECT
          mr.*,
          su.display_name AS seeker_name,
          su.id           AS seeker_user_id,
          hu.display_name AS host_name,
          hu.id           AS host_user_id,
          p.section, p.spend_band, p.arrival_plan, p.capacity
        FROM match_results mr
        JOIN seeker_requests s ON s.id = mr.seeker_request_id
        JOIN users su          ON su.id = s.user_id
        LEFT JOIN parties p    ON p.id = mr.party_id
        LEFT JOIN users hu     ON hu.id = p.host_user_id
        WHERE mr.round_id = ?
        -- matched first (CASE, not alphabetical: 'unmatched' sorts after 'matched'),
        -- then best rank achieved first
        ORDER BY CASE mr.outcome WHEN 'matched' THEN 0 ELSE 1 END,
                 mr.seeker_rank ASC
      `).all(roundId);
    },

    traceForRound(roundId, limit = 2000) {
      return db.prepare(`
        SELECT * FROM match_trace WHERE round_id = ? ORDER BY step ASC LIMIT ?
      `).all(roundId, limit);
    },

    /** Everyone placed in a given party, for the "your group" view. */
    partyRoster(roundId, partyId) {
      return db.prepare(`
        SELECT mr.seeker_request_id, mr.seeker_rank, mr.party_rank,
               u.id AS user_id, u.display_name, u.age_band, u.home_region, u.vibe_json
        FROM match_results mr
        JOIN seeker_requests s ON s.id = mr.seeker_request_id
        JOIN users u           ON u.id = s.user_id
        WHERE mr.round_id = ? AND mr.party_id = ?
        ORDER BY mr.party_rank ASC
      `).all(roundId, partyId);
    },
  };
}

export function createSessionRepo(db) {
  return {
    create(tokenHash, userId, expiresAt) {
      db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
        .run(tokenHash, userId, expiresAt);
    },
    findUserId(tokenHash, now) {
      return db.prepare('SELECT user_id FROM sessions WHERE token_hash = ? AND expires_at > ?')
        .get(tokenHash, now)?.user_id ?? null;
    },
    delete(tokenHash) {
      db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
    },
  };
}

const kakiJoined = (user, concert) => `EXISTS (
  SELECT 1 FROM concert_participants joined
  WHERE joined.user_id = ${user} AND joined.concert_id = ${concert}
    AND joined.status = 'joined'
)`;
const kakiEligiblePair = (actor, concert, target) => `(
  ${actor} <> ${target}
  AND ${kakiJoined(actor, concert)}
  AND ${kakiJoined(target, concert)}
  AND NOT EXISTS (SELECT 1 FROM blocks b
                  WHERE (b.blocker_user_id = ${actor} AND b.blocked_user_id = ${target})
                     OR (b.blocker_user_id = ${target} AND b.blocked_user_id = ${actor}))
)`;

export function createKakiRepo(db) {
  const concerts = db.prepare(`
    SELECT c.* FROM concerts c
    WHERE ${kakiJoined('@viewer', 'c.id')}
    ORDER BY c.event_date, c.id
  `);
  const people = db.prepare(`
    SELECT c.id AS concert_id, c.artist, c.tour_name, c.event_date, c.venue,
           p.section_pref,
           s.spend_band_max,
           p.arrival_pref,
           COALESCE(s.plans_wanted_json, '{}') AS plans_wanted_json,
           u.id AS user_id, u.display_name AS user_display_name,
           u.age_band AS user_age_band, u.home_region AS user_home_region,
           u.languages_json AS user_languages_json, u.vibe_json AS user_vibe_json,
           u.reliability AS user_reliability, u.verified AS user_verified,
           u.avatar_path AS user_avatar_path
    FROM concert_participants p
    JOIN concerts c ON c.id = p.concert_id
    JOIN users u ON u.id = p.user_id
    LEFT JOIN seeker_requests s ON s.concert_id = p.concert_id
      AND s.user_id = p.user_id AND s.status = 'open'
    WHERE p.status = 'joined' AND ${kakiEligiblePair('@viewer', 'c.id', 'u.id')}
    ORDER BY c.event_date, c.id, u.id
  `);
  const eligible = db.prepare(`
    SELECT 1 WHERE ${kakiEligiblePair('@actor', '@concert', '@target')}
  `);
  const decisions = db.prepare(`
    SELECT d.concert_id, d.target_user_id, d.decision, d.decided_at,
           reverse.decision AS reverse_decision,
           ${kakiJoined('d.actor_user_id', 'd.concert_id')} AS actor_is_candidate
    FROM kaki_decisions d
    LEFT JOIN kaki_decisions reverse ON reverse.concert_id = d.concert_id
      AND reverse.actor_user_id = d.target_user_id
      AND reverse.target_user_id = d.actor_user_id
    WHERE d.actor_user_id = ?
  `);
  const upsert = db.prepare(`
    INSERT INTO kaki_decisions (concert_id, actor_user_id, target_user_id, decision, decided_at)
    VALUES (@concert, @actor, @target, @decision, @at)
    ON CONFLICT (concert_id, actor_user_id, target_user_id)
    DO UPDATE SET decision = excluded.decision, decided_at = excluded.decided_at
  `);
  const reciprocal = db.prepare(`
    SELECT 1 FROM kaki_decisions d
    WHERE d.concert_id = @concert AND d.actor_user_id = @target
      AND d.target_user_id = @actor AND d.decision = 'like'
      AND ${kakiJoined('@actor', '@concert')}
  `);
  const remove = db.prepare(`
    DELETE FROM kaki_decisions
    WHERE concert_id = @concert AND actor_user_id = @actor AND target_user_id = @target
  `);
  const toPerson = (row) => ({
    id: `${row.concert_id}:${row.user_id}`,
    concertId: row.concert_id,
    artist: row.artist,
    tourName: row.tour_name,
    eventDate: row.event_date,
    venue: row.venue,
    sectionPref: row.section_pref,
    spendBandMax: row.spend_band_max,
    arrivalPref: row.arrival_pref,
    plansWanted: JSON.parse(row.plans_wanted_json),
    user: mapUser(prefixed(row, 'user_')),
  });
  return {
    people(viewer) {
      return people.all({ viewer }).map(toPerson);
    },
    pool(viewer) {
      return { concerts: concerts.all({ viewer }), people: this.people(viewer) };
    },
    decisions(viewer, visiblePeople) {
      const visible = new Set(visiblePeople.map((person) => person.id));
      const result = {};
      for (const row of decisions.all(viewer)) {
        const id = `${row.concert_id}:${row.target_user_id}`;
        if (!visible.has(id)) continue;
        result[id] = {
          decision: row.decision,
          at: row.decided_at,
          mutual: row.decision === 'like' && row.reverse_decision === 'like'
            && Boolean(row.actor_is_candidate),
        };
      }
      return result;
    },
    setDecision: db.transaction((actor, concert, target, decision) => {
      const pair = { actor, concert, target };
      if (!eligible.get(pair)) return null;
      const at = Date.now();
      upsert.run({ ...pair, decision, at });
      return { decision, at, mutual: decision === 'like' && Boolean(reciprocal.get(pair)) };
    }),
    deleteDecision: db.transaction((actor, concert, target) => {
      const pair = { actor, concert, target };
      if (!eligible.get(pair)) return false;
      remove.run(pair);
      return true;
    }),
  };
}

export function createOrderRepo(db) {
  const findById = (id) => db.prepare('SELECT * FROM orders WHERE id = ?').get(id) ?? null;


  return { findById };
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

    /** Messages after a message id; row order keeps same-millisecond messages distinct. */
    messages(conversationId, after = null) {
      return db.prepare(`
        SELECT * FROM ticket_messages
        WHERE conversation_id = @c AND (@after IS NULL OR rowid > (
          SELECT rowid FROM ticket_messages WHERE id = @after AND conversation_id = @c
        ))
        ORDER BY rowid
        LIMIT 500
      `).all({ c: conversationId, after });
    },

    addMessage(conversationId, senderUserId, body) {
      const id = `m_${randomUUID().slice(0, 8)}`;
      db.prepare('INSERT INTO ticket_messages (id, conversation_id, sender_user_id, body) VALUES (?, ?, ?, ?)')
        .run(id, conversationId, senderUserId, body);
      return db.prepare('SELECT * FROM ticket_messages WHERE id = ?').get(id);
    },
  };
}

export function createRepositories(db) {
  const repos = {
    users: createUserRepo(db),
    concerts: createConcertRepo(db),
    participation: createParticipationRepo(db),
    parties: createPartyRepo(db),
    tickets: createTicketRepo(db),
    orders: createOrderRepo(db),
    issuedTickets: createIssuedTicketRepo(db),
    conversations: createConversationRepo(db),
    seekers: createSeekerRepo(db),
    rounds: createRoundRepo(db),
    sessions: createSessionRepo(db),
    kaki: createKakiRepo(db),
    // Kaki Finder messaging. Separate from `conversations` above, which is the
    // buyer–seller chat on a ticket listing.
    kakiChat: createKakiChatRepo(db),
  };
  repos.proposals = createProposalRepo(db, repos);
  repos.groups = createGroupDiscoveryRepo(db, repos);
  repos.membership = createMembershipRepo(db, repos);
  repos.recommendations = createRecommendationRepo(db, repos);
  repos.notifications = createNotificationRepo(db);
  repos.meetups = createMeetupRepo(db,repos);
  repos.feedback = createFeedbackRepo(db,repos);
  return repos;
}
