<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api.js';
import { onChatEvent, refreshUnread } from '../chatLive.js';
import { currentUser } from '../auth.js';
import { formatMoney, formatRelative } from '../market.js';
import UserAvatar from '../components/UserAvatar.vue';
import LoadingSpinner from '../components/LoadingSpinner.vue';
import SegmentedTabs from '../components/SegmentedTabs.vue';

const route = useRoute();
const router = useRouter();

/**
 * One inbox, three kinds of conversation. The tab lives in the URL so a link
 * to "my group channels" is a link, and so leaving a channel can send you back
 * to the tab you came from.
 */
const TABS = ['companion', 'tickets', 'groups'];
const tab = ref(TABS.includes(route.query.tab) ? route.query.tab : 'companion');
watch(tab, (next) => router.replace({ query: { ...route.query, tab: next } }));
watch(() => route.query.tab, (next) => { if (TABS.includes(next) && next !== tab.value) tab.value = next; });

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

const companionUnread = computed(() => conversations.value.filter((c) => c.unread > 0).length);
const groupUnread = computed(() => channels.value.filter((c) => c.unread > 0).length);
const channelLink = channel => channel.connectionId
  ? `/groups/connections/${encodeURIComponent(channel.connectionId)}/channel`
  : `/groups/${encodeURIComponent(channel.partyId)}/channel`;
const tabs = computed(() => [
  { id: 'companion', label: 'Companions', icon: 'companion', count: companionUnread.value },
  { id: 'tickets', label: 'Tickets', icon: 'ticket' },
  { id: 'groups', label: 'Groups', icon: 'group', count: groupUnread.value },
]);

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
      <div class="head__title"><p class="inbox__eyebrow">Your conversations</p><h1>Messages</h1><p class="head__hint">Pick a space, then carry on where you left off.</p></div>
      <div class="head__actions"><RouterLink to="/meetups" class="btn btn--ghost">My meetups</RouterLink><SegmentedTabs v-model="tab" :tabs="tabs" aria-label="Message type" /></div>
    </header>

    <p v-if="actionError" class="notice notice--error" role="alert">{{ actionError }}</p>

    <section v-show="tab === 'companion'" class="inbox__section" aria-labelledby="companion-messages">
      <div class="section-head">
        <div><h2 id="companion-messages">Companion messages</h2><p class="section-head__hint">One-to-one conversations with your mutual matches.</p></div>
        <button v-if="blocked.length" class="btn btn--ghost" type="button" :aria-expanded="showBlocked" @click="showBlocked = !showBlocked">
          Blocked people ({{ blocked.length }})
        </button>
      </div>

      <div v-if="showBlocked" class="blocked">
        <h3>Blocked people</h3>
        <p class="hint">Blocking hides companion conversations and stops messages. Unblocking restores your chat history.</p>
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

      <p v-if="loading" class="empty loading-state" role="status"><LoadingSpinner />Loading companion messages…</p>
      <div v-else-if="error" class="notice notice--error" role="alert">
        <p>{{ error.status === 401 ? 'Sign in to see your companion messages.' : 'Could not load companion messages.' }}</p>
        <RouterLink v-if="error.status === 401" :to="{ name: 'login', query: { redirect: '/messages' } }">Sign in</RouterLink>
        <button v-else class="btn btn--ghost" type="button" @click="load()">Retry</button>
      </div>
      <template v-else>
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

        <ul v-if="conversations.length" class="threads">
          <li v-for="c in conversations" :key="c.id">
            <RouterLink :to="`/kaki/chat/${c.id}`" class="thread" :class="{ 'thread--unread': c.unread > 0 }">
              <UserAvatar :src="c.other.avatarUrl" :name="c.other.displayName" :size="44" />
              <span class="thread__text">
                <span class="thread__top">
                  <strong class="thread__name">{{ c.other.displayName }}</strong>
                  <span class="thread__time">{{ when(c.lastMessage?.createdAt ?? c.createdAt) }}</span>
                </span>
                <span class="thread__preview" :class="{ 'thread__preview--muted': !c.lastMessage || c.lastMessage.deleted }">{{ preview(c) }}</span>
                <span class="thread__context">{{ c.concert.artist }}</span>
              </span>
              <span v-if="c.unread > 0" class="thread__unread" :aria-label="`${c.unread} unread messages`">{{ c.unread > 9 ? '9+' : c.unread }}</span>
              <span class="thread__arrow" aria-hidden="true">&rsaquo;</span>
            </RouterLink>
          </li>
        </ul>
        <p v-else-if="!unstarted.length" class="empty">
          No companion conversations yet. <RouterLink to="/kaki">Find a companion</RouterLink> to get started.
        </p>
      </template>
    </section>

    <section v-show="tab === 'tickets'" class="inbox__section" aria-labelledby="ticket-messages">
      <div class="section-head"><div><h2 id="ticket-messages">Ticket messages</h2><p class="section-head__hint">Keep seller enquiries and listing details together.</p></div></div>
      <p v-if="ticketLoading" class="empty loading-state" role="status"><LoadingSpinner />Loading ticket messages…</p>
      <div v-else-if="ticketError" class="notice notice--error" role="alert">
        <p>{{ ticketError.status === 401 ? 'Sign in to see your ticket messages.' : 'Could not load ticket messages.' }}</p>
        <RouterLink v-if="ticketError.status === 401" :to="{ name: 'login', query: { redirect: '/messages' } }">Sign in</RouterLink>
        <button v-else class="btn btn--ghost" type="button" @click="loadTickets">Retry</button>
      </div>
      <ul v-else-if="ticketConversations.length" class="threads">
        <li v-for="c in ticketConversations" :key="c.id">
          <RouterLink :to="{ name: 'chat-thread', params: { id: c.id } }" class="thread">
            <UserAvatar :src="c.other.avatarUrl" :name="c.other.displayName" :size="44" />
            <span class="thread__text">
              <span class="thread__top">
                <strong class="thread__name">{{ c.other.displayName }}</strong>
                <time v-if="c.lastMessage" class="thread__time" :datetime="c.lastMessage.createdAt">{{ formatRelative(c.lastMessage.createdAt) }}</time>
              </span>
              <span class="thread__preview">{{ c.lastMessage?.body ?? 'No messages yet' }}</span>
              <span class="thread__context">{{ c.role === 'buyer' ? 'Ticket enquiry' : 'Your listing' }}: {{ c.listing.title }} · {{ formatMoney(c.listing.priceCents) }} listing total</span>
            </span>
            <span class="thread__arrow" aria-hidden="true">&rsaquo;</span>
          </RouterLink>
        </li>
      </ul>
      <p v-else class="empty">No ticket conversations yet. Message a seller from a listing in <RouterLink to="/concerts">Concerts</RouterLink>.</p>
    </section>

    <!-- Single-group channels and accepted connections share the Groups inbox. -->
    <section v-show="tab === 'groups'" class="inbox__section" aria-labelledby="group-messages">
      <div class="section-head"><div><h2 id="group-messages">Group messages</h2><p class="section-head__hint">Your concert groups and shared rooms for connected groups.</p></div></div>
      <p v-if="channelsLoading" class="empty loading-state" role="status"><LoadingSpinner />Loading group channels…</p>
      <div v-if="!channelsLoading && channelsError" class="notice notice--error" role="alert">
        <p>{{ channelsError.status === 401 ? 'Sign in to see your group channels.' : channels.length ? 'Some group chats could not be refreshed. You can still open the chats shown below.' : 'Could not load group channels.' }}</p>
        <RouterLink v-if="channelsError.status === 401" :to="{ name: 'login', query: { redirect: '/messages' } }">Sign in</RouterLink>
        <button v-else class="btn btn--ghost" type="button" @click="loadChannels">Retry</button>
      </div>
      <ul v-if="!channelsLoading && channels.length" class="threads">
        <li v-for="channel in channels" :key="channel.connectionId ? `connection:${channel.connectionId}` : `group:${channel.partyId}`">
          <RouterLink :to="channelLink(channel)" class="thread" :class="{ 'thread--unread': channel.unread > 0 }">
            <span class="thread__group" aria-hidden="true">{{ (channel.concert.artist || '?').slice(0, 1) }}</span>
            <span class="thread__text">
              <span class="thread__top">
                <strong class="thread__name">{{ channel.name }}</strong>
                <span class="thread__time">{{ when(channel.lastMessage?.createdAt) }}</span>
              </span>
              <span class="thread__preview" :class="{ 'thread__preview--muted': !channel.lastMessage }">
                {{ channel.lastMessage?.deleted ? 'Message deleted' : channel.lastMessage?.body ?? 'No messages yet' }}
              </span>
              <span class="thread__context">
                {{ channel.connectionId ? 'Connected groups · ' : '' }}{{ channel.memberCount }} {{ channel.memberCount === 1 ? 'member' : 'members' }}{{ channel.isHost ? ' · you host a group' : '' }}
              </span>
            </span>
            <span v-if="channel.unread > 0" class="thread__unread" :aria-label="`${channel.unread} unread messages`">{{ channel.unread > 9 ? '9+' : channel.unread }}</span>
            <span class="thread__arrow" aria-hidden="true">&rsaquo;</span>
          </RouterLink>
        </li>
      </ul>
      <p v-if="!channelsLoading && !channelsError && !channels.length" class="empty">
        No group chats yet. Your host can add you to your group's channel. Accepted group connections also open a shared chat for both groups.
        <RouterLink to="/groups">Find a group</RouterLink> to get started.
      </p>
    </section>
  </div>
</template>

<style scoped>
.head__actions { display:flex; flex-wrap:wrap; align-items:center; justify-content:flex-end; gap:.75rem; }
.inbox {
  max-width: 800px;
}
.head {
  display: grid;
  gap: var(--space-4);
}
.head h1 {
  margin: 0;
}
.head__title { padding-bottom: var(--space-2); }
.head .inbox__eyebrow {
  margin: 0 0 var(--space-2);
  color: var(--accent-400);
  font-size: .7rem;
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
