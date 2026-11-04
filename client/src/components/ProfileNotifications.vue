<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { api } from '../api.js';
import LoadingSpinner from './LoadingSpinner.vue';
import SaveBadge from './SaveBadge.vue';
import '../assets/groups.css';
import { browserPushStatus, enableBrowserPush, disableBrowserPush } from '../browserPush.js';

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
const push = ref(null);
const pushBusy = ref(false);
const pushError = ref('');
// The saved confirmation fades after a moment; errors stay until the next try.
let noticeFade = null;
onBeforeUnmount(() => clearTimeout(noticeFade));
async function loadPush() {
  try { push.value = await browserPushStatus(); }
  catch { pushError.value = 'Could not check browser notifications.'; }
}
async function togglePush() {
  pushBusy.value = true;
  pushError.value = '';
  try {
    if (push.value?.enabled) await disableBrowserPush();
    else await enableBrowserPush();
    await loadPush();
  } catch (error) {
    pushError.value = error.message === 'push_permission_denied'
      ? 'Notifications are blocked. Allow them in your browser settings to enable pop-ups.'
      : 'Could not update browser notifications. Please try again.';
  } finally { pushBusy.value = false; }
}
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
// Each tick saves straight away; boxes are disabled until the save settles.
async function save() {
  if (saving.value) return;
  saving.value = true;
  error.value = '';
  notice.value = '';
  try {
    await api.saveNotificationSettings(settings.value);
    settings.value = (await api.notificationSettings()).preferences;
    notice.value = 'Notification preferences saved.';
    clearTimeout(noticeFade);
    noticeFade = setTimeout(() => { notice.value = ''; }, 2000);
  } catch {
    error.value = 'Could not save notification preferences. Please try again.';
  } finally {
    saving.value = false;
  }
}
onMounted(load);
onMounted(loadPush);
</script>

<template>
  <section id="notifications" class="profile-notifications" aria-labelledby="profile-notifications-title">
    <div class="profile-notifications__head">
      <h2 id="profile-notifications-title">Notification preferences</h2>
      <SaveBadge :state="saving ? 'saving' : notice ? 'saved' : ''" />
    </div>
    <p v-if="error" role="alert" class="group-error">{{ error }}</p>
    <p v-if="loading" class="loading-state"><LoadingSpinner /> Loading notification preferences…</p>
    <div v-else-if="settings" class="profile-notifications__group">
      <p>Notify me about:</p>
      <label v-for="(_, key) in settings" :key="key" class="group-check">
        <input v-model="settings[key]" type="checkbox" :disabled="saving" @change="save" />{{ categories[key] ?? 'Other updates' }}
      </label>
    </div>
    <button v-if="error && !settings" class="btn btn--ghost" type="button" :disabled="loading" @click="load">Try again</button>
    <div class="profile-notifications__group profile-notifications__device">
      <h3>Notifications on this device</h3>
      <p>Get message and meetup pop-ups even when Encore is in the background. Your category preferences above still apply.</p>
      <p v-if="pushError" role="alert" class="group-error">{{ pushError }}</p>
      <p v-if="push && !push.supported">This browser does not support push notifications here. Use HTTPS or localhost; on iPhone and iPad, add Encore to your Home Screen and open it there.</p>
      <p v-else-if="push && !push.configured">Browser notifications will be available after the server's notification keys are configured.</p>
      <button v-else-if="push" class="btn btn--ghost" type="button" :disabled="pushBusy" @click="togglePush">
        {{ pushBusy ? 'Updating…' : push.enabled ? 'Turn off on this device' : 'Enable browser notifications' }}
      </button>
      <p class="push-hint">Delivery depends on your browser, operating system and notification settings. Logging out turns off notifications on this device.</p>
    </div>
  </section>
</template>

<style scoped>
.profile-notifications {
  display: grid;
  gap: var(--space-4);
  min-width: 0;
}
.profile-notifications h2 {
  font-size: var(--step-1);
}
.profile-notifications__group {
  display: grid;
  gap: var(--space-2);
}
.profile-notifications .group-check {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: 2rem;
}
.profile-notifications .group-check input[type=checkbox] {
  flex: none;
  margin: 0;
}
.profile-notifications__head {
  position: relative;
  padding-right: 6.5rem;
}
.profile-notifications__device {
  padding-top: var(--space-4);
  border-top: var(--border-hairline);
}
.profile-notifications h3 {
  font-size: var(--step-0);
}
.profile-notifications > .btn {
  justify-self: start;
}
.push-hint {
  color: var(--text-400);
  font-size: var(--step--1);
}
</style>
