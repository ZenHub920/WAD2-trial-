<script setup>
import { computed } from 'vue';

const props = defineProps({
  // false shows the red "unverified" version of the same badge.
  verified: { type: Boolean, default: true },
  label: { type: String, default: '' },
});
const text = computed(() => props.label || (props.verified ? 'Ticket verified' : 'Unverified ticket'));

/*
 * A scalloped seal (12 rounded points around the centre): blue with a white
 * tick when verified, red with a white X when not. Drawn here rather than
 * copied from any brand's icon.
 */
const POINTS = 12;
const seal = Array.from({ length: POINTS * 2 }, (_, i) => {
  const angle = (Math.PI * i) / POINTS - Math.PI / 2;
  const radius = i % 2 === 0 ? 11.4 : 9.6;
  return `${(12 + Math.cos(angle) * radius).toFixed(2)},${(12 + Math.sin(angle) * radius).toFixed(2)}`;
}).join(' ');
</script>

<template>
  <span class="verified" :class="{ 'verified--no': !verified }">
    <svg class="verified__seal" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <polygon :points="seal" />
      <path v-if="verified" d="M7.6 12.3l3 3 5.8-6.2" />
      <path v-else d="M8.8 8.8l6.4 6.4M15.2 8.8l-6.4 6.4" />
    </svg>
    {{ text }}
  </span>
</template>

<style scoped>
.verified {
  --verified-tone: #1d9bf0;
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-3);
  border-radius: var(--radius-sm);
  background: color-mix(in oklab, var(--verified-tone) 14%, transparent);
  color: var(--text-100);
  font-size: var(--step--1);
  font-weight: 600;
  max-width: 100%;
}
.verified--no {
  --verified-tone: #e0245e;
}
.verified__seal {
  flex: none;
}
.verified__seal polygon {
  fill: var(--verified-tone);
  stroke: var(--verified-tone);
  stroke-width: 1.6;
  stroke-linejoin: round;
}
.verified__seal path {
  fill: none;
  stroke: #fff;
  stroke-width: 2.2;
  stroke-linecap: round;
  stroke-linejoin: round;
}
</style>
