/**
 * Synthetic instance generator.
 *
 * Produces realistic seeker/party populations at arbitrary scale, seeded so that
 * every benchmark run is reproducible. Realism matters here: an instance where
 * everyone is identical has one obvious matching and proves nothing, and an
 * instance that is uniformly random understates how often preferences collide.
 *
 * The generator therefore builds CLUSTERED populations — most people at a given
 * concert want the same few sections and the same arrival plan — which is what
 * creates genuine contention and gives blocking pairs somewhere to hide.
 */

import { mulberry32 } from '../src/matching/baselines.js';
import {
  SECTIONS,
  ARRIVAL_PLANS,
  AGE_BANDS,
  VIBE_DIMENSIONS,
  PLAN_KEYS,
} from '../src/matching/compatibility.js';

const REGIONS = ['north', 'north_east', 'east', 'west', 'central'];
const LANGUAGE_POOL = [['en'], ['en', 'zh'], ['en', 'ms'], ['en', 'ta'], ['en', 'zh', 'ms']];
const GENDERS = ['f', 'm', 'nb'];

/**
 * @param {object} options
 * @param {number} options.seekers
 * @param {number} options.parties
 * @param {number} [options.seed=1]
 * @param {number} [options.maxCapacity=3]
 * @param {number} [options.concerts=1]
 * @param {number} [options.strictness=0.15] fraction of agents setting hard filters
 */
export function generateInstance({
  seekers: seekerCount,
  parties: partyCount,
  seed = 1,
  maxCapacity = 3,
  concerts = 1,
  strictness = 0.15,
} = {}) {
  const rng = mulberry32(seed);

  const pick = (array) => array[Math.floor(rng() * array.length)];
  const int = (min, max) => min + Math.floor(rng() * (max - min + 1));
  const chance = (p) => rng() < p;

  const concertIds = Array.from({ length: concerts }, (_, i) => `c${i + 1}`);

  // Per-concert "crowd character": each event skews toward a section and an
  // arrival culture, so populations cluster instead of spreading uniformly.
  const concertProfile = new Map(
    concertIds.map((id) => [
      id,
      {
        dominantSection: pick(SECTIONS),
        dominantArrival: pick(ARRIVAL_PLANS),
        priceLevel: int(1, 3),
      },
    ]),
  );

  const makeVibe = (archetype) => {
    // Archetypes give the vibe vectors real structure, so cosine similarity
    // discriminates rather than hovering near 1 for everybody.
    const base = Object.fromEntries(VIBE_DIMENSIONS.map((d) => [d, int(0, 2)]));
    for (const dim of archetype) base[dim] = int(3, 5);
    return base;
  };

  const ARCHETYPES = [
    ['singalong', 'dancing'],
    ['photography', 'quiet'],
    ['queue_early', 'merch'],
    ['dancing', 'queue_early'],
    ['quiet', 'singalong'],
    ['merch', 'photography'],
  ];

  const makePlans = (bias) =>
    Object.fromEntries(PLAN_KEYS.map((key) => [key, chance(bias)]));

  const users = [];
  const makeUser = (id) => {
    const user = {
      id,
      display_name: `User ${id}`,
      age_band: pick(AGE_BANDS),
      home_region: pick(REGIONS),
      gender: pick(GENDERS),
      companion_gender_pref: chance(strictness) ? 'same_only' : 'any',
      languages: pick(LANGUAGE_POOL),
      vibe: makeVibe(pick(ARCHETYPES)),
      // Beta-ish: most users reliable, a minority flaky.
      reliability: chance(0.15) ? rng() * 0.5 : 0.6 + rng() * 0.4,
      verified: chance(0.6) ? 1 : 0,
    };
    users.push(user);
    return user;
  };

  const parties = [];
  for (let i = 0; i < partyCount; i += 1) {
    const concertId = pick(concertIds);
    const character = concertProfile.get(concertId);
    const host = makeUser(`uh${String(i).padStart(5, '0')}`);
    parties.push({
      id: `p${String(i).padStart(5, '0')}`,
      host_user_id: host.id,
      host,
      concert_id: concertId,
      capacity: int(1, maxCapacity),
      // 60% follow the crowd's dominant section; the rest spread out.
      section: chance(0.6) ? character.dominantSection : pick(SECTIONS),
      spend_band: Math.min(4, Math.max(1, character.priceLevel + int(-1, 1))),
      arrival_plan: chance(0.6) ? character.dominantArrival : pick(ARRIVAL_PLANS),
      plans: makePlans(0.45),
      strict_age_policy: chance(strictness) ? 1 : 0,
      min_age_band: pick(AGE_BANDS.slice(0, 3)),
    });
  }

  const seekers = [];
  for (let i = 0; i < seekerCount; i += 1) {
    const concertId = pick(concertIds);
    const character = concertProfile.get(concertId);
    const user = makeUser(`us${String(i).padStart(5, '0')}`);
    seekers.push({
      id: `s${String(i).padStart(5, '0')}`,
      user_id: user.id,
      user,
      concert_id: concertId,
      section_pref: chance(0.6) ? character.dominantSection : pick(SECTIONS),
      spend_band_max: Math.min(4, Math.max(1, character.priceLevel + int(0, 2))),
      arrival_pref: chance(0.6) ? character.dominantArrival : pick(ARRIVAL_PLANS),
      plans_wanted: makePlans(0.45),
      strict_age_policy: chance(strictness) ? 1 : 0,
      age_tolerance: int(1, 2),
    });
  }

  return { users, seekers, parties, concertIds };
}

/**
 * A hand-checkable miniature instance, used in the seed data and in the docs so
 * a reader can follow the algorithm by hand against real output.
 */
export function tinyInstance() {
  return generateInstance({ seekers: 6, parties: 3, seed: 20260929, maxCapacity: 2 });
}
