import { ref } from 'vue';
import { api } from './api.js';

export const currentUser = ref(null);

export function setCurrentUser(user) {
  currentUser.value = user;
}

export async function refreshSession() {
  localStorage.removeItem('encore-user');
  try {
    currentUser.value = (await api.me()).user;
  } catch (error) {
    if (error.status !== 401) throw error;
    currentUser.value = null;
  }
}

export async function signOut() {
  await api.logout();
  currentUser.value = null;
}
