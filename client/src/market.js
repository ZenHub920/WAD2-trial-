/** Browser-only display and saved-ticket helpers for the existing ticket inventory. */
import { ref } from 'vue';

const money = new Intl.NumberFormat('en-SG', { style: 'currency', currency: 'SGD' });

export function formatMoney(cents) {
  return money.format(cents / 100);
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
