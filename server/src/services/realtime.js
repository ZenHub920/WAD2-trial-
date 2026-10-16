/**
 * Real-time delivery for Kaki chat, over Server-Sent Events.
 *
 * WHY SSE RATHER THAN WEBSOCKETS
 * Chat traffic here is almost entirely server → client: new messages, read
 * receipts, a thread closing. Sending still goes through an ordinary POST,
 * which keeps the existing authorisation path intact — a socket would need its
 * own auth handshake and its own copy of the block/match gate. SSE is plain
 * HTTP, so it inherits the session cookie, passes through the Vite dev proxy
 * unchanged, reconnects on its own, and needs no dependency.
 *
 * ADDRESSING
 * Events are addressed to USERS, not to conversations. The server decides who
 * is entitled to each event before it is queued, so a client can never
 * subscribe its way into a thread it has no right to read. One person may have
 * several tabs open; each is a separate subscriber and all of them receive it.
 *
 * SCOPE
 * This is an in-process event bus. It delivers across every tab of every user
 * on ONE server process. Running two processes behind a load balancer would
 * need a shared broker (Redis pub/sub or similar) — out of scope here, and
 * stated plainly rather than left for someone to discover.
 */

import { EventEmitter } from 'node:events';

/** Browsers reconnect an idle EventSource; a comment line keeps it from idling. */
const HEARTBEAT_MS = 25_000;

export function createRealtime() {
  const bus = new EventEmitter();
  // A popular user could exceed the default 10-listener warning threshold.
  bus.setMaxListeners(0);

  /** userId -> Set of subscriber callbacks (one per open tab). */
  const subscribers = new Map();

  function subscribe(userId, send) {
    if (!subscribers.has(userId)) subscribers.set(userId, new Set());
    subscribers.get(userId).add(send);
    return () => {
      const set = subscribers.get(userId);
      if (!set) return;
      set.delete(send);
      if (set.size === 0) subscribers.delete(userId);
    };
  }

  /**
   * Deliver one event to every open tab of the given users.
   * A failed write is ignored: the connection is already gone and its
   * cleanup handler will remove it.
   */
  function emitTo(userIds, type, payload) {
    for (const userId of new Set(userIds.filter(Boolean))) {
      const set = subscribers.get(userId);
      if (!set) continue;
      for (const send of set) {
        try { send(type, payload); } catch { /* closed mid-write */ }
      }
    }
  }

  return {
    subscribe,
    emitTo,
    /** Open tabs for this user, used by tests and diagnostics. */
    connectionCount: (userId) => subscribers.get(userId)?.size ?? 0,
    totalConnections: () => [...subscribers.values()].reduce((n, s) => n + s.size, 0),
    HEARTBEAT_MS,
    bus,
  };
}

/**
 * Turn an Express response into an SSE stream and register it.
 * Returns a cleanup function; the caller wires it to the request's close event.
 */
export function openStream(realtime, req, res, userId) {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    // Without this, an nginx or similar in front would buffer the stream and
    // deliver everything at once when the connection closes — which looks
    // exactly like the feature not working.
    'x-accel-buffering': 'no',
  });
  res.flushHeaders?.();

  const send = (type, payload) => {
    res.write(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`);
  };

  // An immediate event tells the client the stream is live, so it can stop
  // showing a "connecting" state without waiting for real traffic.
  send('ready', { userId, at: new Date().toISOString() });

  const heartbeat = setInterval(() => {
    // A comment line: ignored by EventSource, but it keeps proxies and the
    // browser from treating the connection as idle and dropping it.
    res.write(': ping\n\n');
  }, realtime.HEARTBEAT_MS);

  const unsubscribe = realtime.subscribe(userId, send);

  return () => {
    clearInterval(heartbeat);
    unsubscribe();
  };
}
