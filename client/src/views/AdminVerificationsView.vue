<script setup>
import { computed, ref, onMounted } from 'vue';
import { api, formatDate } from '../api.js';
import { formatMoney, formatRelative, listingTitle, sectionLabel } from '../market.js';
import MarketNotice from '../components/market/MarketNotice.vue';
import LoadingSpinner from '../components/LoadingSpinner.vue';

/**
 * Admin page for proof of purchase. Each pending listing shows its proof;
 * approving sets the listing's Verified badge, rejecting sends the seller a note
 * so they know what to fix before re-submitting. Recent decisions sit in a
 * second tab so an admin can see what was already handled.
 */
const listings = ref([]);
const recent = ref([]);
const tab = ref('pending');
const loading = ref(true);
const hasLoaded = ref(false);
const error = ref(null);
const notes = ref({});
const working = ref('');
const actionError = ref({});
const decided = ref('');

async function load() {
  loading.value = true;
  error.value = null;
  try {
    const queue = await api.verificationQueue();
    listings.value = queue.listings;
    recent.value = queue.recent ?? [];
    hasLoaded.value = true;
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
    const result = await api.reviewVerification(listing.id, decision, note);
    listings.value = listings.value.filter((item) => item.id !== listing.id);
    // Show the decision in the history straight away, without a reload.
    recent.value = [result?.listing ?? listing, ...recent.value.filter((item) => item.id !== listing.id)];
    decided.value = `${listingTitle(listing)} ${decision === 'approve' ? 'approved' : 'rejected'}.`;
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
const approvedCount = computed(() => recent.value.filter((item) => item.verification?.status === 'approved').length);
const rejectedCount = computed(() => recent.value.filter((item) => item.verification?.status === 'rejected').length);
const denied = computed(() => error.value?.status === 401 || error.value?.status === 403);

onMounted(load);
</script>

<template>
  <div class="container admin">
    <header class="admin__head page-banner d-flex flex-wrap align-items-end justify-content-between gap-3">
      <div>
        <p class="admin__eyebrow">Admin</p>
        <h1>Proof of purchase</h1>
        <p>Check that each ticket for sale is real before it gets a Verified badge.</p>
      </div>
      <button class="btn btn--outline-light" type="button" :disabled="loading" @click="load"><LoadingSpinner v-if="loading" /> Refresh</button>
    </header>

    <div v-if="loading && !hasLoaded" class="loading-state" aria-busy="true"><LoadingSpinner /> Loading verification queue…</div>

    <MarketNotice v-if="denied" title="Admins only">
      An admin account is required to access this page.
      <RouterLink to="/concerts">Back to concerts</RouterLink>
    </MarketNotice>

    <MarketNotice v-else-if="error" tone="error" title="Could not load the queue">
      <p>Use Refresh to try again.</p>
    </MarketNotice>

    <template v-if="!error && hasLoaded">
      <dl class="row g-3 admin__stats">
        <div class="col-12 col-sm-4"><div class="admin__stat"><dt>Waiting for review</dt><dd class="tabular">{{ listings.length }}</dd></div></div>
        <div class="col-6 col-sm-4"><div class="admin__stat admin__stat--ok"><dt>Recently approved</dt><dd class="tabular">{{ approvedCount }}</dd></div></div>
        <div class="col-6 col-sm-4"><div class="admin__stat admin__stat--no"><dt>Recently rejected</dt><dd class="tabular">{{ rejectedCount }}</dd></div></div>
      </dl>

      <div class="admin__tabs d-flex flex-wrap gap-2" role="tablist" aria-label="Proof review">
        <button id="admin-tab-pending" type="button" role="tab" :aria-selected="tab === 'pending'" aria-controls="admin-panel-pending" @click="tab = 'pending'">
          Pending <span class="admin__count">{{ listings.length }}</span>
        </button>
        <button id="admin-tab-history" type="button" role="tab" :aria-selected="tab === 'history'" aria-controls="admin-panel-history" @click="tab = 'history'">
          Recent decisions <span class="admin__count">{{ recent.length }}</span>
        </button>
      </div>
      <p v-if="decided" class="admin__decided" role="status">{{ decided }}</p>

      <section v-show="tab === 'pending'" id="admin-panel-pending" role="tabpanel" aria-labelledby="admin-tab-pending">
        <MarketNotice v-if="!listings.length" title="Nothing to review">
          New proofs of purchase will appear here.
        </MarketNotice>

        <ul v-else class="queue">
          <li v-for="listing in listings" :key="listing.id" class="item row g-4">
            <div class="col-12 col-lg-5">
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
            </div>

            <div class="col-12 col-lg-7">
              <h2>
                <RouterLink :to="{ name: 'ticket-detail', params: { id: listing.id } }">{{ listingTitle(listing) }}</RouterLink>
              </h2>
              <dl class="item__facts">
                <div><dt>Seller</dt><dd>{{ listing.seller.displayName }}</dd></div>
                <div><dt>Event</dt><dd>{{ listing.concert.artist }}, {{ formatDate(listing.concert.event_date) }}</dd></div>
                <div><dt>Venue</dt><dd>{{ listing.concert.venue }}</dd></div>
                <div><dt>Ticket</dt><dd>{{ sectionLabel(listing.section) }}, {{ listing.quantity }} × {{ formatMoney(listing.priceCents) }}</dd></div>
                <div><dt>Listed</dt><dd>{{ formatRelative(listing.createdAt) }}</dd></div>
              </dl>
              <p class="item__check">
                Check the proof shows this event and date, a matching section and quantity, and an order number.
              </p>

              <label class="item__note">
                Note to seller (required to reject)
                <textarea v-model="notes[listing.id]" rows="2" maxlength="500" placeholder="e.g. Please upload the full confirmation showing the order number." />
              </label>
              <p v-if="actionError[listing.id]" class="item__error" role="alert">{{ actionError[listing.id] }}</p>

              <div class="item__actions d-flex flex-wrap justify-content-end align-items-center gap-3">
                <LoadingSpinner v-if="working === listing.id" />
                <button class="btn btn--danger-ghost" type="button" :disabled="working === listing.id" @click="decide(listing, 'reject')">
                  Reject
                </button>
                <button class="btn btn--success" type="button" :disabled="working === listing.id" @click="decide(listing, 'approve')">
                  Approve
                </button>
              </div>
            </div>
          </li>
        </ul>
      </section>

      <section v-show="tab === 'history'" id="admin-panel-history" role="tabpanel" aria-labelledby="admin-tab-history">
        <MarketNotice v-if="!recent.length" title="No decisions yet">
          Approved and rejected proofs will be listed here.
        </MarketNotice>
        <ul v-else class="history">
          <li v-for="listing in recent" :key="listing.id" class="history__row row g-2 align-items-center">
            <div class="col-12 col-md-6">
              <RouterLink :to="{ name: 'ticket-detail', params: { id: listing.id } }">{{ listingTitle(listing) }}</RouterLink>
              <small>{{ listing.seller.displayName }} · {{ sectionLabel(listing.section) }}, {{ listing.quantity }} × {{ formatMoney(listing.priceCents) }}</small>
            </div>
            <div class="col-6 col-md-3">
              <span class="history__status" :class="`history__status--${listing.verification?.status}`">
                {{ listing.verification?.status === 'approved' ? 'Approved' : 'Rejected' }}
              </span>
            </div>
            <div class="col-6 col-md-3 text-end history__when">{{ formatRelative(listing.verification?.reviewedAt) || 'Just now' }}</div>
            <p v-if="listing.verification?.note" class="col-12 history__note">Note to seller: {{ listing.verification.note }}</p>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>

<style scoped>
.admin {
  max-width: 1080px;
  padding-block: var(--space-6) var(--space-9);
}

.admin__head {
  margin-bottom: var(--space-6);
}

.admin__eyebrow {
  margin-bottom: var(--space-1);
  font-size: var(--step--2);
  font-weight: 650;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  opacity: 0.8;
}

.admin__stats {
  margin-bottom: var(--space-5);
}

.admin__stat {
  height: 100%;
  padding: var(--space-4);
  border: 1px solid var(--panel-edge);
  border-left: 3px solid var(--accent-400);
  border-radius: var(--radius-md);
  background: var(--panel-bg);
}

.admin__stat--ok {
  border-left-color: var(--status-positive);
}

.admin__stat--no {
  border-left-color: var(--rose-400);
}

.admin__stat dt {
  color: var(--text-300);
  font-size: var(--step--1);
}

.admin__stat dd {
  margin-top: var(--space-1);
  color: var(--text-100);
  font-size: var(--step-2);
  font-weight: 700;
}

.admin__tabs {
  margin-bottom: var(--space-4);
  padding-bottom: var(--space-3);
  border-bottom: var(--border-hairline);
}

.admin__tabs button {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 44px;
  padding-inline: var(--space-4);
  border: var(--control-border);
  border-radius: var(--radius-pill);
  background: transparent;
  color: var(--text-300);
  font-weight: 600;
}

.admin__tabs button[aria-selected='true'] {
  border-color: var(--accent-400);
  background: var(--ink-750);
  color: var(--text-100);
}

.admin__count {
  min-width: 1.6em;
  padding: 0 0.45em;
  border-radius: var(--radius-pill);
  background: var(--ink-700);
  font-size: var(--step--2);
  text-align: center;
}

.admin__decided {
  margin-bottom: var(--space-4);
  padding: var(--space-3) var(--space-4);
  border: 1px solid var(--panel-edge);
  border-left: 3px solid var(--accent-400);
  border-radius: var(--radius-sm);
  background: var(--panel-bg);
  color: var(--text-200);
}

.queue,
.history {
  display: grid;
  gap: var(--space-5);
  padding: 0;
  list-style: none;
}

.item {
  min-width: 0;
  margin: 0;
  padding: var(--space-5) var(--space-3);
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
  overflow-wrap: anywhere;
  display: grid;
  gap: var(--space-1);
  margin-top: var(--space-3);
  font-size: var(--step--1);
}

.item__facts div {
  display: grid;
  grid-template-columns: 70px minmax(0, 1fr);
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
  background: var(--field-bg);
  resize: vertical;
}

.item__error {
  margin-top: var(--space-2);
  color: var(--rose-400);
  font-size: var(--step--1);
}

.item__actions {
  margin-top: var(--space-4);
}

.history {
  gap: var(--space-3);
}

.history__row {
  margin: 0;
  padding: var(--space-3) var(--space-2);
  border: var(--border-hairline);
  border-radius: var(--radius-md);
  background: var(--ink-800);
  overflow-wrap: anywhere;
}

.history__row a {
  display: block;
  color: var(--text-100);
  font-weight: 600;
  text-decoration: none;
}

.history__row small {
  color: var(--text-300);
  font-size: var(--step--1);
}

.history__status {
  display: inline-block;
  padding: 3px 10px;
  border-radius: var(--radius-pill);
  color: var(--text-100);
  font-size: var(--step--2);
  font-weight: 650;
}

.history__status--approved {
  background: color-mix(in oklab, var(--status-positive) 22%, transparent);
}

.history__status--rejected {
  background: color-mix(in oklab, var(--rose-400) 22%, transparent);
}

.history__when {
  color: var(--text-400);
  font-size: var(--step--1);
}

.history__note {
  margin: 0;
  color: var(--text-300);
  font-size: var(--step--1);
}
</style>
