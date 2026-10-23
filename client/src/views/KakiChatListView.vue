<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api.js';
import { onChatEvent, refreshUnread } from '../chatLive.js';
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

async function loadChannels() {
  channelsLoading.value = true;
  try {
    channels.value = (await api.groupChannels()).channels;
    channelsError.value = null;
  } catch (err) {
    channelsError.value = err;
  } finally {
    channelsLoading.value = false;
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
  stopListening = onChatEvent(() => {
    load({ quiet: true });
    loadChannels();
    refreshUnread();
  });
  load();
  loadTickets();
  loadChannels();
  loadBlocked();
});
onUnmounted(() => stopListening?.());
</script>

<template>
  <div class="container section inbox">
    <header class="head">
      <h1>Messages</h1>
      <SegmentedTabs v-model="tab" :tabs="tabs" aria-label="Message type" />
    </header>

    <p v-if="actionError" class="notice notice--error" role="alert">{{ actionError }}</p>

    <section v-show="tab === 'companion'" class="inbox__section" aria-labelledby="companion-messages">
      <div class="section-head">
        <h2 id="companion-messages" class="sr-only">Companion messages</h2>
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
            <RouterLink :to="`/kaki/chat/${c.id}`" class="thread">
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
            </RouterLink>
          </li>
        </ul>
        <p v-else-if="!unstarted.length" class="empty">
          No companion conversations yet. <RouterLink to="/kaki">Find a companion</RouterLink> to get started.
        </p>
      </template>
    </section>

    <section v-show="tab === 'tickets'" class="inbox__section" aria-labelledby="ticket-messages">
      <h2 id="ticket-messages" class="sr-only">Ticket messages</h2>
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
          </RouterLink>
        </li>
      </ul>
      <p v-else class="empty">No ticket conversations yet. Message a seller from a listing in <RouterLink to="/concerts">Concerts</RouterLink>.</p>
    </section>

    <!-- Group channels. A room appears here only once its host has added you;
         being accepted into the group is not the same as being in its chat. -->
    <section v-show="tab === 'groups'" class="inbox__section" aria-labelledby="group-messages">
      <h2 id="group-messages" class="sr-only">Group messages</h2>
      <p v-if="channelsLoading" class="empty loading-state" role="status"><LoadingSpinner />Loading group channels…</p>
      <div v-else-if="channelsError" class="notice notice--error" role="alert">
        <p>{{ channelsError.status === 401 ? 'Sign in to see your group channels.' : 'Could not load group channels.' }}</p>
        <RouterLink v-if="channelsError.status === 401" :to="{ name: 'login', query: { redirect: '/messages' } }">Sign in</RouterLink>
        <button v-else class="btn btn--ghost" type="button" @click="loadChannels">Retry</button>
      </div>
      <ul v-else-if="channels.length" class="threads">
        <li v-for="channel in channels" :key="channel.partyId">
          <RouterLink :to="`/groups/${channel.partyId}/channel`" class="thread">
            <span class="thread__group" aria-hidden="true">{{ (channel.concert.artist || '?').slice(0, 1) }}</span>
            <span class="thread__text">
              <span class="thread__top">
                <strong class="thread__name">{{ channel.name }}</strong>
                <span class="thread__time">{{ when(channel.lastMessage?.createdAt) }}</span>
              </span>
              <span class="thread__preview" :class="{ 'thread__preview--muted': !channel.lastMessage }">
                {{ channel.lastMessage?.body ?? 'No messages yet' }}
              </span>
              <span class="thread__context">
                {{ channel.memberCount }} {{ channel.memberCount === 1 ? 'member' : 'members' }}{{ channel.isHost ? ' · you host this group' : '' }}
              </span>
            </span>
            <span v-if="channel.unread > 0" class="thread__unread" :aria-label="`${channel.unread} unread messages`">{{ channel.unread > 9 ? '9+' : channel.unread }}</span>
          </RouterLink>
        </li>
      </ul>
      <p v-else class="empty">
        No group channels yet. A group's host adds people to its channel from the members the group has accepted —
        <RouterLink to="/groups">find a group</RouterLink> to get started.
      </p>
    </section>
  </div>
</template>

<style scoped>
.inbox { max-width: 800px; }
.head { display: grid; gap: var(--space-4); }
.head h1 { margin: 0; }
.head p, .hint { color: var(--text-300); }
.inbox__section { margin-top: var(--space-5); min-width: 0; }
.inbox__section h2 { margin: 0; font-size: var(--step-1); }
.section-head { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: var(--space-3); }
.hint { margin: var(--space-2) 0 var(--space-4); font-size: var(--step--1); }
.blocked { margin-block: var(--space-4); padding: var(--space-4); border: var(--border-hairline); border-radius: var(--radius-md); background: var(--ink-850); }
.blocked h3, .fresh h3 { margin: 0 0 var(--space-3); font-size: var(--step-0); }
.blocked__list, .fresh__row, .threads { list-style: none; margin: 0; padding: 0; }
.blocked__list { display: grid; gap: var(--space-3); }
.blocked__list li { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); }
.blocked__list li span { min-width: 0; overflow-wrap: anywhere; }
.blocked__list button { flex-shrink: 0; }
.fresh { margin-block: var(--space-5); }
.fresh__row { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 15rem), 1fr)); gap: var(--space-3); }
.fresh__item { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-3); width: 100%; min-width: 0; border: var(--border-hairline); border-radius: var(--radius-md); background: var(--ink-850); color: var(--text-100); text-align: left; cursor: pointer; }
.fresh__text { display: grid; gap: var(--space-1); min-width: 0; overflow-wrap: anywhere; }
.fresh__text span { color: var(--text-300); font-size: var(--step--2); }
.threads { display: grid; }
.thread { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-4) var(--space-2); border-bottom: var(--border-hairline); color: inherit; text-decoration: none; }
.thread:hover { background: var(--ink-850); }
.thread__text { display: grid; gap: var(--space-1); flex: 1; min-width: 0; }
.thread__top { display: flex; align-items: baseline; justify-content: space-between; flex-wrap: wrap; gap: var(--space-1) var(--space-3); }
.thread__name { min-width: 0; overflow-wrap: anywhere; }
.thread__time { font-size: var(--step--2); color: var(--text-400); }
.thread__preview { font-size: var(--step--1); color: var(--text-300); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.thread__preview--muted { color: var(--text-400); font-style: italic; }
.thread__context { font-size: var(--step--2); color: var(--text-300); overflow-wrap: anywhere; }
.thread__unread { display: grid; place-items: center; min-width: 1.5rem; height: 1.5rem; padding-inline: .35em; flex-shrink: 0; border-radius: var(--radius-pill); background: var(--accent-600); color: #fff; font-size: var(--step--2); font-weight: 700; }
.empty { margin-block: var(--space-5); color: var(--text-300); }
.thread__group { display: grid; place-items: center; width: 44px; height: 44px; flex: none; border-radius: var(--radius-md); background: var(--accent-500); color: #fff; font-weight: 700; font-size: var(--step-0); }
</style>
