<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import SiteHeader from './components/SiteHeader.vue';
import { refreshSession } from './auth.js';

// Encore starts in light mode; dark mode is optional.
const theme = ref('light');
const route = useRoute();
// Home and sign-in draw their own full backgrounds; every other page gets the
// shared drifting colour behind it.
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
  <div v-if="!ownBackdrop" class="ambient" aria-hidden="true">
    <span class="ambient__orb ambient__orb--one" />
    <span class="ambient__orb ambient__orb--two" />
    <span class="ambient__orb ambient__orb--three" />
    <span class="ambient__grid" />
  </div>
  <main id="main" :class="{ 'main--animated': !ownBackdrop }">
    <RouterView v-slot="{ Component }">
      <Transition name="page" mode="out-in">
        <component :is="Component" :key="route.path" />
      </Transition>
    </RouterView>
  </main>
</template>

<style>
/* ---- Shared page backdrop: the home hero's colour, fixed behind every page. */
.ambient {
  position: fixed;
  inset: 0;
  z-index: -1;
  overflow: hidden;
  pointer-events: none;
}

.ambient__orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(90px);
  animation: ambient-drift 22s ease-in-out infinite alternate;
}

.ambient__orb--one {
  width: 560px;
  height: 560px;
  top: -200px;
  left: -160px;
  background: var(--accent-300);
  opacity: 0.5;
}

.ambient__orb--two {
  width: 480px;
  height: 480px;
  top: 30%;
  right: -180px;
  background: var(--accent-400);
  opacity: 0.22;
  animation-duration: 28s;
  animation-direction: alternate-reverse;
}

.ambient__orb--three {
  width: 420px;
  height: 420px;
  bottom: -180px;
  left: 30%;
  background: var(--mint-400);
  opacity: 0.16;
  animation-duration: 32s;
}

.ambient__grid {
  position: absolute;
  inset: 0;
  background-image: radial-gradient(var(--ink-500) 1px, transparent 1px);
  background-size: 28px 28px;
  opacity: 0.45;
  mask-image: radial-gradient(ellipse at 20% 0%, #000, transparent 65%);
}

@keyframes ambient-drift {
  0% { transform: translate(0, 0) scale(1); }
  50% { transform: translate(70px, 50px) scale(1.1); }
  100% { transform: translate(-50px, 80px) scale(0.95); }
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
