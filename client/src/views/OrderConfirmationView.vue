<script setup>
import { ref, watch } from 'vue';
import { api } from '../api.js';
import { formatDateTime } from '../market.js';
import MarketPageHead from '../components/market/MarketPageHead.vue';
import MarketNotice from '../components/market/MarketNotice.vue';
import OrderItem from '../components/market/OrderItem.vue';
import OrderSummary from '../components/market/OrderSummary.vue';
import LoadingSpinner from '../components/LoadingSpinner.vue';

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

</script>

<template>
  <div class="container flow">
    <MarketPageHead title="Historical order" fallback="/concerts" />

    <div v-if="loading" class="loading-state" aria-busy="true"><LoadingSpinner /> Loading order…</div>

    <MarketNotice v-else-if="error?.status === 401" title="Sign in to see this order">
      <RouterLink :to="{ name: 'login', query: { redirect: $route.fullPath } }">Sign in</RouterLink>
    </MarketNotice>

    <MarketNotice v-else-if="error?.status === 404" title="Order not found">
      <RouterLink to="/concerts">Back to concerts</RouterLink>
    </MarketNotice>

    <MarketNotice v-else-if="error" tone="error" title="Could not load this order">
      <p>Please refresh the page to try again.</p>
    </MarketNotice>

    <template v-else>
      <header class="done">
        <p>
          This record was created by the previous simulated checkout. No real payment was taken
          and a ticket transfer is not confirmed by this record.
        </p>
      </header>

      <dl class="receipt">
        <div><dt>Order number</dt><dd class="mono">{{ order.id }}</dd></div>
        <div><dt>Checkout</dt><dd>Simulated — no charge</dd></div>
        <div><dt>Date</dt><dd>{{ formatDateTime(order.createdAt) }}</dd></div>
        <div v-if="order.ticketNumbers?.length">
          <dt>Ticket {{ order.ticketNumbers.length === 1 ? 'number' : 'numbers' }}</dt>
          <dd class="mono">{{ order.ticketNumbers.join(', ') }}</dd>
        </div>
      </dl>

      <OrderItem v-if="order.listing" :listing="order.listing" class="flow__item" />

      <OrderSummary
        :subtotal-cents="order.subtotalCents"
        :delivery-fee-cents="order.deliveryFeeCents"
        class="flow__summary"
      />

      <div class="actions">
        <RouterLink to="/concerts" class="btn btn--primary">Back to concerts</RouterLink>
        <RouterLink
          v-if="order.listing"
          :to="{ name: 'ticket-detail', params: { id: order.listing.id } }"
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


.done {
  text-align: center;
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
  min-width: 0;
  overflow-wrap: anywhere;
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
  min-width: 160px;
  min-height: 50px;
}

.skeleton {
  height: 560px;
}
</style>
