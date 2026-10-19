/** Companion finder data and display helpers. Decisions are owned by the API. */

import { api, LABELS } from './api.js';

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
 * Returns `{ shared, theirs }` so the card can say "You both like" only when
 * both profiles have those interests, and "They're into" otherwise.
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
 * Optional photos are displayed by UserAvatar. This stable tint decorates the
 * profile card without implying that a generated portrait is a real person.
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

  let hash = 0;
  for (const char of user?.id ?? name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const [bg, fg] = AVATAR_TINTS[hash % AVATAR_TINTS.length];

  return { bg, fg };
}

/* ---------------------------------------------------------------------------
 * The pool
 * ------------------------------------------------------------------------ */

/** The server only exposes eligible profiles at concerts the viewer participates in. */
export async function loadPool() {
  return api.kakiPool();
}

/* ---------------------------------------------------------------------------
 * Filtering
 * ------------------------------------------------------------------------ */

export const EMPTY_FILTERS = {
  artist: '',
  date: '',
  section: '',
  ageMin: 18,
  ageMax: 100,
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

/* Decisions use the stable concert:user identity returned by the pool. */
export async function readDecisions() {
  return (await api.kakiDecisions()).decisions;
}

export async function writeDecision(person, decision) {
  return (await api.putKakiDecision(person.concertId, person.user.id, decision)).decision;
}

export async function clearDecision(person) {
  await api.deleteKakiDecision(person.concertId, person.user.id);
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
