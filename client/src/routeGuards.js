/**
 * The router's sign-in and preferences gate, run before every navigation.
 *
 * Protected pages need a session. Once signed in, a member must save their
 * matching preferences before using anything else: every page except the ones
 * listed below sends them to /welcome, which returns them to where they were
 * heading (?next=) after saving.
 */
import { watch } from 'vue';
import { currentUser, sessionReady } from './auth.js';
import { loadMyPreferences } from './groupPreferences.js';

/** Pages a signed-in member can open before saving preferences. */
export const OPEN_BEFORE_PREFERENCES = new Set(['welcome', 'login', 'account-security']);

/** Wait for the cookie-backed session check, so we know who is signed in. */
function sessionSettled() {
  if (sessionReady.value) return Promise.resolve();
  return new Promise((resolve) => {
    const stop = watch(sessionReady, (ready) => {
      if (!ready) return;
      stop();
      resolve();
    }, { immediate: true });
  });
}

export async function guardRoute(to) {
  await sessionSettled();
  if (!currentUser.value) {
    return to.meta?.requiresAuth ? { path: '/login', query: { redirect: to.fullPath } } : true;
  }
  if (OPEN_BEFORE_PREFERENCES.has(to.name)) return true;
  try {
    if (!(await loadMyPreferences())) return { name: 'welcome', query: { next: to.fullPath } };
  } catch {
    // The check itself failed (e.g. offline): let them through rather than lock them out.
  }
  return true;
}
