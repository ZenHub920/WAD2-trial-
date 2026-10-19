<script setup>
import { useTicket } from '../market.js';
import MarketPageHead from '../components/market/MarketPageHead.vue';
import MarketNotice from '../components/market/MarketNotice.vue';
import OrderItem from '../components/market/OrderItem.vue';
import LoadingSpinner from '../components/LoadingSpinner.vue';

const props = defineProps({ id: { type: String, required: true } });
const { listing, loading, error } = useTicket(() => props.id);
</script>

<template>
  <div class="container flow">
    <MarketPageHead title="Checkout unavailable" :fallback="{ name: 'ticket-detail', params: { id } }" />

    <div v-if="loading" class="loading-state" aria-busy="true"><LoadingSpinner /> Loading listing…</div>
    <MarketNotice v-else-if="error" tone="error" title="Could not load this listing">
      <p>Please refresh the page to try again.</p>
    </MarketNotice>
    <OrderItem v-else :listing="listing" class="flow__item" />

    <MarketNotice title="Online payments are not available" class="flow__notice">
      <p>No payment provider is connected. You cannot pay or place an order here, and no charge has been made.</p>
      <RouterLink to="/concerts">Back to concerts</RouterLink>
    </MarketNotice>
  </div>
</template>

<style scoped>
.flow {
  max-width: 620px;
  padding-block: var(--space-5) var(--space-8);
}

.flow__item,
.flow__notice {
  margin-top: var(--space-6);
}

</style>
