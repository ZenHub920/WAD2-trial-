/**
 * The signed-in user's own group preferences, shared by every group page.
 *
 * Group features stay locked until these exist. Kept in one place so moving
 * between Browse groups, My groups and Manage group does not reload them or
 * flash the locked state.
 */
import { computed, ref, watch } from 'vue';
import { api } from './api.js';
import { currentUser } from './auth.js';

/** undefined while unknown, null when none are saved yet. */
export const myPreferences = ref(undefined);
export const preferencesReady = computed(() => Boolean(myPreferences.value));

let pending = null;
let generation = 0;
export function loadMyPreferences() {
  if (myPreferences.value !== undefined) return Promise.resolve(myPreferences.value);
  const version = generation, userId = currentUser.value?.id;
  pending ??= api.myPreferences()
    .then(r => {
      if (version === generation && currentUser.value?.id === userId) myPreferences.value = r.preferences;
      return r.preferences;
    })
    .finally(() => { if (version === generation) pending = null; });
  return pending;
}

export async function saveMyPreferences(answers) {
  const version = generation, userId = currentUser.value?.id;
  const result = await api.saveMyPreferences(answers);
  if (version === generation && currentUser.value?.id === userId) myPreferences.value = result.preferences;
  return myPreferences.value;
}

// A different account has different answers.
watch(() => currentUser.value?.id, () => { generation++; pending = null; myPreferences.value = undefined; });
