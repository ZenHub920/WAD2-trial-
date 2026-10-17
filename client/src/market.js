/** Display, checkout and saved-ticket helpers for the ticket inventory. */
import { ref, watch, toValue } from 'vue';
import { api, LABELS } from './api.js';

const money = new Intl.NumberFormat('en-SG', { style: 'currency', currency: 'SGD' });

/** `$310.00`, or `SGD $310.00` with `withCode`. */
export function formatMoney(cents, { withCode = false } = {}) {
  const amount = money.format(cents / 100);
  return withCode ? `SGD ${amount}` : amount;
}

/** Split a price for the large display: `{ symbol: '$', whole: '310', fraction: '' }`. */
export function priceParts(cents) {
  const parts = new Intl.NumberFormat('en-SG', {
    style: 'currency',
    currency: 'SGD',
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).formatToParts(cents / 100);
  const pick = (...types) =>
    parts.filter((p) => types.includes(p.type)).map((p) => p.value).join('');
  return { symbol: pick('currency'), whole: pick('integer', 'group'), fraction: pick('decimal', 'fraction') };
}

/** Sections are free text ("Cat 3"); older listings may hold a matching-section key. */
export function sectionLabel(section) {
  return LABELS.section[section] ?? section;
}

/** A listing has no title of its own: it is the concert plus the section, e.g. "KIYOKO · Cat 1". */
export function listingTitle(listing) {
  return `${listing.concert.artist}, ${sectionLabel(listing.section)}`;
}

/** Common categories offered as suggestions; sellers can type any section printed on their ticket. */
export const SECTION_SUGGESTIONS = ['Cat 1', 'Cat 2', 'Cat 3', 'Cat 4', 'Cat 5', 'Cat 6', 'VIP', 'Pen A', 'Pen B', 'Standing'];

/**
 * Checkout is simulated: these are a demo buyer's saved methods. Only a display
 * mask lives here — the API receives the method id, never card details.
 */
export const PAYMENT_METHODS = [
  { id: 'visa', label: 'Visa', mask: '2109' },
  { id: 'paypal', label: 'PayPal', mask: '2129' },
  { id: 'mastercard', label: 'Mastercard', mask: '3345' },
  { id: 'apple_pay', label: 'Apple Pay', mask: '7788' },
];

export function paymentMethod(id) {
  return PAYMENT_METHODS.find((m) => m.id === id) ?? null;
}

/** SQLite's `datetime('now')` is UTC without a zone marker; parse it as such. */
function parseDbTime(value) {
  if (!value) return null;
  const date = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

/** "11 minutes ago", "1 hour ago", "yesterday". */
export function formatRelative(value, now = Date.now()) {
  const date = parseDbTime(value);
  if (!date) return '';
  const seconds = Math.round((date.getTime() - now) / 1000);
  for (const [unit, size] of [['day', 86_400], ['hour', 3_600], ['minute', 60]]) {
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
  }
  return 'just now';
}

export function formatDateTime(value) {
  const date = parseDbTime(value);
  if (!date) return '';
  return date.toLocaleString('en-SG', {
    day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

/**
 * Load one ticket listing, reloading when the id changes. Each checkout step
 * fetches it afresh, so every step survives a refresh and shows current status.
 */
export function useTicket(id) {
  const listing = ref(null);
  const loading = ref(true);
  const error = ref(null);
  let latest = 0;

  async function load() {
    const request = ++latest;
    loading.value = true;
    error.value = null;
    try {
      const body = await api.ticket(toValue(id));
      if (request === latest) listing.value = body.listing;
    } catch (err) {
      if (request === latest) error.value = err;
    } finally {
      if (request === latest) loading.value = false;
    }
  }

  watch(() => toValue(id), load, { immediate: true });
  return { listing, loading, error };
}

/* ---------------------------------------------------------------------------
 * Demand ranking — what the market shows before anyone has searched
 * ------------------------------------------------------------------------ */

/** Whole days from `now` until a `YYYY-MM-DD` event date; negative once it has passed. */
export function daysUntil(eventDate, now = Date.now()) {
  if (!eventDate) return null;
  const date = new Date(`${String(eventDate).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return Math.round((date.getTime() - now) / 86_400_000);
}

/**
 * How contested one concert is.
 *
 * The market's stock is seller-supplied, so on a quiet day there is genuinely
 * nothing listed — and a grid answering "no results" to someone who has not
 * searched for anything yet is a dead end. The page therefore opens on the
 * concerts people are actually competing over, ranked by the three things that
 * decide whether a ticket is hard to get:
 *
 *   interest  how many people are involved at all: seekers looking for company,
 *             spare seats offered inside groups, and tickets on resale. Resale
 *             counts double — a listed ticket is a committed transaction, not
 *             an intention.
 *   scarcity  seekers per available place. Above 1 means more people want in
 *             than there are places, which is what makes a concert hot rather
 *             than merely large.
 *   urgency   how near the date is, taken to zero at four months out. The same
 *             show moves faster next week than it does next year.
 *
 *   score = interest × (1 + scarcity) × (1 + ½ urgency)
 *
 * Multiplying rather than adding is the point: scarcity and urgency modify
 * interest that already exists. A concert nobody has joined has interest 0 and
 * stays bottom however extreme its ratio — otherwise an empty concert with one
 * seeker and no slots (scarcity 1.0) would outrank a busy, well-supplied one.
 */
export function concertHeat(concert, { listings = 0, now = Date.now() } = {}) {
  const seekers = concert.open_seekers ?? 0;
  const slots = concert.open_slots ?? 0;
  const places = slots + listings;

  const interest = seekers + slots + listings * 2;
  // +1 keeps a concert with no places at all from dividing by zero.
  const scarcity = seekers / (places + 1);
  const days = daysUntil(concert.event_date, now);
  const urgency = days === null ? 0 : Math.max(0, Math.min(1, 1 - days / 120));

  return {
    score: interest * (1 + scarcity) * (1 + urgency * 0.5),
    interest,
    scarcity,
    urgency,
    days,
    seekers,
    slots,
    listings,
  };
}

/**
 * Scarcity turned into a label. Ordered loosest-last so the first match wins,
 * and keyed by id so a card can colour itself from the same decision.
 */
export const HEAT_TIERS = [
  { id: 'surging', label: 'Selling out', min: 1.2 },
  { id: 'hot', label: 'High demand', min: 0.8 },
  { id: 'steady', label: 'Filling up', min: 0.35 },
  { id: 'open', label: 'Places going spare', min: 0 },
];

export function heatTier(scarcity) {
  return HEAT_TIERS.find((tier) => scarcity >= tier.min) ?? HEAT_TIERS.at(-1);
}

/**
 * Concerts in demand order, each carrying its resale summary, so the market can
 * recommend a concert whether or not anybody has listed a ticket for it yet.
 * Concerts already past are dropped: they cannot be a recommendation.
 */
export function rankConcerts(concerts = [], listings = [], { now = Date.now() } = {}) {
  const resale = new Map();
  for (const listing of listings) {
    const id = listing.concert?.id;
    if (!id) continue;
    const entry = resale.get(id) ?? { count: 0, fromCents: Infinity };
    entry.count += 1;
    entry.fromCents = Math.min(entry.fromCents, listing.priceCents);
    resale.set(id, entry);
  }

  return concerts
    .filter((concert) => (daysUntil(concert.event_date, now) ?? -1) >= 0)
    .map((concert) => {
      const sale = resale.get(concert.id) ?? { count: 0, fromCents: Infinity };
      const heat = concertHeat(concert, { listings: sale.count, now });
      return {
        concert,
        heat,
        tier: heatTier(heat.scarcity),
        onSale: sale.count,
        fromCents: Number.isFinite(sale.fromCents) ? sale.fromCents : null,
      };
    })
    .sort((a, b) => b.heat.score - a.heat.score || (a.heat.days ?? 0) - (b.heat.days ?? 0))
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

/** Keep the fallback poster and seller avatar colours stable across visits. */
export function hueFor(id = '') {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return hash % 360;
}

// Saved listings are a convenience for this browser, not an account-level feature.

const SAVED_KEY = 'encore-saved-listings';

function readSaved() {
  try {
    return new Set(JSON.parse(localStorage.getItem(SAVED_KEY) ?? '[]'));
  } catch {
    return new Set();
  }
}

// Module-level so every card on the page shares one source of truth.
const saved = ref(readSaved());

export function useSavedListings() {
  function toggle(id) {
    const next = new Set(saved.value);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    saved.value = next;
    try {
      localStorage.setItem(SAVED_KEY, JSON.stringify([...next]));
    } catch {
      // Storage can be unavailable (private mode); the toggle still works for this visit.
    }
  }

  return { isSaved: (id) => saved.value.has(id), toggle };
}
