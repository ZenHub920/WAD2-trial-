<script setup>
import MarketIcon from './MarketIcon.vue';

defineProps({
  label: { type: String, default: 'Verified Ticket' },
});
</script>

<template>
  <span class="verified">
    <MarketIcon name="check-circle" :size="18" />
    {{ label }}
  </span>
</template>

<style scoped>
.verified {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-3);
  border-radius: var(--radius-sm);
  background: color-mix(in oklab, var(--accent-500) 18%, transparent);
  color: var(--text-100);
  font-size: var(--step--1);
  font-weight: 500;
  white-space: nowrap;
}
</style>
