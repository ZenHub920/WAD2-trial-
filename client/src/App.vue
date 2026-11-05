<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { useRoute } from 'vue-router';
import SiteHeader from './components/SiteHeader.vue';
import { refreshSession } from './auth.js';

// Encore starts in light mode; dark mode is optional.
const theme = ref('light');
const route = useRoute();
// Home and sign-in draw their own full backgrounds; every other page gets the
// shared static backdrop behind it.
const ownBackdrop = computed(() => ['home', 'login'].includes(route.name));
refreshSession().catch((error) => console.error('Could not load session', error));

onMounted(() => {
  const stored = localStorage.getItem('encore-theme');
  if (stored === 'light' || stored === 'dark') {
    theme.value = stored;
    document.documentElement.dataset.theme = stored;
  }
});

/**
 * Which way a page change should travel.
 *
 * The nav reads left to right, so moving to something further right should
 * look like the page slid that way — the same mental model as swiping. Order
 * here is the ORDER OF THE NAV, not of the router table, because the nav is
 * what the person sees; anything not in the nav (a concert, a profile) has no
 * place on that line and simply fades.
 */
const NAV_ORDER = ['/concerts', '/tickets', '/kaki', '/groups', '/messages'];
const navRank = (path) => NAV_ORDER.findIndex((entry) => path === entry || path.startsWith(`${entry}/`));

const transitionName = ref('page');
watch(() => route.path, (to, from) => {
  const next = navRank(to);
  const previous = navRank(from ?? '');
  // One of the two is off the nav line: there is no direction to imply, so
  // claiming one would be a lie about where the person just went.
  if (next === -1 || previous === -1 || next === previous) { transitionName.value = 'page'; return; }
  transitionName.value = next > previous ? 'page-forward' : 'page-back';
});

function toggleTheme() {
  theme.value = theme.value === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme.value;
  localStorage.setItem('encore-theme', theme.value);
}
</script>

<template>
  <a class="skip-link" href="#main">Skip to content</a>
  <SiteHeader :theme="theme" @toggle-theme="toggleTheme" />
  <div v-if="!ownBackdrop" class="ambient" aria-hidden="true" />
  <main id="main" :class="{ 'main--animated': !ownBackdrop }">
    <RouterView v-slot="{ Component }">
      <Transition :name="transitionName" mode="out-in">
        <component :is="Component" :key="route.path" />
      </Transition>
    </RouterView>
  </main>
</template>

<style>
/* A quiet static backdrop leaves the homepage's opening sequence independent. */
.ambient {
  position: fixed;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  background: radial-gradient(ellipse at 12% 0%, var(--accent-glow), transparent 58%),
    linear-gradient(var(--surface-base, var(--ink-900)), var(--surface-base, var(--ink-900)));
}

.page-enter-active,
.page-leave-active,
.page-forward-enter-active,
.page-forward-leave-active,
.page-back-enter-active,
.page-back-leave-active {
  transition:
    opacity var(--dur-base) var(--ease-out),
    transform var(--dur-base) var(--ease-out);
}

.page-enter-from {
  opacity: 0;
  transform: translateY(8px);
}

.page-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

/* Moving right along the nav: the old page leaves to the LEFT and the new one
   arrives from the right, so the pair reads as one sideways movement. The
   shift is small on purpose — a full-width slide at this duration reads as a
   lurch, and `mode="out-in"` means only one page is ever on screen. */
.page-forward-enter-from { opacity: 0; transform: translateX(2.5rem); }
.page-forward-leave-to { opacity: 0; transform: translateX(-2rem); }
.page-back-enter-from { opacity: 0; transform: translateX(-2.5rem); }
.page-back-leave-to { opacity: 0; transform: translateX(2rem); }

@media (prefers-reduced-motion: reduce) {
  .page-enter-active,
  .page-leave-active,
  .page-forward-enter-active,
  .page-forward-leave-active,
  .page-back-enter-active,
  .page-back-leave-active {
    transition: opacity var(--dur-base) var(--ease-out);
  }
  .page-enter-from,
  .page-leave-to,
  .page-forward-enter-from,
  .page-forward-leave-to,
  .page-back-enter-from,
  .page-back-leave-to { transform: none; }
}
</style>
