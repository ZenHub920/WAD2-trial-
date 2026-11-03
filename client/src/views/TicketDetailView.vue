<script setup>
import { computed, ref, onMounted, onUnmounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api.js';
import { currentUser } from '../auth.js';
import { takeListingFlash, useSavedListings, useTicket } from '../market.js';
import ListingDetailCard from '../components/market/ListingDetailCard.vue';
import MarketNotice from '../components/market/MarketNotice.vue';
import MarketPageHead from '../components/market/MarketPageHead.vue';
import LoadingSpinner from '../components/LoadingSpinner.vue';

/**
 * One ticket listing, as the full listing card. Buyers can chat with the seller;
 * the seller can remove their own listing or open its edit page. Online checkout
 * is unavailable.
 */
const props = defineProps({ id: { type: String, required: true } });

const route = useRoute();
const router = useRouter();
const { listing, loading, error } = useTicket(() => props.id);
const { isSaved, toggle } = useSavedListings();

const isOwnListing = computed(() =>
  Boolean(currentUser.value?.id && listing.value?.seller?.id === currentUser.value.id),
);
const busy = ref(false);

// One polite status line for actions that do not navigate.
const message = ref('');
let clear;
function announce(text) {
  message.value = text;
  clearTimeout(clear);
  clear = setTimeout(() => { message.value = ''; }, 3200);
}
onUnmounted(() => clearTimeout(clear));

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

async function copyLink() {
  try {
    await navigator.clipboard.writeText(window.location.href);
    announce('Link copied.');
  } catch {
    announce('Could not copy the link.');
  }
}

async function removeListing() {
  if (!window.confirm('Remove this listing?')) return;
  busy.value = true;
  try {
    await api.deleteTicket(listing.value.id);
    await router.push('/my-listings');
  } catch (err) {
    announce('Could not remove this listing. Please try again.');
  } finally {
    busy.value = false;
  }
}

// Editing happens on its own page (seller only).
function editListing() {
  router.push({ name: 'ticket-edit', params: { id: props.id } });
}

// The edit page hands over "Listing updated." when it returns here.
onMounted(() => {
  const flash = takeListingFlash(props.id);
  if (flash) announce(flash);
});
</script>

<template>
  <div class="container flow">
    <MarketPageHead title="Listing details" />

    <div v-if="loading" class="loading-state" aria-busy="true"><LoadingSpinner /> Loading listing…</div>

    <MarketNotice v-else-if="error?.status === 404" title="Listing not found">
      It may have been removed. <RouterLink to="/tickets">Back to tickets</RouterLink>
    </MarketNotice>

    <MarketNotice v-else-if="error" tone="error" title="Could not load this listing">
      <p>Please refresh the page to try again.</p>
    </MarketNotice>

    <template v-else>
      <ListingDetailCard
        :listing="listing"
        :saved="isSaved(listing.id)"
        :own="isOwnListing"
        :busy="busy"
        @toggle-save="toggle"
        @chat="chat"
        @edit="editListing"
        @remove="removeListing"
        @copy-link="copyLink"
      />
    </template>

    <p class="toast" role="status" aria-live="polite">
      <span v-if="message">{{ message }}</span>
    </p>
  </div>
</template>

<style scoped>
.flow {
  max-width: 620px;
  padding-block: var(--space-5) var(--space-8);
}


.toast {
  position: fixed;
  left: 50%;
  bottom: calc(var(--tabbar-height, 0px) + var(--space-5));
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
