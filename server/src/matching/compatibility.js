/**
 * Compatibility scoring.
 *
 * Turns a (seeker, party) pair into:
 *   - a feasibility verdict driven by HARD constraints, and
 *   - two DIRECTIONAL scores in [0,1], because the two sides value different things.
 *
 * See docs/ALGORITHM.md §3 and §4.
 */

export const SECTIONS = ['pit', 'ga_standing', 'lower_bowl', 'upper_bowl', 'seated_any'];

/** Ordinal proximity of seating sections. Index distance 1 counts as "adjacent". */
const SECTION_ORDER = {
  pit: 0,
  ga_standing: 1,
  lower_bowl: 2,
  upper_bowl: 3,
  seated_any: 2, // "anything seated" sits between the two seated tiers
};

export const ARRIVAL_PLANS = ['early_queue', 'mid', 'doors'];
const ARRIVAL_ORDER = { early_queue: 0, mid: 1, doors: 2 };

export const AGE_BANDS = ['18-20', '21-24', '25-29', '30-34', '35+'];
const AGE_ORDER = Object.fromEntries(AGE_BANDS.map((b, i) => [b, i]));

export const VIBE_DIMENSIONS = [
  'singalong',
  'photography',
  'dancing',
  'quiet',
  'queue_early',
  'merch',
];

export const PLAN_KEYS = ['pre_meetup', 'post_supper', 'merch_run', 'transport_share'];

/** Coarse geography. Adjacency is a small hand-built graph, not a distance metric. */
const REGION_ADJACENCY = {
  north: ['central', 'north_east'],
  north_east: ['north', 'east', 'central'],
  east: ['north_east', 'central'],
  west: ['central', 'north'],
  central: ['north', 'north_east', 'east', 'west'],
};

// ---------------------------------------------------------------------------
// Hard constraints
// ---------------------------------------------------------------------------

/**
 * Decide whether a seeker and a party may appear on each other's preference lists.
 *
 * Returns { feasible: boolean, reason?: string }. The reason is retained for the
 * UI ("why am I not seeing this listing?") and for debugging the gate itself.
 */
export function checkFeasibility(seeker, party, options = {}) {
  const { blocklist = new Set() } = options;

  if (seeker.concert_id !== party.concert_id) {
    return { feasible: false, reason: 'different_concert' };
  }

  if (seeker.user_id === party.host_user_id) {
    return { feasible: false, reason: 'self_match' };
  }

  // Guarded because the common case is an empty blocklist, and building two
  // template strings per pair is measurable across millions of pairs.
  if (blocklist.size > 0) {
    if (
      blocklist.has(`${seeker.user_id}:${party.host_user_id}`) ||
      blocklist.has(`${party.host_user_id}:${seeker.user_id}`)
    ) {
      return { feasible: false, reason: 'blocked' };
    }
  }

  // Affordability: the seeker must be able to cover the party's expected spend band.
  if (seeker.spend_band_max < party.spend_band) {
    return { feasible: false, reason: 'unaffordable' };
  }

  // Gender preference, enforced symmetrically.
  const seekerUser = seeker.user;
  const hostUser = party.host;
  if (seekerUser.companion_gender_pref === 'same_only' && seekerUser.gender !== hostUser.gender) {
    return { feasible: false, reason: 'seeker_gender_pref' };
  }
  if (hostUser.companion_gender_pref === 'same_only' && hostUser.gender !== seekerUser.gender) {
    return { feasible: false, reason: 'host_gender_pref' };
  }

  // Age policy, enforced only when a side has opted into strictness.
  const seekerAge = AGE_ORDER[seekerUser.age_band];
  const hostAge = AGE_ORDER[hostUser.age_band];
  if (party.strict_age_policy) {
    const minIdx = AGE_ORDER[party.min_age_band ?? AGE_BANDS[0]];
    if (seekerAge < minIdx) return { feasible: false, reason: 'below_party_min_age' };
  }
  if (seeker.strict_age_policy) {
    const tolerance = seeker.age_tolerance ?? 1;
    if (Math.abs(seekerAge - hostAge) > tolerance) {
      return { feasible: false, reason: 'age_gap_outside_tolerance' };
    }
  }

  return { feasible: true };
}

// ---------------------------------------------------------------------------
// Score components — each returns a value in [0,1]
// ---------------------------------------------------------------------------

export function sectionScore(seekerPref, partySection) {
  if (seekerPref === partySection) return 1;
  const a = SECTION_ORDER[seekerPref];
  const b = SECTION_ORDER[partySection];
  if (a === undefined || b === undefined) return 0.2;
  return Math.abs(a - b) <= 1 ? 0.6 : 0.2;
}

/**
 * Dense-array + magnitude cache for vibe vectors.
 *
 * Profiling showed cosine similarity was the single largest cost in preference
 * construction: for every one of millions of pairs it walked six object property
 * lookups per side and took two square roots. Each user's vector and its magnitude
 * are fixed for the lifetime of a round, so both are computed once and cached.
 *
 * A WeakMap keyed by the user object keeps this transparent — nothing mutates the
 * caller's data, and the cache is collected with the objects it describes.
 */
const vibeCache = new WeakMap();

function vibeVector(vibe) {
  if (!vibe) return { values: new Float64Array(VIBE_DIMENSIONS.length), magnitude: 0 };
  const cached = vibeCache.get(vibe);
  if (cached) return cached;

  const values = new Float64Array(VIBE_DIMENSIONS.length);
  let sumSquares = 0;
  for (let i = 0; i < VIBE_DIMENSIONS.length; i += 1) {
    const v = vibe[VIBE_DIMENSIONS[i]] ?? 0;
    values[i] = v;
    sumSquares += v * v;
  }
  const entry = { values, magnitude: Math.sqrt(sumSquares) };
  vibeCache.set(vibe, entry);
  return entry;
}

/** Cosine similarity over the 6-dimensional vibe vector. */
export function vibeScore(vibeA, vibeB) {
  const a = vibeVector(vibeA);
  const b = vibeVector(vibeB);
  if (a.magnitude === 0 || b.magnitude === 0) return 0;

  let dot = 0;
  for (let i = 0; i < VIBE_DIMENSIONS.length; i += 1) {
    dot += a.values[i] * b.values[i];
  }
  return dot / (a.magnitude * b.magnitude);
}

export function arrivalScore(seekerPref, partyPlan) {
  const a = ARRIVAL_ORDER[seekerPref];
  const b = ARRIVAL_ORDER[partyPlan];
  if (a === undefined || b === undefined) return 0.5;
  const gap = Math.abs(a - b);
  return gap === 0 ? 1 : gap === 1 ? 0.5 : 0;
}

/** Jaccard index over the set of desired activities. */
export function plansScore(plansA, plansB) {
  let intersection = 0;
  let union = 0;
  for (const key of PLAN_KEYS) {
    const a = Boolean(plansA?.[key]);
    const b = Boolean(plansB?.[key]);
    if (a && b) intersection += 1;
    if (a || b) union += 1;
  }
  if (union === 0) return 0.5; // neither wants extras — neutral, not incompatible
  return intersection / union;
}

export function languageScore(langsA = [], langsB = []) {
  const setB = new Set(langsB);
  return langsA.some((l) => setB.has(l)) ? 1 : 0;
}

export function regionScore(regionA, regionB) {
  if (regionA === regionB) return 1;
  if (REGION_ADJACENCY[regionA]?.includes(regionB)) return 0.5;
  return 0.2;
}

export function reliabilityScore(user) {
  const base = user.reliability ?? 0.5;
  return Math.min(1, base + (user.verified ? 0.1 : 0));
}

/** Rewards a close budget fit; a seeker far above the party's band scores lower. */
export function budgetFitScore(seekerMax, partyBand) {
  const gap = seekerMax - partyBand;
  if (gap < 0) return 0; // should already have been filtered as infeasible
  return Math.max(0, 1 - gap / 3);
}

// ---------------------------------------------------------------------------
// Directional weights
// ---------------------------------------------------------------------------

export const WEIGHTS = {
  seekerToParty: {
    section: 0.22,
    vibe: 0.24,
    arrival: 0.12,
    plans: 0.14,
    language: 0.08,
    region: 0.06,
    reliability: 0.10,
    budgetFit: 0.04,
  },
  partyToSeeker: {
    section: 0.12,
    vibe: 0.22,
    arrival: 0.10,
    plans: 0.12,
    language: 0.08,
    region: 0.06,
    reliability: 0.26,
    budgetFit: 0.04,
  },
};

for (const [side, weights] of Object.entries(WEIGHTS)) {
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  if (Math.abs(total - 1) > 1e-9) {
    throw new Error(`Weight vector "${side}" sums to ${total}, expected 1`);
  }
}

/**
 * Score a feasible pair from both directions in one pass.
 *
 * Components are computed once and combined under two different weight vectors,
 * which is what makes the two preference orderings genuinely different.
 *
 * @returns {{ components: object, seekerToParty: number, partyToSeeker: number }}
 */
export function scorePair(seeker, party) {
  const seekerUser = seeker.user;
  const hostUser = party.host;

  const components = {
    section: sectionScore(seeker.section_pref, party.section),
    vibe: vibeScore(seekerUser.vibe, hostUser.vibe),
    arrival: arrivalScore(seeker.arrival_pref, party.arrival_plan),
    plans: plansScore(seeker.plans_wanted, party.plans),
    language: languageScore(seekerUser.languages, hostUser.languages),
    region: regionScore(seekerUser.home_region, hostUser.home_region),
    budgetFit: budgetFitScore(seeker.spend_band_max, party.spend_band),
    // reliability is directional: each side judges the OTHER side's reliability
    reliabilityOfHost: reliabilityScore(hostUser),
    reliabilityOfSeeker: reliabilityScore(seekerUser),
  };

  const combine = (weights, reliability) =>
    weights.section * components.section +
    weights.vibe * components.vibe +
    weights.arrival * components.arrival +
    weights.plans * components.plans +
    weights.language * components.language +
    weights.region * components.region +
    weights.reliability * reliability +
    weights.budgetFit * components.budgetFit;

  return {
    components,
    seekerToParty: round6(
      combine(WEIGHTS.seekerToParty, components.reliabilityOfHost),
    ),
    partyToSeeker: round6(
      combine(WEIGHTS.partyToSeeker, components.reliabilityOfSeeker),
    ),
  };
}

/** Rounding keeps scores stable across platforms so tie-breaking is reproducible. */
export function round6(n) {
  return Math.round(n * 1e6) / 1e6;
}
