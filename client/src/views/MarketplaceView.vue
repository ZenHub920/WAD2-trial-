<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { api, formatDate } from '../api.js';
import {
  formatMoney,
  rankConcerts,
  SECTION_SUGGESTIONS,
  sectionLabel,
  useSavedListings,
} from '../market.js';
import ListingCard from '../components/market/ListingCard.vue';
import ConcertSpotlightCard from '../components/market/ConcertSpotlightCard.vue';
import DateField from '../components/market/DateField.vue';
import MarketIcon from '../components/market/MarketIcon.vue';
import PriceRange from '../components/market/PriceRange.vue';

const listings = ref([]);
const concerts = ref([]);
const loading = ref(true);
const error = ref('');
// One feed can fail while the other works; say so in that block rather than
// letting an empty grid read as "nobody has listed anything".
const ticketError = ref('');
const concertError = ref('');

const { isSaved, toggle } = useSavedListings();

/**
 * One object holds the whole query, which is what makes "has the visitor
 * narrowed anything?" a single comparison against the defaults rather than six
 * separate conditions scattered through the template.
 */
const DEFAULTS = {
  search: '',
  date: '',
  section: 'all',
  min: '',
  max: '',
  savedOnly: false,
  sort: 'newest',
};
/** What an empty price box means. Left out of DEFAULTS so the fields show their placeholders. */
const BOUNDS = { min: 0, max: 100000 };
const filters = ref({ ...DEFAULTS });

const SORTS = [
  { id: 'newest', label: 'Newest listings' },
  { id: 'price_asc', label: 'Price: low to high' },
  { id: 'price_desc', label: 'Price: high to low' },
  { id: 'soonest', label: 'Event date: soonest' },
];

/** An emptied number box reads as `''`; that means "no bound", not zero. */
const normalised = computed(() => ({
  search: filters.value.search.trim(),
  date: filters.value.date,
  section: filters.value.section,
  min: Number.isFinite(filters.value.min) ? filters.value.min : BOUNDS.min,
  max: Number.isFinite(filters.value.max) ? filters.value.max : BOUNDS.max,
  savedOnly: filters.value.savedOnly,
  sort: filters.value.sort,
}));

/** True once anything has been narrowed — the page shows results instead of recommendations. */
const refining = computed(() => Object.keys(DEFAULTS).some((key) => {
  const value = filters.value[key];
  return (typeof value === 'string' ? value.trim() : value) !== DEFAULTS[key];
}));

onMounted(async () => {
  // The two feeds are independent: a failed concert list must not take the
  // ticket grid down with it, and vice versa.
  const [tickets, shows] = await Promise.allSettled([api.tickets(), api.concerts()]);
  const reason = (result) => result.reason?.body?.error ?? result.reason?.message ?? 'request_failed';
  if (tickets.status === 'fulfilled') listings.value = tickets.value.listings;
  else ticketError.value = reason(tickets);
  if (shows.status === 'fulfilled') concerts.value = shows.value.concerts;
  else concertError.value = reason(shows);
  if (ticketError.value && concertError.value) error.value = ticketError.value;
  loading.value = false;
});

/* ---- The filter bar ------------------------------------------------------ */

const PANEL_KEY = 'encore-market-filters-open';
/** Starts minimised: the results matter more than the controls that found them. */
const panelOpen = ref(localStorage.getItem(PANEL_KEY) === '1');
watch(panelOpen, (open) => {
  try {
    localStorage.setItem(PANEL_KEY, open ? '1' : '0');
  } catch {
    // Private browsing; the panel simply forgets its state between visits.
  }
});

/** Sections are free text, so offer the ones actually listed — or the usual set when nothing is. */
const sections = computed(() => {
  const listed = [...new Set(listings.value.map((l) => l.section))];
  if (!listed.length) return SECTION_SUGGESTIONS;
  return listed.sort((a, b) =>
    sectionLabel(a).localeCompare(sectionLabel(b), undefined, { numeric: true }));
});

const priceNarrowed = computed(() =>
  filters.value.min !== DEFAULTS.min || filters.value.max !== DEFAULTS.max);

/**
 * The slider's track is scaled to what is actually for sale. On a fixed
 * 0–100,000 scale every real ticket would sit in the first half-percent of it,
 * and dragging would be hopeless.
 */
const priceBounds = computed(() => {
  const prices = listings.value.map((l) => l.priceCents / 100);
  if (!prices.length) return { floor: 0, ceil: 500 };
  const low = Math.max(0, Math.floor(Math.min(...prices) / 10) * 10);
  const high = Math.ceil(Math.max(...prices) / 10) * 10;
  return { floor: low, ceil: high > low ? high : low + 10 };
});

/** One object for the range control, writing back to the two filter fields. */
const priceRange = computed({
  get: () => ({ min: filters.value.min, max: filters.value.max }),
  set: ({ min, max }) => {
    filters.value.min = min;
    filters.value.max = max;
  },
});

/**
 * The active filters, as removable chips. Shown in the collapsed bar so
 * minimising the panel never hides what is narrowing the results.
 */
const chips = computed(() => {
  const n = normalised.value;
  const out = [];
  if (n.search) out.push({ key: 'search', label: `“${n.search}”`, clear: () => { filters.value.search = ''; } });
  if (n.date) out.push({ key: 'date', label: formatDate(n.date), clear: () => { filters.value.date = ''; } });
  if (n.section !== DEFAULTS.section) {
    out.push({ key: 'section', label: sectionLabel(n.section), clear: () => { filters.value.section = DEFAULTS.section; } });
  }
  if (priceNarrowed.value) {
    // Only name the bound that was actually set; the other one is not a filter.
    const hasMin = filters.value.min !== DEFAULTS.min;
    const hasMax = filters.value.max !== DEFAULTS.max;
    const label = hasMin && hasMax
      ? `${formatMoney(n.min * 100)} – ${formatMoney(n.max * 100)}`
      : hasMin ? `Over ${formatMoney(n.min * 100)}` : `Under ${formatMoney(n.max * 100)}`;
    out.push({
      key: 'price',
      label,
      clear: () => { filters.value.min = DEFAULTS.min; filters.value.max = DEFAULTS.max; },
    });
  }
  if (n.savedOnly) out.push({ key: 'saved', label: 'Saved only', clear: () => { filters.value.savedOnly = false; } });
  if (n.sort !== DEFAULTS.sort) {
    out.push({
      key: 'sort',
      label: SORTS.find((s) => s.id === n.sort)?.label ?? n.sort,
      clear: () => { filters.value.sort = DEFAULTS.sort; },
    });
  }
  return out;
});

function resetFilters() {
  filters.value = { ...DEFAULTS };
}

/* ---- Results ------------------------------------------------------------- */

function matchesText(haystacks, query) {
  return haystacks.some((value) => String(value ?? '').toLowerCase().includes(query));
}

const filteredListings = computed(() => {
  const n = normalised.value;
  const query = n.search.toLowerCase();
  const found = listings.value.filter((listing) => {
    if (n.savedOnly && !isSaved(listing.id)) return false;
    if (query && !matchesText(
      [listing.concert.artist, listing.concert.venue, listing.concert.city, listing.seller.displayName, sectionLabel(listing.section)],
      query,
    )) return false;
    if (n.date && listing.concert.event_date.slice(0, 10) !== n.date) return false;
    if (n.section !== 'all' && listing.section !== n.section) return false;
    const price = listing.priceCents / 100;
    return price >= n.min && price <= n.max;
  });

  const sorted = [...found];
  if (n.sort === 'price_asc') sorted.sort((a, b) => a.priceCents - b.priceCents);
  else if (n.sort === 'price_desc') sorted.sort((a, b) => b.priceCents - a.priceCents);
  else if (n.sort === 'soonest') {
    sorted.sort((a, b) => a.concert.event_date.localeCompare(b.concert.event_date));
  }
  // 'newest' is the order the API already returns.
  return sorted;
});

/** Every upcoming concert in demand order, each with its resale summary. */
const ranked = computed(() => rankConcerts(concerts.value, listings.value));

/**
 * Concerts are narrowed by the things that describe a concert — text and date.
 * Price and seat section describe a *listing*, so applying them here would hide
 * concerts that simply have no resale yet, which is the opposite of the point.
 */
const matchingConcerts = computed(() => {
  const n = normalised.value;
  const query = n.search.toLowerCase();
  if (!query && !n.date) return ranked.value;
  return ranked.value.filter(({ concert }) => {
    if (n.date && concert.event_date.slice(0, 10) !== n.date) return false;
    if (!query) return true;
    return matchesText([concert.artist, concert.tour_name, concert.venue, concert.city], query);
  });
});

/**
 * Price and seat section narrow tickets, not concerts — so when those are the
 * only thing set, the rail below is not "what you searched for", it is what is
 * still worth opening.
 */
const concertsNarrowed = computed(() => Boolean(normalised.value.search || normalised.value.date));

const concertHeading = computed(() => {
  if (!refining.value) return 'Hottest concerts right now';
  return concertsNarrowed.value ? 'Concerts matching your search' : 'Concerts you could still join';
});

const concertNote = computed(() => {
  if (!refining.value) return 'Ranked by how many people are chasing places — seekers against spare seats and resale.';
  return 'Open a concert to join its matching round, or see what is on resale.';
});

const SPOTLIGHT = 6;
const showAllConcerts = ref(false);
const visibleConcerts = computed(() =>
  (showAllConcerts.value ? matchingConcerts.value : matchingConcerts.value.slice(0, SPOTLIGHT)));

const summary = computed(() => {
  if (loading.value) return 'Loading the market…';
  const tickets = filteredListings.value.length;
  const shows = matchingConcerts.value.length;
  if (refining.value) {
    return `${tickets} ${tickets === 1 ? 'ticket' : 'tickets'} · ${shows} ${shows === 1 ? 'concert' : 'concerts'}`;
  }
  if (!tickets) return `No tickets listed yet · ${shows} ${shows === 1 ? 'concert' : 'concerts'} matching now`;
  return `${tickets} ${tickets === 1 ? 'ticket' : 'tickets'} on sale · ${shows} upcoming ${shows === 1 ? 'concert' : 'concerts'}`;
});

/* ---- Jumping from a recommendation to its tickets ------------------------ */

const ticketsBlock = ref(null);

function focusArtist(artist) {
  filters.value = { ...DEFAULTS, search: artist };
  const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  requestAnimationFrame(() => {
    ticketsBlock.value?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
  });
}

function onKeydown(event) {
  if (event.key === 'Escape' && panelOpen.value) panelOpen.value = false;
}
onMounted(() => window.addEventListener('keydown', onKeydown));
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown));
</script>

<template>
  <div class="marketplace">
    <div class="marketplace__shell container container--wide">
      <header class="marketplace__top">
        <div>
          <p class="eyebrow">Resale</p>
          <h1 class="marketplace__title">Ticket market</h1>
        </div>
        <p class="marketplace__summary" role="status">{{ summary }}</p>
      </header>

      <!-- The search and filter bar: a search field and a toggle, with the
           controls in a panel the visitor can minimise. Active filters stay
           visible as chips whether or not the panel is open. -->
      <div class="bar" :class="{ 'bar--open': panelOpen }">
        <div class="bar__row">
          <label class="bar__search">
            <MarketIcon name="search" :size="18" />
            <input
              v-model="filters.search"
              type="search"
              aria-label="Search tickets and concerts"
              placeholder="Search artist, venue or seller"
            />
            <button
              v-if="filters.search"
              type="button"
              class="bar__clear"
              aria-label="Clear search"
              @click="filters.search = ''"
            >
              <MarketIcon name="close" :size="15" />
            </button>
          </label>

          <button
            type="button"
            class="bar__toggle"
            :aria-expanded="panelOpen"
            aria-controls="market-filters"
            @click="panelOpen = !panelOpen"
          >
            <MarketIcon name="filters" :size="18" />
            <span>Filters</span>
            <span v-if="chips.length" class="bar__count tabular">{{ chips.length }}</span>
            <MarketIcon name="chevron" :size="16" class="bar__chevron" />
          </button>
        </div>

        <TransitionGroup v-if="chips.length" tag="div" name="chip" class="bar__chips">
          <button
            v-for="chip in chips"
            :key="chip.key"
            type="button"
            class="chip"
            :aria-label="`Remove filter ${chip.label}`"
            @click="chip.clear()"
          >
            {{ chip.label }}
            <MarketIcon name="close" :size="13" />
          </button>
          <button key="reset" type="button" class="chip chip--reset" @click="resetFilters">
            Clear all
          </button>
        </TransitionGroup>

        <!-- Collapsed with a grid row that animates from 0fr; `inert` keeps the
             hidden controls out of the tab order and the accessibility tree. -->
        <div class="bar__drawer" :class="{ 'bar__drawer--open': panelOpen }">
          <div id="market-filters" class="panel" :inert="panelOpen ? undefined : true">
            <div class="panel__grid">
              <!-- A group of three inputs, so it is named by a <span>, not wrapped
                   in a <label> that could only point at one of them. -->
              <div class="panel__field">
                <span id="market-date-label">Event date</span>
                <DateField v-model="filters.date" labelled-by="market-date-label" />
              </div>
              <label>
                Seat section
                <select v-model="filters.section">
                  <option value="all">Any section</option>
                  <option v-for="section in sections" :key="section" :value="section">
                    {{ sectionLabel(section) }}
                  </option>
                </select>
              </label>
              <div class="panel__field panel__field--wide">
                <span id="market-price-label">Price range</span>
                <PriceRange
                  v-model="priceRange"
                  :floor="priceBounds.floor"
                  :ceil="priceBounds.ceil"
                  aria-labelledby="market-price-label"
                />
              </div>
              <label>
                Sort tickets by
                <select v-model="filters.sort">
                  <option v-for="option in SORTS" :key="option.id" :value="option.id">{{ option.label }}</option>
                </select>
              </label>
              <!-- Carries a label like its neighbours so it sits on their line;
                   aligning a bare button to the row's edge drifts once the row
                   grows taller than one input. -->
              <div class="panel__field">
                <span id="market-saved-label">Saved tickets</span>
                <button
                  type="button"
                  class="switch"
                  :aria-pressed="filters.savedOnly"
                  aria-labelledby="market-saved-label"
                  @click="filters.savedOnly = !filters.savedOnly"
                >
                  <MarketIcon :name="filters.savedOnly ? 'bookmark-filled' : 'bookmark'" :size="17" />
                  Saved only
                </button>
              </div>
            </div>

            <div class="panel__foot">
              <!-- No "minimise" button: the Filters toggle above and Escape both
                   close the drawer, so a third control would only repeat them. -->
              <button type="button" class="text-button" @click="resetFilters">Reset</button>
            </div>
          </div>
        </div>
      </div>

      <div v-if="error" class="notice notice--error">
        <h3>Could not load the market</h3>
        <p>
          Start the backend from <code>server/</code>:
          <code>npm install &amp;&amp; npm run seed &amp;&amp; npm start</code>
        </p>
        <p class="mono">{{ error }}</p>
      </div>

      <div v-else-if="loading" class="ticket-grid">
        <div v-for="n in 6" :key="n" class="skeleton" />
      </div>

      <!-- Recommendations come first until the visitor narrows something, at
           which point their results take the top. One markup order, two
           reading orders. -->
      <div v-else class="results" :class="{ 'results--refining': refining }">
        <section v-if="matchingConcerts.length" class="block block--concerts" aria-labelledby="concerts-heading">
          <header class="block__head">
            <div>
              <h2 id="concerts-heading">{{ concertHeading }}</h2>
              <p class="block__note">{{ concertNote }}</p>
            </div>
            <button
              v-if="matchingConcerts.length > SPOTLIGHT"
              type="button"
              class="text-button"
              @click="showAllConcerts = !showAllConcerts"
            >
              {{ showAllConcerts ? 'Show fewer' : `Show all ${matchingConcerts.length}` }}
            </button>
          </header>

          <TransitionGroup tag="div" name="pop" class="concert-grid">
            <ConcertSpotlightCard
              v-for="row in visibleConcerts"
              :key="row.concert.id"
              :concert="row.concert"
              :rank="row.rank"
              :tier="row.tier"
              :heat="row.heat"
              :on-sale="row.onSale"
              :from-cents="row.fromCents"
              @filter="focusArtist"
            />
          </TransitionGroup>
        </section>

        <section ref="ticketsBlock" class="block block--tickets" aria-labelledby="tickets-heading">
          <header class="block__head">
            <div>
              <h2 id="tickets-heading">{{ refining ? 'Tickets matching your filters' : 'Tickets on resale' }}</h2>
              <p class="block__note">Listed by other fans. Every listing shows its seller and verification state.</p>
            </div>
            <RouterLink to="/list-ticket" class="btn btn--ghost">List a ticket</RouterLink>
          </header>

          <TransitionGroup v-if="filteredListings.length" tag="div" name="pop" class="ticket-grid">
            <ListingCard
              v-for="listing in filteredListings"
              :key="listing.id"
              :listing="listing"
              :saved="isSaved(listing.id)"
              @toggle-save="toggle"
            />
          </TransitionGroup>

          <div v-else-if="ticketError" class="empty">
            <MarketIcon name="ticket" :size="26" />
            <h3>Could not load the listings.</h3>
            <p>The concerts above loaded, so this is the ticket feed alone. <span class="mono">{{ ticketError }}</span></p>
          </div>

          <div v-else class="empty">
            <MarketIcon name="ticket" :size="26" />
            <h3>{{ refining ? 'No tickets match those filters.' : 'Nothing on resale yet.' }}</h3>
            <p v-if="!refining">
              Tickets appear here the moment a fan lists one. The concerts above are the ones to watch.
            </p>
            <p v-else-if="matchingConcerts.length">
              The concerts below still match — open one to join its matching round, or widen your filters.
            </p>
            <p v-else>
              Nothing in the market matches that, concerts included. Try a different artist or venue.
            </p>
            <button v-if="refining" type="button" class="btn btn--ghost" @click="resetFilters">Clear filters</button>
            <RouterLink v-else to="/list-ticket" class="btn btn--primary">List the first ticket</RouterLink>
          </div>
        </section>

        <p v-if="concertError" class="dead-end">
          Recommended concerts are unavailable right now. <span class="mono">{{ concertError }}</span>
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.marketplace {
  min-height: calc(100vh - var(--header-height));
  padding-block: var(--space-7) 7rem;
  background:
    radial-gradient(circle at 90% 0%, color-mix(in oklab, var(--accent-500) 13%, transparent), transparent 30rem),
    var(--ink-900);
}

.marketplace__top {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--space-5);
  margin-bottom: var(--space-5);
}

.marketplace__title {
  color: var(--text-100);
  font-family: var(--font-display);
  font-size: var(--step-3);
  font-weight: 700;
  letter-spacing: -0.025em;
}

.marketplace__summary {
  color: var(--text-300);
  font-size: var(--step--1);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

/* ---- Filter bar ---------------------------------------------------------- */

.bar {
  position: sticky;
  /* Under the fixed site header (z-index 100), above the cards. */
  top: calc(var(--header-height) + var(--space-3));
  z-index: 20;
  margin-bottom: var(--space-6);
  padding: var(--space-3);
  border: var(--border-soft);
  border-radius: var(--radius-lg);
  background: var(--glass-tint);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  box-shadow: var(--shadow-sm);
  transition: box-shadow var(--dur-base) var(--ease-out);
}

.bar--open { box-shadow: var(--shadow-md); }

.bar__row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.bar__search {
  display: flex;
  flex: 1;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  padding: var(--space-3) var(--space-4);
  border: var(--border-soft);
  border-radius: var(--radius-pill);
  background: var(--ink-800);
  color: var(--text-400);
  transition: border-color var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out);
}

.bar__search:focus-within {
  border-color: var(--accent-500);
  box-shadow: 0 0 0 3px var(--accent-glow);
}

.bar__search input {
  width: 100%;
  min-width: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--text-100);
  font: inherit;
  font-size: var(--step--1);
}

.bar__search input::-webkit-search-cancel-button { appearance: none; }

.bar__clear,
.bar__toggle {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--text-300);
  transition: color var(--dur-fast) var(--ease-out);
}

.bar__clear:hover { color: var(--text-100); }

.bar__toggle {
  flex: none;
  padding: var(--space-3) var(--space-4);
  border: var(--border-soft);
  border-radius: var(--radius-pill);
  background: var(--ink-800);
  color: var(--text-100);
  font-size: var(--step--1);
  font-weight: 600;
  transition:
    background var(--dur-fast) var(--ease-out),
    border-color var(--dur-fast) var(--ease-out);
}

.bar__toggle:hover { border-color: var(--accent-400); }

.bar--open .bar__toggle {
  background: var(--accent-500);
  border-color: var(--accent-500);
  color: #fff;
}

.bar__count {
  display: grid;
  place-items: center;
  min-width: 20px;
  height: 20px;
  padding-inline: 5px;
  border-radius: var(--radius-pill);
  background: var(--accent-500);
  color: #fff;
  font-size: var(--step--2);
}

.bar--open .bar__count { background: rgba(255, 255, 255, 0.24); }

.bar__chevron { transition: transform var(--dur-base) var(--ease-settle); }
.bar--open .bar__chevron { transform: rotate(180deg); }

.bar__chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-top: var(--space-3);
  padding-inline: var(--space-1);
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-3);
  border: 1px solid color-mix(in oklab, var(--accent-500) 35%, transparent);
  border-radius: var(--radius-pill);
  background: color-mix(in oklab, var(--accent-500) 10%, transparent);
  color: var(--text-100);
  font-size: var(--step--2);
  transition: background var(--dur-fast) var(--ease-out);
}

.chip:hover { background: color-mix(in oklab, var(--accent-500) 20%, transparent); }
.chip--reset { border-style: dashed; border-color: var(--ink-500); background: none; color: var(--text-300); }
.chip--reset:hover { background: var(--ink-700); color: var(--text-100); }

/* 0fr → 1fr gives a height transition without measuring anything in JS. */
.bar__drawer {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows var(--dur-base) var(--ease-settle);
}

.bar__drawer > * { overflow: hidden; }
.bar__drawer--open { grid-template-rows: 1fr; }

.panel {
  padding-top: var(--space-4);
  opacity: 0;
  transform: translateY(-4px);
  transition:
    opacity var(--dur-base) var(--ease-out),
    transform var(--dur-base) var(--ease-out);
}

.bar__drawer--open .panel {
  opacity: 1;
  transform: none;
}

.panel__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  gap: var(--space-4);
  padding-top: var(--space-4);
  border-top: var(--border-hairline);
}

.panel__grid label,
.panel__field {
  display: grid;
  gap: var(--space-2);
  align-content: start;
  color: var(--text-300);
  font-size: var(--step--2);
  font-weight: 600;
}

.panel__grid select,
.panel__grid input {
  width: 100%;
  min-width: 0;
  min-height: 44px;
  padding: var(--space-2) var(--space-3);
  border: var(--border-soft);
  border-radius: var(--radius-md);
  background: var(--ink-800);
  color: var(--text-200);
  font: inherit;
  font-size: var(--step--1);
}

.panel__grid input::placeholder { color: var(--text-400); }

.panel__grid input:focus,
.panel__grid select:focus {
  border-color: var(--accent-500);
  outline: none;
  box-shadow: 0 0 0 3px var(--accent-glow);
}

/* The slider needs a usable track, so it takes two columns where there are two. */
.panel__field--wide { grid-column: span 2; }

.switch {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  min-height: 44px;
  padding: var(--space-2) var(--space-4);
  border: var(--border-soft);
  border-radius: var(--radius-md);
  background: var(--ink-800);
  color: var(--text-200);
  font-size: var(--step--1);
  transition:
    background var(--dur-fast) var(--ease-out),
    border-color var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out);
}

.switch[aria-pressed='true'] {
  border-color: var(--accent-500);
  background: color-mix(in oklab, var(--accent-500) 12%, transparent);
  color: var(--text-100);
}

.panel__foot {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  margin-top: var(--space-4);
}

.text-button { color: var(--text-300); font-size: var(--step--1); }
.text-button:hover { color: var(--text-100); }

/* ---- Results ------------------------------------------------------------- */

.results {
  display: flex;
  flex-direction: column;
  gap: var(--space-7);
}

/* Once the visitor has narrowed something, their results lead. */
.results--refining .block--concerts { order: 2; }

.block__head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--space-4);
  margin-bottom: var(--space-5);
  padding-bottom: var(--space-4);
  border-bottom: var(--border-hairline);
}

.block__head h2 { font-size: var(--step-1); }
.block__note { margin-top: var(--space-2); max-width: 56ch; color: var(--text-300); font-size: var(--step--1); }

/* Both grids are positioning contexts: a card leaving the list is taken out of
   flow (see .pop-leave-active) so the remaining cards slide up behind it. */
.concert-grid {
  position: relative;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(290px, 1fr));
  gap: var(--space-4);
}

.ticket-grid {
  position: relative;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-5);
}

.empty {
  display: grid;
  justify-items: center;
  gap: var(--space-3);
  padding: var(--space-8) var(--space-5);
  border: 1px dashed var(--ink-500);
  border-radius: var(--radius-lg);
  text-align: center;
  color: var(--text-400);
}

.empty h3 { color: var(--text-100); font-size: var(--step-0); }
.empty p { max-width: 48ch; color: var(--text-300); font-size: var(--step--1); }
.empty .btn { margin-top: var(--space-2); }

.dead-end { text-align: center; color: var(--text-300); }

.notice {
  padding: var(--space-6);
  border-radius: var(--radius-lg);
  border: 1px solid color-mix(in oklab, var(--rose-400) 40%, var(--ink-600));
  background: color-mix(in oklab, var(--rose-400) 7%, transparent);
  color: var(--text-200);
}

.notice h3 { margin-bottom: var(--space-3); color: var(--rose-400); font-size: var(--step-0); }
.notice code { color: var(--accent-400); }
.notice .mono { margin-top: var(--space-3); color: var(--text-400); font-size: var(--step--2); }

.skeleton {
  min-height: 320px;
  border-radius: var(--radius-lg);
  background: linear-gradient(110deg, var(--ink-850) 30%, var(--ink-700) 45%, var(--ink-850) 60%);
  background-size: 200% 100%;
  animation: shimmer 1.3s infinite;
}

@keyframes shimmer { to { background-position-x: -200%; } }

/* ---- Motion -------------------------------------------------------------- */

.pop-move,
.pop-enter-active,
.pop-leave-active {
  transition:
    opacity var(--dur-base) var(--ease-out),
    transform var(--dur-base) var(--ease-settle);
}

.pop-enter-from,
.pop-leave-to {
  opacity: 0;
  transform: scale(0.97) translateY(6px);
}

/* Leaving cards are taken out of flow so the survivors slide into place. */
.pop-leave-active { position: absolute; }

.chip-enter-active,
.chip-leave-active { transition: opacity var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out); }
.chip-enter-from,
.chip-leave-to { opacity: 0; transform: scale(0.88); }

@media (prefers-reduced-motion: reduce) {
  .bar__drawer { transition: none; }
}

@media (max-width: 900px) {
  .ticket-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

@media (max-width: 760px) {
  .marketplace { padding-block: var(--space-6) 6rem; }
  .marketplace__top { align-items: flex-start; flex-direction: column; gap: var(--space-2); }
  .marketplace__summary { white-space: normal; }
  .bar__row { flex-wrap: wrap; }
  .bar__search { flex-basis: 100%; }
  .bar__toggle { flex: 1; justify-content: center; }
  .block__head { align-items: flex-start; flex-direction: column; }
}

@media (max-width: 520px) {
  .concert-grid,
  .ticket-grid { grid-template-columns: 1fr; }
}
</style>
