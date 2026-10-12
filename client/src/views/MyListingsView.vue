<script setup>
import { onMounted, ref } from 'vue';
import { api, formatDate } from '../api.js';
import { formatMoney } from '../market.js';
import TicketPoster from '../components/market/TicketPoster.vue';
import ProofUpload from '../components/market/ProofUpload.vue';

const listings = ref([]);
const loading = ref(true);
const error = ref('');
const removing = ref('');

async function loadListings() {
  try {
    listings.value = (await api.myListings()).listings;
  } catch (err) {
    error.value = err.body?.error ?? err.message;
  } finally {
    loading.value = false;
  }
}

async function removeListing(listing) {
  if (!window.confirm(`Remove your listing for ${listing.title}?`)) return;
  removing.value = listing.id;
  error.value = '';
  try {
    await api.deleteListing(listing.id);
    listings.value = listings.value.filter((item) => item.id !== listing.id);
  } catch (err) {
    error.value = err.body?.error ?? err.message;
  } finally {
    removing.value = '';
  }
}

// Proof being attached per listing, keyed by listing id.
const proofs = ref({});
const submitting = ref('');

const VERIFICATION_COPY = {
  none: 'Not verified',
  pending: 'Verification pending review',
  approved: 'Verified by review',
  rejected: 'Verification rejected',
};

/** Proof can be sent for open listings that are unverified or were rejected. */
const canSubmitProof = (listing) =>
  listing.status === 'open' && ['none', 'rejected'].includes(listing.verification.status);

async function submitProof(listing) {
  submitting.value = listing.id;
  error.value = '';
  try {
    const { listing: updated } = await api.submitProof(listing.id, proofs.value[listing.id]);
    listings.value = listings.value.map((item) => (item.id === updated.id ? updated : item));
    delete proofs.value[listing.id];
  } catch (err) {
    error.value = err.body?.error ?? err.message;
  } finally {
    submitting.value = '';
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
          <TicketPoster :listing="listing" ratio="16 / 9" />
          <div class="listing-card__body">
            <p class="listing-card__status" :data-status="listing.status">{{ listing.status }}</p>
            <h2>
              <RouterLink :to="{ name: 'ticket-detail', params: { id: listing.id } }">{{ listing.title }}</RouterLink>
            </h2>
            <p class="listing-card__details">
              {{ formatDate(listing.showDate ?? listing.concert.eventDate) }} · {{ listing.concert.venue }}
            </p>
            <div class="listing-card__meta">
              <span>{{ listing.category }}</span>
              <span>{{ listing.quantity }} {{ listing.quantity === 1 ? 'ticket' : 'tickets' }}</span>
              <strong>{{ formatMoney(listing.priceCents, listing.currency) }}</strong>
            </div>

            <div class="verify" :data-state="listing.verification.status">
              <p class="verify__status">
                {{ listing.verification.status === 'approved' && listing.verification.method === 'ticket_number'
                  ? 'Verified — ticket number matched the issued list'
                  : VERIFICATION_COPY[listing.verification.status] }}
              </p>
              <p v-if="listing.ticketNumbers?.length" class="verify__numbers">
                Ticket {{ listing.ticketNumbers.length === 1 ? 'number' : 'numbers' }}:
                <span class="mono">{{ listing.ticketNumbers.join(', ') }}</span>
              </p>
              <p v-if="listing.verification.status === 'rejected' && listing.verification.note" class="verify__note">
                Reviewer: “{{ listing.verification.note }}”
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
                  {{ submitting === listing.id ? 'Sending…'
                    : listing.verification.status === 'rejected' ? 'Re-submit for review' : 'Submit for review' }}
                </button>
              </template>
            </div>
            <button
              v-if="listing.status === 'open'"
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
.listing-card__body { padding: var(--space-5); }
.listing-card__status { color: var(--mint-400); font-size: var(--step--2); text-transform: capitalize; }
.listing-card h2 { margin-top: var(--space-2); font-size: var(--step-1); }
.listing-card h2 a { color: var(--text-100); text-decoration: none; }
.listing-card h2 a:hover { color: var(--accent-300); }
.listing-card__status[data-status='sold'] { color: var(--amber-400); }
.listing-card__details { margin-top: var(--space-2); color: var(--text-300); font-size: var(--step--1); }
.listing-card__meta { display: flex; align-items: center; gap: var(--space-2); margin-top: var(--space-4); font-size: var(--step--2); }
.listing-card__meta span { padding: 3px 7px; border-radius: var(--radius-pill); background: var(--ink-700); }
.listing-card__meta strong { margin-left: auto; color: var(--accent-300); }
.verify { display: grid; gap: var(--space-2); margin-top: var(--space-4); padding: var(--space-3); border-radius: var(--radius-md); background: var(--ink-750); }
.verify__status { font-size: var(--step--1); font-weight: 600; color: var(--text-300); }
.verify[data-state='pending'] .verify__status { color: var(--amber-400); }
.verify[data-state='approved'] .verify__status { color: var(--mint-400); }
.verify[data-state='rejected'] .verify__status { color: var(--rose-400); }
.verify__note { font-size: var(--step--1); color: var(--text-200); }
.verify__numbers { font-size: var(--step--2); color: var(--text-300); }
.verify__send { justify-self: start; padding: var(--space-2) var(--space-4); border-radius: var(--radius-md); background: var(--accent-500); color: #fff; font-size: var(--step--1); }
.verify__send:disabled { opacity: .6; }
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
