<script setup>
import { computed } from 'vue';
import { useRoute } from 'vue-router';
const route = useRoute();
const concertQuery = computed(() => typeof route.query.concertId === 'string' ? { concertId: route.query.concertId } : {});
const active = computed(() => route.path === '/groups' ? 'browse' : route.query.view === 'create' ? 'create' : 'mine');
const links = computed(() => [
  { id: 'browse', label: 'Browse groups', to: { path: '/groups', query: concertQuery.value } },
  { id: 'mine', label: 'My groups', to: { path: '/groups/connect', query: concertQuery.value } },
  { id: 'create', label: 'Create group', to: { path: '/groups/connect', query: { ...concertQuery.value, view: 'create' } } },
]);
</script>

<template>
  <nav class="group-navigation" aria-label="Group workflows">
    <RouterLink v-for="link in links" :key="link.id" :to="link.to" class="group-navigation__link"
      :class="{ 'group-navigation__link--active': active === link.id }" :aria-current="active === link.id ? 'page' : undefined">
      {{ link.label }}
    </RouterLink>
  </nav>
</template>

<style scoped>
.group-navigation { display: flex; flex-wrap: wrap; gap: var(--space-2); padding: 5px; width: fit-content; max-width: 100%; background: var(--ink-700); border: var(--border-soft); border-radius: var(--radius-md); }
.group-navigation__link { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; padding: var(--space-2) var(--space-4); border: 1px solid transparent; border-radius: var(--radius-sm); color: var(--text-300); font-size: var(--step--1); font-weight: 600; text-decoration: none; }
.group-navigation__link:hover { color: var(--text-100); }
.group-navigation__link--active { background: var(--ink-800); color: var(--accent-400); border-color: var(--accent-400); }
@media (max-width: 480px) { .group-navigation { width: 100%; } .group-navigation__link { flex: 1 1 auto; padding-inline: var(--space-2); } }
</style>
