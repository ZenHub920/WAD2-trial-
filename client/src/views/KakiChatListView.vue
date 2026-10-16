<script setup>
/**
 * Kaki conversations — the inbox.
 *
 * Two sections, as dating apps do it: the people you have matched with but
 * not yet messaged sit in a row at the top, and live threads sit below. The
 * split matters because an unstarted match is a prompt to act, while a thread
 * is something to return to, and mixing them buries the former.
 */

import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api.js';
import { onChatEvent, refreshUnread } from '../chatLive.js';
import UserAvatar from '../components/UserAvatar.vue';

const router = useRouter();

const conversations = ref([]);
const matches = ref([]);
const blocked = ref([]);
const loading = ref(true);
const error = ref(null);
const showBlocked = ref(false);

/** Matches with no thread yet — the ones worth prompting about. */
const unstarted = computed(() => {
  const talking = new Set(conversations.value.map((c) => c.other.id));
  return matches.value.filter((m) => !talking.has(m.user.id));
});

async function load() {
  loading.value = true;
  try {
    const [threads, matched] = await Promise.all([
      api.kakiConversations(),
      api.kakiMatches(),
    ]);
    conversations.value = threads.conversations;
    matches.value = matched.matches;
    error.value = null;
  } catch (err) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
}

async function loadBlocked() {
  try {
    blocked.value = (await api.blockedUsers()).blocked;
  } catch (err) {
    error.value = err.message;
  }
}

async function openWith(match) {
  try {
    const { conversation } = await api.openKakiConversation(match.concertId, match.user.id);
    router.push(`/kaki/chat/${conversation.id}`);
  } catch (err) {
    error.value = err.status === 403
      ? 'You can no longer message this person.'
      : err.message;
  }
}

async function unblock(entry) {
  try {
    await api.unblockUser(entry.id);
    await Promise.all([loadBlocked(), load()]);
  } catch (err) {
    error.value = err.message;
  }
}

function preview(c) {
  if (!c.lastMessage) return 'No messages yet';
  if (c.lastMessage.deleted) return 'Message deleted';
  return c.lastMessage.body;
}

function when(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) {
    return d.toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString('en-SG', { day: 'numeric', month: 'short' });
}

let stopListening = null;

onMounted(async () => {
  await load();
  await loadBlocked();
  // A new message, an edit or a read receipt can all change what this list
  // shows (preview text, ordering, unread count), and none of them are worth
  // reasoning about individually — reload the list, which is one small query.
  stopListening = onChatEvent(() => {
    load();
    refreshUnread();
  });
});

onUnmounted(() => stopListening?.());
</script>

<template>
  <div class="container section">
    <header class="head">
      <h1>Messages</h1>
      <button
        v-if="blocked.length"
        class="head__blocked"
        type="button"
        @click="showBlocked = !showBlocked"
      >
        Blocked ({{ blocked.length }})
      </button>
    </header>

    <p v-if="error" class="notice notice--error">{{ error }}</p>

    <div v-if="showBlocked" class="blocked">
      <h2 class="blocked__title">Blocked people</h2>
      <p class="blocked__hint">
        They cannot message you and your shared chats are hidden. Unblocking
        restores the conversation and its history.
      </p>
      <ul class="blocked__list">
        <li v-for="entry in blocked" :key="entry.id">
          <span>{{ entry.displayName }}</span>
          <button type="button" class="btn btn--ghost" @click="unblock(entry)">Unblock</button>
        </li>
      </ul>
    </div>

    <div v-if="loading" class="skeleton" />

    <template v-else>
      <!-- Matches with no thread yet -->
      <section v-if="unstarted.length" class="fresh">
        <h2 class="fresh__title">New matches</h2>
        <ul class="fresh__row">
          <li v-for="match in unstarted" :key="`${match.concertId}-${match.user.id}`">
            <button type="button" class="fresh__item" @click="openWith(match)">
              <UserAvatar
                :src="match.user.avatarUrl"
                :name="match.user.displayName"
                :size="56"
                ring
              />
              <span class="fresh__name">{{ match.user.displayName }}</span>
            </button>
          </li>
        </ul>
      </section>

      <!-- Live threads -->
      <ul v-if="conversations.length" class="threads">
        <li v-for="c in conversations" :key="c.id">
          <RouterLink :to="`/kaki/chat/${c.id}`" class="thread">
            <UserAvatar :src="c.other.avatarUrl" :name="c.other.displayName" :size="48" />
            <span class="thread__text">
              <span class="thread__top">
                <span class="thread__name">{{ c.other.displayName }}</span>
                <span class="thread__time">{{ when(c.lastMessage?.createdAt ?? c.createdAt) }}</span>
              </span>
              <span class="thread__preview" :class="{ 'thread__preview--muted': !c.lastMessage || c.lastMessage.deleted }">
                {{ preview(c) }}
              </span>
              <span class="thread__concert">{{ c.concert.artist }}</span>
            </span>
            <span
              v-if="c.unread > 0"
              class="thread__unread"
              :aria-label="`${c.unread} unread`"
            >{{ c.unread > 9 ? '9+' : c.unread }}</span>
            <span v-else class="thread__spacer" aria-hidden="true">
            </span>
          </RouterLink>
        </li>
      </ul>

      <p v-else-if="!unstarted.length" class="empty">
        No conversations yet. Match with someone in
        <RouterLink to="/kaki">Kaki Finder</RouterLink> and you can message them here.
      </p>
    </template>
  </div>
</template>

<style scoped>
.head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); }
.head h1 { margin: 0; }

.head__blocked {
  border: var(--border-hairline);
  border-radius: var(--radius-pill);
  background: var(--ink-800);
  color: var(--text-300);
  padding: var(--space-2) var(--space-4);
  font: inherit;
  font-size: var(--step--1);
  cursor: pointer;
}

.blocked {
  margin-top: var(--space-5);
  padding: var(--space-5);
  border-radius: var(--radius-lg);
  border: var(--border-hairline);
  background: var(--ink-850);
}

.blocked__title { margin: 0 0 var(--space-2); font-size: var(--step-1); }
.blocked__hint { margin: 0 0 var(--space-4); font-size: var(--step--1); color: var(--text-400); max-width: 52ch; }
.blocked__list { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--space-2); }
.blocked__list li { display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); }

/* ------------------------------------------------------------ new matches */

.fresh { margin-top: var(--space-6); }
.fresh__title { margin: 0 0 var(--space-3); font-size: var(--step-0); color: var(--text-300); }

.fresh__row {
  display: flex;
  gap: var(--space-4);
  list-style: none;
  margin: 0;
  padding: 0 0 var(--space-2);
  overflow-x: auto;
}

.fresh__item {
  display: grid;
  justify-items: center;
  gap: var(--space-2);
  border: 0;
  background: none;
  cursor: pointer;
  padding: 0;
  width: 4.5rem;
}

.fresh__avatar {
  display: grid;
  place-items: center;
  width: 3.5rem;
  height: 3.5rem;
  border-radius: 50%;
  background: linear-gradient(145deg, var(--accent-400), var(--accent-600));
  color: #fff;
  font-size: var(--step-1);
  font-weight: 600;
  /* A ring, because an unstarted match is the thing to act on. */
  box-shadow: 0 0 0 2px var(--ink-900), 0 0 0 4px var(--accent-500);
  transition: transform var(--dur-fast) var(--ease-spring);
}

.fresh__item:hover .fresh__avatar { transform: scale(1.06); }

.fresh__name {
  font-size: var(--step--2);
  color: var(--text-300);
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ---------------------------------------------------------------- threads */

.threads { list-style: none; margin: var(--space-6) 0 0; padding: 0; }

.thread {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-4) var(--space-2);
  border-bottom: var(--border-hairline);
  text-decoration: none;
  color: inherit;
  transition: background var(--dur-fast) var(--ease-glide);
}

.thread:hover { background: var(--ink-850); }

.thread__avatar {
  display: grid;
  place-items: center;
  width: 3rem;
  height: 3rem;
  border-radius: 50%;
  background: var(--ink-700);
  color: var(--text-200);
  font-weight: 600;
  flex-shrink: 0;
}

.thread__text { display: grid; gap: 2px; flex: 1; min-width: 0; }
.thread__top { display: flex; justify-content: space-between; gap: var(--space-3); }
.thread__name { font-weight: 600; }
.thread__time { font-size: var(--step--2); color: var(--text-400); flex-shrink: 0; }

.thread__preview {
  font-size: var(--step--1);
  color: var(--text-300);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.thread__preview--muted { color: var(--text-400); font-style: italic; }
.thread__concert { font-size: var(--step--2); color: var(--text-400); }

.empty { margin-top: var(--space-7); color: var(--text-300); }

.skeleton {
  margin-top: var(--space-6);
  height: 18rem;
  border-radius: var(--radius-lg);
  background: var(--ink-850);
}
</style>

<style scoped>
/* Unread badge on a thread row. Mirrors the navbar dot so the two read as the
   same signal at different scales. */
.thread__unread {
  display: grid;
  place-items: center;
  min-width: 1.35rem;
  height: 1.35rem;
  padding: 0 0.35em;
  border-radius: var(--radius-pill);
  background: var(--accent-500);
  color: #fff;
  font-size: 0.72rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

/* Keeps the row's right edge stable whether or not a badge is present, so
   rows do not shift sideways as threads are read. */
.thread__spacer { width: 1.35rem; flex-shrink: 0; }
</style>
