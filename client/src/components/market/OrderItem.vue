<script setup>
import TicketPoster from './TicketPoster.vue';
import VerifiedBadge from './VerifiedBadge.vue';

/** The listing being bought, as it appears at the top of each checkout step. */
defineProps({
  listing: { type: Object, required: true },
});
</script>

<template>
  <div class="item">
    <div class="item__thumb">
      <TicketPoster :listing="listing" ratio="4 / 5" compact />
    </div>
    <div class="item__body">
      <h2 class="item__title">{{ listing.title }}</h2>
      <p class="item__seller">Seller: {{ listing.seller.displayName }}</p>
      <VerifiedBadge v-if="listing.verified" label="Verified" />
    </div>
  </div>
</template>

<style scoped>
.item {
  display: grid;
  grid-template-columns: minmax(96px, 30%) 1fr;
  gap: var(--space-5);
  align-items: start;
}

.item__title {
  font-size: var(--step-2);
  line-height: 1.12;
}

.item__seller {
  margin-block: var(--space-2) var(--space-3);
  font-size: var(--step--1);
  color: var(--text-300);
}
</style>
