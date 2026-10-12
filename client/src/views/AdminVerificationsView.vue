<script setup>
import { ref, onMounted } from 'vue';
import { api, formatDate } from '../api.js';
import { formatMoney, formatRelative, listingTitle, sectionLabel } from '../market.js';
import IssuedTicketLists from '../components/market/IssuedTicketLists.vue';
import MarketNotice from '../components/market/MarketNotice.vue';

/**
 * Ticket verification queue. Each pending listing shows its proof of purchase;
 * approving sets the listing's Verified badge, rejecting sends the seller a note
 * so they know what to fix before re-submitting.
 */
const listings = ref([]);
const loading = ref(true);
const error = ref(null);
const notes = ref({});
const working = ref('');
const actionError = ref({});

async function load() {
  loading.value = true;
  error.value = null;
  try {
    listings.value = (await api.verificationQueue()).listings;
  } catch (err) {
    error.value = err;
  } finally {
    loading.value = false;
  }
}

async function decide(listing, decision) {
  const note = (notes.value[listing.id] ?? '').trim();
  if (decision === 'reject' && !note) {
    actionError.value = { ...actionError.value, [listing.id]: 'Tell the seller what is wrong so they can fix it.' };
    return;
  }
  working.value = listing.id;
  actionError.value = { ...actionError.value, [listing.id]: '' };
  try {
    await api.reviewVerification(listing.id, decision, note);
    listings.value = listings.value.filter((item) => item.id !== listing.id);
  } catch (err) {
    actionError.value = {
      ...actionError.value,
      [listing.id]: err.message === 'not_pending'
        ? 'Already reviewed by someone else. Refresh the queue.'
        : 'Could not save the decision. Please try again.',
    };
  } finally {
    working.value = '';
  }
}

const isPdf = (dataUrl) => dataUrl?.startsWith('data:application/pdf');

onMounted(load);
</script>

<template>
  <div class="container admin">
    <header class="admin__head">
      <div>
        <p class="eyebrow">Operator</p>
        <h1>Ticket verification</h1>
      </div>
      <button class="btn btn--ghost" type="button" :disabled="loading" @click="load">Refresh</button>
    </header>

    <div v-if="loading" class="skeleton" aria-busy="true" />

    <MarketNotice v-else-if="error?.status === 401 || error?.status === 403" title="Operators only">
      This page is for ticket reviewers. An operator account is granted with
      <code>npm run operator:grant -- &lt;email&gt;</code>.
      <RouterLink :to="{ name: 'marketplace' }">Back to the market</RouterLink>
    </MarketNotice>

    <MarketNotice v-else-if="error" tone="error" title="Could not load the queue">
      <p class="mono">{{ error.message }}</p>
    </MarketNotice>

    <template v-else>
      <IssuedTicketLists />
      <h2 class="admin__queue-title">Proof review queue</h2>
    </template>

    <MarketNotice v-if="!loading && !error && !listings.length" title="Nothing to review">
      New proofs of purchase will appear here.
    </MarketNotice>

    <ul v-else-if="!loading && !error" class="queue">
      <li v-for="listing in listings" :key="listing.id" class="item">
        <div class="item__proof">
          <iframe
            v-if="isPdf(listing.proofData)"
            :src="listing.proofData"
            :title="`Proof for ${listingTitle(listing)}`"
          />
          <a v-else :href="listing.proofData" target="_blank" rel="noopener">
            <img :src="listing.proofData" :alt="`Proof of purchase for ${listingTitle(listing)}`" />
          </a>
        </div>

        <div class="item__body">
          <h2>
            <RouterLink :to="{ name: 'ticket-detail', params: { id: listing.id } }">{{ listingTitle(listing) }}</RouterLink>
          </h2>
          <dl class="item__facts">
            <div><dt>Seller</dt><dd>{{ listing.seller.displayName }}</dd></div>
            <div><dt>Event</dt><dd>{{ listing.concert.artist }} · {{ formatDate(listing.concert.event_date) }}</dd></div>
            <div><dt>Venue</dt><dd>{{ listing.concert.venue }}</dd></div>
            <div><dt>Ticket</dt><dd>{{ sectionLabel(listing.section) }} · {{ listing.quantity }} × · {{ formatMoney(listing.priceCents) }}</dd></div>
            <div><dt>Listed</dt><dd>{{ formatRelative(listing.createdAt) }}</dd></div>
          </dl>
          <p class="item__check">
            Check the proof shows this event and date, a matching section and quantity, and an order number.
          </p>

          <label class="item__note">
            Note to seller (required to reject)
            <textarea v-model="notes[listing.id]" rows="2" maxlength="500" placeholder="e.g. Order number is cut off — please upload the full confirmation." />
          </label>
          <p v-if="actionError[listing.id]" class="item__error" role="alert">{{ actionError[listing.id] }}</p>

          <div class="item__actions">
            <button class="btn btn--ghost" type="button" :disabled="working === listing.id" @click="decide(listing, 'reject')">
              Reject
            </button>
            <button class="btn btn--primary" type="button" :disabled="working === listing.id" @click="decide(listing, 'approve')">
              Approve
            </button>
          </div>
        </div>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.admin {
  max-width: 980px;
  padding-block: var(--space-6) var(--space-9);
}

.admin__head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--space-4);
  margin-bottom: var(--space-6);
}

.admin__head h1 {
  margin-top: var(--space-2);
  font-size: var(--step-4);
}

.admin__queue-title {
  margin-bottom: var(--space-4);
  font-size: var(--step-1);
}

.queue {
  display: grid;
  gap: var(--space-5);
  padding: 0;
  list-style: none;
}

.item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr);
  gap: var(--space-5);
  padding: var(--space-5);
  border: var(--border-hairline);
  border-radius: var(--radius-lg);
  background: var(--ink-800);
}

.item__proof {
  overflow: hidden;
  border-radius: var(--radius-md);
  background: var(--ink-700);
}

.item__proof img {
  width: 100%;
  max-height: 460px;
  object-fit: contain;
}

.item__proof iframe {
  width: 100%;
  height: 460px;
  border: 0;
}

.item h2 {
  font-size: var(--step-1);
}

.item h2 a {
  color: var(--text-100);
  text-decoration: none;
}

.item__facts {
  display: grid;
  gap: var(--space-1);
  margin-top: var(--space-3);
  font-size: var(--step--1);
}

.item__facts div {
  display: grid;
  grid-template-columns: 70px 1fr;
  gap: var(--space-3);
}

.item__facts dt {
  color: var(--text-400);
}

.item__facts dd {
  color: var(--text-200);
}

.item__check {
  margin-top: var(--space-4);
  padding: var(--space-3);
  border-radius: var(--radius-md);
  background: color-mix(in oklab, var(--amber-400) 10%, transparent);
  color: var(--text-200);
  font-size: var(--step--1);
}

.item__note {
  display: grid;
  gap: var(--space-2);
  margin-top: var(--space-4);
  color: var(--text-300);
  font-size: var(--step--1);
}

.item__note textarea {
  width: 100%;
  padding: var(--space-3);
  border: var(--border-soft);
  border-radius: var(--radius-md);
  background: var(--ink-700);
  resize: vertical;
}

.item__error {
  margin-top: var(--space-2);
  color: var(--rose-400);
  font-size: var(--step--1);
}

.item__actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-3);
  margin-top: var(--space-4);
}

.skeleton {
  height: 420px;
}

@media (max-width: 760px) {
  .item {
    grid-template-columns: 1fr;
  }
}
</style>
