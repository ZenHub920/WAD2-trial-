<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api.js';
import { fetchChatUpdates } from '../chatPages.js';
import { onChatEvent, refreshUnread } from '../chatLive.js';
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
async function loadOlder() {
  if (!historyPage.value?.nextCursor || loadingHistory.value) return;
  loadingHistory.value = true;
  const height = list.value?.scrollHeight ?? 0;
  const top = list.value?.scrollTop ?? 0;
  try {
    const { channel: older } = await api.groupChannel(props.id, { before: historyPage.value.nextCursor });
    const known = new Set(channel.value.messages.map((m) => m.id));
    channel.value.messages = [...older.messages.filter((m) => !known.has(m.id)), ...channel.value.messages];
    historyPage.value = older.page;
    await nextTick();
    if (list.value) list.value.scrollTop = top + list.value.scrollHeight - height;
  } catch { actionError.value = 'Could not load older messages.'; }
  finally { loadingHistory.value = false; }
}
const loading = ref(true);
const error = ref(null);
const draft = ref('');
const sending = ref(false);
const actionError = ref('');
const showMembers = ref(false);
const candidates = ref([]);
const addingId = ref('');
const confirmingLeave = ref(false);
const leaving = ref(false);
const list = ref(null);

const isHost = computed(() => Boolean(channel.value?.isHost));

async function scrollToEnd() {
  await nextTick();
  if (list.value) list.value.scrollTop = list.value.scrollHeight;
}

async function load({ quiet = false } = {}) {
  if (!quiet) loading.value = true;
  try {
    if (quiet && channel.value?.messages.length) {
      const updates = await fetchChatUpdates(async (options) => (await api.groupChannel(props.id, options)).channel, channel.value.messages.at(-1).id);
      const known = new Set(channel.value.messages.map((m) => m.id));
      channel.value.messages.push(...updates.filter((m) => !known.has(m.id)));
    }
    const latest = (await api.groupChannel(props.id)).channel;
    if (quiet && channel.value) {
      const known = new Set(latest.messages.map((m) => m.id));
      latest.messages = [...channel.value.messages.filter((m) => !known.has(m.id)), ...latest.messages];
    } else historyPage.value = latest.page;
    channel.value = latest;
    error.value = null;
    refreshUnread();
    if (!quiet) await scrollToEnd();
  } catch (err) {
    error.value = err;
  } finally {
    loading.value = false;
  }
}

async function loadCandidates() {
  if (!isHost.value) return;
  try {
    candidates.value = (await api.groupChannelCandidates(props.id)).candidates;
  } catch {
    candidates.value = [];
  }
}

async function send() {
  const body = draft.value.trim();
  if (!body || sending.value) return;
  sending.value = true;
  actionError.value = '';
  try {
    await api.sendGroupChannelMessage(props.id, body);
    draft.value = '';
    await load({ quiet: true });
    await scrollToEnd();
  } catch (err) {
    actionError.value = err.message === 'group_channel_not_found'
      ? 'You are no longer in this channel.'
      : 'Could not send that message.';
  } finally {
    sending.value = false;
  }
}

async function removeMessage(message) {
  try {
    await api.deleteGroupChannelMessage(props.id, message.id);
    await load({ quiet: true });
  } catch {
    actionError.value = 'Could not delete that message.';
  }
}

async function add(person) {
  addingId.value = person.id;
  actionError.value = '';
  try {
    await api.addToGroupChannel(props.id, person.id);
    await Promise.all([load({ quiet: true }), loadCandidates()]);
  } catch (err) {
    actionError.value = err.message === 'not_a_group_member'
      ? `${person.displayName} is not in this group.`
      : `Could not add ${person.displayName}.`;
  } finally {
    addingId.value = '';
  }
}

async function leave() {
  leaving.value = true;
  try {
    await api.leaveGroupChannel(props.id);
    confirmingLeave.value = false;
    refreshUnread();
    router.push({ path: '/messages', query: { tab: 'groups' } });
  } catch {
    actionError.value = 'Could not leave this channel.';
    confirmingLeave.value = false;
  } finally {
    leaving.value = false;
  }
}

function when(iso) {
  if (!iso) return '';
  const date = new Date(iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit' });
}

let stopListening = null;
onMounted(() => {
  stopListening = onChatEvent((type, data) => {
    if (type !== 'ready' && (!['group-message', 'group-members'].includes(type) || data.partyId !== props.id)) return;
    load({ quiet: true });
    if (isHost.value && (type === 'ready' || type === 'group-members')) loadCandidates();
  });
  load().then(loadCandidates);
});
onUnmounted(() => stopListening?.());
</script>

<template>
  <div class="container section channel">
    <p v-if="loading" class="loading-state" role="status"><LoadingSpinner />Loading channel…</p>

    <div v-else-if="error" class="notice notice--error" role="alert">
      <h2>This channel is not open to you</h2>
      <p>
        {{ error.status === 404
          ? 'You are not in this group channel. The group host decides who is added.'
          : 'Could not load this channel.' }}
      </p>
      <RouterLink class="btn btn--ghost" :to="{ path: '/messages', query: { tab: 'groups' } }">Back to messages</RouterLink>
    </div>

    <template v-else-if="channel">
      <header class="channel__head">
        <div class="channel__id">
          <RouterLink class="channel__back" :to="{ path: '/messages', query: { tab: 'groups' } }" aria-label="Back to messages">←</RouterLink>
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

      <p v-if="actionError" class="notice notice--error" role="alert">{{ actionError }}</p>

      <section v-if="showMembers" class="members card">
        <h2>In this channel</h2>
        <ul class="members__list">
          <li v-for="person in channel.members" :key="person.id">
            <UserAvatar :src="person.avatarUrl" :name="person.displayName" :size="32" />
            <span>{{ person.displayName }}</span>
            <span v-if="person.isHost" class="members__tag">Host</span>
          </li>
        </ul>

        <!-- Only the host adds, and only from people the group already accepted. -->
        <template v-if="isHost">
          <h2>Add from your group</h2>
          <p v-if="!candidates.length" class="members__hint">
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
.channel { max-width: 800px; display: grid; gap: var(--space-4); }
.channel__head { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: var(--space-3); }
.channel__id { display: flex; align-items: center; gap: var(--space-3); min-width: 0; }
.channel__back { font-size: var(--step-1); text-decoration: none; color: var(--text-200); }
.channel__head h1 { margin: 0; font-size: var(--step-2); }
.channel__sub { margin: 0; color: var(--text-300); font-size: var(--step--1); }
.channel__tools { display: flex; gap: var(--space-2); flex-wrap: wrap; }

.members { padding: var(--space-4); display: grid; gap: var(--space-3); }
.members h2 { margin: 0; font-size: var(--step-0); }
.members__hint { color: var(--text-300); font-size: var(--step--1); }
.members__list { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--space-2); }
.members__list li { display: flex; align-items: center; gap: var(--space-3); min-width: 0; }
.members__list li > span { min-width: 0; overflow-wrap: anywhere; }
.members__tag { padding: 1px var(--space-2); border-radius: var(--radius-pill); background: var(--ink-700); color: var(--text-300); font-size: var(--step--2); }
.members__add { margin-left: auto; padding: var(--space-1) var(--space-4); }

.stream { display: grid; gap: var(--space-3); max-height: 56vh; overflow-y: auto; padding: var(--space-2); }
.empty { color: var(--text-300); text-align: center; padding-block: var(--space-6); }

.msg { display: flex; align-items: flex-end; gap: var(--space-2); max-width: 80%; }
.msg--mine { margin-left: auto; flex-direction: row-reverse; }
.msg__body { display: grid; gap: 2px; padding: var(--space-3) var(--space-4); border-radius: var(--radius-lg); background: var(--ink-800); border: var(--border-hairline); min-width: 0; }
.msg--mine .msg__body { background: var(--accent-500); border-color: var(--accent-500); color: #fff; }
.msg__who { font-size: var(--step--2); font-weight: 700; color: var(--accent-400); }
.msg__text { margin: 0; overflow-wrap: anywhere; white-space: pre-wrap; }
.msg__text--gone { font-style: italic; opacity: .7; }
.msg__time { display: flex; align-items: center; gap: var(--space-2); font-size: var(--step--2); color: var(--text-400); }
.msg--mine .msg__time { color: rgba(255, 255, 255, .75); justify-content: flex-end; }
.msg__delete { background: none; color: inherit; text-decoration: underline; font-size: var(--step--2); }

.composer { display: flex; gap: var(--space-3); }
.composer__input { flex: 1; min-width: 0; padding: var(--space-3) var(--space-4); border: var(--border-soft); border-radius: var(--radius-pill); background: var(--ink-800); color: var(--text-100); }
.composer__input:focus { outline: none; border-color: var(--accent-500); box-shadow: 0 0 0 3px var(--accent-glow); }
</style>
