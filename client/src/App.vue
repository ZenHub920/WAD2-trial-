<script setup>
import { ref, onMounted } from 'vue';
import SiteHeader from './components/SiteHeader.vue';
import SiteFooter from './components/SiteFooter.vue';

const theme = ref('dark');

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
  <main id="main">
    <RouterView v-slot="{ Component }">
      <Transition name="page" mode="out-in">
        <component :is="Component" />
      </Transition>
    </RouterView>
  </main>
  <SiteFooter />
</template>

<style>
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
