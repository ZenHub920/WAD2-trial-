<script setup>
import { computed, onMounted, ref } from 'vue';
import { api } from '../api.js';
import { useSavedListings } from '../market.js';
import ConcertSpotlightCard from '../components/market/ConcertSpotlightCard.vue';
import DateField from '../components/market/DateField.vue';
import MarketIcon from '../components/market/MarketIcon.vue';
import LoadingSpinner from '../components/LoadingSpinner.vue';

const concerts = ref([]);
const listings = ref([]);
const activity = ref([]);
const concertsLoading = ref(true);
const ticketsLoading = ref(true);
const activityLoading = ref(true);
const concertError = ref('');
const ticketError = ref('');
const activityError = ref('');
const search = ref('');
const date = ref('');
const savedOnly = ref(false);
const { isSaved } = useSavedListings();
const hasFilters = computed(() => Boolean(search.value || date.value || savedOnly.value));
const showAll = ref(false);
const PAGE_SIZE = 6;

onMounted(() => {
  api.tickets().then((body) => {
    listings.value = body.listings;
  }).catch((err) => {
    ticketError.value = err.body?.error ?? err.message;
  }).finally(() => {
    ticketsLoading.value = false;
  });
  const shows = api.externalConcerts().then((body) => {
    concerts.value = body.events;
  }).catch((err) => {
    concertError.value = err.body?.error ?? err.message;
  }).finally(() => {
    concertsLoading.value = false;
  });
  // Read counts after discovery persists IDs, even if the provider is unavailable.
  shows.then(async () => {
    try {
      activity.value = (await api.concerts()).concerts;
    } catch (err) {
      activityError.value = err.body?.error ?? err.message;
    } finally {
      activityLoading.value = false;
    }
  });
});

const discovered = computed(() => {
  const inventory = new Map();
  for (const listing of listings.value) {
    const id = listing.concert.id;
    const sale = inventory.get(id) ?? { quantity: 0, fromCents: listing.priceCents };
    sale.quantity += listing.quantity;
    sale.fromCents = Math.min(sale.fromCents, listing.priceCents);
    inventory.set(id, sale);
  }
  const local = new Map(activity.value.map((concert) => [concert.id, concert]));
  const events = new Map(concerts.value.map((concert) => [concert.id, concert]));
  for (const listing of listings.value) {
    if (!events.has(listing.concert.id)) {
      events.set(listing.concert.id, local.get(listing.concert.id) ?? listing.concert);
    }
  }
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return [...events.values()].filter((concert) => concert.event_date.slice(0, 10) >= today)
    .sort((a, b) => a.event_date.localeCompare(b.event_date)).map((concert) => {
    const counts = activityError.value ? null : local.get(concert.id);
    return {
      concert,
      openSeekers: counts?.open_seekers ?? null,
      openSlots: counts?.open_slots ?? null,
      ticketCount: ticketsLoading.value || ticketError.value ? null : (inventory.get(concert.id)?.quantity ?? 0),
      fromCents: inventory.get(concert.id)?.fromCents ?? null,
    };
  });
});

const matchingConcerts = computed(() => {
  const query = search.value.trim().toLowerCase();
  return discovered.value.filter(({ concert }) => {
    if (date.value && concert.event_date.slice(0, 10) !== date.value) return false;
    if (savedOnly.value && !listings.value.some((listing) => listing.concert.id === concert.id && isSaved(listing.id))) return false;
    return !query || [concert.artist, concert.tour_name, concert.venue]
      .some((value) => String(value ?? '').toLowerCase().includes(query));
  });
});
const visibleConcerts = computed(() => showAll.value ? matchingConcerts.value : matchingConcerts.value.slice(0, PAGE_SIZE));
const summary = computed(() => {
  if (concertsLoading.value) return 'Loading concerts…';
  if (activityLoading.value) return 'Loading group activity…';
  if (concertError.value && !visibleConcerts.value.length) return 'Group finder activity unavailable';
  if (activityError.value || visibleConcerts.value.some((row) => row.openSeekers === null)) {
    return 'Group finder activity unavailable';
  }
  const count = visibleConcerts.value.reduce((total, row) => total + row.openSeekers, 0);
  return count ? `${count} active group ${count === 1 ? 'finder' : 'finders'}` : 'No active group finders';
});
function clearFilters() {
  search.value = '';
  date.value = '';
  savedOnly.value = false;
}
</script>

<template>
  <div class="concert-market">
    <div class="container container--wide">
      <header class="concert-market__head">
        <div>
          <h1>Concerts</h1>
          <p>Discover upcoming concerts, find a group and browse tickets from other fans.</p>
        </div>
        <nav class="concert-market__tools" aria-label="Ticket tools">
          <RouterLink to="/my-listings" class="btn btn--ghost">My listings</RouterLink>
          <RouterLink to="/list-ticket" class="btn btn--primary">List a ticket</RouterLink>
        </nav>
      </header>

      <section class="concert-filters" aria-label="Filter concerts">
        <label class="concert-filters__search">
          <span>Search concerts</span>
          <div class="concert-filters__input">
            <MarketIcon name="search" :size="18" />
            <input v-model="search" type="search" placeholder="Artist or venue" />
          </div>
        </label>
        <div class="concert-filters__date">
          <span id="concert-market-date">Event date</span>
          <DateField v-model="date" labelled-by="concert-market-date" />
        </div>
        <button v-if="hasFilters" type="button" class="btn btn--ghost" @click="clearFilters">Clear filters</button>
        <label class="concert-filters__saved">
          <input v-model="savedOnly" type="checkbox" :disabled="ticketsLoading || Boolean(ticketError)" />
          Concerts with saved listings
        </label>
      </section>

      <p v-if="concertsLoading" class="loading-state" role="status" aria-busy="true">
        <LoadingSpinner /> Loading concerts…
      </p>
      <section v-if="!concertsLoading || visibleConcerts.length" aria-labelledby="upcoming-concerts">
        <header class="concert-results">
          <div>
            <h2 id="upcoming-concerts">Upcoming concerts</h2>
            <p>Showing {{ visibleConcerts.length }} of {{ matchingConcerts.length }} {{ matchingConcerts.length === 1 ? 'concert' : 'concerts' }}{{ hasFilters ? ' matching your filters' : '' }}.</p>
          </div>
          <p class="concert-results__activity" role="status">{{ summary }}</p>
        </header>
        <details v-if="matchingConcerts.length" class="concert-context">
          <summary>What do these counts mean?</summary>
          <p>Group places are openings in app groups. Active group finders are open group-matching requests. Tickets for sale are fan listings here, not Ticketmaster availability.</p>
        </details>
        <p v-if="activityError" class="concert-error" role="alert">Could not load group activity. Group counts are unavailable; concert and ticket details are shown separately.</p>
        <p v-if="ticketError" class="concert-error" role="alert">Could not load tickets for sale. Ticket counts and resale prices are unavailable; concert discovery is still shown.</p>
        <div v-if="concertError" class="concert-empty" role="alert">
          <h3>Ticketmaster discovery unavailable</h3>
          <p>{{ concertError === 'concert_provider_not_configured' ? 'Ticketmaster discovery is not configured.' : 'Live concerts could not be loaded. Any available fan listings are still shown below.' }}</p>
        </div>
        <div v-if="!matchingConcerts.length && !concertError" class="concert-empty">
          <h3>{{ hasFilters ? 'No concerts match your filters' : 'No upcoming concerts available' }}</h3>
          <p>{{ hasFilters ? 'Try another filter or clear your saved-listing selection.' : 'Ticketmaster has not returned any upcoming concerts.' }}</p>
          <button v-if="hasFilters" type="button" class="btn btn--ghost" @click="clearFilters">Clear filters</button>
        </div>
        <div v-else class="concert-grid">
          <ConcertSpotlightCard v-for="row in visibleConcerts" :key="row.concert.id"
            :concert="row.concert" :open-seekers="row.openSeekers" :open-slots="row.openSlots"
            :ticket-count="row.ticketCount" :from-cents="row.fromCents"
            :tickets-loading="ticketsLoading" :activity-loading="activityLoading" />
        </div>
        <button v-if="matchingConcerts.length > PAGE_SIZE" type="button" class="btn btn--ghost concert-more" @click="showAll = !showAll">
          {{ showAll ? 'Show fewer concerts' : `Show all ${matchingConcerts.length} concerts` }}
        </button>
      </section>
    </div>
  </div>
</template>

<style scoped>
.concert-market { min-height: calc(100vh - var(--header-height)); padding-block: var(--space-6) var(--space-9); background: var(--ink-900); }
.concert-market__head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-5); margin-bottom: var(--space-5); }
.concert-market__head > div { min-width: 0; }
.concert-market__head h1 { font-size: var(--step-3); }
.concert-market__head p { margin-top: var(--space-2); color: var(--text-300); max-width: 62ch; }
.concert-market__tools { display: flex; flex-wrap: wrap; gap: var(--space-2); flex-shrink: 0; }
.concert-filters { display: grid; grid-template-columns: minmax(0, 1fr) minmax(190px, 260px) auto; align-items: end; gap: var(--space-3); padding: var(--space-4); margin-bottom: var(--space-6); border: var(--border-soft); border-radius: var(--radius-lg); background: var(--ink-850); }
.concert-filters__search, .concert-filters__date { display: grid; min-width: 0; gap: var(--space-2); color: var(--text-300); font-size: var(--step--1); }
.concert-filters__input { display: flex; align-items: center; gap: var(--space-2); min-height: 44px; padding: var(--space-2) var(--space-3); border: var(--border-soft); border-radius: var(--radius-md); background: var(--ink-800); }
.concert-filters__input:focus-within { border-color: var(--accent-500); }
.concert-filters__input input { width: 100%; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--text-100); font: inherit; }
.concert-filters__date :deep(.datefield) { min-height: 44px; }
.concert-filters__saved { grid-column: 1 / -1; display: flex; align-items: center; gap: var(--space-2); min-height: 36px; font-size: var(--step--1); color: var(--text-300); }
.concert-results { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: var(--space-3); }
.concert-results h2 { font-size: var(--step-1); }
.concert-results p { margin-top: var(--space-1); color: var(--text-300); font-size: var(--step--1); }
.concert-results__activity { font-variant-numeric: tabular-nums; }
.concert-context { max-width: 95ch; margin-block: var(--space-3) var(--space-5); color: var(--text-400); font-size: var(--step--1); }
.concert-error { margin-bottom: var(--space-4); color: var(--rose-400); }
.concert-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-4); }
.concert-empty { display: grid; justify-items: center; gap: var(--space-3); padding: var(--space-7) var(--space-4); text-align: center; border: var(--border-soft); border-radius: var(--radius-lg); }
.concert-empty h3 { font-size: var(--step-1); }
.concert-empty p { color: var(--text-300); }
.concert-more { display: flex; margin: var(--space-5) auto 0; }
@media (max-width: 1000px) { .concert-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } .concert-market__head { align-items: flex-start; flex-direction: column; } }
@media (max-width: 600px) { .concert-grid, .concert-filters { grid-template-columns: minmax(0, 1fr); } .concert-market__tools { width: 100%; } .concert-market__tools .btn { flex: 1; } }
</style>
