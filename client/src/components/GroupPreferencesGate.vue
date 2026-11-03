<script setup>
/** Shared preferences live in Profile; group pages keep their primary task clear. */
import { onMounted, ref } from 'vue';
import { myPreferences, loadMyPreferences } from '../groupPreferences.js';
import LoadingSpinner from './LoadingSpinner.vue';

defineProps({ summary: Boolean });
defineEmits(['saved']);
const error = ref('');
onMounted(async () => {
  try { await loadMyPreferences(); }
  catch { error.value = 'Preferences could not be loaded. You can still browse and choose a group.'; }
});
</script>

<template>
  <slot name="before" />
  <aside v-if="!myPreferences" class="pref-nudge" aria-label="Private matching preferences">
    <template v-if="myPreferences === undefined && !error">
      <p class="loading-state" role="status"><LoadingSpinner />Checking your matching preferences…</p>
    </template>
    <template v-else>
      <div>
        <strong>Your private matching preferences</strong>
        <p>{{ error || 'Save your preferences to finish setup. Every group member also needs saved preferences before the group can be published.' }}</p>
      </div>
      <RouterLink class="btn btn--ghost" to="/profile#preferences">Set up preferences</RouterLink>
    </template>
  </aside>
  <slot :preferences="myPreferences ?? null" />
</template>

<style scoped>
.pref-nudge { display:flex; align-items:center; flex-wrap:wrap; gap:var(--space-3) var(--space-5); padding:var(--space-4) var(--space-5); margin-block:var(--space-4); border:var(--border-soft); border-left:3px solid var(--accent-400); border-radius:var(--radius-md); background:var(--ink-850); }
.pref-nudge > div { flex:1 1 22rem; min-width:0; }
.pref-nudge strong { color:var(--text-200); font-size:var(--step--1); }
.pref-nudge p { margin:var(--space-1) 0 0; color:var(--text-400); font-size:var(--step--1); }
</style>
