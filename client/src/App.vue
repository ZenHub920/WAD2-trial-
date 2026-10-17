<script setup>
import { computed, ref, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import SiteHeader from './components/SiteHeader.vue';
import { currentUser, refreshSession } from './auth.js';

// Encore starts in light mode; dark mode is optional.
const theme = ref('light');
const route = useRoute();
const hasFixedHeader = computed(() =>
  Boolean(currentUser.value) || [
    'marketplace', 'list-ticket', 'my-listings', 'ticket-detail',
    'kaki-chat', 'kaki-chat-thread',
  ].includes(route.name),
);
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
  <SiteHeader :theme="theme" :fixed="hasFixedHeader" @toggle-theme="toggleTheme" />
  <main id="main" :class="{ 'main--with-fixed-header': hasFixedHeader }">
    <RouterView v-slot="{ Component }">
      <Transition name="page" mode="out-in">
        <component :is="Component" :key="route.path" />
      </Transition>
    </RouterView>
  </main>
</template>

<style>
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
