<script setup>
import { computed, ref, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import SiteHeader from './components/SiteHeader.vue';
import SiteFooter from './components/SiteFooter.vue';
import TabBar from './components/TabBar.vue';
import { refreshSession } from './auth.js';

// Concert Kaki is a light product; dark is the opt-in now, not the default.
const theme = ref('light');
const route = useRoute();
const hasFixedHeader = computed(() => ['marketplace', 'list-ticket', 'my-listings', 'ticket-detail'].includes(route.name));
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
  <main id="main" :class="{ 'main--with-fixed-header': hasFixedHeader }">
    <RouterView v-slot="{ Component }">
      <Transition name="page" mode="out-in">
        <component :is="Component" />
      </Transition>
    </RouterView>
  </main>
  <SiteFooter />
  <TabBar />
</template>

<style>
/* The tab bar is fixed, so the document needs to end above it or the footer
   and the last control on every page sit underneath. */
body {
  padding-bottom: calc(var(--tabbar-height) + env(safe-area-inset-bottom, 0px));
}

.page-enter-active,
.page-leave-active {
  transition:
    opacity var(--dur-base) var(--ease-out),
    transform var(--dur-base) var(--ease-out);
}

.main--with-fixed-header {
  padding-top: var(--header-height);
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
