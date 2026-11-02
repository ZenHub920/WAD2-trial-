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
function onPush(event) {
  if (event.data?.type === 'encore-notification') open.value ? load() : refreshUnread();
}

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
  navigator.serviceWorker?.addEventListener('message', onPush);
  document.addEventListener('click', outside);
  document.addEventListener('keydown', onKeydown);
  refreshUnread();
  timer = setInterval(() => open.value ? load() : refreshUnread(), 30000);
});
onUnmounted(() => {
  navigator.serviceWorker?.removeEventListener('message', onPush);
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
    <Transition name="notification-panel" @before-leave="element => element.setAttribute('inert', '')">
    <section v-if="open" id="notification-popover" ref="panel" class="notification-popover" tabindex="-1" aria-labelledby="notification-popover-title">
      <header class="notification-popover__head">
        <div><p class="notification-popover__eyebrow">Your latest updates</p><div class="notification-popover__title-row"><h2 id="notification-popover-title">Notifications</h2><span v-if="unreadCount" class="notification-popover__total">{{ unreadCount }} unread</span></div></div>
        <button type="button" class="notification-popover__close" aria-label="Close notifications" @click="close">×</button>
      </header>
      <div class="notification-popover__tools">
        <RouterLink to="/profile#notifications">Notification preferences</RouterLink>
        <button type="button" :disabled="loading" @click="load"><LoadingSpinner v-if="loading && items.length" /><svg v-else viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 8a7 7 0 0 1 11.5-2L20 12M4 12l2.5 6A7 7 0 0 0 18 16"/></svg>Refresh</button>
      </div>
      <p v-if="error" class="notification-popover__error" role="alert">{{ error }}</p>
      <p v-if="loading && !items.length" class="loading-state"><LoadingSpinner /> Loading notifications…</p>
      <p v-else-if="!items.length && !error" class="notification-popover__empty">No notifications yet.</p>
      <ul v-if="items.length" class="notification-popover__list">
        <li v-for="item in items" :key="item.id" :class="{ 'notification-popover__unread': !item.readAt }">
          <RouterLink :to="item.path === '/kaki/chat' || item.path === '/chat' ? '/messages' : item.path === '/marketplace' ? '/concerts' : item.path">{{ titles[item.title] ?? item.title }}</RouterLink>
          <p class="notification-popover__meta">{{ formatDateTime(item.createdAt) }} · {{ item.readAt ? 'Read' : 'Unread' }}</p>
          <button v-if="!item.readAt" type="button" class="notification-popover__read" :disabled="Boolean(readingId)" @click="markRead(item.id)">
            <LoadingSpinner v-if="readingId === item.id" /><svg v-else viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg> Mark read
          </button>
        </li>
      </ul>
    </section>
    </Transition>
  </div>
</template>

<style scoped>
.notification-bell {
  position: relative;
}
.notification-bell__button, .notification-popover__close {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border: var(--border-hairline);
  border-radius: var(--radius-sm);
  color: var(--text-200);
  background: color-mix(in srgb, var(--ink-800) 65%, transparent);
  box-shadow: inset 0 1px 0 var(--panel-highlight);
  transition: border-color var(--dur-fast), background-color var(--dur-fast), color var(--dur-fast), transform var(--dur-fast) var(--ease-settle);
}
.notification-bell__button:active, .notification-popover__close:active { transform: translateY(1px) scale(.97); }
.notification-popover__close:hover { background: var(--ink-750); border-color: var(--accent-400); }
.notification-bell__button {
  position: relative;
}
.notification-bell__badge {
  position: absolute;
  top: -5px;
  right: -5px;
  display: grid;
  place-items: center;
  min-width: 20px;
  height: 20px;
  padding-inline: 4px;
  border-radius: 999px;
  background: var(--accent-400);
  color: var(--ink-900);
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
}
.notification-bell__button:hover, .notification-bell__button[aria-expanded='true'] {
  border-color: var(--accent-400);
  color: var(--accent-400);
  background: var(--ink-800);
}
.notification-popover {
  position: absolute;
  top: calc(100% + var(--space-3));
  right: 0;
  z-index: 120;
  width: min(380px, calc(100vw - 32px));
  max-height: min(70dvh, 560px);
  overflow-y: auto;
  padding: var(--space-4);
  border: 1px solid var(--panel-edge);
  border-radius: var(--radius-lg);
  background: var(--panel-bg);
  box-shadow: inset 0 1px 0 var(--panel-highlight), var(--shadow-lg);
  color: var(--text-200);
  transform-origin: top right;
  overscroll-behavior: contain;
}
.notification-popover__head, .notification-popover__tools {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-2);
}
.notification-popover__head h2 {
  font-size: var(--step-1);
}
.notification-popover__title-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-2);
}
.notification-popover__head > div { flex: 1; min-width: 0; }
.notification-popover__eyebrow { margin-bottom: var(--space-1); color: var(--text-300); font-size: .65rem; font-weight: 600; letter-spacing: .1em; text-transform: uppercase; }
.notification-popover__total { display: inline-flex; align-items: center; min-height: 24px; padding: .15rem .45rem; border: 1px solid color-mix(in srgb, var(--accent-400) 35%, var(--panel-edge)); border-radius: 5px; background: var(--accent-glow); color: var(--accent-400); font-size: .68rem; font-weight: 600; letter-spacing: normal; }
.notification-popover__close {
  flex: none;
  font-size: var(--step-1);
}
.notification-popover__tools {
  margin-block: var(--space-3);
  padding: var(--space-2);
  border: var(--border-hairline);
  border-radius: var(--radius-sm);
  background: var(--ink-850);
  font-size: var(--step--1);
}
.notification-popover__tools a { min-height: 44px; display: inline-flex; align-items: center; padding-inline: var(--space-1); text-underline-offset: .25em; }
.notification-popover__tools button, .notification-popover__read {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  min-height: 44px;
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--panel-edge);
  border-radius: var(--radius-sm);
  background: var(--ink-800);
  color: var(--accent-400);
  font-weight: 550;
  box-shadow: inset 0 1px 0 var(--panel-highlight);
  transition: border-color var(--dur-fast), background-color var(--dur-fast), box-shadow var(--dur-fast), transform var(--dur-fast) var(--ease-settle);
}
.notification-popover__tools button:hover:not(:disabled), .notification-popover__read:hover:not(:disabled) { border-color: var(--accent-400); background: var(--ink-750); }
.notification-popover__tools button:active:not(:disabled), .notification-popover__read:active:not(:disabled) { transform: translateY(1px); box-shadow: inset 0 2px 4px rgba(0, 0, 0, .1); }
.notification-popover__tools button:disabled, .notification-popover__read:disabled { opacity: .55; cursor: wait; }
.notification-popover__error {
  color: var(--rose-400);
  font-size: var(--step--1);
}
.notification-popover__empty {
  padding-block: var(--space-5);
  color: var(--text-300);
  text-align: center;
}
.notification-popover__list {
  list-style: none;
  padding: 0;
  display: grid;
  gap: var(--space-2);
}
.notification-popover__list li {
  padding: var(--space-3);
  display: grid;
  gap: var(--space-1);
  border: var(--border-hairline);
  border-left: 3px solid transparent;
  border-radius: var(--radius-sm);
  overflow-wrap: anywhere;
}
.notification-popover__list li.notification-popover__unread {
  border-left-color: var(--accent-400);
  background: color-mix(in srgb, var(--accent-400) 5%, var(--ink-800));
}
.notification-popover__list a {
  font-size: var(--step--1);
  color: var(--text-200);
  text-decoration: none;
  font-weight: 550;
  line-height: 1.5;
}
.notification-popover__list a:hover {
  color: var(--accent-400);
  text-decoration: underline;
}
.notification-popover__meta {
  margin-top: var(--space-1);
  color: var(--text-400);
  font-size: var(--step--2);
}
.notification-popover__read {
  font-size: var(--step--1);
  justify-self: start;
  margin-top: var(--space-2);
}
.notification-panel-enter-active { transition: opacity 180ms var(--ease-settle), transform 220ms var(--ease-settle); }
.notification-panel-leave-active { pointer-events: none; transition: opacity 120ms var(--ease-out), transform 140ms var(--ease-out); }
.notification-panel-enter-from, .notification-panel-leave-to { opacity: 0; transform: translateY(-6px) scale(.99); }
@media (prefers-reduced-motion: reduce) {
  .notification-panel-enter-active, .notification-panel-leave-active { transition: none; }
  .notification-panel-enter-from, .notification-panel-leave-to,
  .notification-bell__button:active, .notification-popover__close:active,
  .notification-popover__tools button:active:not(:disabled), .notification-popover__read:active:not(:disabled) { transform: none; }
}
@media (max-width: 1100px) {
  .notification-bell {
    position: static;
  }
  .notification-popover {
    right: var(--gutter);
    top: calc(100% + var(--space-2));
  }
}
</style>
