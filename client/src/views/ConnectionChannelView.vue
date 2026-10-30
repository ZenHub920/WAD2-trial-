<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api.js';
import { currentUser } from '../auth.js';
import { fetchChatUpdates } from '../chatPages.js';
import { applyConnectionMessageUpdate } from '../connectionChatMessages.js';
import { connectionState, onChatEvent, refreshUnread } from '../chatLive.js';
import UserAvatar from '../components/UserAvatar.vue';
import GroupAvatar from '../components/GroupAvatar.vue';
import LoadingSpinner from '../components/LoadingSpinner.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';

const props = defineProps({ id: { type: String, required: true } });
const router = useRouter();
const channel = ref(null), loading = ref(true), error = ref(''), unavailable = ref(false);
const historyPage = ref(null), loadingHistory = ref(false);
const draft = ref(''), sending = ref(false), editing = ref(null), replyingTo = ref(null);
const deleting = ref(null), deleteBusy = ref(false), showMembers = ref(false), showSettings = ref(false);
const backgroundPending = ref(''), list = ref(null), composer = ref(null);
const backgrounds = ['default', 'dusk', 'neon', 'paper', 'forest', 'mono'];
const background = computed(() => backgrounds.includes(channel.value?.background) ? channel.value.background : 'default');
const context = () => `${props.id}:${currentUser.value?.id ?? ''}`;
let loadRequest = 0, active = true, stopListening, fallbackTimer, reading = false;

function valid(key) { return active && context() === key; }
function visible() { return document.visibilityState === 'visible'; }
function mergeMessages(...groups) {
  return [...new Map(groups.flat().map(message => [message.id, message])).values()].sort((a, b) => a.seq - b.seq);
}
function handleError(err, fallback) {
  if ([401, 403, 404].includes(err.status)) {
    channel.value = null;
    historyPage.value = null;
    unavailable.value = true;
    error.value = 'This shared chat is unavailable. You need to be a current member of either connected group.';
  } else error.value = fallback;
}
async function scrollToEnd() {
  await nextTick();
  if (list.value) list.value.scrollTop = list.value.scrollHeight;
}
function nearBottom() {
  return !list.value || list.value.scrollHeight - list.value.scrollTop - list.value.clientHeight < 120;
}
async function acknowledgeRead() {
  if (!channel.value || !visible() || reading) return;
  reading = true;
  const key = context(), id = props.id;
  try {
    await api.readConnectionChannel(id);
    if (valid(key)) refreshUnread();
  } catch { /* Opening the room again retries the read acknowledgement. */ }
  finally { reading = false; }
}
async function load({ quiet = false, resetHistory = false } = {}) {
  // GET opens/marks the room read; hidden tabs wait until the user returns.
  if (!visible()) return;
  const key = context(), id = props.id, request = ++loadRequest;
  if (!quiet) loading.value = true;
  const atBottom = nearBottom();
  try {
    let updates = [];
    if (quiet && !resetHistory && channel.value?.messages.length) {
      updates = await fetchChatUpdates(async options => (await api.connectionChannel(id, options)).channel, channel.value.messages.at(-1).id);
    }
    const latest = (await api.connectionChannel(id)).channel;
    if (!valid(key) || request !== loadRequest) return;
    if (quiet && !resetHistory && channel.value) latest.messages = mergeMessages(channel.value.messages, updates, latest.messages);
    else historyPage.value = latest.page;
    channel.value = latest;
    unavailable.value = false;
    error.value = '';
    refreshUnread();
    if (!quiet || atBottom) await scrollToEnd();
    acknowledgeRead();
  } catch (err) {
    if (valid(key) && request === loadRequest) handleError(err, 'Could not refresh this shared chat. Please try again.');
  } finally {
    if (valid(key) && request === loadRequest) loading.value = false;
  }
}
async function loadOlder() {
  if (!channel.value || !historyPage.value?.nextCursor || loadingHistory.value) return;
  const key = context(), id = props.id, cursor = historyPage.value.nextCursor;
  const height = list.value?.scrollHeight ?? 0, top = list.value?.scrollTop ?? 0;
  loadingHistory.value = true;
  try {
    const { channel: older } = await api.connectionChannel(id, { before: cursor });
    if (!valid(key) || !channel.value) return;
    channel.value.messages = mergeMessages(older.messages, channel.value.messages);
    historyPage.value = older.page;
    await nextTick();
    if (list.value) list.value.scrollTop = top + list.value.scrollHeight - height;
  } catch (err) {
    if (valid(key)) handleError(err, 'Could not load older messages. Please try again.');
  } finally { if (valid(key)) loadingHistory.value = false; }
}
function applyMessage(message, options) {
  if (!channel.value) return;
  channel.value.messages = applyConnectionMessageUpdate(channel.value.messages, message, options);
  if (replyingTo.value?.id === message.id) replyingTo.value = message.deleted ? null : message;
  if (editing.value?.id === message.id) {
    if (message.deleted) cancelComposer();
    else editing.value = message;
  }
}
async function send() {
  const body = draft.value.trim();
  if (!body || sending.value || !channel.value) return;
  const key = context(), id = props.id;
  sending.value = true;
  error.value = '';
  try {
    const { message } = editing.value
      ? await api.editConnectionChannelMessage(id, editing.value.id, body)
      : await api.sendConnectionChannelMessage(id, body, replyingTo.value?.id ?? null);
    if (!valid(key)) return;
    applyMessage(message);
    cancelComposer();
    refreshUnread();
    await scrollToEnd();
  } catch (err) {
    if (valid(key)) handleError(err, 'Message not saved. Your draft is unchanged; please try again.');
  } finally { if (valid(key)) sending.value = false; }
}
function startReply(message) {
  if (sending.value || message.deleted) return;
  replyingTo.value = message;
  editing.value = null;
  nextTick(() => composer.value?.focus());
}
function startEdit(message) {
  if (sending.value || !message.mine || message.deleted) return;
  editing.value = message;
  replyingTo.value = null;
  draft.value = message.body;
  nextTick(() => composer.value?.focus());
}
function cancelComposer() { editing.value = null; replyingTo.value = null; draft.value = ''; }
async function removeMessage() {
  if (!deleting.value || deleteBusy.value) return;
  const key = context(), id = props.id, messageId = deleting.value.id;
  deleteBusy.value = true;
  try {
    await api.deleteConnectionChannelMessage(id, messageId);
    const { message } = await api.connectionChannelMessage(id, messageId);
    if (!valid(key)) return;
    applyMessage(message);
    deleting.value = null;
  } catch (err) {
    if (valid(key)) handleError(err, 'Could not delete this message. Please try again.');
  } finally { if (valid(key)) deleteBusy.value = false; }
}
async function chooseBackground(name) {
  if (!channel.value || backgroundPending.value) return;
  const key = context(), id = props.id;
  backgroundPending.value = name;
  try {
    await api.setConnectionChannelBackground(id, name);
    if (valid(key) && channel.value) channel.value.background = name;
  } catch (err) {
    if (valid(key)) handleError(err, 'Could not save your chat background. Please try again.');
  } finally { if (valid(key)) backgroundPending.value = ''; }
}
function when(value) {
  if (typeof value !== 'string') return '';
  const date = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
  return Number.isFinite(date.getTime()) ? date.toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit' }) : '';
}
function readBy(message) { return (message.readBy ?? []).filter(person => person.id !== currentUser.value?.id); }
function groupFor(person) {
  return person.partyId === channel.value?.partyA.id ? channel.value.partyA.name : channel.value?.partyB.name;
}
async function handleEvent(type, data) {
  if (!visible()) return;
  if (type === 'ready') { await load({ quiet: true, resetHistory: true }); return; }
  if (data.connectionId !== props.id) return;
  if (type === 'connection-members') { await load({ quiet: true, resetHistory: true }); return; }
  if (type === 'connection-read') {
    if (!channel.value || data.readerId === currentUser.value?.id) return;
    const person = channel.value.members.find(member => member.id === data.readerId);
    if (!person) return;
    for (const message of channel.value.messages) {
      if (message.mine && message.seq <= data.lastReadSeq && !(message.readBy ?? []).some(reader => reader.id === person.id)) {
        message.readBy = [...(message.readBy ?? []), { id: person.id, displayName: person.displayName }];
      }
    }
    return;
  }
  if (type !== 'connection-message' || !data.messageId) return;
  const key = context(), id = props.id, atBottom = nearBottom();
  try {
    const { message } = await api.connectionChannelMessage(id, data.messageId);
    if (!valid(key) || !channel.value) return;
    // A change to earlier, unloaded history does not pull that history into view.
    const includeOriginal = !channel.value.messages.length || message.seq >= channel.value.messages[0].seq;
    applyMessage(message, { includeOriginal });
    if (atBottom) await scrollToEnd();
    acknowledgeRead();
  } catch (err) {
    if (valid(key)) handleError(err, 'Could not refresh this message. Refresh the chat to try again.');
  }
}
function onVisibility() { if (visible()) load({ quiet: Boolean(channel.value), resetHistory: true }); }
watch([() => props.id, () => currentUser.value?.id], () => {
  loadRequest++;
  channel.value = null; historyPage.value = null; unavailable.value = false; error.value = '';
  loading.value = true; loadingHistory.value = false; sending.value = false; deleteBusy.value = false;
  deleting.value = null; showMembers.value = false; showSettings.value = false; backgroundPending.value = '';
  cancelComposer();
  if (currentUser.value) load();
});
onMounted(() => {
  stopListening = onChatEvent(handleEvent);
  document.addEventListener('visibilitychange', onVisibility);
  fallbackTimer = window.setInterval(() => {
    if (connectionState.value !== 'live' && visible() && !unavailable.value) load({ quiet: Boolean(channel.value) });
  }, 8000);
  load();
});
onUnmounted(() => {
  active = false;
  stopListening?.();
  window.clearInterval(fallbackTimer);
  document.removeEventListener('visibilitychange', onVisibility);
});
</script>

<template>
  <div class="container section connection-channel">
    <p v-if="loading" class="loading-state" role="status"><LoadingSpinner />Loading shared chat…</p>
    <p v-if="error" class="notice notice--error" role="alert">{{ error }}</p>
    <template v-if="!loading && channel">
      <header class="channel-head">
        <RouterLink :to="{ path: '/messages', query: { tab: 'groups' } }" class="channel-back" aria-label="Back to group messages">←</RouterLink>
        <GroupAvatar :name="channel.name" :size="44" />
        <div class="channel-identity"><p class="channel-label">Connected groups</p><h1>{{ channel.name }}</h1><p>{{ channel.concert.artist }} · {{ channel.members.length }} members</p></div>
        <div class="channel-tools"><button type="button" class="btn btn--ghost" :aria-expanded="showMembers" @click="showMembers = !showMembers">Members</button><button type="button" class="btn btn--ghost" :aria-expanded="showSettings" @click="showSettings = !showSettings">Chat options</button><button type="button" class="btn btn--primary" @click="router.push({ path: '/meetups', query: { connectionId: id } })">Plan meetup</button></div>
      </header>
      <p class="channel-hint">Current members of {{ channel.partyA.name }} and {{ channel.partyB.name }} share this room.</p>
      <section v-if="showMembers" class="card channel-panel" aria-label="Shared chat members"><h2>Shared chat members</h2><ul class="members"><li v-for="person in channel.members" :key="person.id"><UserAvatar :src="person.avatarUrl" :name="person.displayName" :size="32" /><div><strong>{{ person.displayName }}{{ person.isHost ? ' · Host' : '' }}</strong><small>{{ groupFor(person) }}</small></div></li></ul><p class="channel-hint">The member list updates when either group’s membership changes.</p></section>
      <section v-if="showSettings" class="card channel-panel" aria-label="Shared chat options"><h2>Your chat background</h2><p class="channel-hint">This changes the background for you.</p><div class="swatches"><button v-for="name in backgrounds" :key="name" type="button" class="swatch" :data-bg="name" :aria-pressed="background === name" :disabled="Boolean(backgroundPending)" @click="chooseBackground(name)"><LoadingSpinner v-if="backgroundPending === name" />{{ name }}</button></div><RouterLink to="/profile#notifications">Message and meetup notification preferences</RouterLink></section>
      <div ref="list" class="stream" :data-bg="background" aria-label="Shared chat messages" tabindex="0">
        <button v-if="historyPage?.nextCursor" type="button" class="btn btn--ghost older" :disabled="loadingHistory" @click="loadOlder">{{ loadingHistory ? 'Loading…' : 'Load older messages' }}</button>
        <p v-if="!channel.messages.length" class="empty">No messages yet. Say hello to both groups.</p>
        <article v-for="message in channel.messages" :key="message.id" class="message" :class="{ 'message--mine': message.mine }">
          <UserAvatar v-if="!message.mine" :src="message.sender.avatarUrl" :name="message.sender.displayName" :size="30" />
          <div class="message-body"><strong v-if="!message.mine" class="message-name">{{ message.sender.displayName }}</strong><blockquote v-if="message.replyTo && !message.deleted" class="message-quote">{{ message.replyTo.deleted ? 'Message deleted' : message.replyTo.body }}</blockquote><p class="message-text" :class="{ 'message-text--deleted': message.deleted }">{{ message.deleted ? 'Message deleted' : message.body }}</p><span class="message-meta">{{ when(message.createdAt) }}<span v-if="message.editedAt && !message.deleted"> · Edited</span><span v-if="message.mine && !message.deleted" :title="readBy(message).map(person => person.displayName).join(', ')"> · {{ readBy(message).length ? `Read by ${readBy(message).length}` : 'Sent' }}</span></span><div v-if="!message.deleted" class="message-actions"><button type="button" :disabled="sending" @click="startReply(message)">Reply</button><button v-if="message.mine" type="button" :disabled="sending" @click="startEdit(message)">Edit</button><button v-if="message.mine" type="button" :disabled="deleteBusy" @click="deleting = message">Delete</button></div></div>
        </article>
      </div>
      <form class="composer" @submit.prevent="send"><div v-if="editing || replyingTo" class="composer-context"><span>{{ editing ? 'Editing your message' : `Replying to ${replyingTo.sender.displayName}` }}<small>{{ editing?.body ?? replyingTo?.body }}</small></span><button type="button" :disabled="sending" aria-label="Cancel editing or reply" @click="cancelComposer">×</button></div><div class="composer-row"><input ref="composer" v-model="draft" :disabled="sending" maxlength="2000" aria-label="Message both groups" placeholder="Message both groups…" /><button type="submit" class="btn btn--primary" :disabled="sending || !draft.trim()"><LoadingSpinner v-if="sending" />{{ editing ? 'Save edit' : 'Send' }}</button></div></form>
    </template>
    <div v-else-if="!loading" class="channel-panel"><h1>Shared chat unavailable</h1><RouterLink :to="{ path: '/messages', query: { tab: 'groups' } }" class="btn btn--ghost">Back to group messages</RouterLink></div>
    <button v-if="!loading && error && !unavailable" type="button" class="btn btn--ghost" @click="load({ quiet: Boolean(channel) })">Refresh chat</button>
    <ConfirmDialog :open="Boolean(deleting)" title="Delete this message?" body="Both groups will see that the message was removed." confirm-label="Delete message" cancel-label="Keep message" danger :busy="deleteBusy" @confirm="removeMessage" @cancel="deleting = null" />
  </div>
</template>

<style scoped>
.connection-channel { max-width: 800px; display: grid; gap: var(--space-4); min-width: 0; }
.channel-head { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-3); }
.channel-back { color: var(--text-200); font-size: var(--step-1); text-decoration: none; }
.channel-identity { flex: 1 1 14rem; min-width: 0; overflow-wrap: anywhere; }
.channel-identity h1 { margin: 0; font-size: var(--step-1); }
.channel-identity p, .channel-hint { color: var(--text-300); font-size: var(--step--1); margin: 0; }
.channel-identity .channel-label { color: var(--accent-400); font-size: var(--step--2); }
.channel-tools, .swatches { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.channel-tools .btn { white-space: normal; }
.channel-panel { display: grid; gap: var(--space-3); padding: var(--space-4); }
.channel-panel h2 { font-size: var(--step-0); margin: 0; }
.members { display: grid; gap: var(--space-3); margin: 0; padding: 0; list-style: none; }
.members li { display: flex; align-items: center; gap: var(--space-3); min-width: 0; }
.members strong { font-size: var(--step--1); }
.members small { display: block; color: var(--text-300); }
.stream { display: grid; align-content: start; gap: var(--space-3); min-height: 16rem; max-height: 56vh; overflow-y: auto; padding: var(--space-4); border: var(--border-hairline); border-radius: var(--radius-md); }
.stream:focus-visible { outline: 2px solid var(--accent-400); outline-offset: 3px; }
.stream[data-bg='default'], .swatch[data-bg='default'] { background: var(--ink-900); }
.stream[data-bg='dusk'], .swatch[data-bg='dusk'] { background: linear-gradient(180deg, #1a1130, #0b0a14); }
.stream[data-bg='neon'], .swatch[data-bg='neon'] { background: radial-gradient(120% 80% at 50% 0%, #2a0a3d, #07060d); }
.stream[data-bg='paper'], .swatch[data-bg='paper'] { background: #efe9dd; }
.stream[data-bg='forest'], .swatch[data-bg='forest'] { background: linear-gradient(180deg, #0d1f18, #060d0a); }
.stream[data-bg='mono'], .swatch[data-bg='mono'] { background: #101010; }
.stream:is([data-bg='dusk'],[data-bg='neon'],[data-bg='forest'],[data-bg='mono']) .empty { color: #e3ddeb; }
.stream[data-bg='paper'] .empty { color: #5b5346; }
.swatch { min-height: 36px; padding: var(--space-2) var(--space-3); border: 2px solid var(--ink-600); border-radius: var(--radius-sm); color: #efeaff; cursor: pointer; text-transform: capitalize; }
.swatch[data-bg='default'] { color: var(--text-100); }
.swatch[data-bg='paper'] { color: #1a1a1a; }
.swatch[aria-pressed='true'] { outline: 2px solid var(--accent-400); outline-offset: 2px; }
.older { justify-self: center; background: var(--ink-800); white-space: normal; }
.empty { color: var(--text-300); text-align: center; padding-block: var(--space-5); }
.message { display: flex; align-items: flex-end; gap: var(--space-2); max-width: 86%; min-width: 0; }
.message--mine { margin-left: auto; }
.message-body { display: grid; gap: var(--space-1); padding: var(--space-3) var(--space-4); border-radius: var(--radius-lg); background: var(--ink-800); border: var(--border-hairline); min-width: 0; }
.message--mine .message-body { background: var(--accent-500); border-color: var(--accent-500); color: #fff; }
.message-name { color: var(--accent-400); font-size: var(--step--2); }
.message-text { margin: 0; overflow-wrap: anywhere; white-space: pre-wrap; }
.message-text--deleted { opacity: .7; font-style: italic; }
.message-meta { color: var(--text-300); font-size: var(--step--2); }
.message--mine .message-meta { color: rgba(255,255,255,.8); }
.message-quote { margin: 0 0 var(--space-1); padding-left: var(--space-2); border-left: 2px solid currentColor; font-size: var(--step--2); opacity: .85; white-space: pre-wrap; overflow-wrap: anywhere; }
.message-actions { display: flex; flex-wrap: wrap; gap: var(--space-3); }
.message-actions button { background: none; border: 0; color: inherit; padding: var(--space-1) 0; text-decoration: underline; font: inherit; font-size: var(--step--2); cursor: pointer; }
.composer { display: grid; gap: var(--space-2); }
.composer-row { display: flex; gap: var(--space-2); }
.composer-row input { flex: 1; min-width: 0; padding: var(--space-3) var(--space-4); border: var(--border-soft); border-radius: var(--radius-pill); background: var(--ink-800); color: var(--text-100); }
.composer-context { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); padding: var(--space-3); border-left: 3px solid var(--accent-400); background: var(--ink-800); font-size: var(--step--1); }
.composer-context > span { min-width: 0; }
.composer-context small { display: block; max-height: 3rem; overflow: hidden; overflow-wrap: anywhere; color: var(--text-300); }
.composer-context button { flex: none; border: 0; background: none; color: var(--text-200); font-size: var(--step-1); cursor: pointer; }
@media (max-width: 480px) { .stream { padding: var(--space-3); } .message { max-width: 95%; } }
</style>
