/**
 * Ticket market helpers shared by the market components and views.
 */

import { ref, watch, toValue } from 'vue';
import { api } from './api.js';

/**
 * There is no authentication, so the market acts as one seeded buyer
 * (see server/src/db/seed.js).
 */
export const DEMO_BUYER_ID = 'u_demo_buyer';

/**
 * The demo buyer's saved payment methods. Only a display mask lives here — the
 * API receives the method id, never card details.
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

/** `$310`, or `SGD $310` with `withCode`. Whole amounts drop the cents. */
export function formatMoney(cents, currency = 'SGD', { withCode = false } = {}) {
  const amount = new Intl.NumberFormat('en-SG', {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
  return withCode ? `${currency} ${amount}` : amount;
}

/** Split a price for the large display: `{ symbol: '$', whole: '310', fraction: '' }`. */
export function priceParts(cents, currency = 'SGD') {
  const parts = new Intl.NumberFormat('en-SG', {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).formatToParts(cents / 100);
  const pick = (...types) =>
    parts.filter((p) => types.includes(p.type)).map((p) => p.value).join('');
  return {
    symbol: pick('currency'),
    whole: pick('integer', 'group'),
    fraction: pick('decimal', 'fraction'),
  };
}

/** SQLite's `datetime('now')` is UTC without a zone marker; parse it as such. */
function parseDbTime(value) {
  if (!value) return null;
  const iso = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
const UNITS = [
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
];

/** "11 minutes ago", "1 hour ago", "yesterday". */
export function formatRelative(value, now = Date.now()) {
  const date = parseDbTime(value);
  if (!date) return '';
  const seconds = Math.round((date.getTime() - now) / 1000);
  for (const [unit, size] of UNITS) {
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

/** A stable hue per id, so a seller's avatar or a concert's poster never changes colour. */
export function hueFor(id = '') {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return hash % 360;
}

/**
 * Load one listing, reloading when the id changes. Each checkout step fetches it
 * afresh rather than passing it along in memory, so every step survives a refresh
 * and always shows the listing's current status.
 */
export function useListing(id) {
  const listing = ref(null);
  const loading = ref(true);
  const error = ref(null);
  let latest = 0;

  async function load() {
    const request = ++latest;
    loading.value = true;
    error.value = null;
    try {
      const body = await api.listing(toValue(id));
      if (request === latest) listing.value = body.listing;
    } catch (err) {
      if (request === latest) error.value = err;
    } finally {
      if (request === latest) loading.value = false;
    }
  }

  watch(() => toValue(id), load, { immediate: true });
  return { listing, loading, error, reload: load };
}

// ---------------------------------------------------------------------------
// Saved listings — a per-browser convenience, so localStorage is enough.
// ---------------------------------------------------------------------------

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
