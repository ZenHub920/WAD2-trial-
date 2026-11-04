<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api.js';
import { onChatEvent, refreshUnread } from '../chatLive.js';
import { currentUser } from '../auth.js';
import { formatMoney } from '../market.js';
import UserAvatar from '../components/UserAvatar.vue';
import LoadingSpinner from '../components/LoadingSpinner.vue';

const router = useRouter();

const channels = ref([]);
const channelsLoading = ref(true);
const channelsError = ref(null);
const conversations = ref([]);
const ticketConversations = ref([]);
const matches = ref([]);
const blocked = ref([]);
const loading = ref(true);
const ticketLoading = ref(true);
const error = ref(null);
const ticketError = ref(null);
const actionError = ref('');
const showBlocked = ref(false);
const blockedLoading = ref(false);
const openingMatch = ref(null);
const unblockingId = ref(null);

const channelLink = channel => channel.connectionId
  ? `/groups/connections/${encodeURIComponent(channel.connectionId)}/channel`
  : `/groups/${encodeURIComponent(channel.partyId)}/channel`;

// Server times come as ISO strings or SQLite "YYYY-MM-DD HH:MM:SS" (UTC).
function stamp(value) {
  if (!value) return 0;
  const text = String(value);
  const time = Date.parse(text.includes('T') ? text : `${text.replace(' ', 'T')}Z`);
  return Number.isNaN(time) ? 0 : time;
}

/**
 * One inbox: companion, ticket and group chats in a single list, newest first,
 * each tagged with its kind so nobody has to remember where a chat lives.
 */
const threads = computed(() => [
  ...conversations.value.map((c) => ({
    key: `companion:${c.id}`, kind: 'Companion', to: `/kaki/chat/${c.id}`,
    title: c.other.displayName, person: c.other, unread: c.unread ?? 0,
    preview: preview(c), muted: !c.lastMessage || c.lastMessage.deleted,
    context: c.concert.artist, at: c.lastMessage?.createdAt ?? c.createdAt,
  })),
  ...ticketConversations.value.map((c) => ({
    key: `ticket:${c.id}`, kind: 'Ticket', to: `/chat/${encodeURIComponent(c.id)}`,
    title: c.other.displayName, person: c.other, unread: c.unread ?? 0,
    preview: c.lastMessage?.body ?? 'No messages yet', muted: !c.lastMessage,
    context: `${c.role === 'buyer' ? 'Enquiry' : 'Your listing'}: ${c.listing.title} · ${formatMoney(c.listing.priceCents)}`,
    at: c.lastMessage?.createdAt ?? c.createdAt,
  })),
  ...channels.value.map((channel) => ({
    key: channel.connectionId ? `connection:${channel.connectionId}` : `group:${channel.partyId}`,
    kind: channel.connectionId ? 'Connected groups' : 'Group', to: channelLink(channel),
    title: channel.name, initial: (channel.concert.artist || '?').slice(0, 1), unread: channel.unread ?? 0,
    preview: channel.lastMessage?.deleted ? 'Message deleted' : channel.lastMessage?.body ?? 'No messages yet',
    muted: !channel.lastMessage || channel.lastMessage.deleted,
    context: `${channel.memberCount} ${channel.memberCount === 1 ? 'member' : 'members'}`,
    at: channel.lastMessage?.createdAt,
  })),
].sort((a, b) => stamp(b.at) - stamp(a.at) || a.title.localeCompare(b.title)));

const anyLoading = computed(() => loading.value || ticketLoading.value || channelsLoading.value);
const signedOut = computed(() => [error.value, ticketError.value, channelsError.value].some((e) => e?.status === 401));

const unstarted = computed(() => {
  const talking = new Set(conversations.value.map((c) => `${c.concert.id}:${c.other.id}`));
  return matches.value.filter((m) => !talking.has(`${m.concertId}:${m.user.id}`));
});

async function load({ quiet = false } = {}) {
  if (!quiet) loading.value = true;
  try {
    const [threads, matched] = await Promise.all([
      api.kakiConversations(),
      api.kakiMatches(),
    ]);
    conversations.value = threads.conversations;
    matches.value = matched.matches;
    error.value = null;
  } catch (err) {
    error.value = err;
  } finally {
    loading.value = false;
  }
}

async function loadTickets() {
  ticketLoading.value = true;
  try {
    ticketConversations.value = (await api.conversations()).conversations;
    ticketError.value = null;
  } catch (err) {
    ticketError.value = err;
  } finally {
    ticketLoading.value = false;
  }
}

let channelsRequest = 0;
async function loadChannels({ quiet = false } = {}) {
  const request = ++channelsRequest, userId = currentUser.value?.id;
  if (!quiet) channelsLoading.value = true;
  try {
    const results = await Promise.allSettled([api.groupChannels(), api.connectionChannels()]);
    if (request !== channelsRequest || currentUser.value?.id !== userId) return;
    channels.value = results.flatMap(result => result.status === 'fulfilled' ? result.value.channels : []);
    channels.value.sort((a, b) => String(b.lastMessage?.createdAt ?? '').localeCompare(String(a.lastMessage?.createdAt ?? '')) || a.name.localeCompare(b.name));
    channelsError.value = results.find(result => result.status === 'rejected')?.reason ?? null;
  } catch (err) {
    if (request === channelsRequest && currentUser.value?.id === userId) channelsError.value = err;
  } finally {
    if (request === channelsRequest && currentUser.value?.id === userId) channelsLoading.value = false;
  }
}

async function loadBlocked() {
  blockedLoading.value = true;
  try {
    blocked.value = (await api.blockedUsers()).blocked;
  } catch (err) {
    if (err.status !== 401) actionError.value = 'Could not load blocked people.';
  } finally {
    blockedLoading.value = false;
  }
}

async function openWith(match) {
  if (openingMatch.value !== null) return;
  openingMatch.value = `${match.concertId}:${match.user.id}`;
  actionError.value = '';
  try {
    const { conversation } = await api.openKakiConversation(match.concertId, match.user.id);
    router.push(`/kaki/chat/${conversation.id}`);
  } catch (err) {
    actionError.value = err.status === 403
      ? 'You can no longer message this person.'
      : 'Could not open this conversation. Please try again.';
  } finally {
    openingMatch.value = null;
  }
}

async function unblock(entry) {
  if (unblockingId.value !== null) return;
  unblockingId.value = entry.id;
  actionError.value = '';
  try {
    await api.unblockUser(entry.id);
    await Promise.all([loadBlocked(), load({ quiet: true })]);
  } catch (err) {
    actionError.value = 'Could not unblock this person. Please try again.';
  } finally {
    unblockingId.value = null;
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
  if (d.toDateString() === new Date().toDateString()) {
    return d.toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString('en-SG', { day: 'numeric', month: 'short' });
}

let stopListening = null;
onMounted(() => {
  stopListening = onChatEvent(type => {
    if (type === 'ready' || !type.startsWith('group-') && !type.startsWith('connection-')) load({ quiet: true });
    if (type === 'ready' || type.startsWith('group-') || type.startsWith('connection-')) loadChannels({ quiet: true });
    refreshUnread();
  });
  load();
  loadTickets();
  loadChannels();
  loadBlocked();
});
onUnmounted(() => stopListening?.());
watch(() => currentUser.value?.id, userId => {
  channelsRequest++;
  channels.value = [];
  channelsError.value = null;
  if (userId) loadChannels();
});
</script>

<template>
  <div class="container section inbox">
    <header class="head">
      <div class="head__title"><h1>Messages</h1></div>
      <div class="head__actions"><RouterLink to="/meetups" class="btn btn--ghost">My meetups</RouterLink></div>
    </header>

    <p v-if="actionError" class="notice notice--error" role="alert">{{ actionError }}</p>

    <div v-if="signedOut" class="notice notice--error" role="alert">
      <p>Sign in to see your messages.</p>
      <RouterLink :to="{ name: 'login', query: { redirect: '/messages' } }">Sign in</RouterLink>
    </div>
    <template v-else>
      <!-- A source that fails says so; chats from the others still show below. -->
      <div v-if="error" class="notice notice--error" role="alert"><p>Could not load companion messages.</p><button class="btn btn--ghost" type="button" @click="load()">Retry</button></div>
      <div v-if="ticketError" class="notice notice--error" role="alert"><p>Could not load ticket messages.</p><button class="btn btn--ghost" type="button" @click="loadTickets">Retry</button></div>
      <div v-if="channelsError" class="notice notice--error" role="alert"><p>{{ channels.length ? 'Some group chats could not be refreshed.' : 'Could not load group chats.' }}</p><button class="btn btn--ghost" type="button" @click="loadChannels()">Retry</button></div>

      <div v-if="unstarted.length" class="fresh">
        <h3>Mutual matches · ready to message</h3>
        <ul class="fresh__row">
          <li v-for="match in unstarted" :key="`${match.concertId}-${match.user.id}`">
            <button type="button" class="fresh__item" :disabled="openingMatch !== null" @click="openWith(match)">
              <UserAvatar :src="match.user.avatarUrl" :name="match.user.displayName" :size="48" ring />
              <span class="fresh__text">
                <strong>{{ match.user.displayName }}</strong>
                <span>Start a conversation</span>
                <LoadingSpinner v-if="openingMatch === `${match.concertId}:${match.user.id}`" />
              </span>
            </button>
          </li>
        </ul>
      </div>

      <ul v-if="threads.length" class="threads" aria-label="Conversations">
        <li v-for="thread in threads" :key="thread.key">
          <RouterLink :to="thread.to" class="thread" :class="{ 'thread--unread': thread.unread > 0 }">
            <UserAvatar v-if="thread.person" :src="thread.person.avatarUrl" :name="thread.person.displayName" :size="44" />
            <span v-else class="thread__group" aria-hidden="true">{{ thread.initial }}</span>
            <span class="thread__text">
              <span class="thread__top">
                <strong class="thread__name">{{ thread.title }}</strong>
                <span class="thread__time">{{ when(thread.at) }}</span>
              </span>
              <span class="thread__preview" :class="{ 'thread__preview--muted': thread.muted }">{{ thread.preview }}</span>
              <span class="thread__context"><span class="thread__kind">{{ thread.kind }}</span>{{ thread.context }}</span>
            </span>
            <span v-if="thread.unread > 0" class="thread__unread" :aria-label="`${thread.unread} unread messages`">{{ thread.unread > 9 ? '9+' : thread.unread }}</span>
            <span class="thread__arrow" aria-hidden="true">&rsaquo;</span>
          </RouterLink>
        </li>
      </ul>
      <p v-else-if="anyLoading" class="empty loading-state" role="status"><LoadingSpinner />Loading messages…</p>
      <p v-else-if="!unstarted.length" class="empty">
        No messages yet. <RouterLink to="/kaki">Find a companion</RouterLink>, join a <RouterLink to="/groups">group</RouterLink> or message a seller from <RouterLink to="/tickets">Tickets</RouterLink>.
      </p>

      <div v-if="blocked.length" class="inbox__blocked">
        <button class="btn btn--ghost" type="button" :aria-expanded="showBlocked" @click="showBlocked = !showBlocked">
          Blocked people ({{ blocked.length }})
        </button>
        <div v-if="showBlocked" class="blocked">
          <h3>Blocked people</h3>
          <p class="hint">Unblocking restores your chat history.</p>
          <p v-if="blockedLoading" class="loading-state" role="status"><LoadingSpinner />Loading blocked people…</p>
          <ul class="blocked__list">
            <li v-for="entry in blocked" :key="entry.id">
              <span>{{ entry.displayName }}</span>
              <button type="button" class="btn btn--ghost" :disabled="unblockingId !== null" @click="unblock(entry)">
                <LoadingSpinner v-if="unblockingId === entry.id" />
                Unblock
              </button>
            </li>
          </ul>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.head__actions { display:flex; flex-wrap:wrap; align-items:center; justify-content:flex-end; gap:.75rem; }
.inbox {
  max-width: 800px;
}
.head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  margin-bottom: var(--space-5);
}
.head h1 {
  margin: 0;
}
.head__title { padding-bottom: var(--space-2); }
.head .inbox__eyebrow {
  margin: 0 0 var(--space-2);
  color: var(--accent-400);
  font-size: .8rem;
  font-weight: 650;
  letter-spacing: .1em;
  text-transform: uppercase;
}
.head__hint { margin-top: var(--space-2); font-size: var(--step--1); }
.head p, .hint {
  color: var(--text-300);
}
.inbox__section {
  margin-top: var(--space-5);
  min-width: 0;
  animation: inbox-section-in 180ms var(--ease-settle) both;
}
.inbox__section h2 {
  margin: 0;
  font-size: var(--step-1);
}
.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--space-3);
  margin-bottom: var(--space-4);
}
.section-head__hint { margin-top: var(--space-1); color: var(--text-300); font-size: var(--step--1); }
.hint {
  margin: var(--space-2) 0 var(--space-4);
  font-size: var(--step--1);
}
.blocked {
  margin-block: var(--space-4);
  padding: var(--space-4);
  border: 1px solid var(--panel-edge);
  border-radius: var(--radius-md);
  background: var(--ink-850);
  box-shadow: inset 0 1px 0 var(--panel-highlight);
}
.blocked h3, .fresh h3 {
  margin: 0 0 var(--space-3);
  font-size: var(--step-0);
}
.blocked__list, .fresh__row, .threads {
  list-style: none;
  margin: 0;
  padding: 0;
}
.blocked__list {
  display: grid;
  gap: var(--space-3);
}
.blocked__list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}
.blocked__list li span {
  min-width: 0;
  overflow-wrap: anywhere;
}
.blocked__list button {
  flex-shrink: 0;
}
.fresh {
  margin-block: var(--space-5);
}
.fresh__row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 15rem), 1fr));
  gap: var(--space-3);
}
.fresh__item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3);
  width: 100%;
  min-width: 0;
  border: 1px solid var(--panel-edge);
  border-radius: var(--radius-md);
  background: var(--ink-850);
  color: var(--text-100);
  text-align: left;
  cursor: pointer;
  box-shadow: var(--panel-shadow);
  transition: border-color var(--dur-fast), background-color var(--dur-fast), transform var(--dur-fast) var(--ease-settle), box-shadow var(--dur-fast);
}
.fresh__item:hover:not(:disabled) { border-color: var(--accent-400); background: var(--ink-800); }
.fresh__item:active:not(:disabled) { transform: translateY(1px); box-shadow: inset 0 2px 4px rgba(0, 0, 0, .12); }
.fresh__item:disabled { opacity: .55; cursor: wait; }
.fresh__text {
  display: grid;
  gap: var(--space-1);
  min-width: 0;
  overflow-wrap: anywhere;
}
.fresh__text span {
  color: var(--text-300);
  font-size: var(--step--2);
}
.threads {
  display: grid;
  border: 1px solid var(--panel-edge);
  border-radius: var(--radius-md);
  overflow: hidden;
  background: var(--panel-bg);
  box-shadow: var(--panel-shadow);
}
.thread {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-4);
  border-bottom: var(--border-hairline);
  border-left: 3px solid transparent;
  color: inherit;
  text-decoration: none;
  transition: background-color var(--dur-fast), border-color var(--dur-fast), box-shadow var(--dur-fast);
}
.threads > li:last-child .thread { border-bottom: 0; }
.thread__kind { margin-right: var(--space-2); padding: 0 var(--space-2); border-radius: var(--radius-pill); background: var(--ink-750); color: var(--accent-400); font-weight: 650; }
.inbox__blocked { display: grid; justify-items: start; gap: var(--space-3); margin-top: var(--space-5); }
.thread--unread { border-left-color: var(--accent-400); background: color-mix(in srgb, var(--accent-400) 5%, var(--ink-800)); }
.thread:hover {
  background: var(--ink-850);
  color: var(--text-100);
}
.thread:active { background: var(--ink-750); box-shadow: inset 0 2px 5px rgba(0, 0, 0, .08); }
.thread:focus-visible { position: relative; z-index: 1; outline-offset: -3px; }
.thread__arrow { flex: none; color: var(--text-400); font-size: 1.5rem; line-height: 1; transition: color var(--dur-fast), transform var(--dur-fast) var(--ease-settle); }
.thread:hover .thread__arrow, .thread:focus-visible .thread__arrow { color: var(--accent-400); transform: translateX(2px); }
.thread__text {
  display: grid;
  gap: var(--space-1);
  flex: 1;
  min-width: 0;
}
.thread__top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-3);
}
.thread__name {
  min-width: 0;
  overflow-wrap: anywhere;
}
.thread__time {
  font-size: var(--step--2);
  color: var(--text-400);
}
.thread__preview {
  font-size: var(--step--1);
  color: var(--text-300);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.thread__preview--muted {
  color: var(--text-400);
  font-style: italic;
}
.thread__context {
  font-size: var(--step--2);
  color: var(--text-300);
  overflow-wrap: anywhere;
  padding-top: 2px;
}
.thread__unread {
  display: grid;
  place-items: center;
  min-width: 1.5rem;
  height: 1.5rem;
  padding-inline: .35em;
  flex-shrink: 0;
  border-radius: var(--radius-pill);
  background: var(--accent-600);
  color: #fff;
  font-size: var(--step--2);
  font-weight: 700;
}
.empty {
  margin-block: var(--space-5);
  padding: var(--space-5);
  border: 1px dashed var(--ink-500);
  border-radius: var(--radius-md);
  background: var(--ink-850);
  color: var(--text-300);
}
.thread__group {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  flex: none;
  border-radius: var(--radius-md);
  background: var(--action-start);
  color: var(--on-action);
  font-weight: 700;
  font-size: var(--step-0);
}
@keyframes inbox-section-in {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: none; }
}
@media (max-width: 480px) {
  .thread { padding: var(--space-3); gap: var(--space-2); }
  .thread__arrow { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .inbox__section { animation: none; }
  .fresh__item:active:not(:disabled), .thread:hover .thread__arrow, .thread:focus-visible .thread__arrow { transform: none; }
}
</style>
