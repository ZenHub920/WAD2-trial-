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
import { api } from './api.js';
import { currentUser } from './auth.js';

/** Unread messages across every visible conversation. Drives the navbar dot. */
export const unreadTotal = ref(0);

/** 'idle' | 'connecting' | 'live' — surfaced so a view can show a subtle state. */
export const connectionState = ref('idle');

/** Listeners registered by views that want raw events. */
const handlers = new Set();

let source = null;

/**
 * Subscribe to chat events. Returns an unsubscribe function.
 * Events: 'message', 'message-updated', 'read', 'ready'.
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
  if (!currentUser.value) {
    unreadTotal.value = 0;
    return;
  }
  try {
    unreadTotal.value = (await api.kakiUnread()).total;
  } catch {
    // A failed badge refresh is not worth surfacing; the next event corrects it.
  }
}

function connect() {
  if (source || !currentUser.value) return;
  connectionState.value = 'connecting';

  // Same-origin, so the session cookie is sent automatically — no token to
  // pass in the URL, where it would end up in logs and history.
  source = new EventSource('/api/kaki/stream');

  source.addEventListener('ready', () => {
    connectionState.value = 'live';
    // Anything that happened while disconnected is not replayed, so resync.
    refreshUnread();
    dispatch('ready', {});
  });

  for (const type of ['message', 'message-updated', 'read']) {
    source.addEventListener(type, (event) => {
      let data;
      try { data = JSON.parse(event.data); } catch { return; }

      // The server sends each recipient's total in one event; take ours.
      if (type === 'message' && data.unreadFor && currentUser.value) {
        const mine = data.unreadFor[currentUser.value.id];
        if (typeof mine === 'number') unreadTotal.value = mine;
      }
      dispatch(type, data);
    });
  }

  source.addEventListener('error', () => {
    // EventSource retries by itself; reflect the gap rather than intervening.
    connectionState.value = 'connecting';
  });
}

function disconnect() {
  source?.close();
  source = null;
  connectionState.value = 'idle';
  unreadTotal.value = 0;
}

/** Follow the session: connect on sign-in, drop everything on sign-out. */
watch(currentUser, (user) => {
  if (user) {
    connect();
    refreshUnread();
  } else {
    disconnect();
  }
}, { immediate: true });
