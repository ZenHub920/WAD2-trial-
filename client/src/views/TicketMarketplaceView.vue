<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, formatShortDate } from '../api.js';
import { sectionLabel, useSavedListings } from '../market.js';
import TicketListingCard from '../components/market/TicketListingCard.vue';
import MarketIcon from '../components/market/MarketIcon.vue';
import MarketNotice from '../components/market/MarketNotice.vue';
import LoadingSpinner from '../components/LoadingSpinner.vue';

/**
 * Every active fan-listed ticket for upcoming concerts, across all concerts.
 * The concert filter lives in the URL (?concert=<id>) so concert pages can link here.
 */
const route = useRoute();
const router = useRouter();
const { isSaved, toggle } = useSavedListings();

const listings = ref([]);
const loading = ref(true);
const error = ref('');

async function load() {
  loading.value = true;
  error.value = '';
  try {
    listings.value = (await api.tickets()).listings;
  } catch {
    error.value = 'Could not load tickets for sale. Please try again.';
  } finally {
    loading.value = false;
  }
}
onMounted(load);

const search = ref('');
const concertId = ref(String(route.query.concert ?? ''));
const sort = ref('soonest');
const verifiedOnly = ref(false);
const savedOnly = ref(false);

// Keep the concert filter and the URL in step, both ways.
watch(concertId, (id) => {
  if (id === String(route.query.concert ?? '')) return;
  router.replace({ query: { ...route.query, concert: id || undefined } });
});
watch(() => route.query.concert, (id) => { concertId.value = String(id ?? ''); });

function today() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
const upcoming = computed(() => {
  const from = today();
  return listings.value.filter((listing) => listing.status === 'active' && listing.concert.event_date.slice(0, 10) >= from);
});

/** One option per concert that has tickets, soonest first. */
const concertOptions = computed(() => {
  const seen = new Map();
  for (const { concert } of upcoming.value) if (!seen.has(concert.id)) seen.set(concert.id, concert);
  return [...seen.values()].sort((a, b) => a.event_date.localeCompare(b.event_date));
});
const unknownConcert = computed(() => concertId.value && !concertOptions.value.some((c) => c.id === concertId.value));

const SORTS = {
  soonest: (a, b) => a.concert.event_date.localeCompare(b.concert.event_date) || a.priceCents - b.priceCents,
  'price-asc': (a, b) => a.priceCents - b.priceCents,
  'price-desc': (a, b) => b.priceCents - a.priceCents,
  newest: (a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')),
};

const results = computed(() => {
  const query = search.value.trim().toLowerCase();
  return upcoming.value.filter((listing) => {
    if (concertId.value && listing.concert.id !== concertId.value) return false;
    if (verifiedOnly.value && !listing.verified) return false;
    if (savedOnly.value && !isSaved(listing.id)) return false;
    return !query || [listing.concert.artist, listing.concert.venue, sectionLabel(listing.section), listing.seller.displayName]
      .some((value) => String(value ?? '').toLowerCase().includes(query));
  }).sort(SORTS[sort.value]);
});
const ticketTotal = computed(() => results.value.reduce((sum, listing) => sum + listing.quantity, 0));

const hasFilters = computed(() => Boolean(search.value || concertId.value || verifiedOnly.value || savedOnly.value));
function clearFilters() {
  search.value = '';
  concertId.value = '';
  verifiedOnly.value = false;
  savedOnly.value = false;
}
</script>

<template>
  <div class="market-page">
    <div class="container container--wide">
      <header class="market-page__head page-banner">
        <div>
          <h1>Tickets</h1>
          <p>Tickets other fans can no longer use. Message a seller to arrange the transfer.</p>
        </div>
        <nav class="market-page__tools" aria-label="Ticket tools">
          <RouterLink to="/my-listings" class="btn btn--outline-light">My listings</RouterLink>
          <RouterLink to="/list-ticket" class="btn btn--light">List a ticket</RouterLink>
        </nav>
      </header>

      <section class="market-filters" aria-label="Filter tickets">
        <label class="market-filters__search">
          <span>Search</span>
          <span class="market-filters__input">
            <MarketIcon name="search" :size="18" />
            <input v-model="search" type="search" placeholder="Artist, venue, section or seller" />
          </span>
        </label>
        <label>
          <span id="market-concert-label">Concert</span>
          <select v-model="concertId" aria-labelledby="market-concert-label">
            <option value="">All concerts</option>
            <option v-if="unknownConcert" :value="concertId">Selected concert</option>
            <option v-for="concert in concertOptions" :key="concert.id" :value="concert.id">
              {{ concert.artist }} · {{ formatShortDate(concert.event_date) }}
            </option>
          </select>
        </label>
        <label>
          <span id="market-sort-label">Sort by</span>
          <select v-model="sort" aria-labelledby="market-sort-label">
            <option value="soonest">Concert date: soonest</option>
            <option value="price-asc">Price: low to high</option>
            <option value="price-desc">Price: high to low</option>
            <option value="newest">Newest listings</option>
          </select>
        </label>
        <div class="market-filters__checks">
          <label><input v-model="verifiedOnly" type="checkbox" /> Verified tickets only</label>
          <label><input v-model="savedOnly" type="checkbox" /> Saved listings only</label>
        </div>
      </section>

      <p v-if="loading" class="loading-state" role="status" aria-busy="true"><LoadingSpinner /> Loading tickets…</p>

      <MarketNotice v-else-if="error" tone="error" title="Tickets unavailable">
        <p>{{ error }}</p>
        <button type="button" class="btn btn--ghost market-page__retry" @click="load">Try again</button>
      </MarketNotice>

      <section v-else aria-labelledby="market-results">
        <header class="market-results">
          <h2 id="market-results">{{ results.length }} {{ results.length === 1 ? 'listing' : 'listings' }}</h2>
          <p v-if="results.length">{{ ticketTotal }} {{ ticketTotal === 1 ? 'ticket' : 'tickets' }}{{ hasFilters ? ' matching your filters' : ' for sale' }}</p>
          <button v-if="hasFilters" type="button" class="btn btn--ghost" @click="clearFilters">Clear filters</button>
        </header>

        <MarketNotice v-if="!results.length" :title="hasFilters ? 'No tickets match your filters' : 'No tickets for sale yet'">
          <p v-if="hasFilters">Try another search or clear your filters.</p>
          <p v-else>When fans list tickets for upcoming concerts, they appear here.</p>
          <RouterLink to="/list-ticket">List a ticket</RouterLink>
        </MarketNotice>

        <div v-else class="market-grid">
          <TicketListingCard
            v-for="listing in results"
            :key="listing.id"
            :listing="listing"
            :saved="isSaved(listing.id)"
            @toggle-save="toggle"
          />
        </div>
      </section>

      <p class="market-page__note">Online checkout is unavailable because no payment provider is connected.</p>
    </div>
  </div>
</template>

<style scoped>
.market-page {
  min-height: calc(100vh - var(--header-height));
  padding-block: var(--space-6) var(--space-9);
}
.market-page__head {
  display: flex;
  align-items: end;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--space-5);
  margin-bottom: var(--space-5);
}
.market-page__head > div {
  min-width: 0;
}
.market-page__tools {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
.market-filters {
  display: grid;
  grid-template-columns: minmax(0, 2fr) repeat(2, minmax(0, 1fr));
  gap: var(--space-4);
  align-items: end;
  margin-bottom: var(--space-6);
  padding: var(--space-5);
  border: var(--border-soft);
  border-radius: var(--radius-lg);
  background: var(--ink-850);
}
.market-filters label {
  display: grid;
  gap: var(--space-2);
  min-width: 0;
  color: var(--text-300);
  font-size: var(--step--1);
}
.market-filters select,
.market-filters input[type='search'] {
  width: 100%;
  min-width: 0;
  padding: var(--space-3);
  border: var(--border-soft);
  border-radius: var(--radius-md);
  background: var(--field-bg);
  color: var(--text-100);
}
.market-filters__input {
  position: relative;
  display: block;
}
.market-filters__input :deep(svg) {
  position: absolute;
  top: 50%;
  left: var(--space-3);
  transform: translateY(-50%);
  color: var(--text-400);
}
.market-filters__input input[type='search'] {
  padding-left: calc(var(--space-3) * 2 + 18px);
}
.market-filters__checks {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-5);
  grid-column: 1 / -1;
}
.market-filters__checks label {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--text-200);
}
.market-results {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-2) var(--space-4);
  margin-bottom: var(--space-4);
}
.market-results h2 {
  font-size: var(--step-2);
}
.market-results p {
  color: var(--text-300);
}
.market-results .btn {
  margin-left: auto;
}
.market-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 280px), 1fr));
  gap: var(--space-5);
}
.market-page__retry {
  margin-top: var(--space-3);
}
.market-page__note {
  margin-top: var(--space-6);
  color: var(--text-400);
  font-size: var(--step--1);
}
@media (max-width: 760px) {
  .market-filters {
    grid-template-columns: 1fr;
  }
}
</style>
