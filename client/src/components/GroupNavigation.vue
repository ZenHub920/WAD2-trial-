<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
const route = useRoute();
const concertQuery = computed(() => typeof route.query.concertId === 'string' ? { concertId: route.query.concertId } : {});
const active = computed(() => route.path === '/groups' ? 'browse' : 'mine');
const links = computed(() => [
  { id: 'browse', label: 'Find a group', to: { path: '/groups', query: concertQuery.value } },
  { id: 'mine', label: 'My groups', to: { path: '/groups/connect', query: concertQuery.value } },
]);

/**
 * The pill behind the current tab, as one element that slides.
 *
 * Measured from the live link, because the two labels are different widths
 * and translating a fixed-size pill between them would stretch or clip. It
 * stays `null` until a measurement succeeds, so it never flashes at the left
 * edge before the tabs have laid out.
 */
const tabs = ref(null);
const marker = ref(null);

function measure() {
  const list = tabs.value;
  const current = list?.querySelector('.group-navigation__link--active');
  if (!list || !current) { marker.value = null; return; }
  const from = list.getBoundingClientRect();
  const to = current.getBoundingClientRect();
  if (!to.width) { marker.value = null; return; }
  marker.value = { left: `${to.left - from.left}px`, width: `${to.width}px`, height: `${to.height}px`, top: `${to.top - from.top}px` };
}
const remeasure = () => { void nextTick(measure); };
watch(() => route.fullPath, remeasure);

let observer;
onMounted(() => {
  remeasure();
  document.fonts?.ready?.then(remeasure).catch(() => {});
  if (typeof ResizeObserver === 'function') {
    observer = new ResizeObserver(measure);
    if (tabs.value) observer.observe(tabs.value);
  }
  window.addEventListener('resize', measure);
});
onUnmounted(() => {
  observer?.disconnect();
  window.removeEventListener('resize', measure);
});
</script>

<template>
  <nav ref="tabs" class="group-navigation" aria-label="Group workflows">
    <span v-if="marker" class="group-navigation__marker" :style="marker" aria-hidden="true" />
    <RouterLink v-for="link in links" :key="link.id" :to="link.to" class="group-navigation__link"
      :class="{ 'group-navigation__link--active': active === link.id }" :aria-current="active === link.id ? 'page' : undefined">
      {{ link.label }}
    </RouterLink>
  </nav>
</template>

<style scoped>
.group-navigation {
  position: relative;
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  padding: 5px;
  width: fit-content;
  max-width: 100%;
  background: var(--ink-700);
  border: var(--border-soft);
  border-radius: var(--radius-md);
}
.group-navigation__link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  padding: var(--space-2) var(--space-4);
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  color: var(--text-300);
  font-size: var(--step--1);
  font-weight: 600;
  text-decoration: none;
}
.group-navigation__link:hover {
  color: var(--text-100);
}
.group-navigation__link--active {
  color: var(--accent-400);
}

/* The filled pill is one element that slides between the tabs, so switching
   reads as the selection moving rather than two separate boxes blinking. */
.group-navigation__marker {
  position: absolute;
  z-index: 0;
  border: 1px solid var(--accent-400);
  border-radius: var(--radius-sm);
  background: var(--ink-800);
  transition:
    left var(--dur-base) var(--ease-settle, ease-out),
    width var(--dur-base) var(--ease-settle, ease-out),
    top var(--dur-base) var(--ease-settle, ease-out);
  pointer-events: none;
}
/* The links ride above the pill, or the fill would cover their text. */
.group-navigation__link { position: relative; z-index: 1; }

@media (prefers-reduced-motion: reduce) {
  .group-navigation__marker { transition: none; }
}
@media (max-width: 480px) {
  .group-navigation {
    width: 100%;
  }
  .group-navigation__link {
    flex: 1 1 auto;
    padding-inline: var(--space-2);
  }
}
</style>
