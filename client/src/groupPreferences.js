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
export function loadMyPreferences() {
  if (myPreferences.value !== undefined) return Promise.resolve(myPreferences.value);
  pending ??= api.myPreferences()
    .then(r => (myPreferences.value = r.preferences))
    .finally(() => { pending = null; });
  return pending;
}

export async function saveMyPreferences(answers) {
  myPreferences.value = (await api.saveMyPreferences(answers)).preferences;
  return myPreferences.value;
}

// A different account has different answers.
watch(() => currentUser.value?.id, () => { myPreferences.value = undefined; });
