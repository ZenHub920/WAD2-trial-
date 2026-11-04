<script setup>
/**
 * The back arrow that returns to the page the user actually came from; its
 * label ("Back to My groups") is the accessible name and tooltip.
 *
 * Vue Router records the previous in-app path in history.state.back. When it
 * exists we go back through history, so a concert opened from Manage group
 * returns to Manage group. Opened directly (new tab, bookmark), there is no
 * previous page, so it goes to `fallback` instead.
 */
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import BackArrow from './BackArrow.vue';

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
  <BackArrow class="back-link" :label="label" @click="go" />
</template>

<style scoped>
.back-link {
  margin-bottom: var(--space-4);
}
</style>
