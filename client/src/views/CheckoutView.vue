<script setup>
import { ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api.js';
import { DEMO_BUYER_ID, PAYMENT_METHODS, formatMoney, useListing } from '../market.js';
import CheckoutSteps from '../components/market/CheckoutSteps.vue';
import MarketIcon from '../components/market/MarketIcon.vue';
import MarketPageHead from '../components/market/MarketPageHead.vue';
import MarketNotice from '../components/market/MarketNotice.vue';
import OrderSummary from '../components/market/OrderSummary.vue';

const props = defineProps({ id: { type: String, required: true } });

const router = useRouter();
const { listing, loading, error } = useListing(() => props.id);

const method = ref(PAYMENT_METHODS[0].id);
const paying = ref(false);
const payError = ref(null);

const PAY_ERRORS = {
  listing_unavailable: 'Someone else bought this ticket before your payment went through. You have not been charged.',
  cannot_buy_own_listing: 'You can’t buy a ticket you are selling.',
  listing_not_found: 'This listing no longer exists. You have not been charged.',
};

const sold = computed(
  () => listing.value?.status !== 'open' || payError.value?.code === 'listing_unavailable',
);

async function pay() {
  if (paying.value || !listing.value) return;
  paying.value = true;
  payError.value = null;
  try {
    const { order } = await api.buyListing(props.id, {
      buyerUserId: DEMO_BUYER_ID,
      paymentMethod: method.value,
    });
    // Replace, so Back from the receipt cannot land on a payable form again.
    router.replace({ name: 'order', params: { id: order.id } });
  } catch (err) {
    payError.value = {
      code: err.message,
      message: PAY_ERRORS[err.message] ?? 'The payment could not be completed. Please try again.',
    };
    paying.value = false;
  }
}
</script>

<template>
  <div class="container flow">
    <MarketPageHead title="Checkout" :fallback="{ name: 'order-review', params: { id } }" />
    <CheckoutSteps :current="2" class="flow__steps" />

    <div v-if="loading" class="skeleton" aria-busy="true" />

    <MarketNotice v-else-if="error" tone="error" title="Could not load checkout">
      <p class="mono">{{ error.message }}</p>
    </MarketNotice>

    <form v-else class="checkout" @submit.prevent="pay">
      <OrderSummary :subtotal-cents="listing.priceCents" :currency="listing.currency" />

      <fieldset class="methods" :disabled="paying || sold">
        <legend>Payment method</legend>
        <label
          v-for="option in PAYMENT_METHODS"
          :key="option.id"
          class="method"
          :class="{ 'method--on': method === option.id }"
        >
          <input v-model="method" type="radio" name="payment-method" :value="option.id" />
          <span class="method__brand" :data-brand="option.id">{{ option.label }}</span>
          <span class="method__mask tabular" :aria-label="`ending in ${option.mask}`">
            •••• {{ option.mask }}
          </span>
        </label>
      </fieldset>

      <MarketNotice
        v-if="payError"
        tone="error"
        :title="payError.code === 'listing_unavailable' ? 'Ticket no longer available' : 'Payment failed'"
        class="checkout__error"
      >
        <p>{{ payError.message }}</p>
        <RouterLink v-if="sold" :to="{ name: 'market' }">Find another listing</RouterLink>
      </MarketNotice>
      <MarketNotice v-else-if="sold" title="This ticket has been sold" class="checkout__error">
        <RouterLink :to="{ name: 'market' }">Find another listing</RouterLink>
      </MarketNotice>

      <button class="pay" type="submit" :disabled="paying || sold" :aria-busy="paying">
        <span v-if="paying" class="pay__spinner" aria-hidden="true" />
        <template v-if="paying">Processing payment…</template>
        <template v-else>Pay {{ formatMoney(listing.priceCents, listing.currency, { withCode: true }) }}</template>
      </button>
      <p class="secure">
        <MarketIcon name="lock" :size="14" />
        Demo checkout — no real payment is taken.
      </p>
    </form>
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

/* ---- Payment methods -------------------------------------------------- */

.methods {
  margin-top: var(--space-6);
  padding: var(--space-5) 0 0;
  border: 0;
  border-top: 1px solid color-mix(in oklab, var(--accent-500) 30%, var(--ink-600));
  display: grid;
  gap: var(--space-3);
}

.methods legend {
  float: left;
  width: 100%;
  margin-bottom: var(--space-3);
  color: var(--text-200);
}

.method {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  min-height: 72px;
  padding: var(--space-3) var(--space-5);
  border-radius: var(--radius-md);
  background: var(--ink-750);
  border: 1px solid var(--ink-600);
  cursor: pointer;
  transition: border-color var(--dur-fast) var(--ease-out), background var(--dur-fast) var(--ease-out);
}

.method:hover {
  border-color: var(--ink-500);
}

.method--on {
  border-color: var(--accent-500);
  background: color-mix(in oklab, var(--accent-500) 8%, var(--ink-800));
}

.method:has(input:focus-visible) {
  outline: 2px solid var(--accent-400);
  outline-offset: 2px;
}

.method input {
  accent-color: var(--accent-500);
  width: 18px;
  height: 18px;
  flex: none;
}

.methods:disabled .method {
  cursor: not-allowed;
  opacity: 0.6;
}

.method__brand {
  font-weight: 700;
  font-size: var(--step-0);
  color: var(--text-100);
}

/* Wordmarks as styled text, not borrowed logos. */
.method__brand[data-brand='visa'] { font-style: italic; letter-spacing: 0.04em; text-transform: uppercase; }
.method__brand[data-brand='paypal'] { font-style: italic; }

.method__mask {
  margin-left: auto;
  color: var(--text-300);
  font-family: var(--font-mono);
  font-size: var(--step--1);
}

.checkout__error {
  margin-top: var(--space-5);
}

/* ---- Pay -------------------------------------------------------------- */

.pay {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-3);
  width: 100%;
  min-height: 60px;
  margin-top: var(--space-7);
  border-radius: var(--radius-md);
  background: var(--accent-500);
  color: #fff;
  font-size: var(--step-1);
  font-weight: 500;
  transition: background var(--dur-fast) var(--ease-out);
}

.pay:hover:not(:disabled) {
  background: var(--accent-400);
}

.pay:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.pay[aria-busy='true'] {
  opacity: 0.85;
  cursor: progress;
}

.pay__spinner {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 2px solid rgba(255, 255, 255, 0.4);
  border-top-color: #fff;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.secure {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  margin-top: var(--space-3);
  font-size: var(--step--2);
  color: var(--text-400);
}

.skeleton {
  height: 560px;
}
</style>
