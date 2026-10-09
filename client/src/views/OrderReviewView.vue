<script setup>
import { computed } from 'vue';
import { DEMO_BUYER_ID, useListing } from '../market.js';
import CheckoutSteps from '../components/market/CheckoutSteps.vue';
import MarketPageHead from '../components/market/MarketPageHead.vue';
import MarketNotice from '../components/market/MarketNotice.vue';
import OrderItem from '../components/market/OrderItem.vue';
import OrderSummary from '../components/market/OrderSummary.vue';

const props = defineProps({ id: { type: String, required: true } });

const { listing, loading, error } = useListing(() => props.id);

const ownListing = computed(() => listing.value?.seller.id === DEMO_BUYER_ID);
const buyable = computed(() => listing.value?.status === 'open' && !ownListing.value);
</script>

<template>
  <div class="container flow">
    <MarketPageHead
      title="Order details"
      :fallback="{ name: 'listing', params: { id } }"
    />
    <CheckoutSteps :current="1" class="flow__steps" />

    <div v-if="loading" class="skeleton" aria-busy="true" />

    <MarketNotice v-else-if="error" tone="error" title="Could not load this order">
      <p class="mono">{{ error.message }}</p>
    </MarketNotice>

    <template v-else>
      <OrderItem :listing="listing" />
      <hr class="divider" />
      <OrderSummary
        heading="Order Payment Details"
        :subtotal-cents="listing.priceCents"
        :currency="listing.currency"
      />

      <MarketNotice v-if="listing.status !== 'open'" title="This ticket has been sold" class="flow__notice">
        <RouterLink :to="{ name: 'market' }">Find another listing</RouterLink>
      </MarketNotice>
      <MarketNotice v-else-if="ownListing" title="This is your listing" class="flow__notice">
        You can’t buy a ticket you are selling.
      </MarketNotice>

      <RouterLink
        v-if="buyable"
        :to="{ name: 'checkout', params: { id } }"
        class="cta"
      >
        Proceed to payment
      </RouterLink>
    </template>
  </div>
</template>

<style scoped>
.flow {
  max-width: 620px;
  padding-block: var(--space-5) var(--space-8);
}

.flow__steps {
  margin-bottom: var(--space-6);
}

.flow__notice {
  margin-top: var(--space-5);
}

.divider {
  margin-block: var(--space-6);
  border: 0;
  height: 1px;
  background: color-mix(in oklab, var(--accent-500) 30%, var(--ink-600));
}

.cta {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 60px;
  margin-top: var(--space-8);
  border-radius: var(--radius-md);
  background: var(--accent-500);
  color: #fff;
  font-size: var(--step-1);
  font-weight: 500;
  text-decoration: none;
  transition: background var(--dur-fast) var(--ease-out);
}

.cta:hover {
  background: var(--accent-400);
  color: #fff;
}

.skeleton {
  height: 420px;
}
</style>
