<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import BackArrow from '../components/BackArrow.vue';
import { useRouter } from 'vue-router';
import { api } from '../api.js';
import MeetupEntryCard from '../components/MeetupEntryCard.vue';
import { fetchChatUpdates } from '../chatPages.js';
import { connectionState, onChatEvent, refreshUnread } from '../chatLive.js';
import { currentUser } from '../auth.js';
import UserAvatar from '../components/UserAvatar.vue';
import LoadingSpinner from '../components/LoadingSpinner.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';

/**
 * One group's shared room.
 *
 * Who may be here is the server's business and it is re-checked on every
 * request, so a 404 is the normal answer for somebody who has left or was
 * never added — not an error worth dressing up.
 */
const props = defineProps({ id: { type: String, required: true } });
const router = useRouter();

const channel = ref(null);
const historyPage = ref(null);
const loadingHistory = ref(false);
let active = true, loadRequest = 0, candidatesRequest = 0, scopeEpoch = 0, stopListening, fallbackTimer;
const context = () => `${props.id}:${currentUser.value?.id ?? ''}:${scopeEpoch}`;
const valid = key => active && context() === key;
const visible = () => document.visibilityState === 'visible';
const mergeMessages = (...groups) => [...new Map(groups.flat().map(message => [message.id, message])).values()]
  .sort((a, b) => a.seq - b.seq);
function denied(err) {
  if (![401, 403, 404].includes(err.status)) return false;
  channel.value = null;
  historyPage.value = null;
  candidates.value = [];
  error.value = err;
  return true;
}
async function loadOlder() {
  if (!channel.value || !historyPage.value?.nextCursor || loadingHistory.value) return;
  const key = context(), id = props.id, cursor = historyPage.value.nextCursor;
  loadingHistory.value = true;
  actionError.value = '';
  const height = list.value?.scrollHeight ?? 0;
  const top = list.value?.scrollTop ?? 0;
  try {
    const { channel: older } = await api.groupChannel(id, { before: cursor });
    if (!valid(key) || !channel.value) return;
    channel.value.messages = mergeMessages(older.messages, channel.value.messages);
    historyPage.value = older.page;
    await nextTick();
    if (valid(key) && list.value) list.value.scrollTop = top + list.value.scrollHeight - height;
  } catch (err) { if (valid(key) && !denied(err)) actionError.value = 'Could not load older messages. Please try again.'; }
  finally { if (valid(key)) loadingHistory.value = false; }
}
const loading = ref(true);
const error = ref(null);
const draft = ref('');
const sending = ref(false);
const actionError = ref('');
const refreshError = ref('');
const notice = ref('');
const showMembers = ref(false);
const candidates = ref([]);
const candidatesError = ref('');
const addingId = ref('');
const confirmingLeave = ref(false);
const leaving = ref(false);
const deletingId = ref('');
const list = ref(null);

const isHost = computed(() => Boolean(channel.value?.isHost));

async function scrollToEnd(key = context()) {
  await nextTick();
  if (valid(key) && list.value) list.value.scrollTop = list.value.scrollHeight;
}

async function load({ quiet = false, resetHistory = false } = {}) {
  if (!visible() || !currentUser.value) return;
  const key = context(), id = props.id, request = ++loadRequest;
  if (!quiet) loading.value = true;
  try {
    let updates = [];
    if (quiet && !resetHistory && channel.value?.messages.length) {
      updates = await fetchChatUpdates(async (options) => {
        if (!valid(key)) throw new Error('stale_channel_request');
        return (await api.groupChannel(id, options)).channel;
      }, channel.value.messages.at(-1).id);
    }
    if (!valid(key)) return;
    const latest = (await api.groupChannel(id)).channel;
    if (!valid(key) || request !== loadRequest) return;
    if (quiet && !resetHistory && channel.value) latest.messages = mergeMessages(channel.value.messages, updates, latest.messages);
    else historyPage.value = latest.page;
    channel.value = latest;
    error.value = null;
    refreshError.value = '';
    notice.value = '';
    refreshUnread();
    if (!quiet) await scrollToEnd();
    return true;
  } catch (err) {
    if (!valid(key) || request !== loadRequest) return;
    if (!denied(err)) {
      if (channel.value) refreshError.value = 'Could not refresh this channel. Your draft is unchanged; please try again.';
      else error.value = err;
    }
    return false;
  } finally {
    if (valid(key) && request === loadRequest) loading.value = false;
  }
}

async function loadCandidates() {
  if (!active || !isHost.value) return false;
  const key = context(), id = props.id, request = ++candidatesRequest;
  try {
    const result = await api.groupChannelCandidates(id);
    if (!valid(key) || request !== candidatesRequest) return false;
    candidates.value = result.candidates;
    candidatesError.value = '';
    return true;
  } catch (err) {
    if (valid(key) && request === candidatesRequest && !denied(err))
      candidatesError.value = 'Could not check who can be added. Please try again.';
    return false;
  }
}

async function send() {
  const body = draft.value.trim();
  if (!body || sending.value || !channel.value) return;
  const key = context(), id = props.id;
  sending.value = true;
  actionError.value = '';
  notice.value = '';
  try {
    const { message } = await api.sendGroupChannelMessage(id, body);
    if (!valid(key)) return;
    if (draft.value.trim() === body) draft.value = '';
    if (channel.value) channel.value.messages = mergeMessages(channel.value.messages, [message]);
    refreshUnread();
    if (await load({ quiet: true }) === false && valid(key)) notice.value = 'Your message was sent. Channel details could not refresh; refresh to see the latest changes.';
    if (valid(key)) await scrollToEnd();
  } catch (err) {
    if (!valid(key)) return;
    denied(err);
    actionError.value = err.message === 'group_channel_not_found'
      ? 'You are no longer in this channel.'
      : 'Could not send that message. Your draft is unchanged; please try again.';
  } finally {
    if (valid(key)) sending.value = false;
  }
}

async function removeMessage(message) {
  if (deletingId.value || !channel.value) return;
  const key = context(), id = props.id;
  deletingId.value = message.id;
  actionError.value = ''; notice.value = '';
  try {
    await api.deleteGroupChannelMessage(id, message.id);
    if (!valid(key)) return;
    if (channel.value) channel.value.messages = channel.value.messages.map(item => item.id === message.id ? { ...item, deleted: true, body: null } : item);
    if (await load({ quiet: true }) === false && valid(key)) notice.value = 'Your message was deleted. Channel details could not refresh; refresh to see the latest changes.';
  } catch (err) { if (valid(key) && !denied(err)) actionError.value = 'Could not delete that message. Please try again.'; }
  finally { if (valid(key)) deletingId.value = ''; }
}

async function add(person) {
  if (addingId.value || !isHost.value) return;
  const key = context(), id = props.id;
  addingId.value = person.id;
  actionError.value = '';
  notice.value = '';
  try {
    const result = await api.addToGroupChannel(id, person.id);
    if (!valid(key)) return;
    if (channel.value) channel.value.members = result.members;
    candidates.value = candidates.value.filter(item => item.id !== person.id);
    const reads = await Promise.all([load({ quiet: true }), loadCandidates()]);
    if (valid(key) && reads.some(ok => !ok)) notice.value = `${person.displayName} was added. Some channel details could not refresh; please refresh.`;
  } catch (err) {
    if (!valid(key)) return;
    denied(err);
    actionError.value = err.message === 'not_a_group_member'
      ? `${person.displayName} is not in this group.`
      : `Could not add ${person.displayName}.`;
  } finally {
    if (valid(key)) addingId.value = '';
  }
}

async function leave() {
  if (leaving.value || !channel.value) return;
  const key = context(), id = props.id;
  leaving.value = true;
  actionError.value = ''; notice.value = '';
  try {
    await api.leaveGroupChannel(id);
    if (!valid(key)) return;
    confirmingLeave.value = false;
    channel.value = null; historyPage.value = null; candidates.value = [];
    refreshUnread();
    notice.value = 'You left this channel. You are still in the concert group.';
  } catch (err) {
    if (!valid(key)) return;
    denied(err);
    actionError.value = 'Could not leave this channel.';
    confirmingLeave.value = false;
    return;
  } finally {
    if (valid(key)) leaving.value = false;
  }
  if (!valid(key)) return;
  try { await router.push({ path: '/messages', query: { tab: 'groups' } }); }
  catch { if (valid(key)) notice.value = 'You left this channel. Use Back to messages to return to your inbox.'; }
}

function when(iso) {
  if (!iso) return '';
  const date = new Date(iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit' });
}

function onVisibility() {
  if (visible()) load({ quiet: Boolean(channel.value), resetHistory: true }).then(loadCandidates);
}
watch([() => props.id, () => currentUser.value?.id], () => {
  scopeEpoch++;
  loadRequest++; candidatesRequest++;
  channel.value = null; historyPage.value = null; candidates.value = [];
  error.value = null; refreshError.value = ''; candidatesError.value = ''; actionError.value = ''; notice.value = '';
  draft.value = ''; loading.value = Boolean(currentUser.value); loadingHistory.value = false;
  sending.value = false; addingId.value = ''; deletingId.value = ''; leaving.value = false;
  confirmingLeave.value = false; showMembers.value = false;
  if (currentUser.value) load().then(loadCandidates);
});
onMounted(() => {
  stopListening = onChatEvent((type, data) => {
    if (type !== 'ready' && (!['group-message', 'group-members'].includes(type) || data.partyId !== props.id)) return;
    load({ quiet: true, resetHistory: type !== 'group-message' || !data.messageId }).then(() => {
      if (type === 'ready' || type === 'group-members') loadCandidates();
    });
  });
  document.addEventListener('visibilitychange', onVisibility);
  fallbackTimer = window.setInterval(() => {
    if (connectionState.value !== 'live' && visible() && channel.value && !error.value) load({ quiet: true });
  }, 8000);
  load().then(loadCandidates);
});
onUnmounted(() => {
  active = false;
  stopListening?.();
  window.clearInterval(fallbackTimer);
  document.removeEventListener('visibilitychange', onVisibility);
});
</script>

<template>
  <div class="container section channel">
    <p v-if="notice" class="notice" role="status">{{ notice }}</p>
    <p v-if="loading" class="loading-state" role="status"><LoadingSpinner />Loading channel…</p>

    <div v-else-if="error" class="notice notice--error" role="alert">
      <h2>{{ [401, 403, 404].includes(error.status) ? 'This channel is not open to you' : 'Could not load this channel' }}</h2>
      <p>
        {{ error.status === 404
          ? 'You are not in this group channel. The group host decides who is added.'
          : 'Could not load this channel.' }}
      </p>
      <RouterLink class="btn btn--ghost" :to="{ path: '/messages', query: { tab: 'groups' } }">Back to messages</RouterLink>
      <button v-if="![401, 403, 404].includes(error.status)" type="button" class="btn btn--ghost" @click="load().then(loadCandidates)">Retry loading channel</button>
    </div>

    <RouterLink v-if="!loading && !error && !channel" class="btn btn--ghost" :to="{ path: '/messages', query: { tab: 'groups' } }">Back to messages</RouterLink>

    <template v-else-if="channel">
      <header class="channel__head">
        <div class="channel__id">
          <BackArrow :to="{ path: '/messages', query: { tab: 'groups' } }" label="Back to messages" />
          <div>
            <h1>{{ channel.concert?.artist }} group</h1>
            <p class="channel__sub">{{ channel.members.length }} in this channel · {{ channel.concert?.venue }}</p>
          </div>
        </div>
        <div class="channel__tools">
          <button type="button" class="btn btn--ghost" :aria-expanded="showMembers" @click="showMembers = !showMembers">
            Members
          </button>
          <button v-if="!isHost" type="button" class="btn btn--ghost" @click="confirmingLeave = true">Leave</button>
        </div>
      </header>

      <MeetupEntryCard :scope="{ partyId: id }" label="Meetup planner for this group" />

      <p v-if="actionError" class="notice notice--error" role="alert">{{ actionError }}</p>
      <div v-if="refreshError" class="notice notice--error" role="alert">{{ refreshError }} <button type="button" class="btn btn--ghost" @click="load({ quiet: true, resetHistory: true })">Refresh channel</button></div>

      <section v-if="showMembers" class="members card">
        <h2>In this channel</h2>
        <ul class="members__list">
          <li v-for="person in channel.members" :key="person.id">
            <UserAvatar :src="person.avatarUrl" :name="person.displayName" :size="32" />
            <RouterLink :to="`/people/${encodeURIComponent(person.id)}`" :aria-label="`View ${person.displayName}'s concert vibe`">{{ person.displayName }}</RouterLink>
            <span v-if="person.isHost" class="members__tag">Host</span>
          </li>
        </ul>

        <!-- Only the host adds, and only from people the group already accepted. -->
        <template v-if="isHost">
          <h2>Add from your group</h2>
          <p v-if="candidatesError" class="notice notice--error" role="alert">{{ candidatesError }} <button type="button" class="btn btn--ghost" @click="loadCandidates">Retry member check</button></p>
          <p v-else-if="!candidates.length" class="members__hint">
            Everyone the group has accepted is already here. People appear once they join the group.
          </p>
          <ul v-else class="members__list">
            <li v-for="person in candidates" :key="person.id">
              <UserAvatar :src="person.avatarUrl" :name="person.displayName" :size="32" />
              <span>{{ person.displayName }}</span>
              <button type="button" class="btn btn--primary members__add" :disabled="addingId !== ''" @click="add(person)">
                <LoadingSpinner v-if="addingId === person.id" />Add
              </button>
            </li>
          </ul>
        </template>
      </section>

      <div ref="list" class="stream">
        <button v-if="historyPage?.nextCursor" class="btn btn--ghost" :disabled="loadingHistory" @click="loadOlder">{{ loadingHistory ? 'Loading…' : 'Load older messages' }}</button>
        <p v-if="!channel.messages.length" class="empty">
          No messages yet. Say hello to the group.
        </p>
        <article
          v-for="message in channel.messages"
          :key="message.id"
          class="msg"
          :class="{ 'msg--mine': message.mine }"
        >
          <UserAvatar v-if="!message.mine" :src="message.sender.avatarUrl" :name="message.sender.displayName" :size="30" />
          <div class="msg__body">
            <span v-if="!message.mine" class="msg__who">{{ message.sender.displayName }}</span>
            <p class="msg__text" :class="{ 'msg__text--gone': message.deleted }">
              {{ message.deleted ? 'Message deleted' : message.body }}
            </p>
            <span class="msg__time">
              {{ when(message.createdAt) }}
              <button
                v-if="message.mine && !message.deleted"
                type="button"
                class="msg__delete"
                :disabled="deletingId !== ''"
                @click="removeMessage(message)"
              >Delete</button>
            </span>
          </div>
        </article>
      </div>

      <form class="composer" @submit.prevent="send">
        <input
          v-model="draft"
          :disabled="sending"
          class="composer__input"
          :placeholder="`Message the ${channel.concert?.artist} group`"
          maxlength="2000"
          aria-label="Message the group"
        />
        <button type="submit" class="btn btn--primary" :disabled="sending || !draft.trim()">
          <LoadingSpinner v-if="sending" />Send
        </button>
      </form>
    </template>

    <ConfirmDialog
      :open="confirmingLeave"
      title="Leave this channel?"
      body="You will stop seeing these messages. You stay in the group itself, and the host can add you back."
      confirm-label="Leave channel"
      cancel-label="Stay"
      danger
      :busy="leaving"
      @confirm="leave"
      @cancel="confirmingLeave = false"
    />
  </div>
</template>

<style scoped>
.channel {
  max-width: 800px;
  display: grid;
  gap: var(--space-4);
}
.channel__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--space-3);
}
.channel__id {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-width: 0;
}
.channel__head h1 {
  margin: 0;
  font-size: var(--step-2);
}
.channel__sub {
  margin: 0;
  color: var(--text-300);
  font-size: var(--step--1);
}
.channel__tools {
  display: flex;
  gap: var(--space-2);
  flex-wrap: wrap;
}

.members {
  padding: var(--space-4);
  display: grid;
  gap: var(--space-3);
}
.members h2 {
  margin: 0;
  font-size: var(--step-0);
}
.members__hint {
  color: var(--text-300);
  font-size: var(--step--1);
}
.members__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--space-2);
}
.members__list li {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-width: 0;
}
.members__list li > span {
  min-width: 0;
  overflow-wrap: anywhere;
}
.members__tag {
  padding: 1px var(--space-2);
  border-radius: var(--radius-pill);
  background: var(--ink-700);
  color: var(--text-300);
  font-size: var(--step--2);
}
.members__add {
  margin-left: auto;
  padding: var(--space-1) var(--space-4);
}

.stream {
  display: grid;
  gap: var(--space-3);
  max-height: 56vh;
  overflow-y: auto;
  padding: var(--space-2);
}
.empty {
  color: var(--text-300);
  text-align: center;
  padding-block: var(--space-6);
}

.msg {
  display: flex;
  align-items: flex-end;
  gap: var(--space-2);
  max-width: 80%;
}
.msg--mine {
  margin-left: auto;
  flex-direction: row-reverse;
}
.msg__body {
  display: grid;
  gap: 2px;
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-lg);
  background: var(--ink-800);
  border: var(--border-hairline);
  min-width: 0;
}
.msg--mine .msg__body {
  background: var(--action-start);
  border-color: var(--action-start);
  color: var(--on-action);
}
.msg__who {
  font-size: var(--step--2);
  font-weight: 700;
  color: var(--accent-400);
}
.msg__text {
  margin: 0;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
.msg__text--gone {
  font-style: italic;
  opacity: .7;
}
.msg__time {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--step--2);
  color: var(--text-400);
}
.msg--mine .msg__time {
  color: var(--on-action);
  justify-content: flex-end;
}
.msg__delete {
  min-height: 2.75rem;
  min-width: 2.75rem;
  background: none;
  color: inherit;
  text-decoration: underline;
  font-size: var(--step--1);
}

.composer {
  display: flex;
  gap: var(--space-3);
}
.composer__input {
  flex: 1;
  min-width: 0;
  padding: var(--space-3) var(--space-4);
  border: var(--border-soft);
  border-radius: var(--radius-pill);
  background: var(--field-bg);
  color: var(--text-100);
}
.composer__input:focus {
  outline: none;
  border-color: var(--accent-500);
  box-shadow: 0 0 0 3px var(--accent-glow);
}
</style>
