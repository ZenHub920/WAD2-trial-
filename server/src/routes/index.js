/**
 * HTTP API.
 *
 * Thin by design: validation, a repository or service call, and a response shape.
 * No matching logic lives here — the engine is a library the API calls, which is
 * what lets the benchmarks exercise it without an HTTP server.
 */

import { Router } from 'express';

export function createRoutes({ repos, matching }) {
  const router = Router();

  // -------------------------------------------------------------------------
  // Concerts
  // -------------------------------------------------------------------------

  router.get('/concerts', (req, res) => {
    res.json({ concerts: repos.concerts.listWithCounts() });
  });

  router.get('/concerts/:id', (req, res) => {
    const concert = repos.concerts.findById(req.params.id);
    if (!concert) return res.status(404).json({ error: 'concert_not_found' });

    const parties = repos.parties.openForConcert(concert.id);
    const seekers = repos.seekers.openForConcert(concert.id);
    const latestRound = repos.rounds.latestForConcert(concert.id);

    res.json({
      concert,
      openParties: parties.length,
      openSlots: parties.reduce((a, p) => a + p.capacity, 0),
      openSeekers: seekers.length,
      latestRound: latestRound
        ? {
            id: latestRound.id,
            ranAt: latestRound.ran_at,
            isStable: latestRound.is_stable === 1,
            matched: latestRound.matched_count,
            metrics: latestRound.metrics,
          }
        : null,
    });
  });

  // -------------------------------------------------------------------------
  // Listings
  // -------------------------------------------------------------------------

  router.get('/concerts/:id/parties', (req, res) => {
    const parties = repos.parties.openForConcert(req.params.id);
    res.json({
      parties: parties.map((p) => ({
        id: p.id,
        capacity: p.capacity,
        section: p.section,
        spendBand: p.spend_band,
        arrivalPlan: p.arrival_plan,
        plans: p.plans,
        notes: p.notes,
        host: publicUser(p.host),
      })),
    });
  });

  router.post('/concerts/:id/parties', (req, res) => {
    const error = validateParty(req.body);
    if (error) return res.status(400).json({ error });
    try {
      const party = repos.parties.create({ ...req.body, concert_id: req.params.id });
      res.status(201).json({ party });
    } catch (err) {
      res.status(409).json({ error: 'could_not_create_party', detail: err.message });
    }
  });

  router.get('/concerts/:id/requests', (req, res) => {
    const seekers = repos.seekers.openForConcert(req.params.id);
    res.json({
      requests: seekers.map((s) => ({
        id: s.id,
        sectionPref: s.section_pref,
        spendBandMax: s.spend_band_max,
        arrivalPref: s.arrival_pref,
        plansWanted: s.plans_wanted,
        user: publicUser(s.user),
      })),
    });
  });

  router.post('/concerts/:id/requests', (req, res) => {
    const error = validateRequest(req.body);
    if (error) return res.status(400).json({ error });
    try {
      const request = repos.seekers.create({ ...req.body, concert_id: req.params.id });
      res.status(201).json({ request });
    } catch (err) {
      res.status(409).json({ error: 'could_not_create_request', detail: err.message });
    }
  });

  // -------------------------------------------------------------------------
  // Matching
  // -------------------------------------------------------------------------

  /** Dry run: solve and report, write nothing. */
  router.get('/concerts/:id/match/preview', (req, res) => {
    const withBaselines = req.query.baselines === 'true';
    const withTrace = req.query.trace === 'true';

    try {
      const preview = matching.preview(req.params.id, {
        trace: withTrace,
        withBaselines,
      });
      if (preview.empty) return res.json({ empty: true, ...preview });

      res.json({
        empty: false,
        metrics: preview.metrics,
        timings: preview.timings,
        comparison: preview.comparison ?? null,
        instance: preview.profile.stats,
        solver: preview.result.stats,
        trace: withTrace ? preview.result.trace : undefined,
        assignments: [...preview.result.assignments].map(([seekerId, partyId]) => ({
          seekerId,
          partyId,
        })),
        unmatched: preview.result.unmatchedSeekers,
      });
    } catch (err) {
      res.status(500).json({ error: 'match_failed', detail: err.message });
    }
  });

  /** Commit a round. */
  router.post('/concerts/:id/match', (req, res) => {
    try {
      const outcome = matching.run(req.params.id, { trace: true });
      if (outcome.empty) return res.status(409).json({ error: 'nothing_to_match', ...outcome });
      res.status(201).json(outcome);
    } catch (err) {
      res.status(500).json({ error: 'match_failed', detail: err.message });
    }
  });

  router.get('/rounds/:id', (req, res) => {
    const round = repos.rounds.findById(req.params.id);
    if (!round) return res.status(404).json({ error: 'round_not_found' });
    res.json({
      round: {
        id: round.id,
        concertId: round.concert_id,
        algorithm: round.algorithm,
        ranAt: round.ran_at,
        isStable: round.is_stable === 1,
        blockingPairCount: round.blocking_pair_count,
        metrics: round.metrics,
        timings: round.timings,
      },
      results: repos.rounds.resultsForRound(round.id),
    });
  });

  router.get('/rounds/:id/trace', (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 2000, 10000);
    res.json({ trace: repos.rounds.traceForRound(req.params.id, limit) });
  });

  router.get('/rounds/:id/parties/:partyId', (req, res) => {
    res.json({ roster: repos.rounds.partyRoster(req.params.id, req.params.partyId) });
  });

  /**
   * Re-run the stability check against the round's own stored preference snapshot.
   * The point of this endpoint is that the claim is auditable after the fact, not
   * merely asserted at write time.
   */
  router.get('/rounds/:id/verify', (req, res) => {
    const verdict = matching.reverify(req.params.id);
    if (!verdict) return res.status(404).json({ error: 'round_not_found' });
    res.json(verdict);
  });

  /** Why did this seeker get this result? */
  router.get('/concerts/:id/explain/:requestId', (req, res) => {
    try {
      res.json(matching.explain(req.params.id, req.params.requestId));
    } catch (err) {
      res.status(500).json({ error: 'explain_failed', detail: err.message });
    }
  });

  // -------------------------------------------------------------------------
  // Ticket market
  // -------------------------------------------------------------------------

  router.get('/listings', (req, res) => {
    const query = typeof req.query.q === 'string' ? req.query.q.slice(0, 100) : '';
    res.json({ listings: repos.listings.listOpen({ query }).map(publicListing) });
  });

  router.get('/listings/:id', (req, res) => {
    const listing = repos.listings.findById(req.params.id);
    if (!listing) return res.status(404).json({ error: 'listing_not_found' });
    res.json({ listing: publicListing(listing) });
  });

  router.post('/listings/:id/orders', (req, res) => {
    const error = validateOrder(req.body);
    if (error) return res.status(400).json({ error });
    if (!repos.users.findById(req.body.buyer_user_id)) {
      return res.status(400).json({ error: 'buyer_not_found' });
    }

    try {
      const order = repos.orders.purchase({ ...req.body, listing_id: req.params.id });
      res.status(201).json({ order: publicOrder(order, repos) });
    } catch (err) {
      const status = ORDER_ERROR_STATUS[err.code];
      if (!status) throw err;
      res.status(status).json({ error: err.code });
    }
  });

  router.get('/orders/:id', (req, res) => {
    const order = repos.orders.findById(req.params.id);
    if (!order) return res.status(404).json({ error: 'order_not_found' });
    res.json({ order: publicOrder(order, repos) });
  });

  // -------------------------------------------------------------------------
  // Users
  // -------------------------------------------------------------------------

  router.get('/users/:id', (req, res) => {
    const user = repos.users.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'user_not_found' });
    res.json({ user: publicUser(user) });
  });

  router.post('/users', (req, res) => {
    const error = validateUser(req.body);
    if (error) return res.status(400).json({ error });
    try {
      res.status(201).json({ user: publicUser(repos.users.create(req.body)) });
    } catch (err) {
      res.status(409).json({ error: 'could_not_create_user', detail: err.message });
    }
  });

  return router;
}

// ---------------------------------------------------------------------------
// Response shaping — never leak email or raw internals to the client
// ---------------------------------------------------------------------------

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    displayName: user.display_name,
    ageBand: user.age_band,
    homeRegion: user.home_region,
    languages: user.languages,
    vibe: user.vibe,
    reliability: Math.round(user.reliability * 100) / 100,
    verified: Boolean(user.verified),
  };
}

function publicListing(listing) {
  return {
    id: listing.id,
    title: listing.title,
    category: listing.category,
    showDate: listing.show_date,
    seatRow: listing.seat_row,
    seatNumbers: listing.seat_numbers,
    quantity: listing.quantity,
    priceCents: listing.price_cents,
    currency: listing.currency,
    description: listing.description,
    imageUrl: listing.image_url ?? listing.concert.hero_image_url,
    verified: Boolean(listing.verified),
    status: listing.status,
    createdAt: listing.created_at,
    seller: publicUser(listing.seller),
    concert: {
      id: listing.concert.id,
      artist: listing.concert.artist,
      tourName: listing.concert.tour_name,
      venue: listing.concert.venue,
      city: listing.concert.city,
      eventDate: listing.concert.event_date,
    },
  };
}

function publicOrder(order, repos) {
  const listing = repos.listings.findById(order.listing_id);
  return {
    id: order.id,
    status: order.status,
    subtotalCents: order.subtotal_cents,
    deliveryFeeCents: order.delivery_fee_cents,
    totalCents: order.total_cents,
    currency: order.currency,
    paymentMethod: order.payment_method,
    buyerUserId: order.buyer_user_id,
    createdAt: order.created_at,
    listing: listing ? publicListing(listing) : null,
  };
}

const ORDER_ERROR_STATUS = {
  listing_not_found: 404,
  listing_unavailable: 409,
  cannot_buy_own_listing: 409,
};

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const PAYMENT_METHODS = ['visa', 'mastercard', 'paypal', 'apple_pay'];

function validateOrder(body = {}) {
  if (!body.buyer_user_id) return 'buyer_user_id_required';
  if (!PAYMENT_METHODS.includes(body.payment_method)) return 'invalid_payment_method';
  return null;
}

const SECTIONS = ['pit', 'ga_standing', 'lower_bowl', 'upper_bowl', 'seated_any'];
const ARRIVALS = ['early_queue', 'mid', 'doors'];
const AGE_BANDS = ['18-20', '21-24', '25-29', '30-34', '35+'];

function validateParty(body = {}) {
  if (!body.host_user_id) return 'host_user_id_required';
  if (!Number.isInteger(body.capacity) || body.capacity < 1) return 'capacity_must_be_positive_int';
  if (!SECTIONS.includes(body.section)) return 'invalid_section';
  if (!Number.isInteger(body.spend_band) || body.spend_band < 1 || body.spend_band > 4) {
    return 'spend_band_must_be_1_to_4';
  }
  if (!ARRIVALS.includes(body.arrival_plan)) return 'invalid_arrival_plan';
  return null;
}

function validateRequest(body = {}) {
  if (!body.user_id) return 'user_id_required';
  if (!SECTIONS.includes(body.section_pref)) return 'invalid_section_pref';
  if (!Number.isInteger(body.spend_band_max) || body.spend_band_max < 1 || body.spend_band_max > 4) {
    return 'spend_band_max_must_be_1_to_4';
  }
  if (!ARRIVALS.includes(body.arrival_pref)) return 'invalid_arrival_pref';
  return null;
}

function validateUser(body = {}) {
  if (!body.display_name) return 'display_name_required';
  if (!AGE_BANDS.includes(body.age_band)) return 'invalid_age_band';
  if (!body.home_region) return 'home_region_required';
  if (!body.gender) return 'gender_required';
  if (!body.vibe || typeof body.vibe !== 'object') return 'vibe_required';
  return null;
}
