<script setup>
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue';
import { api } from '../api.js';
import { fetchChatUpdates } from '../chatPages.js';
import { currentUser } from '../auth.js';
import { formatMoney } from '../market.js';
import MarketIcon from '../components/market/MarketIcon.vue';
import MarketNotice from '../components/market/MarketNotice.vue';
import MarketPageHead from '../components/market/MarketPageHead.vue';
import LoadingSpinner from '../components/LoadingSpinner.vue';

/**
 * One buyer–seller conversation. New messages arrive by polling: every few
 * seconds it asks only for messages newer than the last one it has, and it
 * stops asking while the tab is hidden.
 */
const props = defineProps({ id: { type: String, required: true } });

const POLL_MS = 4000;

const conversation = ref(null);
const messages = ref([]);
const historyPage = ref(null);
const loadingHistory = ref(false);
async function loadOlder() {
  if (!historyPage.value?.nextCursor || loadingHistory.value) return;
  loadingHistory.value = true;
  const height = listEl.value?.scrollHeight ?? 0;
  const top = listEl.value?.scrollTop ?? 0;
  try {
    const body = await api.conversation(props.id, null, { before: historyPage.value.nextCursor });
    const known = new Set(messages.value.map((m) => m.id));
    messages.value = [...body.messages.filter((m) => !known.has(m.id)), ...messages.value];
    historyPage.value = body.page;
    await nextTick();
    if (listEl.value) listEl.value.scrollTop = top + listEl.value.scrollHeight - height;
  } catch { sendError.value = 'Could not load older messages.'; }
  finally { loadingHistory.value = false; }
}
const loading = ref(true);
const error = ref(null);
const draft = ref('');
const sending = ref(false);
const sendError = ref('');
const listEl = ref(null);

const lastMessageId = computed(() => messages.value.at(-1)?.id ?? null);
const mine = (message) => message.senderId === currentUser.value?.id;

function append(incoming) {
  const known = new Set(messages.value.map((m) => m.id));
  const fresh = incoming.filter((m) => !known.has(m.id));
  if (!fresh.length) return;
  messages.value = [...messages.value, ...fresh];
  scrollToEnd();
}

async function scrollToEnd() {
  await nextTick();
  listEl.value?.scrollTo({ top: listEl.value.scrollHeight });
}

async function load() {
  loading.value = true;
  error.value = null;
  conversation.value = null;
  draft.value = '';
  sendError.value = '';
  messages.value = [];
  try {
    const body = await api.conversation(props.id);
    conversation.value = body.conversation;
    historyPage.value = body.page;
    append(body.messages);
  } catch (err) {
    error.value = err;
  } finally {
    loading.value = false;
  }
}

async function poll() {
  if (document.hidden || !conversation.value) return;
  try {
    append(await fetchChatUpdates((options) => api.conversation(props.id, null, options), lastMessageId.value));
  } catch {
    // A missed poll is harmless; the next one catches up.
  }
}

async function send() {
  const body = draft.value.trim();
  if (!body || sending.value) return;
  sending.value = true;
  sendError.value = '';
  try {
    const previousNewest = lastMessageId.value;
    const { message } = await api.sendMessage(props.id, body);
    draft.value = '';
    if (previousNewest) append(await fetchChatUpdates((options) => api.conversation(props.id, null, options), previousNewest));
    append([message]);
  } catch (err) {
    sendError.value = err.message === 'message_too_long'
      ? 'That message is too long (2,000 characters max).'
      : 'Message not sent. Please try again.';
  } finally {
    sending.value = false;
  }
}

/** Enter sends; Shift+Enter starts a new line. */
function onKeydown(event) {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    send();
  }
}

let timer;
onMounted(() => { timer = setInterval(poll, POLL_MS); });
onUnmounted(() => clearInterval(timer));
watch(() => props.id, load, { immediate: true });

function timeOf(value) {
  const date = new Date(`${value.replace(' ', 'T')}Z`);
  return date.toLocaleTimeString('en-SG', { hour: 'numeric', minute: '2-digit' });
}
</script>

<template>
  <div class="container chat">
    <MarketPageHead
      :title="conversation?.other.displayName ?? 'Ticket conversation'"
      :fallback="{ name: 'kaki-chat' }"
    />

    <p v-if="loading" class="loading-state" role="status"><LoadingSpinner />Loading conversation…</p>

    <MarketNotice v-else-if="error?.status === 401" title="Sign in to see this conversation">
      <RouterLink :to="{ name: 'login', query: { redirect: $route.fullPath } }">Sign in</RouterLink>
    </MarketNotice>

    <MarketNotice v-else-if="error?.status === 404" title="Conversation not found">
      <RouterLink :to="{ name: 'kaki-chat' }">Back to messages</RouterLink>
    </MarketNotice>

    <MarketNotice v-else-if="error" tone="error" title="Could not load this conversation">
      <p>Please refresh the page to try again.</p>
    </MarketNotice>

    <template v-else>
      <RouterLink
        :to="{ name: 'ticket-detail', params: { id: conversation.listing.id } }"
        class="about"
      >
        <span class="about__label">{{ conversation.role === 'buyer' ? 'Ticket enquiry' : 'Your listing' }}</span>
        <span class="about__title">{{ conversation.listing.title }}</span>
        <span class="about__price tabular">
          {{ formatMoney(conversation.listing.priceCents) }} listing total
        </span>
        <span v-if="conversation.listing.status !== 'active'" class="tag tag--rose">
          No longer listed
        </span>
      </RouterLink>

      <ol ref="listEl" class="messages" aria-live="polite" aria-label="Messages">
        <li v-if="historyPage?.nextCursor"><button class="btn btn--ghost" :disabled="loadingHistory" @click="loadOlder">{{ loadingHistory ? 'Loading…' : 'Load older messages' }}</button></li>
        <li v-if="!messages.length" class="messages__empty">
          {{ conversation.role === 'buyer'
            ? `Say hi to ${conversation.other.displayName}. Ask about the seats, transfer, or price.`
            : 'No messages yet.' }}
        </li>
        <li
          v-for="message in messages"
          :key="message.id"
          class="bubble"
          :class="{ 'bubble--mine': mine(message) }"
        >
          <p class="bubble__body">{{ message.body }}</p>
          <time class="bubble__time" :datetime="message.createdAt">{{ timeOf(message.createdAt) }}</time>
        </li>
      </ol>

      <form class="composer" @submit.prevent="send">
        <label for="chat-draft" class="sr-only">Message</label>
        <textarea
          id="chat-draft"
          v-model="draft"
          :disabled="sending"
          rows="1"
          maxlength="2000"
          placeholder="Write a message…"
          @keydown="onKeydown"
        />
        <button class="composer__send" type="submit" :disabled="sending || !draft.trim()" aria-label="Send">
          <LoadingSpinner v-if="sending" />
          <MarketIcon v-else name="send" :size="20" />
        </button>
      </form>
      <p v-if="sendError" class="composer__error" role="alert">{{ sendError }}</p>
    </template>
  </div>
</template>

<style scoped>
.chat {
  max-width: 680px;
  padding-block: var(--space-5) var(--space-9);
}

.about {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: start;
  gap: var(--space-1) var(--space-3);
  padding: var(--space-3) var(--space-4);
  border: var(--border-hairline);
  border-radius: var(--radius-md);
  background: var(--ink-800);
  color: inherit;
  text-decoration: none;
  font-size: var(--step--1);
}

.about:hover {
  border-color: var(--ink-500);
}

.about__label {
  grid-column: 1 / -1;
  color: var(--text-400);
}

.about__title {
  align-self: start;
  min-width: 0;
  color: var(--text-100);
  font-weight: 500;
  overflow-wrap: anywhere;
}

.about__price {
  color: var(--accent-400);
  font-weight: 600;
}

@media (max-width: 480px) {
  .about { grid-template-columns: minmax(0, 1fr); }
}

/* ---- Messages --------------------------------------------------------- */

.messages {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  height: min(60vh, 560px);
  margin-top: var(--space-4);
  padding: var(--space-4) var(--space-2);
  overflow-y: auto;
  list-style: none;
  overscroll-behavior: contain;
}

.messages__empty {
  margin: auto;
  max-width: 34ch;
  text-align: center;
  color: var(--text-400);
}

.bubble {
  max-width: 78%;
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-lg) var(--radius-lg) var(--radius-lg) var(--radius-sm);
  background: var(--ink-700);
  align-self: flex-start;
}

.bubble--mine {
  align-self: flex-end;
  border-radius: var(--radius-lg) var(--radius-lg) var(--radius-sm) var(--radius-lg);
  background: var(--accent-500);
  color: #fff;
}

.bubble__body {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.bubble__time {
  display: block;
  margin-top: 2px;
  font-size: var(--step--2);
  opacity: 0.7;
  text-align: right;
}

/* ---- Composer --------------------------------------------------------- */

.composer {
  display: flex;
  align-items: flex-end;
  gap: var(--space-2);
  padding: var(--space-2);
  border: var(--border-hairline);
  border-radius: var(--radius-lg);
  background: var(--ink-800);
}

.composer:focus-within {
  border-color: var(--accent-500);
}

.composer textarea {
  flex: 1;
  min-width: 0;
  min-height: 44px;
  max-height: 160px;
  padding: var(--space-2) var(--space-3);
  border: 0;
  background: transparent;
  color: var(--text-100);
  resize: vertical;
  outline: none;
  field-sizing: content;
}

.composer__send {
  flex: none;
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: var(--accent-500);
  color: #fff;
  transition: background var(--dur-fast) var(--ease-out);
}

.composer__send:hover:not(:disabled) {
  background: var(--accent-400);
}

.composer__send:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.composer__error {
  margin-top: var(--space-2);
  color: var(--rose-400);
  font-size: var(--step--1);
}

.skeleton {
  height: 480px;
}
</style>
