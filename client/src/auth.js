import { ref } from 'vue';
import { api } from './api.js';
import { disableBrowserPush } from './browserPush.js';

export const currentUser = ref(null);
// Wait for the cookie-backed session check before deciding which controls to show.
export const sessionReady = ref(false);
let sessionVersion = 0;

export function setCurrentUser(user) {
  if (currentUser.value?.id && currentUser.value.id !== user?.id)
    void disableBrowserPush({ server: false }).catch(() => {});
  sessionVersion += 1;
  currentUser.value = user;
  sessionReady.value = true;
}

export async function refreshSession() {
  const version = ++sessionVersion;
  sessionReady.value = false;
  try { localStorage.removeItem('encore-user'); } catch { /* Session restoration does not require browser storage. */ }
  try {
    const user = (await api.me()).user;
    if (version === sessionVersion) currentUser.value = user;
  } catch (error) {
    if (error.status !== 401) throw error;
    if (version === sessionVersion) currentUser.value = null;
  } finally {
    if (version === sessionVersion) sessionReady.value = true;
  }
}

export async function signOut() {
  await disableBrowserPush().catch(() => {});
  await api.logout();
  setCurrentUser(null);
}
