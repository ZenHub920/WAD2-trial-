import { publicUser } from './publicUser.js';
import { recommendCompanions } from '../services/companionRecommendations.js';

const publicPerson = (person) => ({ ...person, user: publicUser(person.user) });

/**
 * Profiles carry an age BAND, not an age, so a band is kept when it overlaps
 * the requested range. Narrowing to bands wholly inside it would drop a
 * 24-year-old from a 20-24 search.
 */
const AGE_BAND_RANGES = {
  '18-20': [18, 20], '21-24': [21, 24], '25-29': [25, 29], '30-34': [30, 34], '35+': [35, 100],
};
function bandOverlaps(band, min, max) {
  const range = AGE_BAND_RANGES[band];
  if (!range) return true;
  return range[0] <= max && range[1] >= min;
}

export function createKakiController(repos) {
  return {
    pool(req, res) {
      const { concerts, people } = repos.kaki.pool(req.user.id);
      res.json({ concerts, people: people.map(publicPerson) });
    },

    /**
     * The deck, ordered.
     *
     * Filters narrow and the algorithm orders what is left, in that order —
     * so the ranking never puts back somebody the viewer has excluded, and
     * the stable partner it finds is stable with respect to what they asked
     * for rather than to a pool they are not looking at.
     */
    recommendations(req, res) {
      const { people } = repos.kaki.pool(req.user.id);
      const { artist, date, section, ageMin, ageMax } = req.query;
      const min = Number.isFinite(Number(ageMin)) ? Number(ageMin) : 18;
      const max = Number.isFinite(Number(ageMax)) ? Number(ageMax) : 100;

      const filtered = people.filter((person) => {
        if (artist && person.artist !== artist) return false;
        if (date && person.eventDate !== date) return false;
        if (section && person.sectionPref !== section) return false;
        // The raw pool is snake_case; publicUser camelises it only on the way
        // out, and this filter runs before that. Accept either spelling rather
        // than depend on which side of the mapper we are on.
        return bandOverlaps(person.user.age_band ?? person.user.ageBand, min, max);
      });

      const result = recommendCompanions(
        filtered,
        req.user.id,
        (userId) => repos.users.groupAnswers(userId),
      );
      res.json({ ...result, people: result.people.map(publicPerson) });
    },
    decisions(req, res) {
      const people = repos.kaki.people(req.user.id);
      res.json({ decisions: repos.kaki.decisions(req.user.id, people) });
    },
    matches(req, res) {
      const people = repos.kaki.people(req.user.id);
      const decisions = repos.kaki.decisions(req.user.id, people);
      res.json({ matches: people.filter((person) => decisions[person.id]?.mutual).map(publicPerson) });
    },
    setDecision(req, res) {
      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)
        || !['like', 'skip'].includes(req.body.decision)) {
        return res.status(400).json({ error: 'invalid_decision' });
      }
      const decision = repos.kaki.setDecision(req.user.id, req.params.concertId,
        req.params.targetUserId, req.body.decision);
      if (!decision) return res.status(404).json({ error: 'not_eligible' });
      res.json({ decision });
    },
    deleteDecision(req, res) {
      if (!repos.kaki.deleteDecision(req.user.id, req.params.concertId, req.params.targetUserId)) {
        return res.status(404).json({ error: 'not_eligible' });
      }
      res.status(204).end();
    },
  };
}
