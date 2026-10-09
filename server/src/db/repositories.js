/**
 * Data access.
 *
 * The only module that knows SQL. Everything above it works with plain objects,
 * so the storage engine can change without touching the matching engine or the API.
 *
 * Hydration note: the matching engine expects seekers and parties to arrive with
 * their user object attached (`.user` / `.host`) and JSON columns already parsed.
 * That is this module's job.
 */

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
    section: row.section,
    spend_band: row.spend_band,
    arrival_plan: row.arrival_plan,
    plans: JSON.parse(row.plans_json),
    strict_age_policy: row.strict_age_policy,
    min_age_band: row.min_age_band,
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
    notes: row.notes,
    status: row.status,
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
        INSERT INTO users (id, display_name, email, age_band, home_region, gender,
                           companion_gender_pref, languages_json, vibe_json,
                           reliability, verified)
        VALUES (@id, @display_name, @email, @age_band, @home_region, @gender,
                @companion_gender_pref, @languages_json, @vibe_json,
                @reliability, @verified)
      `).run({
        id,
        display_name: data.display_name,
        email: data.email ?? null,
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

    list(limit = 100) {
      return db.prepare('SELECT * FROM users ORDER BY created_at DESC LIMIT ?')
        .all(limit).map(mapUser);
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
            WHERE p.concert_id = c.id AND p.status = 'open')            AS open_parties,
          (SELECT COALESCE(SUM(p.capacity), 0) FROM parties p
            WHERE p.concert_id = c.id AND p.status = 'open')            AS open_slots,
          (SELECT COUNT(*) FROM seeker_requests s
            WHERE s.concert_id = c.id AND s.status = 'open')            AS open_seekers
        FROM concerts c
        ORDER BY c.event_date ASC
      `).all();
    },
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
        SELECT p.*, ${USER_COLUMNS('u', 'host_')}
        FROM parties p JOIN users u ON u.id = p.host_user_id
        WHERE p.id = ?
      `).get(id);
      return mapParty(row);
    },

    /** Hydrated open parties for one concert — the left side of the instance. */
    openForConcert(concertId) {
      const rows = db.prepare(`
        SELECT p.*, ${USER_COLUMNS('u', 'host_')}
        FROM parties p JOIN users u ON u.id = p.host_user_id
        WHERE p.concert_id = ? AND p.status = 'open'
        ORDER BY p.id
      `).all(concertId);
      return rows.map(mapParty);
    },

    setStatus(id, status) {
      db.prepare('UPDATE parties SET status = ? WHERE id = ?').run(status, id);
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
                                     age_tolerance, notes)
        VALUES (@id, @user_id, @concert_id, @section_pref, @spend_band_max,
                @arrival_pref, @plans_wanted_json, @strict_age_policy,
                @age_tolerance, @notes)
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
      db.prepare('UPDATE seeker_requests SET status = ? WHERE id = ?').run(status, id);
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
    save({ concertId, profile, result, metrics, timings, trace = [], algorithm = 'gale_shapley_hr' }) {
      const roundId = `r_${randomUUID().slice(0, 8)}`;

      const insertRound = db.prepare(`
        INSERT INTO match_rounds (id, concert_id, algorithm, is_stable, blocking_pair_count,
                                  seeker_count, party_count, total_capacity, feasible_pairs,
                                  matched_count, metrics_json, timings_json,
                                  preference_snapshot_json)
        VALUES (@id, @concert_id, @algorithm, @is_stable, @blocking_pair_count,
                @seeker_count, @party_count, @total_capacity, @feasible_pairs,
                @matched_count, @metrics_json, @timings_json, @preference_snapshot_json)
      `);

      const insertResult = db.prepare(`
        INSERT INTO match_results (id, round_id, seeker_request_id, party_id, seeker_rank,
                                   party_rank, seeker_score, party_score, outcome)
        VALUES (@id, @round_id, @seeker_request_id, @party_id, @seeker_rank,
                @party_rank, @seeker_score, @party_score, @outcome)
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

    findById(roundId) {
      const round = db.prepare('SELECT * FROM match_rounds WHERE id = ?').get(roundId);
      if (!round) return null;
      return {
        ...round,
        metrics: JSON.parse(round.metrics_json),
        timings: JSON.parse(round.timings_json),
      };
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

// ---------------------------------------------------------------------------
// Ticket market
// ---------------------------------------------------------------------------

function mapListing(row) {
  if (!row) return null;
  return {
    id: row.id,
    seller_user_id: row.seller_user_id,
    concert_id: row.concert_id,
    title: row.title,
    category: row.category,
    show_date: row.show_date,
    seat_row: row.seat_row,
    seat_numbers: row.seat_numbers,
    quantity: row.quantity,
    price_cents: row.price_cents,
    currency: row.currency,
    description: row.description,
    image_url: row.image_url,
    verified: row.verified,
    status: row.status,
    created_at: row.created_at,
    seller: mapUser(prefixed(row, 'seller_')),
    concert: {
      id: row.concert_id,
      artist: row.concert_artist,
      tour_name: row.concert_tour_name,
      venue: row.concert_venue,
      city: row.concert_city,
      event_date: row.concert_event_date,
      hero_image_url: row.concert_hero_image_url,
    },
  };
}

const LISTING_SELECT = `
  SELECT l.*, ${USER_COLUMNS('u', 'seller_')},
         c.artist         AS concert_artist,
         c.tour_name      AS concert_tour_name,
         c.venue          AS concert_venue,
         c.city           AS concert_city,
         c.event_date     AS concert_event_date,
         c.hero_image_url AS concert_hero_image_url
  FROM ticket_listings l
  JOIN users u    ON u.id = l.seller_user_id
  JOIN concerts c ON c.id = l.concert_id
`;

/** An error the API layer can map to a status code without string-matching messages. */
function marketError(code) {
  return Object.assign(new Error(code), { code });
}

export function createListingRepo(db) {
  return {
    create(data) {
      const id = data.id ?? `l_${randomUUID().slice(0, 8)}`;
      db.prepare(`
        INSERT INTO ticket_listings (id, seller_user_id, concert_id, title, category, show_date,
                                     seat_row, seat_numbers, quantity, price_cents, currency,
                                     description, image_url, verified, created_at)
        VALUES (@id, @seller_user_id, @concert_id, @title, @category, @show_date,
                @seat_row, @seat_numbers, @quantity, @price_cents, @currency,
                @description, @image_url, @verified, COALESCE(@created_at, datetime('now')))
      `).run({
        id,
        seller_user_id: data.seller_user_id,
        concert_id: data.concert_id,
        title: data.title,
        category: data.category,
        show_date: data.show_date ?? null,
        seat_row: data.seat_row ?? null,
        seat_numbers: data.seat_numbers ?? null,
        quantity: data.quantity ?? 1,
        price_cents: data.price_cents,
        currency: data.currency ?? 'SGD',
        description: data.description ?? null,
        image_url: data.image_url ?? null,
        verified: data.verified ? 1 : 0,
        created_at: data.created_at ?? null,
      });
      return this.findById(id);
    },

    findById(id) {
      return mapListing(db.prepare(`${LISTING_SELECT} WHERE l.id = ?`).get(id));
    },

    /** Open listings, newest first, optionally filtered by a free-text query. */
    listOpen({ query = '', limit = 60 } = {}) {
      const trimmed = query.trim();
      if (!trimmed) {
        return db.prepare(`
          ${LISTING_SELECT}
          WHERE l.status = 'open'
          ORDER BY l.created_at DESC, l.id
          LIMIT ?
        `).all(limit).map(mapListing);
      }

      // Escape LIKE wildcards so a search for "100%" means the literal text.
      const pattern = `%${trimmed.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
      return db.prepare(`
        ${LISTING_SELECT}
        WHERE l.status = 'open'
          AND (l.title LIKE @p ESCAPE '\\' OR l.category LIKE @p ESCAPE '\\'
               OR c.artist LIKE @p ESCAPE '\\' OR c.tour_name LIKE @p ESCAPE '\\'
               OR c.venue LIKE @p ESCAPE '\\')
        ORDER BY l.created_at DESC, l.id
        LIMIT @limit
      `).all({ p: pattern, limit }).map(mapListing);
    },
  };
}

export function createOrderRepo(db) {
  const findById = (id) => db.prepare('SELECT * FROM ticket_orders WHERE id = ?').get(id) ?? null;

  /**
   * Buy a listing. The status flip and the order insert share one transaction, and
   * the UPDATE is conditional on the listing still being open — so two buyers racing
   * for the same ticket cannot both succeed. Prices are read from the database,
   * never from the request.
   */
  const purchase = db.transaction(({ listing_id, buyer_user_id, payment_method }) => {
    const listing = db.prepare('SELECT * FROM ticket_listings WHERE id = ?').get(listing_id);
    if (!listing) throw marketError('listing_not_found');
    if (listing.seller_user_id === buyer_user_id) throw marketError('cannot_buy_own_listing');

    const claimed = db.prepare(`
      UPDATE ticket_listings SET status = 'sold' WHERE id = ? AND status = 'open'
    `).run(listing_id);
    if (claimed.changes !== 1) throw marketError('listing_unavailable');

    const deliveryFee = 0;
    const id = `o_${randomUUID().slice(0, 8)}`;
    db.prepare(`
      INSERT INTO ticket_orders (id, listing_id, buyer_user_id, subtotal_cents,
                                 delivery_fee_cents, total_cents, currency, payment_method)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, listing_id, buyer_user_id, listing.price_cents,
      deliveryFee, listing.price_cents + deliveryFee, listing.currency, payment_method,
    );
    return findById(id);
  });

  return { findById, purchase };
}

export function createRepositories(db) {
  return {
    users: createUserRepo(db),
    concerts: createConcertRepo(db),
    parties: createPartyRepo(db),
    seekers: createSeekerRepo(db),
    rounds: createRoundRepo(db),
    listings: createListingRepo(db),
    orders: createOrderRepo(db),
  };
}
