<script setup>
import { ref, watch, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api.js';
import { useSavedListings } from '../market.js';
import ListingCard from '../components/market/ListingCard.vue';
import MarketIcon from '../components/market/MarketIcon.vue';
import MarketNotice from '../components/market/MarketNotice.vue';

const route = useRoute();
const router = useRouter();
const { isSaved, toggle } = useSavedListings();

const listings = ref([]);
const loading = ref(true);
const error = ref(null);

// The search lives in the URL, so a filtered view can be shared or reloaded.
const query = ref(typeof route.query.q === 'string' ? route.query.q : '');

let latest = 0;
async function load(q) {
  const request = ++latest;
  loading.value = true;
  error.value = null;
  try {
    const body = await api.listings(q);
    if (request === latest) listings.value = body.listings;
  } catch (err) {
    if (request === latest) error.value = err;
  } finally {
    if (request === latest) loading.value = false;
  }
}

watch(
  () => route.query.q,
  (q) => {
    const value = typeof q === 'string' ? q : '';
    // Keep the box in step when the URL changes underneath it (back/forward).
    if (value !== query.value.trim()) query.value = value;
    load(value);
  },
  { immediate: true },
);

let debounce;
watch(query, (value) => {
  clearTimeout(debounce);
  debounce = setTimeout(() => {
    const q = value.trim();
    router.replace({ query: q ? { q } : {} });
  }, 250);
});
onUnmounted(() => clearTimeout(debounce));
</script>

<template>
  <div class="container container--wide market">
    <form class="search" role="search" @submit.prevent>
      <label for="market-search" class="sr-only">Search tickets</label>
      <MarketIcon name="search" :size="24" />
      <input
        id="market-search"
        v-model="query"
        type="search"
        placeholder="Search tickets"
        autocomplete="off"
      />
    </form>

    <h1 class="market__title">Discover</h1>

    <div v-if="loading && !listings.length" class="grid" aria-busy="true">
      <div v-for="n in 8" :key="n" class="skeleton" />
    </div>

    <MarketNotice v-else-if="error" tone="error" title="Could not load listings">
      <p>
        Start the backend from <code>server/</code>:
        <code>npm install &amp;&amp; npm run seed &amp;&amp; npm start</code>
      </p>
      <p class="mono">{{ error.message }}</p>
    </MarketNotice>

    <MarketNotice v-else-if="!listings.length">
      <template v-if="route.query.q">No tickets match “{{ route.query.q }}”.</template>
      <template v-else>No tickets listed right now.</template>
    </MarketNotice>

    <div v-else class="grid" :aria-busy="loading">
      <ListingCard
        v-for="listing in listings"
        :key="listing.id"
        :listing="listing"
        :saved="isSaved(listing.id)"
        @toggle-save="toggle"
      />
    </div>
  </div>
</template>

<style scoped>
.market {
  padding-block: var(--space-5) var(--space-8);
}

.search {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  max-width: 640px;
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-md);
  background: var(--ink-700);
  color: var(--text-300);
  border: 1px solid transparent;
  transition: border-color var(--dur-fast) var(--ease-out);
}

.search:focus-within {
  border-color: var(--accent-500);
}

.search input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  color: var(--text-100);
  font-size: var(--step-0);
  outline: none;
}

.search input::placeholder {
  color: var(--text-400);
}

.market__title {
  margin-block: var(--space-6) var(--space-4);
  font-size: var(--step-4);
}

/* Two columns on a phone, as many as fit beyond that. */
.grid {
  display: grid;
  gap: var(--space-4);
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  transition: opacity var(--dur-fast) var(--ease-out);
}

.grid[aria-busy='true'] {
  opacity: 0.6;
}

@media (max-width: 520px) {
  .grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-3);
  }
}

.skeleton {
  height: 290px;
  border-radius: var(--radius-md);
}

</style>
