/**
 * Kaki Finder — data layer.
 *
 * The finder needs a pool of PEOPLE, and the API has no person-search endpoint.
 * It does, however, already serve hydrated users on every seeker request:
 * `GET /api/concerts/:id/requests` returns each person's display name, age band,
 * region, languages, the six-axis vibe vector, reliability and verified flag —
 * which is everything a profile card shows. So the finder reads the pool from
 * there rather than waiting on new backend work.
 *
 * That choice has one visible consequence worth stating plainly: the pool is
 * "people looking for company at this concert", which is exactly who you want
 * to find a kaki among, but it excludes anyone who has not opened a request.
 *
 * Swipe decisions live in localStorage. Without a backend there is no shared
 * state, so a "match" here is a local record of YOUR decision, not a mutual
 * agreement between two accounts. The UI says so rather than implying a
 * stranger has agreed to anything.
 */

import { api, LABELS } from './api.js';

const STORE_KEY = 'kaki-decisions';

/* ---------------------------------------------------------------------------
 * Age bands
 *
 * Profiles carry a band ('21-24'), not an exact age, while the prototype's
 * filter is a continuous 18–100 range. A band is kept if it OVERLAPS the
 * selected range — narrowing to bands wholly inside it would silently drop
 * someone aged 24 from a 20–24 search.
 * ------------------------------------------------------------------------ */

export const AGE_BAND_RANGES = {
  '18-20': [18, 20],
  '21-24': [21, 24],
  '25-29': [25, 29],
  '30-34': [30, 34],
  '35+': [35, 100],
};

export function bandOverlaps(band, min, max) {
  const range = AGE_BAND_RANGES[band];
  if (!range) return true;
  return range[0] <= max && range[1] >= min;
}

/** The prototype shows "20, Female". We only have a band, so show the band. */
export function displayAge(band) {
  return band === '35+' ? '35+' : band;
}

/* ---------------------------------------------------------------------------
 * Interests
 *
 * The prototype's "You both like:" chips come from an interests field the
 * backend does not have. Rather than invent tags, they are derived from the
 * vibe vector, which is real data: a dimension scored 3+ is something the
 * person actively wants from a night out.
 * ------------------------------------------------------------------------ */

const STRONG_VIBE = 3;

export function interestsOf(user) {
  const vibe = user?.vibe ?? {};
  return Object.entries(vibe)
    .filter(([, score]) => score >= STRONG_VIBE)
    .sort((a, b) => b[1] - a[1])
    .map(([key]) => LABELS.vibe[key] ?? key);
}

/**
 * Interests the two of you share, best first.
 *
 * Returns `{ shared, theirs }` so the card can say "You both like" when there
 * is an overlap and fall back to "They're into" when there is not — or when
 * the viewer is signed out, or registered without ever setting a vibe, which
 * is currently every real account.
 */
export function sharedInterests(viewer, candidate) {
  const theirs = interestsOf(candidate);
  const mine = new Set(interestsOf(viewer));
  const shared = theirs.filter((label) => mine.has(label));
  return { shared, theirs };
}

/* ---------------------------------------------------------------------------
 * Avatars
 *
 * There are no profile photos in the schema. Rather than ship stock faces that
 * imply real people, each profile gets initials on a tint derived from its id,
 * so the same person is always the same colour.
 * ------------------------------------------------------------------------ */

const AVATAR_TINTS = [
  ['#efc3f5', '#4f378b'],
  ['#d9d2f5', '#2f195f'],
  ['#f5d9ec', '#8b2f6b'],
  ['#d2e7f5', '#15536b'],
  ['#d7f0e2', '#0b6b4f'],
  ['#f5e6cc', '#7a5410'],
];

export function avatarFor(user) {
  const name = user?.displayName ?? '?';
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? '')
    .join('')
    .toUpperCase();

  let hash = 0;
  for (const char of user?.id ?? name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const [bg, fg] = AVATAR_TINTS[hash % AVATAR_TINTS.length];

  return { initials, bg, fg };
}

/* ---------------------------------------------------------------------------
 * The pool
 * ------------------------------------------------------------------------ */

/**
 * Load every concert, and the people looking for company at one of them.
 *
 * Requests are fetched per concert because that is the only endpoint that
 * exposes them. They run in parallel, and one concert failing does not lose
 * the rest — a finder that shows four concerts' worth of people beats one
 * that shows an error because the fifth timed out.
 */
export async function loadPool() {
  const { concerts } = await api.concerts();

  const settled = await Promise.allSettled(
    concerts.map(async (concert) => {
      const { requests } = await api.requests(concert.id);
      return requests.map((request) => ({
        // The request id is the stable identity here: one person may be
        // looking for company at several concerts, and each is its own card.
        id: request.id,
        concertId: concert.id,
        artist: concert.artist,
        tourName: concert.tour_name,
        eventDate: concert.event_date,
        venue: concert.venue,
        sectionPref: request.sectionPref,
        spendBandMax: request.spendBandMax,
        arrivalPref: request.arrivalPref,
        plansWanted: request.plansWanted,
        user: request.user,
      }));
    }),
  );

  const people = settled
    .filter((outcome) => outcome.status === 'fulfilled')
    .flatMap((outcome) => outcome.value);

  return { concerts, people };
}

/* ---------------------------------------------------------------------------
 * Filtering
 * ------------------------------------------------------------------------ */

export const EMPTY_FILTERS = {
  artist: '',
  date: '',
  section: '',
  seat: '',
  ageMin: 18,
  ageMax: 100,
  gender: '',
};

export function applyFilters(people, filters, excludeIds = new Set()) {
  return people.filter((person) => {
    if (excludeIds.has(person.id)) return false;
    if (filters.artist && person.artist !== filters.artist) return false;
    if (filters.date && person.eventDate !== filters.date) return false;
    if (filters.section && person.sectionPref !== filters.section) return false;
    if (!bandOverlaps(person.user.ageBand, filters.ageMin, filters.ageMax)) return false;
    return true;
  });
}

/* ---------------------------------------------------------------------------
 * Decisions
 *
 * Shape: { [requestId]: { decision: 'match' | 'skip', at: epochMs } }
 * Reads are defensive because localStorage throws in private windows and can
 * hold anything a previous version wrote.
 * ------------------------------------------------------------------------ */

export function readDecisions() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function writeDecision(id, decision) {
  const all = readDecisions();
  all[id] = { decision, at: Date.now() };
  persist(all);
  return all;
}

export function clearDecision(id) {
  const all = readDecisions();
  delete all[id];
  persist(all);
  return all;
}

export function clearAllDecisions() {
  persist({});
  return {};
}

function persist(all) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(all));
  } catch {
    // Private window or storage disabled: decisions last for this session only.
  }
}

/** "1 min ago", for the history list. */
export function relativeTime(epochMs) {
  const seconds = Math.round((Date.now() - epochMs) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return `${Math.round(hours / 24)} d ago`;
}
