<script setup>
import { computed, onMounted, ref } from 'vue';
import { api, formatDate } from '../api.js';
import ConcertSpotlightCard from '../components/market/ConcertSpotlightCard.vue';
import DateField from '../components/market/DateField.vue';
import MarketIcon from '../components/market/MarketIcon.vue';
import LoadingSpinner from '../components/LoadingSpinner.vue';
import { vReveal } from '../composables/useReveal.js';

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
const hasFilters = computed(() => Boolean(search.value || date.value));
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
  for (const concert of activity.value) {
    if (!events.has(concert.id)) events.set(concert.id, concert);
  }
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
    return !query || [concert.artist, concert.tour_name, concert.venue]
      .some((value) => String(value ?? '').toLowerCase().includes(query));
  });
});
// Days with an upcoming concert, dotted in the date picker.
const concertDates = computed(() => discovered.value.map(({ concert }) => concert.event_date.slice(0, 10)));
const visibleConcerts = computed(() => showAll.value ? matchingConcerts.value : matchingConcerts.value.slice(0, PAGE_SIZE));
function clearFilters() {
  search.value = '';
  date.value = '';
}
</script>

<template>
  <div class="concert-market">
    <div class="container container--wide">
      <header class="concert-market__head page-banner">
        <div>
          <p class="concert-market__eyebrow mono">Live music · Good company</p>
          <h1>Concerts</h1>
          <p>Discover upcoming concerts, find a group and browse tickets from other fans.</p>
        </div>
        <nav class="concert-market__tools" aria-label="Ticket tools">
          <RouterLink to="/tickets" class="btn btn--light">Browse tickets</RouterLink>
        </nav>
      </header>

      <section class="concert-filters" aria-label="Filter concerts">
        <div class="concert-filters__heading">
          <span class="concert-filters__mark" aria-hidden="true"><MarketIcon name="search" :size="18" /></span>
          <p>Find your next show<span>Start with an artist, venue or date.</span></p>
        </div>
        <div class="concert-filters__controls">
        <label class="concert-filters__search">
          <span>Search concerts</span>
          <div class="concert-filters__input">
            <MarketIcon name="search" :size="18" />
            <input v-model="search" type="search" placeholder="Artist or venue" />
          </div>
        </label>
        <div class="concert-filters__date">
          <span id="concert-market-date">Event date</span>
          <DateField v-model="date" labelled-by="concert-market-date" :marked-dates="concertDates" />
        </div>
        <button v-if="hasFilters" type="button" class="btn btn--ghost" @click="clearFilters">Clear filters</button>
        </div>
        <div v-if="hasFilters" class="concert-filters__active" aria-label="Active concert filters">
          <span>Showing matches for</span>
          <button v-if="search" type="button" class="concert-filters__chip" :aria-label="`Remove search filter: ${search}`" @click="search = ''">{{ search }}<MarketIcon name="close" :size="13" /></button>
          <button v-if="date" type="button" class="concert-filters__chip" :aria-label="`Remove date filter: ${formatDate(date)}`" @click="date = ''">{{ formatDate(date) }}<MarketIcon name="close" :size="13" /></button>
        </div>
      </section>

      <p v-if="concertsLoading" class="loading-state" role="status" aria-busy="true">
        <LoadingSpinner /> Loading concerts…
      </p>
      <section v-if="!concertsLoading || visibleConcerts.length" aria-labelledby="upcoming-concerts">
        <header class="concert-results">
          <div>
            <h2 id="upcoming-concerts">Upcoming concerts</h2>
            <p role="status" aria-live="polite" aria-atomic="true">Showing {{ visibleConcerts.length }} of {{ matchingConcerts.length }} {{ matchingConcerts.length === 1 ? 'concert' : 'concerts' }}{{ hasFilters ? ' matching your filters' : '' }}.</p>
          </div>
          <span class="concert-results__order"><MarketIcon name="calendar" :size="15" />Soonest first</span>
        </header>
        <p v-if="activityError" class="concert-error" role="alert">Could not load group activity. Group counts are unavailable; concert and ticket details are shown separately.</p>
        <p v-if="ticketError" class="concert-error" role="alert">Could not load tickets for sale. Ticket counts and resale prices are unavailable; concert discovery is still shown.</p>
        <div v-if="concertError" class="concert-empty" role="alert">
          <h3>Ticketmaster discovery unavailable</h3>
          <p>{{ concertError === 'concert_provider_not_configured' ? 'Ticketmaster discovery is not configured.' : 'Live concerts could not be loaded. Available local concerts and fan listings are still shown below.' }}</p>
        </div>
        <div v-if="!matchingConcerts.length && !concertError" class="concert-empty">
          <h3>{{ hasFilters ? 'No concerts match your filters' : 'No upcoming concerts available' }}</h3>
          <p>{{ hasFilters ? 'Try another search or date.' :'Ticketmaster has not returned any upcoming concerts.' }}</p>
          <button v-if="hasFilters" type="button" class="btn btn--ghost" @click="clearFilters">Clear filters</button>
        </div>
        <TransitionGroup v-else id="concert-results-list" name="concert-list" tag="div" class="concert-grid">
          <div v-for="(row, i) in visibleConcerts" :key="row.concert.id" class="concert-grid__item">
            <div v-reveal="i % 3" class="concert-grid__reveal">
            <ConcertSpotlightCard
              :concert="row.concert" :open-seekers="row.openSeekers" :open-slots="row.openSlots"
              :ticket-count="row.ticketCount" :from-cents="row.fromCents"
              :tickets-loading="ticketsLoading" :activity-loading="activityLoading" />
            </div>
          </div>
        </TransitionGroup>
        <button v-if="matchingConcerts.length > PAGE_SIZE" type="button" class="btn btn--ghost concert-more" :aria-expanded="showAll" aria-controls="concert-results-list" @click="showAll = !showAll">
          {{ showAll ? 'Show fewer concerts' : `Show all ${matchingConcerts.length} concerts` }}
          <MarketIcon name="chevron" :size="16" />
        </button>
      </section>
    </div>
  </div>
</template>

<style scoped>
.concert-market {
  min-height: calc(100vh - var(--header-height));
  padding-block: var(--space-6) var(--space-9);
}
.concert-market__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-5);
  margin-bottom: var(--space-5);
}
.concert-market__head > div {
  min-width: 0;
}
.concert-market__eyebrow {
  margin-bottom: var(--space-2);
  font-size: var(--step--2);
  font-weight: 700;
  letter-spacing: .1em;
  text-transform: uppercase;
}
/* The concerts banner shows its stage photo in full colour, darkened on the
   left so the title stays readable. */
.concert-market__head {
  --banner-image: linear-gradient(90deg, rgba(36, 10, 66, 0.88), rgba(36, 10, 66, 0.45) 55%, rgba(36, 10, 66, 0.1)), url('../assets/concerts-crowd.jpg');
  min-height: 240px;
}
.concert-market__head::before {
  opacity: 1;
  mix-blend-mode: normal;
  background-position: center 40%;
}
.concert-market__tools {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  flex-shrink: 0;
}
.concert-filters {
  display: grid;
  gap: var(--space-3);
  padding: var(--space-4) var(--space-5);
  margin-bottom: var(--space-6);
  border: 1px solid var(--panel-edge);
  border-radius: var(--radius-lg);
  background: var(--panel-bg);
  box-shadow: inset 0 1px 0 var(--panel-highlight), var(--shadow-md);
}
.concert-filters__heading {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}
.concert-filters__heading p {
  margin: 0;
  color: var(--text-100);
  font-size: var(--step--1);
  font-weight: 700;
}
.concert-filters__heading p span {
  margin-left: var(--space-3);
  color: var(--text-300);
  font-weight: 400;
}
.concert-filters__mark {
  display: grid;
  place-items: center;
  width: 2rem;
  height: 2rem;
  flex: none;
  border: 1px solid color-mix(in srgb, var(--accent-400) 30%, var(--panel-edge));
  border-radius: var(--radius-sm);
  background: var(--accent-glow);
  color: var(--accent-400);
  box-shadow: inset 0 1px 0 var(--panel-highlight);
}
.concert-filters__controls {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(190px, 260px) auto;
  align-items: end;
  gap: var(--space-3);
}
.concert-filters__search, .concert-filters__date {
  display: grid;
  min-width: 0;
  gap: var(--space-2);
  color: var(--text-300);
  font-size: var(--step--1);
}
.concert-filters__input {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 44px;
  padding: var(--space-2) var(--space-3);
  border: var(--border-soft);
  border-radius: var(--radius-md);
  background: var(--field-bg);
}
.concert-filters__input {
  transition: border-color var(--dur-base) var(--ease-out), box-shadow var(--dur-base) var(--ease-out);
}
.concert-filters__input:focus-within {
  border-color: var(--accent-400);
  box-shadow: 0 0 0 4px var(--accent-glow);
}
.concert-filters__input input {
  width: 100%;
  min-width: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--text-100);
  font: inherit;
}
.concert-filters__date :deep(.datefield) {
  min-height: 44px;
}
.concert-filters__active {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-2);
  padding-top: var(--space-3);
  border-top: 1px solid var(--panel-edge);
  color: var(--text-300);
  font-size: var(--step--2);
}
.concert-filters__chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  max-width: 100%;
  padding: .3rem .65rem;
  border: 1px solid color-mix(in srgb, var(--accent-400) 45%, var(--panel-edge));
  border-radius: var(--radius-pill);
  background: var(--accent-glow);
  color: var(--accent-400);
  font: inherit;
  font-weight: 700;
  overflow-wrap: anywhere;
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-settle);
}
.concert-filters__chip :deep(svg) { flex: none; }
.concert-filters__chip:hover { background: color-mix(in srgb, var(--accent-400) 18%, var(--ink-800)); }
.concert-filters__chip:active { transform: translateY(1px) scale(.98); }
.concert-filters__chip:focus-visible { outline: 2px solid var(--accent-400); outline-offset: 3px; }
.concert-results {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-3);
}
.concert-results h2 {
  font-size: var(--step-3);
}
.concert-results p {
  margin-top: var(--space-1);
  color: var(--text-300);
  font-size: var(--step--1);
}
.concert-results {
  margin-bottom: var(--space-5);
  padding-bottom: var(--space-4);
  border-bottom: 1px solid var(--panel-edge);
}
.concert-results__order {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--text-300);
  font-size: var(--step--2);
  white-space: nowrap;
}
.concert-error {
  margin-bottom: var(--space-4);
  color: var(--rose-400);
}
.concert-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-5);
}
.concert-grid__item { min-width: 0; }
.concert-grid__reveal { height: 100%; }
/* Grid movement belongs to the outer item; scroll reveal keeps its own inner
   layer so the two transforms never overwrite one another. */
.concert-list-move { transition: transform var(--dur-base) var(--ease-settle); }
.concert-list-enter-active { transition: opacity var(--dur-base) var(--ease-settle); }
.concert-list-leave-active { transition: opacity var(--dur-fast) var(--ease-out); }
.concert-list-enter-from, .concert-list-leave-to { opacity: 0; }
.concert-empty {
  display: grid;
  justify-items: center;
  gap: var(--space-3);
  padding: var(--space-7) var(--space-4);
  text-align: center;
  border: var(--border-soft);
  border-radius: var(--radius-lg);
}
.concert-empty h3 {
  font-size: var(--step-1);
}
.concert-empty p {
  color: var(--text-300);
}
.concert-more {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-3);
  margin: var(--space-5) auto 0;
}
.concert-more :deep(svg) { transition: transform var(--dur-base) var(--ease-settle); }
.concert-more[aria-expanded='true'] :deep(svg) { transform: rotate(180deg); }
@media (max-width: 1000px) {
  .concert-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .concert-market__head {
    align-items: flex-start;
    flex-direction: column;
  }
}
@media (max-width: 600px) {
  .concert-grid, .concert-filters__controls {
    grid-template-columns: minmax(0, 1fr);
  }
  .concert-filters { padding: var(--space-4); }
  .concert-filters__heading p span { display: block; margin: var(--space-1) 0 0; }
  .concert-market__tools {
    width: 100%;
  }
  .concert-market__tools .btn {
    flex: 1;
  }
}
@media (prefers-reduced-motion: reduce) {
  .concert-list-move, .concert-list-enter-active, .concert-list-leave-active,
  .concert-filters__chip, .concert-more :deep(svg) { transition: none; }
}
</style>
