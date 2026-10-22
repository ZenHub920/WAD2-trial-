<script setup>
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { api, notificationRevision } from '../api.js';
import { formatDateTime } from '../market.js';
import LoadingSpinner from './LoadingSpinner.vue';

const emit = defineEmits(['open']);
const route = useRoute();
const root = ref(null);
const trigger = ref(null);
const panel = ref(null);
const open = ref(false);
const items = ref([]);
const unreadCount = ref(0);
const loading = ref(false);
const readingId = ref('');
const error = ref('');
// Chat titles are written by the server and name the sender, so there is
// nothing here to rewrite them to — a generic label would throw away the name.
const titles = {
  'A seeker requested to join your group': 'Someone requested a group place',
  'Seeker preferences changed; review and resubmit the join request': 'Companion preferences changed; review your group join request',
};
let timer;

async function load() {
  if (loading.value) return;
  loading.value = true;
  error.value = '';
  try {
    const [inbox, unread] = await Promise.all([api.notifications(), api.unreadNotifications()]);
    items.value = inbox.notifications;
    unreadCount.value = unread.unread;
  } catch {
    error.value = 'Could not load notifications. Please try again.';
  } finally {
    loading.value = false;
  }
}
async function refreshUnread() {
  try {
    unreadCount.value = (await api.unreadNotifications()).unread;
  } catch {
    // Keep the last known count; the next poll or opening the inbox retries.
  }
}
async function markRead(id) {
  if (readingId.value) return;
  readingId.value = id;
  try {
    await api.readNotification(id);
    await load();
  } catch {
    error.value = 'Could not mark this notification as read. Please try again.';
  } finally {
    readingId.value = '';
  }
}
function close() {
  open.value = false;
  trigger.value?.focus();
}
function outside(event) {
  if (!root.value?.contains(event.target)) open.value = false;
}
function onKeydown(event) {
  if (event.key === 'Escape' && open.value) {
    event.preventDefault();
    close();
  }
}
watch(open, async (visible) => {
  if (!visible) return;
  emit('open');
  load();
  await nextTick();
  panel.value?.focus();
});
watch(() => route.fullPath, () => { open.value = false; });
watch(notificationRevision, () => open.value ? load() : refreshUnread());
onMounted(() => {
  document.addEventListener('click', outside);
  document.addEventListener('keydown', onKeydown);
  refreshUnread();
  timer = setInterval(() => open.value ? load() : refreshUnread(), 30000);
});
onUnmounted(() => {
  clearInterval(timer);
  document.removeEventListener('click', outside);
  document.removeEventListener('keydown', onKeydown);
});
</script>

<template>
  <div ref="root" class="notification-bell">
    <button ref="trigger" type="button" class="notification-bell__button"
      :aria-label="unreadCount ? `Notifications, ${unreadCount} unread` : 'Notifications'"
      aria-controls="notification-popover" :aria-expanded="open" @click="open = !open">
      <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M18 8a6 6 0 0 0-12 0v5l-2 3h16l-2-3V8Z" />
        <path d="M10 20a2 2 0 0 0 4 0" />
      </svg>
      <span v-if="unreadCount" class="notification-bell__badge" aria-hidden="true">{{ unreadCount > 99 ? '99+' : unreadCount }}</span>
    </button>
    <section v-if="open" id="notification-popover" ref="panel" class="notification-popover" tabindex="-1" aria-labelledby="notification-popover-title">
      <header class="notification-popover__head">
        <h2 id="notification-popover-title">Notifications</h2>
        <button type="button" class="notification-popover__close" aria-label="Close notifications" @click="close">×</button>
      </header>
      <div class="notification-popover__tools">
        <RouterLink to="/profile#notifications">Notification preferences</RouterLink>
        <button type="button" :disabled="loading" @click="load"><LoadingSpinner v-if="loading && items.length" />Refresh</button>
      </div>
      <p v-if="error" class="notification-popover__error" role="alert">{{ error }}</p>
      <p v-if="loading && !items.length" class="loading-state"><LoadingSpinner /> Loading notifications…</p>
      <p v-else-if="!items.length && !error" class="notification-popover__empty">No notifications yet.</p>
      <ul v-if="items.length" class="notification-popover__list">
        <li v-for="item in items" :key="item.id" :class="{ 'notification-popover__unread': !item.readAt }">
          <RouterLink :to="item.path === '/kaki/chat' || item.path === '/chat' ? '/messages' : item.path === '/marketplace' ? '/concerts' : item.path">{{ titles[item.title] ?? item.title }}</RouterLink>
          <p class="notification-popover__meta">{{ formatDateTime(item.createdAt) }} · {{ item.readAt ? 'Read' : 'Unread' }}</p>
          <button v-if="!item.readAt" type="button" class="notification-popover__read" :disabled="Boolean(readingId)" @click="markRead(item.id)">
            <LoadingSpinner v-if="readingId === item.id" /> Mark read
          </button>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.notification-bell { position: relative; }
.notification-bell__button, .notification-popover__close { display: grid; place-items: center; width: 44px; height: 44px; border: var(--border-hairline); border-radius: var(--radius-sm); color: var(--text-200); }
.notification-bell__button { position: relative; }
.notification-bell__badge { position: absolute; top: -5px; right: -5px; display: grid; place-items: center; min-width: 20px; height: 20px; padding-inline: 4px; border-radius: 999px; background: var(--accent-400); color: var(--ink-900); font-size: 11px; font-weight: 700; line-height: 1; }
.notification-bell__button:hover, .notification-bell__button[aria-expanded='true'] { border-color: var(--accent-400); color: var(--accent-400); background: var(--ink-800); }
.notification-popover { position: absolute; top: calc(100% + var(--space-3)); right: 0; z-index: 120; width: min(380px, calc(100vw - 32px)); max-height: min(70dvh, 560px); overflow-y: auto; padding: var(--space-4); border: var(--border-soft); border-radius: var(--radius-lg); background: var(--ink-800); box-shadow: var(--shadow-lg); color: var(--text-200); }
.notification-popover__head, .notification-popover__tools { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: var(--space-2); }
.notification-popover__head h2 { font-size: var(--step-1); }
.notification-popover__close { width: 32px; height: 32px; font-size: var(--step-1); }
.notification-popover__tools { margin-block: var(--space-3); font-size: var(--step--1); }
.notification-popover__tools button, .notification-popover__read { display: inline-flex; align-items: center; gap: var(--space-2); min-height: 36px; color: var(--accent-400); }
.notification-popover__error { color: var(--rose-400); font-size: var(--step--1); }
.notification-popover__empty { padding-block: var(--space-5); color: var(--text-300); text-align: center; }
.notification-popover__list { list-style: none; padding: 0; }
.notification-popover__list li { padding: var(--space-3); border-top: var(--border-hairline); overflow-wrap: anywhere; }
.notification-popover__unread { border-left: 3px solid var(--accent-400); }
.notification-popover__list a { font-size: var(--step--1); }
.notification-popover__meta { margin-top: var(--space-1); color: var(--text-400); font-size: var(--step--2); }
.notification-popover__read { font-size: var(--step--1); }
@media (max-width: 1100px) {
  .notification-bell { position: static; }
  .notification-popover { right: var(--gutter); top: calc(100% + var(--space-2)); }
}
</style>
