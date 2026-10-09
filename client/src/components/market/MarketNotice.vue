<script setup>
/** Empty and error states for the market pages. */
defineProps({
  tone: { type: String, default: 'neutral' }, // 'neutral' | 'error'
  title: { type: String, default: '' },
});
</script>

<template>
  <div class="mnotice" :class="`mnotice--${tone}`" :role="tone === 'error' ? 'alert' : undefined">
    <h2 v-if="title">{{ title }}</h2>
    <slot />
  </div>
</template>

<style scoped>
.mnotice {
  padding: var(--space-5);
  border-radius: var(--radius-lg);
  border: 1px dashed var(--ink-500);
  color: var(--text-300);
}

.mnotice h2 {
  font-size: var(--step-0);
  margin-bottom: var(--space-2);
}

.mnotice--error {
  border-style: solid;
  border-color: color-mix(in oklab, var(--rose-400) 40%, var(--ink-600));
  background: color-mix(in oklab, var(--rose-400) 7%, transparent);
  color: var(--text-200);
}

.mnotice--error h2 {
  color: var(--rose-400);
}

.mnotice :slotted(a) {
  font-weight: 500;
}
</style>
