<script setup>
/**
 * "← Back" that returns to the page the user actually came from.
 *
 * Vue Router records the previous in-app path in history.state.back. When it
 * exists we go back through history, so a concert opened from Manage group
 * returns to Manage group. Opened directly (new tab, bookmark), there is no
 * previous page, so it goes to `fallback` instead.
 */
import { computed } from 'vue';
import { useRouter } from 'vue-router';

const props = defineProps({
  fallback: { type: [String, Object], required: true },
  fallbackLabel: { type: String, default: 'Back' },
});

const router = useRouter();
const previous = typeof window !== 'undefined' ? window.history.state?.back ?? null : null;

const PLACES = [
  [/^\/groups\/connect\?(.*&)?view=create/, 'Create group'],
  [/^\/groups\/connect\?(.*&)?view=connections/, 'Connect groups'],
  [/^\/groups\/connect/, 'My groups'],
  [/^\/groups\/invite\//, 'invitation'],
  [/^\/groups\/[^/]+\/members/, 'Manage group'],
  [/^\/groups(\?|$)/, 'Browse groups'],
  [/^\/meetups\/[^/?]+/, 'meetup plan'],
  [/^\/meetups/, 'Meetup planning'],
  [/^\/concerts\/[^/?]+\/algorithm/, 'matching preview'],
  [/^\/concerts\/[^/?]+/, 'concert'],
  [/^\/concerts/, 'All concerts'],
  [/^\/profile/, 'Profile'],
  [/^\/kaki/, 'Find a companion'],
  [/^\/rounds\//, 'matching results'],
  [/^\/?$/, 'Home'],
];

const label = computed(() => {
  if (!previous) return props.fallbackLabel;
  const place = PLACES.find(([pattern]) => pattern.test(previous))?.[1];
  return place ? `Back to ${place}` : 'Back';
});

function go() {
  if (previous) router.back();
  else router.push(props.fallback);
}
</script>

<template>
  <button type="button" class="back-link" @click="go"><span aria-hidden="true">←</span> {{ label }}</button>
</template>

<style scoped>
.back-link { display: inline-flex; align-items: center; gap: var(--space-2); width: fit-content; margin-bottom: var(--space-4); padding: var(--space-2) var(--space-3) var(--space-2) var(--space-2); border: 0; border-radius: var(--radius-sm); background: transparent; color: var(--text-300); font: inherit; font-size: var(--step--1); font-weight: 600; cursor: pointer; transition: color var(--dur-fast) var(--ease-out), background var(--dur-fast) var(--ease-out); }
.back-link:hover { color: var(--accent-400); background: var(--ink-700); }
.back-link:focus-visible { outline: 2px solid var(--accent-400); outline-offset: 2px; }
</style>
