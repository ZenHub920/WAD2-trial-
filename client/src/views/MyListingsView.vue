<script setup>
import { onMounted, ref } from 'vue';
import { api, formatDate } from '../api.js';
import { sectionLabel } from '../market.js';
import ProofUpload from '../components/market/ProofUpload.vue';
import LoadingSpinner from '../components/LoadingSpinner.vue';

const listings = ref([]);
const loading = ref(true);
const error = ref('');
const removing = ref('');

async function loadListings() {
  try {
    listings.value = (await api.myTickets()).listings;
  } catch (err) {
    error.value = err.status === 401 ? 'Sign in to manage your listings.' : 'Could not load your listings. Please refresh the page to try again.';
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
    error.value = err.status === 401 ? 'Sign in before removing a listing.' : 'Could not remove this listing. Please try again.';
  } finally {
    removing.value = '';
  }
}

// Proof being attached per listing, keyed by listing id.
const proofs = ref({});
const submitting = ref('');

const VERIFICATION_COPY = {
  none: 'Ticket not verified',
  pending: 'Ticket verification pending review',
  approved: 'Ticket verified by review',
  rejected: 'Ticket verification rejected',
};

function verificationLabel({ status, method }) {
  if (status === 'approved' && method === 'ticket_number') return 'Ticket number verified';
  return VERIFICATION_COPY[status];
}

/** Proof can be sent for active listings that are unverified or were rejected. */
const canSubmitProof = (listing) =>
  listing.status === 'active' && ['none', 'rejected'].includes(listing.verification.status);

async function submitProof(listing) {
  submitting.value = listing.id;
  error.value = '';
  try {
    const { listing: updated } = await api.submitProof(listing.id, proofs.value[listing.id]);
    listings.value = listings.value.map((item) => (item.id === updated.id ? updated : item));
    delete proofs.value[listing.id];
  } catch (err) {
    error.value = err.status === 401 ? 'Sign in before submitting proof.' : 'Could not submit proof of purchase. Please try again.';
  } finally {
    submitting.value = '';
  }
}

onMounted(loadListings);
</script>

<template>
  <div class="my-listings-page">
    <div class="my-listings-page__shell container container--wide">
      <header class="my-listings-page__header page-banner">
        <div>
          <h1>My listings</h1>
          <p>Tickets you have put up for other fans to buy.</p>
        </div>
        <nav class="my-listings-page__tools" aria-label="Ticket tools">
          <RouterLink to="/concerts" class="btn btn--outline-light">Concerts</RouterLink>
          <RouterLink to="/list-ticket" class="btn btn--light">List a ticket</RouterLink>
        </nav>
      </header>

      <p v-if="error" class="notice notice--error" role="alert">{{ error }}</p>
      <div v-if="loading" class="loading-state" aria-busy="true">
        <LoadingSpinner /> Loading your listings…
      </div>
      <div v-else-if="!error && !listings.length" class="my-listings-empty">
        <span aria-hidden="true">♪</span>
        <h2>You have no listings yet.</h2>
        <p>List a ticket and it will appear here.</p>
        <RouterLink to="/list-ticket" class="btn btn--primary">List your first ticket</RouterLink>
      </div>
      <div v-else-if="listings.length" class="listing-grid">
        <article v-for="listing in listings" :key="listing.id" class="listing-card">
          <img v-if="listing.imageUrl" class="listing-card__image" :src="listing.imageUrl" alt="Ticket listing" />
          <div class="listing-card__body">
            <p class="listing-card__status">{{ listing.status }}</p>
            <h2>{{ listing.concert.artist }}</h2>
            <p class="listing-card__details">
              {{ formatDate(listing.concert.event_date) }}, {{ listing.concert.venue }}
            </p>
            <div class="listing-card__meta">
              <span>{{ sectionLabel(listing.section) }}</span>
              <span>{{ listing.quantity }} {{ listing.quantity === 1 ? 'ticket' : 'tickets' }}</span>
              <strong>${{ (listing.priceCents / 100).toFixed(2) }} total</strong>
            </div>

            <div class="verify" :data-state="listing.verification.status">
              <p class="verify__status">{{ verificationLabel(listing.verification) }}</p>
              <p v-if="listing.verification.status === 'rejected' && listing.verification.note" class="verify__note">
                Reviewer: “{{ listing.verification.note }}”
              </p>
              <p v-if="listing.ticketNumbers?.length" class="verify__numbers">
                Ticket {{ listing.ticketNumbers.length === 1 ? 'number' : 'numbers' }}:
                <span class="mono">{{ listing.ticketNumbers.join(', ') }}</span>
              </p>
              <template v-if="canSubmitProof(listing)">
                <ProofUpload v-model="proofs[listing.id]" />
                <button
                  v-if="proofs[listing.id]"
                  class="verify__send"
                  type="button"
                  :disabled="submitting === listing.id"
                  @click="submitProof(listing)"
                >
                  <LoadingSpinner v-if="submitting === listing.id" />
                  {{ submitting === listing.id ? 'Sending…'
                    : listing.verification.status === 'rejected' ? 'Re-submit for review' : 'Submit for review' }}
                </button>
              </template>
            </div>

            <RouterLink :to="{ name: 'ticket-detail', params: { id: listing.id } }" class="edit-link">View or edit listing</RouterLink>
            <button
              class="remove-button"
              type="button"
              :disabled="removing === listing.id"
              @click="removeListing(listing)"
            >
              <LoadingSpinner v-if="removing === listing.id" />
              {{ removing === listing.id ? 'Removing…' : 'Remove listing' }}
            </button>
          </div>
        </article>
      </div>
    </div>
  </div>
</template>

<style scoped>
.my-listings-page {
  min-height: calc(100vh - var(--header-height));
  padding-block: var(--space-7) 7rem;
}
.my-listings-page__header {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: var(--space-5);
  margin-bottom: var(--space-6);
}

.my-listings-page__tools { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.listing-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-5); }
.listing-card { min-width: 0; overflow: hidden; overflow-wrap: anywhere; border: var(--border-soft); border-radius: var(--radius-lg); background: var(--ink-850); }
.listing-card__image { display: block; width: 100%; height: 180px; object-fit: cover; }
.listing-card__body { padding: var(--space-5); }
.listing-card__status { color: var(--mint-400); font-size: var(--step--2); text-transform: capitalize; }
.listing-card h2 { margin-top: var(--space-2); }
.listing-card__details { margin-top: var(--space-2); color: var(--text-300); font-size: var(--step--1); }
.listing-card__meta { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); margin-top: var(--space-4); font-size: var(--step--2); }
.listing-card__meta span { padding: 3px 7px; border-radius: var(--radius-pill); background: var(--ink-700); }
.listing-card__meta strong { margin-left: auto; color: var(--accent-400); }
.edit-link { display: block; margin-top: var(--space-4); color: var(--accent-400); }
.verify { display: grid; gap: var(--space-2); margin-top: var(--space-4); padding: var(--space-3); border-radius: var(--radius-md); background: var(--ink-750); }
.verify__status { font-size: var(--step--1); font-weight: 600; color: var(--text-300); }
.verify[data-state='pending'] .verify__status { color: var(--amber-400); }
.verify[data-state='approved'] .verify__status { color: var(--mint-400); }
.verify[data-state='rejected'] .verify__status { color: var(--rose-400); }
.verify__note { font-size: var(--step--1); color: var(--text-200); }
.verify__numbers { font-size: var(--step--2); color: var(--text-300); }
.verify__send { display: inline-flex; align-items: center; gap: var(--space-2); justify-self: start; padding: var(--space-2) var(--space-4); border-radius: var(--radius-md); background: var(--accent-500); color: #fff; font-size: var(--step--1); }
.verify__send:disabled { opacity: .6; }
.remove-button { display: inline-flex; align-items: center; justify-content: center; gap: var(--space-2); width: 100%; margin-top: var(--space-5); padding: var(--space-3); border: 1px solid var(--rose-400); border-radius: var(--radius-md); color: var(--rose-400); }
.remove-button:hover { background: color-mix(in oklab, var(--rose-400) 12%, transparent); }
.remove-button:disabled { opacity: .6; }
.my-listings-empty { display: grid; justify-items: center; gap: var(--space-3); padding: 6rem var(--space-5); text-align: center; border: var(--border-soft); border-radius: var(--radius-lg); }
.my-listings-empty > span { color: var(--accent-400); font-size: 3rem; }
.my-listings-empty p { color: var(--text-300); }
@media (max-width: 800px) {
  .listing-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 600px) {
  .my-listings-page__header { align-items: stretch; flex-direction: column; }
  .listing-grid { grid-template-columns: 1fr; }
}
</style>
