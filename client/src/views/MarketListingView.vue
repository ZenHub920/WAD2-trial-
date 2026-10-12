<script setup>
import { ref, computed, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api.js';
import { currentUser } from '../auth.js';
import { useListing, useSavedListings } from '../market.js';
import ListingDetailCard from '../components/market/ListingDetailCard.vue';
import MarketPageHead from '../components/market/MarketPageHead.vue';
import MarketNotice from '../components/market/MarketNotice.vue';

const props = defineProps({ id: { type: String, required: true } });

const route = useRoute();
const router = useRouter();
const { listing, loading, error } = useListing(() => props.id);

const own = computed(() => Boolean(currentUser.value) && listing.value?.seller.id === currentUser.value.id);
const busy = ref(false);
const { isSaved, toggle } = useSavedListings();

// One polite status line for actions that do not navigate.
const status = ref('');
let clear;
function announce(message) {
  status.value = message;
  clearTimeout(clear);
  clear = setTimeout(() => { status.value = ''; }, 3200);
}
onUnmounted(() => clearTimeout(clear));

function buy() {
  router.push({ name: 'order-review', params: { id: props.id } });
}

function signInFirst() {
  router.push({ name: 'login', query: { redirect: route.fullPath } });
}

/** Open (or reopen) this buyer's conversation with the seller about this listing. */
async function chat() {
  // No up-front sign-in check: the session may still be loading, so let the API decide.
  busy.value = true;
  try {
    const { conversation } = await api.startChat(props.id);
    router.push({ name: 'chat-thread', params: { id: conversation.id } });
  } catch (err) {
    if (err.status === 401) return signInFirst();
    announce('Could not open the chat. Please try again.');
  } finally {
    busy.value = false;
  }
}

async function remove() {
  if (!window.confirm('Remove this listing from the market?')) return;
  busy.value = true;
  try {
    await api.deleteListing(props.id);
    router.push({ name: 'my-listings' });
  } catch {
    announce('Could not remove the listing.');
  } finally {
    busy.value = false;
  }
}

async function copyLink() {
  try {
    await navigator.clipboard.writeText(window.location.href);
    announce('Link copied.');
  } catch {
    announce('Could not copy the link.');
  }
}
</script>

<template>
  <div class="container flow">
    <MarketPageHead title="Listing details" />

    <div v-if="loading" class="skeleton" aria-busy="true" />

    <MarketNotice v-else-if="error?.status === 404" title="Listing not found">
      It may have been removed. <RouterLink :to="{ name: 'marketplace' }">Back to the market</RouterLink>
    </MarketNotice>

    <MarketNotice v-else-if="error" tone="error" title="Could not load this listing">
      <p class="mono">{{ error.message }}</p>
    </MarketNotice>

    <ListingDetailCard
      v-else
      :listing="listing"
      :saved="isSaved(listing.id)"
      :own="own"
      :busy="busy"
      @toggle-save="toggle"
      @buy="buy"
      @chat="chat"
      @messages="router.push({ name: 'chat' })"
      @remove="remove"
      @add-to-cart="announce('The cart isn’t available yet — use Buy to check out now.')"
      @copy-link="copyLink"
    />

    <p class="toast" role="status" aria-live="polite">
      <span v-if="status">{{ status }}</span>
    </p>
  </div>
</template>

<style scoped>
.flow {
  max-width: 620px;
  padding-block: var(--space-5) var(--space-8);
}

.skeleton {
  height: 720px;
}

.toast {
  position: fixed;
  left: 50%;
  bottom: var(--space-6);
  transform: translateX(-50%);
  z-index: 50;
  max-width: calc(100% - 2 * var(--gutter));
}

.toast span {
  display: block;
  padding: var(--space-3) var(--space-5);
  border-radius: var(--radius-pill);
  background: var(--text-100);
  color: var(--ink-900);
  font-size: var(--step--1);
  font-weight: 500;
  box-shadow: var(--shadow-lg);
}
</style>
