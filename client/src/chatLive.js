/**
 * The live chat connection and the unread badge, shared app-wide.
 *
 * One EventSource for the whole tab rather than one per view: the navbar badge
 * and an open thread both need the same events, and two connections would
 * double the server's fan-out while still needing to be kept in sync with each
 * other.
 *
 * Lifecycle follows the session. It opens when someone signs in and closes
 * when they sign out — an anonymous visitor has nothing to subscribe to, and
 * leaving a stream open after logout would keep pushing a former user's
 * events at the page.
 *
 * EventSource reconnects on its own after a network drop, with its own
 * backoff, so there is no retry loop here. What it cannot do is recover events
 * missed while disconnected, so each view refetches on reconnect rather than
 * assuming the stream is a complete log.
 */

import { ref, watch } from 'vue';
import { api, notificationRevision } from './api.js';
import { currentUser } from './auth.js';

/** Unread messages across every visible conversation. Drives the navbar dot. */
export const unreadTotal = ref(0);

/** 'idle' | 'connecting' | 'live' — surfaced so a view can show a subtle state. */
export const connectionState = ref('idle');

/** Listeners registered by views that want raw events. */
const handlers = new Set();

let source = null;
let unreadRequest = 0;
const unreadByKind = { companion: 0, group: 0 };

/**
 * Subscribe to chat events. Returns an unsubscribe function.
 * Events include chat messages/reads, membership updates and planner invalidations.
 */
export function onChatEvent(handler) {
  handlers.add(handler);
  return () => handlers.delete(handler);
}

function dispatch(type, data) {
  for (const handler of handlers) {
    try { handler(type, data); } catch (err) { console.error('chat handler failed', err); }
  }
}

export async function refreshUnread() {
  const userId = currentUser.value?.id;
  const request = ++unreadRequest;
  if (!userId) {
    unreadTotal.value = 0;
    return;
  }
  try {
    const kinds = ['companion', 'group'];
    const results = await Promise.allSettled([api.kakiUnread(), api.groupChannelsUnread()]);
    if (currentUser.value?.id !== userId || request !== unreadRequest) return;
    results.forEach((result, index) => {
      if (result.status === 'fulfilled' && Number.isFinite(result.value.total)) unreadByKind[kinds[index]] = result.value.total;
    });
    unreadTotal.value = Object.values(unreadByKind).reduce((sum, total) => sum + total, 0);
  } catch {
    // A failed badge refresh is not worth surfacing; the next event corrects it.
  }
}

function connect() {
  if (source || !currentUser.value || pageHidden()) return;
  connectionState.value = 'connecting';

  // Same-origin, so the session cookie is sent automatically — no token to
  // pass in the URL, where it would end up in logs and history.
  const userId = currentUser.value.id;
  const stream = new EventSource('/api/kaki/stream');
  source = stream;
  const current = () => source === stream && currentUser.value?.id === userId;

  stream.addEventListener('ready', () => {
    if (!current()) return;
    connectionState.value = 'live';
    // Anything that happened while disconnected is not replayed, so resync.
    refreshUnread();
    notificationRevision.value++;
    dispatch('ready', {});
  });

  for (const type of ['message', 'message-updated', 'read', 'group-message', 'group-read', 'group-members', 'meetup-updated']) {
    stream.addEventListener(type, (event) => {
      if (!current()) return;
      let data;
      try { data = JSON.parse(event.data); } catch { return; }

      // Each endpoint applies its own room-membership rules before counting.
      const ownRead = ['read', 'group-read'].includes(type) && data.readerId === userId;
      if (['message', 'group-message', 'group-members'].includes(type)
        || ownRead) refreshUnread();
      if (ownRead) notificationRevision.value++;
      dispatch(type, data);
    });
  }

  stream.addEventListener('error', () => {
    if (!current()) return;
    // EventSource retries by itself; reflect the gap rather than intervening.
    connectionState.value = 'connecting';
  });
}

function disconnect() {
  source?.close();
  source = null;
  connectionState.value = 'idle';
  unreadTotal.value = 0;
  unreadRequest++;
  for (const kind of Object.keys(unreadByKind)) unreadByKind[kind] = 0;
}

/*
 * Background tabs let go of the stream. Over HTTP/1.1 (the dev server, and
 * many hosts) a browser opens at most six connections to one site, and an
 * EventSource holds one for as long as it lives. With six Encore tabs open,
 * every other request (concerts, groups, messages) would queue forever. A tab
 * hidden for a little while closes its stream and reconnects when shown;
 * 'ready' then resyncs everything it missed, as after any other gap.
 */
const HIDDEN_RELEASE_MS = 10000;
let releaseTimer = null;
const pageHidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';

function release() {
  if (!source) return;
  source.close();
  source = null;
  // The unread badge is left as it is; it refreshes on the next 'ready'.
  connectionState.value = 'idle';
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    clearTimeout(releaseTimer);
    if (pageHidden()) releaseTimer = setTimeout(release, HIDDEN_RELEASE_MS);
    else connect();
  });
}

/** Follow the session: connect on sign-in, drop everything on sign-out. */
watch(() => currentUser.value?.id, (userId) => {
  disconnect();
  if (userId) {
    connect();
    refreshUnread();
  }
}, { immediate: true });
