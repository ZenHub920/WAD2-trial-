<script setup>
import MarketIcon from './market/MarketIcon.vue';

/**
 * The app's one back control: an arrow in a 44px square that tints on hover.
 * `label` says where it goes; it is the accessible name and the hover tooltip.
 * Pass `to` for a link; without it this is a button and the host handles @click.
 */
defineProps({
  label: { type: String, default: 'Go back' },
  to: { type: [String, Object], default: null },
});
</script>

<template>
  <RouterLink v-if="to" :to="to" class="back-arrow" :aria-label="label" :title="label">
    <MarketIcon name="back" :size="26" />
  </RouterLink>
  <button v-else type="button" class="back-arrow" :aria-label="label" :title="label">
    <MarketIcon name="back" :size="26" />
  </button>
</template>

<style scoped>
.back-arrow {
  display: grid;
  flex: none;
  place-items: center;
  width: 44px;
  height: 44px;
  padding: 0;
  border: 0;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-100);
  text-decoration: none;
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-out);
}
.back-arrow:hover {
  background: var(--ink-750);
}
.back-arrow:focus-visible {
  outline: 2px solid var(--accent-400);
  outline-offset: 2px;
}
.back-arrow:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
</style>
