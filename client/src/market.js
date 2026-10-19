/** Display and browser-saved listing helpers for the concert ticket inventory. */
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

/** A listing title combines the concert artist and its seating section. */
export function listingTitle(listing) {
  return `${listing.concert.artist}, ${sectionLabel(listing.section)}`;
}

/** Common categories offered as suggestions; sellers can type any section printed on their ticket. */
export const SECTION_SUGGESTIONS = ['Cat 1', 'Cat 2', 'Cat 3', 'Cat 4', 'Cat 5', 'Cat 6', 'VIP', 'Pen A', 'Pen B', 'Standing'];

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
 * Load a ticket listing and reload when its ID changes. Detail and checkout
 * availability pages can be opened directly or refreshed.
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
