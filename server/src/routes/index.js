/**
 * HTTP API.
 *
 * Thin by design: validation, a repository or service call, and a response shape.
 * No matching logic lives here — the engine is a library the API calls, which is
 * what lets the benchmarks exercise it without an HTTP server.
 */

import { Router } from 'express';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

import { listSolvers } from '../matching/index.js';

export function createRoutes({ repos, matching }) {
  const router = Router();

  // -------------------------------------------------------------------------
  // Concerts
  // -------------------------------------------------------------------------

  router.get('/concerts', (req, res) => {
    res.json({ concerts: repos.concerts.listWithCounts() });
  });

  router.post('/concerts', (req, res) => {
    const title = typeof req.body?.artist === 'string' ? req.body.artist.trim() : '';
    const eventDate = typeof req.body?.event_date === 'string' ? req.body.event_date.trim() : '';
    if (!title) return res.status(400).json({ error: 'concert_title_required' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) {
      return res.status(400).json({ error: 'concert_date_required' });
    }

    try {
      const concert = repos.concerts.create({
        artist: title,
        venue: req.body.venue?.trim() || 'Venue to be announced',
        city: req.body.city?.trim() || 'Singapore',
        event_date: eventDate,
      });
      res.status(201).json({ concert });
    } catch (err) {
      res.status(409).json({ error: 'could_not_create_concert', detail: err.message });
    }
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
        priceCents: p.price_cents,
        imageData: p.image_data,
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
        // Which solver ran, on what kind of instance, and what the result is
        // entitled to claim. The UI reads `ledger.headline` rather than
        // deciding for itself whether "verified stable" is warranted.
        ledger: preview.ledger ?? null,
        classification: preview.classification ?? null,
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
        solverId: round.solver_id ?? null,
        instanceClass: round.instance_class ?? null,
        stabilityPromise: round.stability_promise ?? null,
        ledger: round.ledger_json ? JSON.parse(round.ledger_json) : null,
      },
      results: repos.rounds.resultsForRound(round.id),
    });
  });

  /**
   * Every algorithm the engine knows about, with what each can and cannot
   * promise. Drives the method page, and means the guarantees are documented
   * from the same source the solver path reads.
   */
  router.get('/solvers', (req, res) => {
    res.json({ solvers: listSolvers() });
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
  // Users
  // -------------------------------------------------------------------------

  router.post('/auth/register', (req, res) => {
    const error = validateRegistration(req.body);
    if (error) return res.status(400).json({ error });

    try {
      const user = repos.users.create({
        ...req.body,
        age_band: req.body.age_band ?? '21-24',
        home_region: req.body.home_region ?? 'central',
        gender: req.body.gender ?? 'unspecified',
        vibe: req.body.vibe ?? {},
        email: req.body.email.trim().toLowerCase(),
        password_hash: hashPassword(req.body.password),
      });
      res.status(201).json({ user: publicUser(user) });
    } catch (err) {
      res.status(409).json({ error: 'could_not_create_user', detail: err.message });
    }
  });

  router.post('/auth/login', (req, res) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!email || !password) return res.status(400).json({ error: 'email_and_password_required' });

    const user = repos.users.findByEmail(email);
    if (!user?.password_hash || !verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: 'invalid_credentials' });
    }
    res.json({ user: publicUser(user) });
  });

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

function validateRegistration(body = {}) {
  if (!body.display_name || typeof body.display_name !== 'string' || !body.display_name.trim()) {
    return 'display_name_required';
  }
  if (typeof body.email !== 'string' || !body.email.trim()) return 'email_required';
  if (typeof body.password !== 'string' || body.password.length < 8) {
    return 'password_must_be_at_least_8_characters';
  }
  return null;
}

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  const [, salt, expectedHex] = stored.split('$');
  if (!salt || !expectedHex) return false;
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

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
  if (body.price_cents !== undefined && (!Number.isInteger(body.price_cents) || body.price_cents < 0)) {
    return 'price_must_be_non_negative_int';
  }
  if (body.image_data !== undefined && body.image_data !== null
      && (typeof body.image_data !== 'string' || body.image_data.length > 2_500_000)) {
    return 'image_too_large';
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
