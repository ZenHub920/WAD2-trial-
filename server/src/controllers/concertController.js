import { publicUser } from './publicUser.js';

const SECTIONS = ['pit', 'ga_standing', 'lower_bowl', 'upper_bowl', 'seated_any'];
const ARRIVALS = ['early_queue', 'mid', 'doors'];

export function createConcertController(repos) {
  return {
    list(req, res) {
      res.json({ concerts: repos.concerts.listWithCounts() });
    },

    create(req, res) {
      const artist = typeof req.body?.artist === 'string' ? req.body.artist.trim() : '';
      const venue = typeof req.body?.venue === 'string' ? req.body.venue.trim() : '';
      const eventDate = typeof req.body?.event_date === 'string' ? req.body.event_date.trim() : '';
      if (!artist) return res.status(400).json({ error: 'concert_title_required' });
      if (!venue) return res.status(400).json({ error: 'venue_required' });
      if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) {
        return res.status(400).json({ error: 'concert_date_required' });
      }

      try {
        const concert = repos.concerts.create({
          artist,
          venue,
          city: typeof req.body?.city === 'string' && req.body.city.trim()
            ? req.body.city.trim()
            : 'Singapore',
          event_date: eventDate,
        });
        res.status(201).json({ concert });
      } catch (err) {
        res.status(409).json({ error: 'could_not_create_concert', detail: err.message });
      }
    },

    detail(req, res) {
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
    },

    parties(req, res) {
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
    },

    createParty(req, res) {
      const error = validateParty(req.body);
      if (req.body && typeof req.body === 'object' && ('price_cents' in req.body || 'image_data' in req.body
        || 'priceCents' in req.body || 'imageData' in req.body)) {
        return res.status(400).json({ error: 'ticket_fields_not_allowed_on_party' });
      }
      if (error) return res.status(400).json({ error });
      try {
        const party = repos.parties.create({
          ...req.body, host_user_id: req.user.id, concert_id: req.params.id,
        });
        res.status(201).json({ party });
      } catch (err) {
        res.status(409).json({ error: 'could_not_create_party', detail: err.message });
      }
    },

    requests(req, res) {
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
    },

    createRequest(req, res) {
      const error = validateRequest(req.body);
      if (error) return res.status(400).json({ error });
      try {
        const request = repos.seekers.create({
          ...req.body, user_id: req.user.id, concert_id: req.params.id,
        });
        res.status(201).json({ request });
      } catch (err) {
        res.status(409).json({ error: 'could_not_create_request', detail: err.message });
      }
    },
  };
}

function validateParty(body = {}) {
  if (!Number.isInteger(body.capacity) || body.capacity < 1) return 'capacity_must_be_positive_int';
  if (!SECTIONS.includes(body.section)) return 'invalid_section';
  if (!Number.isInteger(body.spend_band) || body.spend_band < 1 || body.spend_band > 4) {
    return 'spend_band_must_be_1_to_4';
  }
  if (!ARRIVALS.includes(body.arrival_plan)) return 'invalid_arrival_plan';
  return null;
}

function validateRequest(body = {}) {
  if (!SECTIONS.includes(body.section_pref)) return 'invalid_section_pref';
  if (!Number.isInteger(body.spend_band_max) || body.spend_band_max < 1 || body.spend_band_max > 4) {
    return 'spend_band_max_must_be_1_to_4';
  }
  if (!ARRIVALS.includes(body.arrival_pref)) return 'invalid_arrival_pref';
  return null;
}
