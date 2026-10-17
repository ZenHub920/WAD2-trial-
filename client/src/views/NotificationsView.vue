<script setup>
import { onMounted, onUnmounted, ref } from "vue";
import { api } from "../api.js";
const items = ref([]),
  settings = ref({}),
  error = ref(""),
  busy = ref(false);
let timer;
async function load() {
  try {
    items.value = (await api.notifications()).notifications;
  } catch (e) {
    error.value = e.message;
  }
}
async function read(id) {
  try {
    await api.readNotification(id);
    await load();
  } catch (e) {
    error.value = e.message;
  }
}
async function save() {
  if (busy.value) return;
  busy.value = true;
  try {
    await api.saveNotificationSettings(settings.value);
    settings.value = (await api.notificationSettings()).preferences;
  } catch (e) {
    error.value = e.message;
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
    error.value = e.message;
  }
});
onUnmounted(() => clearInterval(timer));
</script>
<template>
  <main class="container groups-page">
    <h1>Notifications</h1>
    <p v-if="error" role="alert">{{ error }}</p>
    <form class="card group-panel" @submit.prevent="save">
      <h2>Notify me about</h2>
      <label v-for="(_, key) in settings" :key="key" class="group-check"
        ><input v-model="settings[key]" type="checkbox" :disabled="busy" />{{ key }}</label
      ><button class="btn btn--primary" :disabled="busy">Save settings</button>
    </form>
    <p v-if="!items.length">No notifications yet.</p>
    <article v-for="item in items" :key="item.id" class="card group-panel">
      <RouterLink :to="item.path" @click="read(item.id)">{{
        item.title
      }}</RouterLink
      ><span>{{ item.createdAt }}, {{ item.readAt ? "Read" : "Unread" }}</span
      ><button
        v-if="!item.readAt"
        class="btn btn--ghost"
        @click="read(item.id)"
      >
        Mark read
      </button>
    </article>
  </main>
</template>
