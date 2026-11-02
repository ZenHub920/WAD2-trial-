<script setup>
import { ref, computed, onMounted } from 'vue';
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
      <Transition name="page" mode="out-in">
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
.page-leave-active {
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
</style>
