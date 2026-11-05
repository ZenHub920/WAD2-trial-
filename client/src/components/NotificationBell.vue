<script setup>
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { api, notificationRevision } from '../api.js';
import { currentUser } from '../auth.js';
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
const countError = ref('');
// Chat titles are written by the server and name the sender, so there is
// nothing here to rewrite them to — a generic label would throw away the name.
const titles = {
  'A seeker requested to join your group': 'Someone requested a group place',
  'Seeker preferences changed; review and resubmit the join request': 'Companion preferences changed; review your group join request',
};
let timer;
let mounted = false, disposed = false, accountGeneration = 0;
let inboxRequest = 0, unreadRequest = 0, resolveRequest = 0, readRequest = 0;
const context = () => ({ userId: currentUser.value?.id, generation: accountGeneration });
const current = request => !disposed && request.userId && request.userId === currentUser.value?.id
  && request.generation === accountGeneration;
function onPush(event) {
  if (event.data?.type === 'encore-notification') open.value ? load() : refreshUnread();
}

async function load({ replace = false } = {}) {
  const scope = context();
  if (!current(scope) || (loading.value && !replace)) return;
  const request = ++inboxRequest, countRequest = ++unreadRequest;
  const active = () => current(scope) && request === inboxRequest;
  loading.value = true;
  error.value = '';
  countError.value = '';
  try {
    await Promise.allSettled([
      api.notifications().then(inbox => { if (active()) items.value = inbox.notifications; })
        .catch(() => { if (active()) error.value = 'Could not load notifications. Please try again.'; }),
      api.unreadNotifications().then(unread => {
        if (active() && countRequest === unreadRequest) unreadCount.value = unread.unread;
      }).catch(() => {
        if (active() && countRequest === unreadRequest)
          countError.value = 'Could not refresh the unread count. Refresh to try again.';
      }),
    ]);
  } finally {
    if (active()) loading.value = false;
  }
}
async function refreshUnread() {
  const scope = context(), request = ++unreadRequest;
  if (!current(scope)) return;
  try {
    const unread = await api.unreadNotifications();
    if (!current(scope) || request !== unreadRequest) return;
    unreadCount.value = unread.unread;
    countError.value = '';
  } catch {
    // Keep the last known count; the next poll or opening the inbox retries.
  }
}
async function markRead(id) {
  const scope = context();
  if (!current(scope) || readingId.value || !items.value.some(item => item.id === id)) return;
  const request = ++readRequest;
  const active = () => current(scope) && request === readRequest;
  readingId.value = id;
  try {
    await api.readNotification(id);
    if (active()) {
      const item = items.value.find(item => item.id === id);
      if (item && !item.readAt) {
        item.readAt = new Date().toISOString();
        unreadCount.value = Math.max(0, unreadCount.value - 1);
      }
      await load({ replace: true });
    }
  } catch {
    if (active()) error.value = 'Could not mark this notification as read. Please try again.';
  } finally {
    if (active()) readingId.value = '';
  }
}
/** "3 hours ago", like an updates feed; older than a week shows the date. */
function ago(value) {
  const at = Date.parse(value?.includes?.('T') ? value : `${String(value).replace(' ', 'T')}Z`);
  if (!Number.isFinite(at)) return '';
  const minutes = Math.round((Date.now() - at) / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.round(hours / 24);
  return days <= 7 ? `${days} ${days === 1 ? 'day' : 'days'} ago` : formatDateTime(value);
}
/** A round icon and a "View …" link for each kind of update. */
const KINDS = {
  chat: { icon: 'chat', link: 'View conversation' },
  group: { icon: 'group', link: 'View group' },
  match: { icon: 'match', link: 'View match' },
  meetup: { icon: 'meetup', link: 'View meetup' },
  feedback: { icon: 'feedback', link: 'Leave feedback' },
};
const kindOf = item => KINDS[item.category] ?? { icon: 'group', link: 'View details' };
async function markAllRead() {
  const scope = context();
  const unread = items.value.filter(item => !item.readAt);
  if (!current(scope) || !unread.length || readingId.value) return;
  readingId.value = 'all';
  try {
    await Promise.all(unread.map(item => api.readNotification(item.id)));
    if (current(scope)) { for (const item of unread) item.readAt = new Date().toISOString(); unreadCount.value = 0; }
  } catch {
    if (current(scope)) { error.value = 'Could not mark everything as read. Please try again.'; void load({ replace: true }); }
  } finally {
    if (current(scope)) readingId.value = '';
  }
}
function target(item) {
  if (item.path === '/kaki/chat' || item.path === '/chat') return '/messages';
  return item.path === '/marketplace' ? '/concerts' : item.path;
}
// Reaching a notification's page by any route resolves it, so unread items
// pointing at the current page are marked read without opening the inbox.
async function resolveHere(path) {
  const scope = context(), request = ++resolveRequest;
  const active = () => current(scope) && request === resolveRequest && route.fullPath === path;
  if (!current(scope) || !unreadCount.value) return;
  try {
    const { notifications } = await api.notifications();
    if (!active()) return;
    const here = notifications.filter((item) => !item.readAt && target(item) === path);
    if (!here.length) return;
    await Promise.all(here.map((item) => api.readNotification(item.id)));
    if (active()) open.value ? load({ replace: true }) : refreshUnread();
  } catch {
    // Left unread; the user can still mark it from the inbox.
  }
}
// Following a notification's link resolves it; the request runs alongside
// navigation so a slow or failed call never holds up the route change.
function follow(item) {
  const scope = context();
  if (!current(scope) || !items.value.includes(item)) return;
  dismiss();
  if (item.readAt) return;
  item.readAt = new Date().toISOString();
  unreadCount.value = Math.max(0, unreadCount.value - 1);
  inboxRequest++; unreadRequest++; loading.value = false;
  api.readNotification(item.id).catch(() => { if (current(scope)) refreshUnread(); });
}
function dismiss() {
  open.value = false;
}
function close() {
  dismiss();
  trigger.value?.focus();
}
defineExpose({ dismiss });
function outside(event) {
  if (!root.value?.contains(event.target)) open.value = false;
}
function onFocusout(event) {
  if (event.relatedTarget && !root.value?.contains(event.relatedTarget)) dismiss();
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
  if (open.value) panel.value?.focus();
});
// A first lazy-route commit can arrive after the user has opened the inbox.
watch(() => [route.fullPath, route.matched], (_, previous) => {
  if (previous[1].length) dismiss();
});
watch(() => route.fullPath, (path) => resolveHere(path));
watch(notificationRevision, () => open.value ? load() : refreshUnread());
function refreshAccount() {
  const scope = context();
  refreshUnread().then(() => { if (current(scope)) resolveHere(route.fullPath); });
}
watch(() => currentUser.value?.id, () => {
  accountGeneration++; inboxRequest++; unreadRequest++; resolveRequest++; readRequest++;
  open.value = false; items.value = []; unreadCount.value = 0; loading.value = false;
  readingId.value = ''; error.value = ''; countError.value = '';
  if (mounted) refreshAccount();
}, { flush: 'sync' });
onMounted(() => {
  mounted = true;
  navigator.serviceWorker?.addEventListener('message', onPush);
  document.addEventListener('click', outside);
  document.addEventListener('keydown', onKeydown);
  refreshAccount();
  timer = setInterval(() => open.value ? load() : refreshUnread(), 30000);
});
onUnmounted(() => {
  disposed = true; accountGeneration++;
  navigator.serviceWorker?.removeEventListener('message', onPush);
  clearInterval(timer);
  document.removeEventListener('click', outside);
  document.removeEventListener('keydown', onKeydown);
});
</script>

<template>
  <div ref="root" class="notification-bell" @focusout="onFocusout">
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
    <section v-if="open" id="notification-popover" ref="panel" class="notification-popover" tabindex="-1" aria-labelledby="notification-popover-title" :aria-busy="loading">
      <header class="notification-popover__head">
        <h2 id="notification-popover-title">Updates</h2>
        <div class="notification-popover__head-actions">
          <button v-if="unreadCount" type="button" class="notification-popover__all" :disabled="Boolean(readingId)" @click="markAllRead">Mark all read</button>
          <button type="button" class="notification-popover__icon" :disabled="loading" aria-label="Refresh" title="Refresh" @click="load"><LoadingSpinner v-if="loading && items.length" /><svg v-else viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" /></svg><span class="notification-popover__sr">Refresh</span></button>
          <button type="button" class="notification-popover__icon" aria-label="Close notifications" @click="close">×</button>
        </div>
      </header>
      <p v-if="error" class="notification-popover__error" role="alert">{{ error }}</p>
      <p v-if="countError" class="notification-popover__error" role="alert">{{ countError }}</p>
      <p v-if="loading && !items.length" class="loading-state notification-popover__pad"><LoadingSpinner /> Loading updates…</p>
      <div v-else-if="!items.length && !error" class="notification-popover__empty"><strong>No updates yet.</strong><p>Messages, group requests and meetup updates will appear here.</p></div>
      <ul v-if="items.length" class="notification-popover__list">
        <li v-for="item in items" :key="item.id" class="update" :class="{ 'notification-popover__unread update--unread': !item.readAt }">
          <span class="update__icon" :class="`update__icon--${kindOf(item).icon}`" aria-hidden="true">
            <svg v-if="kindOf(item).icon === 'chat'" viewBox="0 0 24 24"><path d="M4 5h16v11H9l-5 4V5Z" /></svg>
            <svg v-else-if="kindOf(item).icon === 'meetup'" viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M4 10h16M9 3v4M15 3v4" /></svg>
            <svg v-else-if="kindOf(item).icon === 'match'" viewBox="0 0 24 24"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z" /></svg>
            <svg v-else-if="kindOf(item).icon === 'feedback'" viewBox="0 0 24 24"><path d="m12 4 2.5 5 5.5.8-4 3.9.9 5.5L12 16.6 7.1 19.2l.9-5.5-4-3.9 5.5-.8L12 4Z" /></svg>
            <svg v-else viewBox="0 0 24 24"><circle cx="9" cy="9" r="3" /><circle cx="17" cy="10" r="2.5" /><path d="M3 19c0-3 2.7-5 6-5s6 2 6 5M15 19c0-2 1-3.5 3-3.5s3 1.5 3 3.5" /></svg>
          </span>
          <div class="update__body">
            <RouterLink :to="target(item)" class="update__title" @click="follow(item)">{{ titles[item.title] ?? item.title }}</RouterLink>
            <RouterLink :to="target(item)" class="update__link" tabindex="-1" @click="follow(item)">{{ kindOf(item).link }} <span aria-hidden="true">›</span></RouterLink>
          </div>
          <div class="update__side">
            <time :datetime="item.createdAt" :title="formatDateTime(item.createdAt)">{{ ago(item.createdAt) }}</time>
            <button v-if="!item.readAt" type="button" class="notification-popover__read update__dot" :disabled="Boolean(readingId)" title="Mark as read" @click="markRead(item.id)">
              <LoadingSpinner v-if="readingId === item.id" /><span class="notification-popover__sr">Mark read</span>
            </button>
          </div>
        </li>
      </ul>
      <footer class="notification-popover__foot"><RouterLink to="/profile#notifications" @click="dismiss">Notification preferences</RouterLink></footer>
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
  border: var(--control-border);
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
  background: var(--action-start);
  color: var(--on-action);
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
  width: min(440px, calc(100vw - 32px));
  max-height: min(75dvh, 620px);
  overflow-y: auto;
  border: 1px solid var(--floating-edge);
  border-radius: var(--radius-lg);
  background: var(--surface-floating);
  box-shadow: var(--floating-shadow);
  color: var(--text-200);
  transform-origin: top right;
  overscroll-behavior: contain;
}
/* Header: title on the left, actions on the right, a hairline underneath. */
.notification-popover__head {
  position: sticky; top: 0; z-index: 1;
  display: flex; align-items: center; justify-content: space-between; gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border-bottom: var(--border-hairline);
  background: var(--surface-floating);
}
.notification-popover__head h2 { margin: 0; font-size: var(--step-1); color: var(--text-100); }
.notification-popover__head-actions { display: flex; align-items: center; gap: var(--space-1); }
.notification-popover__all { border: 0; background: none; color: var(--signal-good); font: inherit; font-size: var(--step--1); font-weight: 650; cursor: pointer; padding: var(--space-2); }
.notification-popover__all:disabled { opacity: .55; cursor: wait; }
.notification-popover__icon { display: grid; place-items: center; width: 36px; height: 36px; padding: 0; border: 0; border-radius: 50%; background: transparent; color: var(--text-300); font-size: var(--step-1); cursor: pointer; }
.notification-popover__icon:hover:not(:disabled) { background: var(--ink-750); color: var(--text-100); }
.notification-popover__icon svg { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.notification-popover__sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.notification-popover__pad { padding: var(--space-4); }
.notification-popover__error { padding: var(--space-2) var(--space-4) 0; color: var(--rose-400); font-size: var(--step--1); }
.notification-popover__empty { padding: var(--space-6) var(--space-4); color: var(--text-300); text-align: center; }
.notification-popover__empty strong { display: block; color: var(--text-100); font-size: var(--step--1); }
.notification-popover__empty p { max-width: 30ch; margin: var(--space-2) auto 0; font-size: var(--step--1); }
/* Feed rows: icon, text, then time and an unread dot; unread rows are tinted. */
.notification-popover__list { list-style: none; margin: 0; padding: 0; }
.update { display: grid; grid-template-columns: 44px minmax(0, 1fr) auto; gap: var(--space-3); align-items: start; padding: var(--space-4); border-bottom: var(--border-hairline); overflow-wrap: anywhere; }
.update:last-child { border-bottom: 0; }
.update--unread { background: color-mix(in srgb, var(--ink-700) 55%, transparent); }
.update__icon { display: grid; place-items: center; width: 44px; height: 44px; border-radius: 50%; color: #fff; }
.update__icon svg { width: 22px; height: 22px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.update__icon--chat { background: #1971c2; }
.update__icon--group { background: var(--signal-good); }
.update__icon--match { background: #c2255c; }
.update__icon--meetup { background: #d9480f; }
.update__icon--feedback { background: #9c36b5; }
.update__body { display: grid; gap: var(--space-2); min-width: 0; }
.update__title { color: var(--text-200); font-size: var(--step-0); line-height: 1.4; text-decoration: none; }
.update--unread .update__title { color: var(--text-100); font-weight: 700; }
.update__title:hover { text-decoration: underline; }
.update__link { justify-self: start; color: var(--signal-good); font-size: var(--step--1); font-weight: 650; text-decoration: none; }
.update__link:hover { text-decoration: underline; }
.update__side { display: grid; justify-items: end; gap: var(--space-3); }
.update__side time { color: var(--text-400); font-size: var(--step--1); white-space: nowrap; }
.update__dot { display: grid; place-items: center; width: 12px; height: 12px; padding: 0; border: 0; border-radius: 50%; background: #e03131; cursor: pointer; }
.update__dot:hover:not(:disabled) { box-shadow: 0 0 0 4px color-mix(in srgb, #e03131 25%, transparent); }
.update__dot:disabled { cursor: wait; }
.notification-popover__foot { padding: var(--space-3) var(--space-4); border-top: var(--border-hairline); font-size: var(--step--1); text-align: center; }
.notification-panel-enter-active { transition: opacity 180ms var(--ease-settle), transform 220ms var(--ease-settle); }
.notification-panel-leave-active { pointer-events: none; transition: opacity 120ms var(--ease-out), transform 140ms var(--ease-out); }
.notification-panel-enter-from, .notification-panel-leave-to { opacity: 0; transform: translateY(-6px) scale(.99); }
@media (prefers-reduced-motion: reduce) {
  .notification-panel-enter-active, .notification-panel-leave-active { transition: none; }
  .notification-panel-enter-from, .notification-panel-leave-to,
  .notification-bell__button:active, .notification-popover__close:active,
  .notification-popover__read:active:not(:disabled) { transform: none; }
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
