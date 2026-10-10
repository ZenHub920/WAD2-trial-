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
            WHERE p.concert_id = c.id AND p.status = 'open'
              AND NOT EXISTS (SELECT 1 FROM tickets t WHERE t.source_party_id = p.id)) AS open_parties,
          (SELECT COALESCE(SUM(p.capacity), 0) FROM parties p
            WHERE p.concert_id = c.id AND p.status = 'open'
              AND NOT EXISTS (SELECT 1 FROM tickets t WHERE t.source_party_id = p.id)) AS open_slots,
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
          AND NOT EXISTS (SELECT 1 FROM tickets t WHERE t.source_party_id = p.id)
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
    image_path: row.image_path,
  };
}

export function createTicketRepo(db) {
  const joined = `
    SELECT t.*, c.artist, c.venue, c.city, c.event_date,
           ${USER_COLUMNS('u', 'seller_')}
    FROM tickets t
    JOIN users u ON u.id = t.seller_user_id
    JOIN concerts c ON c.id = t.concert_id
  `;
  const get = db.prepare(`${joined} WHERE t.id = ? AND t.status <> 'deleted'`);
  return {
    create({ seller_user_id, concert, priceCents, quantity, section, description, image_path }) {
      const id = `t_${randomUUID()}`;
      db.transaction(() => {
        const concertId = `c_${randomUUID()}`;
        db.prepare(`INSERT INTO concerts (id, artist, venue, city, event_date)
                    VALUES (?, ?, ?, ?, ?)`)
          .run(concertId, concert.artist, concert.venue, concert.city ?? 'Singapore', concert.event_date);
        db.prepare(`INSERT INTO tickets
                    (id, seller_user_id, concert_id, price_cents, quantity, section, description, image_path)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(id, seller_user_id, concertId, priceCents, quantity, section, description, image_path);
      })();
      return this.findById(id);
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
      const result = db.prepare(`UPDATE tickets
        SET price_cents = ?, quantity = ?, section = ?, description = ?, image_path = ?
        WHERE id = ? AND seller_user_id = ? AND status = 'active'`)
        .run(fields.priceCents, fields.quantity, fields.section, fields.description, fields.image_path,
          id, sellerId);
      return result.changes ? this.findById(id) : null;
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
    save({
      concertId,
      profile,
      result,
      metrics,
      timings,
      trace = [],
      algorithm = 'gale_shapley_hr',
      ledger = null,
    }) {
      const roundId = `r_${randomUUID().slice(0, 8)}`;

      const insertRound = db.prepare(`
        INSERT INTO match_rounds (id, concert_id, algorithm, is_stable, blocking_pair_count,
                                  seeker_count, party_count, total_capacity, feasible_pairs,
                                  matched_count, metrics_json, timings_json,
                                  preference_snapshot_json,
                                  solver_id, instance_class, stability_promise,
                                  relaxations_json, ledger_json)
        VALUES (@id, @concert_id, @algorithm, @is_stable, @blocking_pair_count,
                @seeker_count, @party_count, @total_capacity, @feasible_pairs,
                @matched_count, @metrics_json, @timings_json, @preference_snapshot_json,
                @solver_id, @instance_class, @stability_promise,
                @relaxations_json, @ledger_json)
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

export function createRepositories(db) {
  return {
    users: createUserRepo(db),
    concerts: createConcertRepo(db),
    parties: createPartyRepo(db),
    tickets: createTicketRepo(db),
    seekers: createSeekerRepo(db),
    rounds: createRoundRepo(db),
    sessions: createSessionRepo(db),
  };
}
