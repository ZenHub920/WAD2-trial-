<script setup>
/**
 * Placeholder for a tab whose section belongs to another branch.
 *
 * The tab bar has five destinations because the prototype does. Two of them —
 * Chat and Profile — are not this branch's work. A tab that silently does
 * nothing invites someone to rebuild it, so each says what it is waiting on.
 */
import { RouterLink } from 'vue-router';

defineProps({
  title: { type: String, required: true },
  body: { type: String, required: true },
});
</script>

<template>
  <div class="soon">
    <h1 class="soon__title">{{ title }}</h1>
    <p class="soon__body">{{ body }}</p>
    <RouterLink to="/kaki" class="soon__link">Go to Kaki Finder</RouterLink>
  </div>
</template>

<style scoped>
.soon {
  max-width: var(--app-width);
  margin: 0 auto;
  padding: var(--space-9) var(--space-5);
  text-align: center;
}

.soon__title {
  margin: 0 0 var(--space-3);
  font-family: var(--font-display);
  font-size: var(--step-3);
  font-weight: 800;
  color: var(--text-100);
}

.soon__body {
  margin: 0 auto var(--space-5);
  max-width: 36ch;
  color: var(--text-300);
}

.soon__link {
  color: var(--accent-500);
  font-weight: 700;
}
</style>
