<script setup>
import { onMounted, ref } from 'vue';
import { api } from '../api.js';
import LoadingSpinner from './LoadingSpinner.vue';
import '../assets/groups.css';

const categories = {
  chat: 'Companion and ticket messages',
  group: 'Group invitations and join requests',
  match: 'Group matching proposals',
  meetup: 'Meetup plans and changes',
  feedback: 'Post-concert feedback',
};
const settings = ref(null);
const loading = ref(true);
const saving = ref(false);
const error = ref('');
const notice = ref('');
async function load() {
  loading.value = true;
  error.value = '';
  try {
    settings.value = (await api.notificationSettings()).preferences;
  } catch {
    error.value = 'Could not load notification preferences. Please try again.';
  } finally {
    loading.value = false;
  }
}
async function save() {
  if (saving.value) return;
  saving.value = true;
  error.value = '';
  notice.value = '';
  try {
    await api.saveNotificationSettings(settings.value);
    settings.value = (await api.notificationSettings()).preferences;
    notice.value = 'Notification preferences saved.';
  } catch {
    error.value = 'Could not save notification preferences. Please try again.';
  } finally {
    saving.value = false;
  }
}
onMounted(load);
</script>

<template>
  <section id="notifications" class="profile-notifications" aria-labelledby="profile-notifications-title">
    <h2 id="profile-notifications-title">Notification preferences</h2>
    <p v-if="error" role="alert" class="group-error">{{ error }}</p>
    <p v-if="notice" role="status" class="group-success">{{ notice }}</p>
    <p v-if="loading" class="loading-state"><LoadingSpinner /> Loading notification preferences…</p>
    <form v-else-if="settings" class="card group-panel" @submit.prevent="save">
      <p>Notify me about:</p>
      <label v-for="(_, key) in settings" :key="key" class="group-check">
        <input v-model="settings[key]" type="checkbox" :disabled="saving" />{{ categories[key] ?? 'Other updates' }}
      </label>
      <button class="btn btn--primary" type="submit" :disabled="saving"><LoadingSpinner v-if="saving" />{{ saving ? 'Saving…' : 'Save notification preferences' }}</button>
    </form>
    <button v-if="error && !settings" class="btn btn--ghost" type="button" :disabled="loading" @click="load">Try again</button>
  </section>
</template>

<style scoped>
.profile-notifications { display: grid; gap: var(--space-4); margin-top: var(--space-7); padding-top: var(--space-6); border-top: var(--border-hairline); min-width: 0; }
.profile-notifications h2 { font-size: var(--step-2); }
.profile-notifications > .btn { justify-self: start; }
</style>
