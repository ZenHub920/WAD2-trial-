<script setup>
import { computed, onMounted, ref } from 'vue';
import { api, formatDate, LABELS } from '../api.js';
import { currentUser } from '../auth.js';
import { useRouter } from 'vue-router';

const props = defineProps({ id: { type: String, required: true } });
const router = useRouter();
const listing = ref(null);
const loading = ref(true);
const error = ref('');
const message = ref('');
const removing = ref(false);

const isOwnListing = computed(() =>
  Boolean(currentUser.value?.id && listing.value?.host?.id === currentUser.value.id),
);

onMounted(async () => {
  try {
    const { concerts } = await api.concerts();
    for (const concert of concerts) {
      const { parties } = await api.parties(concert.id);
      const party = parties.find((item) => item.id === props.id);
      if (party) {
        listing.value = { ...party, concert };
        break;
      }
    }
    if (!listing.value) error.value = 'This ticket listing could not be found.';
  } catch (err) {
    error.value = err.body?.error ?? err.message;
  } finally {
    loading.value = false;
  }
});

function showMessage(text) {
  message.value = text;
}

async function removeListing() {
  if (!window.confirm('Remove this listing?')) return;
  removing.value = true;
  message.value = '';
  try {
    await api.deleteListing(listing.value.id);
    await router.push('/my-listings');
  } catch (err) {
    message.value = err.body?.error ?? err.message;
  } finally {
    removing.value = false;
  }
}
</script>

<template>
  <main class="ticket-detail-page">
    <div class="ticket-detail-page__shell container">
      <RouterLink to="/marketplace" class="ticket-detail__back">← Back to ticket market</RouterLink>

      <div v-if="loading" class="ticket-detail__loading">Loading ticket details…</div>
      <div v-else-if="error" class="notice notice--error">{{ error }}</div>
      <article v-else class="ticket-detail">
        <img v-if="listing.imageData" class="ticket-detail__image" :src="listing.imageData" alt="Ticket listing" />
        <div class="ticket-detail__content">
          <div class="ticket-detail__seller">
            <span class="seller-avatar">{{ listing.host.displayName.slice(0, 1) }}</span>
            <span>Listed by {{ listing.host.displayName }}</span>
          </div>
          <p class="eyebrow">Ticket listing</p>
          <h1>{{ listing.concert.artist }}</h1>
          <p class="ticket-detail__tour">{{ listing.concert.tour_name || 'Live concert' }}</p>
          <p class="ticket-detail__date">
            {{ formatDate(listing.concert.event_date) }} · {{ listing.concert.venue }}
          </p>
          <p v-if="listing.notes" class="ticket-detail__description">{{ listing.notes.split('\n').slice(1).join('\n') }}</p>
          <div class="ticket-detail__meta">
            <span>{{ LABELS.section[listing.section] }}</span>
            <span>{{ listing.capacity }} {{ listing.capacity === 1 ? 'ticket' : 'tickets' }}</span>
            <strong>${{ ((listing.priceCents ?? 0) / 100).toFixed(2) }}</strong>
          </div>
          <div v-if="isOwnListing" class="ticket-detail__actions">
            <button class="btn btn--primary" type="button" :disabled="removing" @click="removeListing">
              {{ removing ? 'Removing…' : 'Remove listing' }}
            </button>
          </div>
          <div v-else class="ticket-detail__actions">
            <button class="btn btn--ghost" type="button" @click="showMessage('Chat will be available soon.')">Chat</button>
            <button class="btn btn--primary" type="button" @click="showMessage('Buying tickets will be available soon.')">Buy</button>
          </div>
          <p v-if="message" class="ticket-detail__message" role="status">{{ message }}</p>
        </div>
      </article>
    </div>
  </main>
</template>

<style scoped>
.ticket-detail-page { min-height: calc(100vh - var(--header-height)); padding-block: var(--space-5) 4rem; background: var(--ink-900); }
.ticket-detail-page__shell { max-width: 760px; }
.ticket-detail__back { color: var(--text-300); text-decoration: none; font-size: var(--step--1); }
.ticket-detail { display: grid; grid-template-columns: 1fr; margin-top: var(--space-4); overflow: hidden; border: var(--border-soft); border-radius: var(--radius-lg); background: var(--ink-850); }
.ticket-detail__image { display: block; width: 100%; max-height: 240px; object-fit: cover; }
.ticket-detail__content { padding: var(--space-5); }
.ticket-detail__seller { display: flex; align-items: center; gap: var(--space-2); color: var(--text-300); font-size: var(--step--1); margin-bottom: var(--space-3); }
.ticket-detail h1 { margin-top: var(--space-2); font-size: var(--step-3); }
.ticket-detail__tour, .ticket-detail__date { margin-top: var(--space-2); color: var(--text-300); }
.ticket-detail__description { margin-top: var(--space-3); white-space: pre-line; color: var(--text-200); }
.ticket-detail__meta { display: flex; align-items: center; gap: var(--space-2); margin-top: var(--space-4); }
.ticket-detail__meta span { padding: 5px 9px; border-radius: var(--radius-pill); background: var(--ink-700); color: var(--text-300); font-size: var(--step--1); }
.ticket-detail__meta strong { margin-left: auto; color: var(--accent-300); font-size: var(--step-1); }
.ticket-detail__actions { display: flex; gap: var(--space-3); margin-top: var(--space-4); }
.ticket-detail__actions .btn { flex: 1; text-align: center; }
.ticket-detail__message { margin-top: var(--space-3); color: var(--text-300); text-align: center; }
.ticket-detail__loading { padding: 6rem 0; color: var(--text-300); }
@media (max-width: 650px) {
  .ticket-detail__image { max-height: 200px; }
  .ticket-detail__content { padding: var(--space-5); }
}
</style>
