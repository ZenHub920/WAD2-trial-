<script setup>
import { onMounted, onUnmounted, ref } from "vue";
import { api } from "../api.js";
import LoadingSpinner from "../components/LoadingSpinner.vue";
import "../assets/groups.css";
const categories = { chat: "Companion and ticket messages", group: "Group invitations and join requests", match: "Group matching proposals", meetup: "Meetup plans and changes", feedback: "Post-concert feedback" };
const titles = { "New Kaki message": "New companion message", "New marketplace message": "New ticket message", "A seeker requested to join your group": "Someone requested a group place", "Seeker preferences changed; review and resubmit the join request": "Companion preferences changed; review and resubmit the group join request" };
const items = ref([]),
  settings = ref({}),
  error = ref(""),
  busy = ref(false),
  loading = ref(true),
  settingsLoading = ref(true),
  notice = ref("");
let timer;
const readingId = ref('');
async function load() {
  try {
    error.value = "";
    items.value = (await api.notifications()).notifications;
  } catch (e) {
    error.value = "Could not load your notifications. Please try again.";
  } finally {
    loading.value = false;
  }
}
async function read(id) {
  if (readingId.value) return;
  readingId.value = id;
  try {
    await api.readNotification(id);
    await load();
  } catch (e) {
    error.value = "Could not mark this notification as read. Please try again.";
  } finally {
    readingId.value = '';
  }
}
async function save() {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  notice.value = "";
  try {
    await api.saveNotificationSettings(settings.value);
    settings.value = (await api.notificationSettings()).preferences;
    notice.value = "Notification settings saved.";
  } catch (e) {
    error.value = "Could not save notification settings. Please try again.";
  } finally {
    busy.value = false;
  }
}
onMounted(async () => {
  load();
  timer = setInterval(load, 30000);
  try {
    settings.value = (await api.notificationSettings()).preferences;
  } catch (e) {
    error.value = "Could not load notification settings. Refresh this page to try again.";
  } finally {
    settingsLoading.value = false;
  }
});
onUnmounted(() => clearInterval(timer));
</script>
<template>
  <div class="container groups-page">
    <h1>Notifications</h1>
    <p v-if="error" role="alert" class="group-error">{{ error }}</p>
    <p v-if="notice" role="status" class="group-success">{{ notice }}</p>
    <p v-if="settingsLoading" class="loading-state" role="status"><LoadingSpinner />Loading notification settings…</p>
    <form v-else-if="Object.keys(settings).length" class="card group-panel" @submit.prevent="save">
      <h2>Notify me about</h2>
      <label v-for="(_, key) in settings" :key="key" class="group-check">
        <input v-model="settings[key]" type="checkbox" :disabled="busy" />{{ categories[key] ?? "Other updates" }}
      </label>
      <button class="btn btn--primary" :disabled="busy"><LoadingSpinner v-if="busy" />{{ busy ? 'Saving…' : 'Save notification settings' }}</button>
    </form>
    <p v-if="loading" class="loading-state" role="status"><LoadingSpinner />Loading notifications…</p>
    <p v-else-if="!items.length && !error">No notifications yet. Updates about your messages, groups and plans will appear here.</p>
    <button v-if="error" class="btn btn--ghost" :disabled="loading" @click="loading = true; load()">Reload notifications</button>
    <article v-for="item in items" :key="item.id" class="card group-panel">
      <RouterLink :to="item.path === '/kaki/chat' || item.path === '/chat' ? '/messages' : item.path === '/marketplace' ? '/concerts' : item.path">{{ titles[item.title] ?? item.title }}</RouterLink>
      <span>{{ new Date(item.createdAt.includes('T') ? item.createdAt : item.createdAt.replace(' ', 'T') + 'Z').toLocaleString() }} — {{ item.readAt ? "Read" : "Unread" }}</span>
      <button
        v-if="!item.readAt"
        class="btn btn--ghost"
        :disabled="Boolean(readingId)"
        @click="read(item.id)"
      >
        <LoadingSpinner v-if="readingId === item.id" />
        Mark read
      </button>
    </article>
  </div>

</template>
