<script setup>
import { onMounted, ref } from 'vue';
import { api, formatDate, LABELS } from '../api.js';

const listings = ref([]);
const loading = ref(true);
const error = ref('');
const removing = ref('');

async function loadListings() {
  try {
    listings.value = (await api.myTickets()).listings;
  } catch (err) {
    error.value = err.body?.error ?? err.message;
  } finally {
    loading.value = false;
  }
}

async function removeListing(listing) {
  if (!window.confirm(`Remove your listing for ${listing.concert.artist}?`)) return;
  removing.value = listing.id;
  error.value = '';
  try {
    await api.deleteTicket(listing.id);
    listings.value = listings.value.filter((item) => item.id !== listing.id);
  } catch (err) {
    error.value = err.body?.error ?? err.message;
  } finally {
    removing.value = '';
  }
}

onMounted(loadListings);
</script>

<template>
  <main class="my-listings-page">
    <div class="my-listings-page__shell container container--wide">
      <header class="my-listings-page__header">
        <div>
          <p class="eyebrow">Your marketplace activity</p>
          <h1>My listings</h1>
          <p>View and manage the tickets you have listed for sale.</p>
        </div>
      </header>

      <p v-if="error" class="notice notice--error">{{ error }}</p>
      <div v-else-if="loading" class="listing-grid">
        <div v-for="n in 3" :key="n" class="listing-skeleton" />
      </div>
      <div v-else-if="!listings.length" class="my-listings-empty">
        <span aria-hidden="true">♪</span>
        <h2>You have no listings yet.</h2>
        <p>List a ticket and it will appear here.</p>
        <RouterLink to="/list-ticket" class="btn btn--primary">List your first ticket</RouterLink>
      </div>
      <div v-else class="listing-grid">
        <article v-for="listing in listings" :key="listing.id" class="listing-card">
          <img v-if="listing.imageUrl" class="listing-card__image" :src="listing.imageUrl" alt="Ticket listing" />
          <div class="listing-card__body">
            <p class="listing-card__status">{{ listing.status }}</p>
            <h2>{{ listing.concert.artist }}</h2>
            <p class="listing-card__details">
              {{ formatDate(listing.concert.event_date) }} · {{ listing.concert.venue }}
            </p>
            <div class="listing-card__meta">
              <span>{{ LABELS.section[listing.section] }}</span>
              <span>{{ listing.quantity }} {{ listing.quantity === 1 ? 'ticket' : 'tickets' }}</span>
              <strong>${{ (listing.priceCents / 100).toFixed(2) }}</strong>
            </div>
            <RouterLink :to="{ name: 'ticket-detail', params: { id: listing.id } }" class="edit-link">View or edit listing</RouterLink>
            <button
              class="remove-button"
              type="button"
              :disabled="removing === listing.id"
              @click="removeListing(listing)"
            >
              {{ removing === listing.id ? 'Removing…' : 'Remove listing' }}
            </button>
          </div>
        </article>
      </div>
    </div>
  </main>
</template>

<style scoped>
.my-listings-page {
  min-height: calc(100vh - var(--header-height));
  padding-block: var(--space-7) 7rem;
  background: var(--ink-900);
}
.my-listings-page__header {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: var(--space-5);
  margin-bottom: var(--space-6);
}
.my-listings-page__header h1 { margin-top: var(--space-2); }
.my-listings-page__header p:last-child { margin-top: var(--space-3); color: var(--text-300); }
.listing-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-5); }
.listing-card { overflow: hidden; border: var(--border-soft); border-radius: var(--radius-lg); background: var(--ink-850); }
.listing-card__image { display: block; width: 100%; height: 180px; object-fit: cover; }
.listing-card__body { padding: var(--space-5); }
.listing-card__status { color: var(--mint-400); font-size: var(--step--2); text-transform: capitalize; }
.listing-card h2 { margin-top: var(--space-2); }
.listing-card__details { margin-top: var(--space-2); color: var(--text-300); font-size: var(--step--1); }
.listing-card__meta { display: flex; align-items: center; gap: var(--space-2); margin-top: var(--space-4); font-size: var(--step--2); }
.listing-card__meta span { padding: 3px 7px; border-radius: var(--radius-pill); background: var(--ink-700); }
.listing-card__meta strong { margin-left: auto; color: var(--accent-300); }
.edit-link { display: block; margin-top: var(--space-4); color: var(--accent-300); }
.remove-button { width: 100%; margin-top: var(--space-5); padding: var(--space-3); border: 1px solid var(--rose-400); border-radius: var(--radius-md); color: var(--rose-400); }
.remove-button:hover { background: color-mix(in oklab, var(--rose-400) 12%, transparent); }
.remove-button:disabled { opacity: .6; }
.my-listings-empty { display: grid; justify-items: center; gap: var(--space-3); padding: 6rem var(--space-5); text-align: center; border: var(--border-soft); border-radius: var(--radius-lg); }
.my-listings-empty > span { color: var(--accent-300); font-size: 3rem; }
.my-listings-empty p { color: var(--text-300); }
.listing-skeleton { height: 300px; border-radius: var(--radius-lg); background: var(--ink-800); }
@media (max-width: 800px) {
  .listing-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 600px) {
  .my-listings-page__header { align-items: stretch; flex-direction: column; }
  .listing-grid { grid-template-columns: 1fr; }
}
</style>
