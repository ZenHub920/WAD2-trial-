<script setup>
import { computed, onMounted, ref } from 'vue';
import { api } from '../api.js';
import { useSavedListings } from '../market.js';
import ListingCard from '../components/market/ListingCard.vue';

const listings = ref([]);
const loading = ref(true);
const error = ref('');
const search = ref('');
const selectedDate = ref('');
const selectedCategory = ref('all');
const minPrice = ref(0);
const maxPrice = ref(100000);

const { isSaved, toggle } = useSavedListings();

onMounted(async () => {
  try {
    listings.value = (await api.listings()).listings;
  } catch (err) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
});

/** Categories differ per venue (Cat 3, Pen A, Stalls…), so offer the ones actually listed. */
const categories = computed(() =>
  [...new Set(listings.value.map((l) => l.category))].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true }),
  ),
);

const filteredListings = computed(() => {
  const query = search.value.trim().toLowerCase();
  return listings.value.filter((listing) => {
    const matchesSearch =
      !query ||
      [listing.title, listing.concert.artist, listing.concert.venue, listing.seller.displayName]
        .some((text) => text?.toLowerCase().includes(query));
    const date = (listing.showDate ?? listing.concert.eventDate).slice(0, 10);
    const matchesDate = !selectedDate.value || date === selectedDate.value;
    const matchesCategory =
      selectedCategory.value === 'all' || listing.category === selectedCategory.value;
    const price = listing.priceCents / 100;
    const matchesPrice = price >= minPrice.value && price <= maxPrice.value;
    return matchesSearch && matchesDate && matchesCategory && matchesPrice;
  });
});

function resetFilters() {
  selectedDate.value = '';
  selectedCategory.value = 'all';
  minPrice.value = 0;
  maxPrice.value = 100000;
}
</script>

<template>
  <div class="marketplace">
    <div class="marketplace__shell container container--wide">
      <header class="marketplace__top">
        <p class="marketplace__title">Ticket market</p>
      </header>

      <div class="marketplace__layout">
        <aside class="filter-panel" aria-label="Search and filter tickets">
          <label class="marketplace__search">
            <span aria-hidden="true">⌕</span>
            <input v-model="search" type="search" placeholder="Search tickets" />
          </label>

        <div class="filter-panel__heading">
          <div>
            <p class="eyebrow">Refine your search</p>
            <h2>Filter tickets</h2>
          </div>
        </div>

        <div class="filter-grid">
          <label>
            Date (DD/MM/YYYY)
            <input v-model="selectedDate" type="date" lang="en-GB" />
          </label>
          <label>
            Category
            <select v-model="selectedCategory">
              <option value="all">Any category</option>
              <option v-for="category in categories" :key="category" :value="category">{{ category }}</option>
            </select>
          </label>
          <label>
            Minimum price
            <input v-model.number="minPrice" type="number" min="0" :max="maxPrice" step="1" placeholder="$0" />
          </label>
          <label>
            Maximum price
            <input v-model.number="maxPrice" type="number" :min="minPrice" max="100000" step="1" placeholder="$100000" />
          </label>
        </div>

        <div class="filter-panel__footer">
          <button class="text-button" @click="resetFilters">Reset filters</button>
          <span class="filter-count">{{ filteredListings.length }} tickets</span>
        </div>
        </aside>

        <main class="marketplace__results">
          <div v-if="loading" class="ticket-grid">
            <div v-for="n in 6" :key="n" class="ticket-skeleton" />
          </div>
          <div v-else-if="error" class="notice notice--error">
            <h3>Could not load tickets</h3>
            <p>{{ error }}</p>
          </div>
          <div v-else-if="!filteredListings.length" class="marketplace__empty">
            <span aria-hidden="true">♪</span>
            <h2>No tickets match those filters.</h2>
            <p>Try another artist, date, or seat section.</p>
            <button class="btn btn--ghost" @click="resetFilters">Clear filters</button>
          </div>
          <div v-else class="ticket-grid">
            <ListingCard
              v-for="listing in filteredListings"
              :key="listing.id"
              :listing="listing"
              :saved="isSaved(listing.id)"
              @toggle-save="toggle"
            />
          </div>
        </main>
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
  margin-bottom: var(--space-6);
}

.marketplace__title {
  color: #000;
  font-family: var(--font-display);
  font-size: var(--step-3);
  font-weight: 700;
  letter-spacing: -0.025em;
  white-space: nowrap;
}
.marketplace__layout { display: grid; grid-template-columns: 260px minmax(0, 1fr); align-items: start; gap: var(--space-6); }
.marketplace__results { min-width: 0; }
.filter-panel {
  position: sticky;
  top: calc(var(--header-height) + var(--space-5));
  padding: var(--space-5);
  border: var(--border-soft);
  border-radius: var(--radius-lg);
  background: var(--ink-850);
}
.marketplace__search { display: flex; align-items: center; gap: var(--space-2); padding: var(--space-3); margin-bottom: var(--space-6); border: var(--border-soft); border-radius: var(--radius-md); background: var(--ink-700); color: var(--text-400); }
.marketplace__search input { width: 100%; min-width: 0; border: 0; outline: 0; background: transparent; }
.filter-panel__heading, .filter-panel__footer { display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); }
.filter-panel h2 { margin-top: var(--space-2); }
.filter-grid { display: grid; gap: var(--space-4); margin-block: var(--space-5); }
.filter-grid label { display: grid; gap: var(--space-2); color: var(--text-300); font-size: var(--step--1); }
.filter-grid select,
.filter-grid input {
  width: 100%;
  min-height: 48px;
  padding: var(--space-3);
  border: var(--border-soft);
  border-radius: var(--radius-md);
  background: var(--ink-700);
  color: var(--text-200);
}
.filter-grid input::placeholder { color: var(--text-400); }
.filter-grid input:focus,
.filter-grid select:focus {
  border-color: var(--accent-400);
  outline: none;
}
.text-button { color: var(--accent-300); }
.text-button:hover { color: var(--text-100); }
.filter-count { color: var(--text-400); font-size: var(--step--2); }

.ticket-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: var(--space-4); }

.marketplace__empty { padding: var(--space-9) var(--space-4); text-align: center; }
.marketplace__empty > span { color: var(--accent-300); font-size: 3rem; }
.marketplace__empty p { margin-block: var(--space-3) var(--space-5); color: var(--text-300); }
.ticket-skeleton { min-height: 340px; border-radius: var(--radius-lg); background: linear-gradient(110deg, var(--ink-850) 30%, var(--ink-700) 45%, var(--ink-850) 60%); background-size: 200% 100%; animation: shimmer 1.3s infinite; }
@keyframes shimmer { to { background-position-x: -200%; } }

@media (max-width: 820px) {
  .marketplace { padding-block: var(--space-6) 6rem; }
  .marketplace__top { align-items: flex-start; flex-direction: column; }
  .marketplace__layout { grid-template-columns: 1fr; }
  .filter-panel { position: static; }
  .filter-grid { grid-template-columns: repeat(2, 1fr); }
  .ticket-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 540px) {
  .filter-grid { grid-template-columns: 1fr; }
  .ticket-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-3); }
}
</style>
