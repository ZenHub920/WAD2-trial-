<script setup>
import { computed } from 'vue';
import { formatMoney } from '../../market.js';

/**
 * The price breakdown shown at every step of checkout. Display only: the server
 * computes the amount actually charged from the listing.
 */
const props = defineProps({
  subtotalCents: { type: Number, required: true },
  deliveryFeeCents: { type: Number, default: 0 },
  currency: { type: String, default: 'SGD' },
  heading: { type: String, default: '' },
});

const total = computed(() => props.subtotalCents + props.deliveryFeeCents);
const money = (cents) => formatMoney(cents, props.currency, { withCode: true });
</script>

<template>
  <section class="summary">
    <h3 v-if="heading" class="summary__heading">{{ heading }}</h3>
    <dl>
      <div class="summary__line">
        <dt>Order amount</dt>
        <dd class="tabular">{{ money(subtotalCents) }}</dd>
      </div>
      <div class="summary__line">
        <dt>Delivery fee</dt>
        <dd>{{ deliveryFeeCents ? money(deliveryFeeCents) : 'Free' }}</dd>
      </div>
      <div class="summary__line summary__line--total">
        <dt>Order total</dt>
        <dd class="tabular">{{ money(total) }}</dd>
      </div>
    </dl>
  </section>
</template>

<style scoped>
.summary__heading {
  font-family: var(--font-body);
  font-size: var(--step-0);
  font-weight: 700;
  letter-spacing: 0;
  margin-bottom: var(--space-4);
}

.summary__line {
  display: flex;
  justify-content: space-between;
  gap: var(--space-4);
  padding-block: var(--space-2);
  color: var(--text-200);
}

.summary__line dd {
  color: var(--text-100);
  font-weight: 600;
}

.summary__line--total {
  margin-top: var(--space-3);
  padding-top: var(--space-4);
  border-top: 1px solid color-mix(in oklab, var(--accent-500) 30%, var(--ink-600));
  font-weight: 700;
}

.summary__line--total dt {
  color: var(--text-100);
}
</style>
