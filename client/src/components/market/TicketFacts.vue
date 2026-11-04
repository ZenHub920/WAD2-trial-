<script setup>
/**
 * A listing's details as plain labelled lines ("Section: Cat 1", then
 * "No. of tickets: 2"), one per line, rather than pill-shaped chips.
 */
defineProps({
  /** [label, value] pairs, in display order. Empty values are skipped. */
  facts: { type: Array, required: true },
});
</script>

<template>
  <dl class="ticket-facts" aria-label="Ticket details">
    <template v-for="[label, value] in facts" :key="label">
      <div v-if="value !== '' && value != null" class="ticket-facts__row">
        <dt>{{ label }}:</dt>
        <dd>{{ value }}</dd>
      </div>
    </template>
  </dl>
</template>

<style scoped>
.ticket-facts {
  display: grid;
  gap: var(--space-1);
  margin: 0;
  font-size: var(--step--1);
}
.ticket-facts__row {
  display: flex;
  flex-wrap: wrap;
  gap: 0 var(--space-1);
  min-width: 0;
}
.ticket-facts dt {
  color: var(--text-400);
  font-weight: 500;
}
.ticket-facts dd {
  margin: 0;
  color: var(--text-100);
  overflow-wrap: anywhere;
}
</style>
