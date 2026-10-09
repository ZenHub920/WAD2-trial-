<script setup>
import { ref, watch } from 'vue';
import { api } from '../api.js';
import { formatDateTime, paymentMethod } from '../market.js';
import CheckoutSteps from '../components/market/CheckoutSteps.vue';
import MarketIcon from '../components/market/MarketIcon.vue';
import MarketNotice from '../components/market/MarketNotice.vue';
import OrderItem from '../components/market/OrderItem.vue';
import OrderSummary from '../components/market/OrderSummary.vue';

const props = defineProps({ id: { type: String, required: true } });

const order = ref(null);
const loading = ref(true);
const error = ref(null);

watch(
  () => props.id,
  async (id) => {
    loading.value = true;
    error.value = null;
    try {
      order.value = (await api.order(id)).order;
    } catch (err) {
      error.value = err;
    } finally {
      loading.value = false;
    }
  },
  { immediate: true },
);

function methodLabel(id) {
  const method = paymentMethod(id);
  return method ? `${method.label} •••• ${method.mask}` : id;
}
</script>

<template>
  <div class="container flow">
    <CheckoutSteps :current="3" class="flow__steps" />

    <div v-if="loading" class="skeleton" aria-busy="true" />

    <MarketNotice v-else-if="error?.status === 404" title="Order not found">
      <RouterLink :to="{ name: 'market' }">Back to the market</RouterLink>
    </MarketNotice>

    <MarketNotice v-else-if="error" tone="error" title="Could not load this order">
      <p class="mono">{{ error.message }}</p>
    </MarketNotice>

    <template v-else>
      <header class="done">
        <span class="done__icon"><MarketIcon name="check-circle" :size="40" /></span>
        <h1>Payment successful</h1>
        <p>
          The seller has been notified and will transfer your ticket.
          Keep your order number for reference.
        </p>
      </header>

      <dl class="receipt">
        <div><dt>Order number</dt><dd class="mono">{{ order.id }}</dd></div>
        <div><dt>Paid with</dt><dd>{{ methodLabel(order.paymentMethod) }}</dd></div>
        <div><dt>Date</dt><dd>{{ formatDateTime(order.createdAt) }}</dd></div>
      </dl>

      <OrderItem v-if="order.listing" :listing="order.listing" class="flow__item" />

      <OrderSummary
        :subtotal-cents="order.subtotalCents"
        :delivery-fee-cents="order.deliveryFeeCents"
        :currency="order.currency"
        class="flow__summary"
      />

      <div class="actions">
        <RouterLink :to="{ name: 'market' }" class="btn btn--primary">Back to market</RouterLink>
        <RouterLink
          v-if="order.listing"
          :to="{ name: 'listing', params: { id: order.listing.id } }"
          class="btn btn--ghost"
        >
          View listing
        </RouterLink>
      </div>
    </template>
  </div>
</template>

<style scoped>
.flow {
  max-width: 620px;
  padding-block: var(--space-6) var(--space-8);
}

.flow__steps {
  margin-bottom: var(--space-7);
}

.done {
  text-align: center;
}

.done__icon {
  display: inline-grid;
  place-items: center;
  width: 76px;
  height: 76px;
  border-radius: 50%;
  background: color-mix(in oklab, var(--mint-400) 16%, transparent);
  color: var(--mint-400);
  animation: pop var(--dur-slow) var(--ease-spring) both;
}

@keyframes pop {
  from { transform: scale(0.6); opacity: 0; }
  to   { transform: scale(1); opacity: 1; }
}

.done h1 {
  margin-top: var(--space-4);
  font-size: var(--step-3);
}

.done p {
  margin: var(--space-3) auto 0;
  max-width: 44ch;
  color: var(--text-300);
}

.receipt {
  display: grid;
  gap: var(--space-2);
  margin-block: var(--space-6);
  padding: var(--space-4) var(--space-5);
  border-radius: var(--radius-md);
  background: var(--ink-800);
  border: var(--border-hairline);
}

.receipt div {
  display: flex;
  justify-content: space-between;
  gap: var(--space-4);
  font-size: var(--step--1);
}

.receipt dt {
  color: var(--text-400);
}

.receipt dd {
  color: var(--text-100);
  text-align: right;
}

.flow__summary {
  margin-top: var(--space-6);
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  margin-top: var(--space-7);
}

.actions .btn {
  flex: 1;
  min-height: 50px;
}

.skeleton {
  height: 560px;
}
</style>
