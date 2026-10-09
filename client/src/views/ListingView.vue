<script setup>
import { ref, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { useListing, useSavedListings } from '../market.js';
import ListingDetailCard from '../components/market/ListingDetailCard.vue';
import MarketPageHead from '../components/market/MarketPageHead.vue';
import MarketNotice from '../components/market/MarketNotice.vue';

const props = defineProps({ id: { type: String, required: true } });

const router = useRouter();
const { listing, loading, error } = useListing(() => props.id);
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
      It may have been removed. <RouterLink :to="{ name: 'market' }">Back to the market</RouterLink>
    </MarketNotice>

    <MarketNotice v-else-if="error" tone="error" title="Could not load this listing">
      <p class="mono">{{ error.message }}</p>
    </MarketNotice>

    <ListingDetailCard
      v-else
      :listing="listing"
      :saved="isSaved(listing.id)"
      @toggle-save="toggle"
      @buy="buy"
      @chat="announce(`Chat with ${listing.seller.displayName} isn’t available yet.`)"
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
