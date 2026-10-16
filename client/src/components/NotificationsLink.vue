<script setup>
import { onUnmounted, ref, watch } from "vue";
import { currentUser } from "../auth.js";
import { api } from "../api.js";
const unread = ref(0);
let timer,
  generation = 0;
async function refresh() {
  const current = generation;
  try {
    const r = await api.notificationUnread();
    if (current === generation) unread.value = r.unread;
  } catch {
    if (current === generation) unread.value = 0;
  }
}
watch(
  () => currentUser.value?.id,
  (id) => {
    generation++;
    clearInterval(timer);
    unread.value = 0;
    if (id) {
      refresh();
      timer = setInterval(refresh, 30000);
    }
  },
  { immediate: true },
);
onUnmounted(() => {
  generation++;
  clearInterval(timer);
});
</script>
<template>
  <RouterLink to="/notifications"
    >Notifications<span v-if="unread"> ({{ unread }})</span></RouterLink
  >
</template>
