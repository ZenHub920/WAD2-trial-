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
  <RouterLink to="/notifications" class="notifications-link" :aria-label="unread ? `Notifications, ${unread} unread` : 'Notifications'">
    Notifications<span v-if="unread" class="notifications-link__count">{{ unread }}</span>
  </RouterLink>
</template>

<style scoped>
.notifications-link { display: inline-flex; align-items: center; gap: var(--space-2); white-space: nowrap; }
.notifications-link__count { padding: 0 var(--space-2); border-radius: var(--radius-pill); background: var(--ink-700); color: var(--text-100); font-size: var(--step--2); font-variant-numeric: tabular-nums; }
</style>
