<script setup>
/**
 * Kaki chat thread.
 *
 * Shaped after the messaging in dating apps: a bubble column with your own
 * messages right-aligned in the accent colour, theirs left-aligned and muted,
 * day separators, a quoted-reply strip above the composer, and long-press /
 * hover actions on each bubble.
 *
 * Two behaviours borrowed deliberately:
 *   - A deleted message leaves a tombstone in place rather than vanishing, so
 *     the thread does not silently rewrite itself under the other person.
 *   - Report and Block live together behind one menu, because someone who
 *     needs one usually needs the other, and a harassment report applies the
 *     block for you.
 *
 * Live events update the thread, with a fallback refresh while disconnected.
 */

import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api.js';
import { onChatEvent, connectionState, refreshUnread } from '../chatLive.js';
import UserAvatar from '../components/UserAvatar.vue';

const props = defineProps({ id: { type: String, required: true } });
const router = useRouter();

const conversation = ref(null);
const messages = ref([]);
const backgrounds = ref(['default']);
const loading = ref(true);
const closed = ref(false);
const error = ref(null);

const draft = ref('');
const replyingTo = ref(null);
const editing = ref(null);
const openMenuId = ref(null);
const showSettings = ref(false);
const showReport = ref(false);
const reportCategory = ref('harassment');
const reportDetails = ref('');
const reportBusy = ref(false);
const notice = ref('');

const scroller = ref(null);
const composer = ref(null);
let stopListening = null;
/** Fallback refresh, used only when the live stream is not connected. */
let fallbackTimer = null;

/** Group by calendar day so the thread gets date separators. */
const grouped = computed(() => {
  const out = [];
  let lastDay = null;
  for (const m of messages.value) {
    const day = new Date(m.createdAt).toDateString();
    if (day !== lastDay) {
      out.push({ kind: 'day', id: `day-${day}`, label: dayLabel(m.createdAt) });
      lastDay = day;
    }
    out.push({ kind: 'message', ...m });
  }
  return out;
});

function dayLabel(iso) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' });
}

function clockTime(iso) {
  return new Date(iso).toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit' });
}

/** Supplied by the API rather than inferred, so it is correct on an empty thread. */
const myId = computed(() => conversation.value?.me ?? null);
const mine = (m) => m.senderId === myId.value;

async function load({ quiet = false } = {}) {
  if (!quiet) loading.value = true;
  try {
    const data = await api.kakiConversation(props.id);
    conversation.value = data.conversation;
    messages.value = data.messages;
    closed.value = false;
    error.value = null;
  } catch (err) {
    if (err.status === 403) {
      // Blocked, or the match was withdrawn. The server deliberately does not
      // say which, so neither does the interface.
      closed.value = true;
    } else if (err.status === 404) {
      error.value = 'This conversation no longer exists.';
    } else {
      error.value = err.message;
    }
  } finally {
    loading.value = false;
  }
}

async function send() {
  const body = draft.value.trim();
  if (!body) return;

  if (editing.value) {
    const target = editing.value;
    editing.value = null;
    draft.value = '';
    try {
      const { message } = await api.editKakiMessage(props.id, target.id, body);
      const index = messages.value.findIndex((m) => m.id === message.id);
      if (index !== -1) messages.value[index] = message;
    } catch (err) {
      error.value = err.message;
    }
    return;
  }

  const replyTo = replyingTo.value?.id ?? null;
  draft.value = '';
  replyingTo.value = null;
  try {
    const { message } = await api.sendKakiMessage(props.id, body, replyTo);
    // The live stream delivers this same message to us as well, and it can
    // arrive before this response does. Both paths must check, or the sender
    // sees their own message twice.
    if (!messages.value.some((m) => m.id === message.id)) messages.value.push(message);
    await scrollToEnd();
  } catch (err) {
    if (err.status === 403) closed.value = true;
    else error.value = err.message;
  }
}

function startReply(m) {
  if (m.deleted) return;
  replyingTo.value = m;
  editing.value = null;
  openMenuId.value = null;
  composer.value?.focus();
}

function startEdit(m) {
  editing.value = m;
  replyingTo.value = null;
  draft.value = m.body ?? '';
  openMenuId.value = null;
  nextTick(() => composer.value?.focus());
}

function cancelComposerState() {
  replyingTo.value = null;
  editing.value = null;
  draft.value = '';
}

async function remove(m) {
  openMenuId.value = null;
  // Destructive and not undoable, so it is confirmed rather than instant.
  if (!window.confirm('Delete this message? The other person will see that something was removed.')) return;
  try {
    const { message } = await api.deleteKakiMessage(props.id, m.id);
    const index = messages.value.findIndex((x) => x.id === message.id);
    if (index !== -1) messages.value[index] = message;
  } catch (err) {
    error.value = err.message;
  }
}

async function chooseBackground(name) {
  try {
    await api.setKakiBackground(props.id, name);
    conversation.value.background = name;
  } catch (err) {
    error.value = err.message;
  }
}

async function blockOther() {
  const name = conversation.value.other.displayName;
  if (!window.confirm(`Block ${name}? The conversation closes for both of you and they are not told.`)) return;
  try {
    await api.blockUser(conversation.value.other.id);
    router.push('/kaki/chat');
  } catch (err) {
    error.value = err.message;
  }
}

async function submitReport() {
  const details = reportDetails.value.trim();
  if (!details) return;
  reportBusy.value = true;
  try {
    const result = await api.reportUser(conversation.value.other.id, {
      category: reportCategory.value,
      details,
      conversationId: props.id,
    });
    showReport.value = false;
    reportDetails.value = '';
    notice.value = result.blocked
      ? 'Report sent, and this person is now blocked.'
      : 'Report sent. Our team will review it.';
    if (result.blocked) setTimeout(() => router.push('/kaki/chat'), 1600);
  } catch (err) {
    error.value = err.message;
  } finally {
    reportBusy.value = false;
  }
}

async function scrollToEnd() {
  await nextTick();
  const el = scroller.value;
  if (el) el.scrollTop = el.scrollHeight;
}

/** Coming back to the tab marks the thread read and resyncs. */
async function onVisibility() {
  if (document.visibilityState !== 'visible' || closed.value) return;
  await load({ quiet: true });
  acknowledgeRead();
}

/** Tell the server we have seen everything, so their ticks turn double. */
async function acknowledgeRead() {
  if (closed.value) return;
  try {
    await api.markKakiRead(props.id);
    await refreshUnread();
  } catch { /* a missed acknowledgement corrects itself on the next open */ }
}

/**
 * Live events. Only three matter here, and each is applied in place rather
 * than triggering a refetch — a full reload on every keystroke-speed message
 * would fight the scroll position and flicker the thread.
 */
function handleEvent(type, data) {
  if (data.conversationId && data.conversationId !== props.id) return;

  if (type === 'ready') {
    // Reconnected: the stream does not replay what was missed, so resync.
    load({ quiet: true });
    return;
  }

  if (type === 'message') {
    if (!messages.value.some((m) => m.id === data.message.id)) {
      messages.value.push(data.message);
      const atBottom = isNearBottom();
      if (atBottom) scrollToEnd();
      // Seeing a message while the tab is focused counts as reading it.
      if (document.visibilityState === 'visible' && data.message.senderId !== myId.value) {
        acknowledgeRead();
      }
    }
    return;
  }

  if (type === 'message-updated') {
    const index = messages.value.findIndex((m) => m.id === data.message.id);
    if (index !== -1) messages.value[index] = data.message;
    return;
  }

  if (type === 'read' && data.readerId !== myId.value) {
    // They read up to `lastReadSeq`: promote our own ticks to double.
    for (const m of messages.value) {
      if (m.senderId === myId.value && m.seq <= data.lastReadSeq) m.status = 'read';
    }
  }
}

/** Only auto-scroll when already at the bottom, so reading history is not yanked. */
function isNearBottom() {
  const el = scroller.value;
  if (!el) return true;
  return el.scrollHeight - el.scrollTop - el.clientHeight < 120;
}

onMounted(async () => {
  stopListening = onChatEvent(handleEvent);

  // Safety net for the case where SSE cannot connect at all (a proxy that
  // buffers, a corporate network). Idle while the stream is live, so the
  // normal path costs nothing.
  fallbackTimer = window.setInterval(() => {
    if (connectionState.value !== 'live'
      && document.visibilityState === 'visible'
      && !closed.value) {
      load({ quiet: true });
    }
  }, 8000);

  document.addEventListener('visibilitychange', onVisibility);
  await load();
  await scrollToEnd();
  acknowledgeRead();
  try {
    backgrounds.value = (await api.kakiChatBackgrounds()).backgrounds;
  } catch { /* the picker falls back to the default-only list */ }

});

onUnmounted(() => {
  stopListening?.();
  if (fallbackTimer) window.clearInterval(fallbackTimer);
  document.removeEventListener('visibilitychange', onVisibility);
});

watch(() => props.id, () => load());
</script>

<template>
  <div class="thread" :data-bg="conversation?.background ?? 'default'">
    <!-- ------------------------------------------------------------ header -->
    <header class="bar">
      <RouterLink to="/kaki/chat" class="bar__back" aria-label="Back to conversations">←</RouterLink>

      <div v-if="conversation" class="bar__who">
        <UserAvatar
          :src="conversation.other.avatarUrl"
          :name="conversation.other.displayName"
          :size="36"
        />
        <div>
          <p class="bar__name">{{ conversation.other.displayName }}</p>
          <p class="bar__sub">{{ conversation.concert.artist }}</p>
        </div>
      </div>
      <div v-else class="bar__who"><span class="bar__name">Conversation</span></div>
      <RouterLink v-if="conversation" :to="{path:'/meetups',query:{kakiConversationId:id}}">Plan meetup</RouterLink>

      <button
        class="bar__menu"
        type="button"
        aria-label="Conversation options"
        @click="showSettings = !showSettings"
      >⋯</button>

      <!-- Safety and appearance live in one menu: someone who needs to report
           usually needs to block, and burying either costs time.
           Teleported to body: the thread is a stacking context, so a dialog
           left inside it renders underneath the fixed site header no matter
           how high its z-index goes. -->
      <Teleport to="body">
      <div v-if="showSettings" class="sheet" @click.self="showSettings = false">
        <div class="sheet__panel">
          <h2 class="sheet__title">Chat options</h2>

          <section class="sheet__section">
            <h3 class="sheet__label">Background</h3>
            <div class="swatches">
              <button
                v-for="bg in backgrounds"
                :key="bg"
                type="button"
                class="swatch"
                :class="{ 'swatch--on': conversation?.background === bg }"
                :data-bg="bg"
                :aria-pressed="conversation?.background === bg"
                @click="chooseBackground(bg)"
              >{{ bg }}</button>
            </div>
          </section>

          <section class="sheet__section sheet__section--danger">
            <h3 class="sheet__label">Safety</h3>
            <button class="danger" type="button" @click="showSettings = false; showReport = true">
              Report {{ conversation?.other.displayName }}
            </button>
            <button class="danger" type="button" @click="blockOther">
              Block {{ conversation?.other.displayName }}
            </button>
          </section>

          <button class="sheet__close" type="button" @click="showSettings = false">Done</button>
        </div>
      </div>
      </Teleport>
    </header>

    <!-- ------------------------------------------------------------ states -->
    <p v-if="notice" class="notice notice--ok">{{ notice }}</p>
    <p v-if="error" class="notice notice--error">{{ error }}</p>

    <div v-if="loading" class="centered"><p>Loading…</p></div>

    <div v-else-if="closed" class="centered closed">
      <h2>This conversation is closed</h2>
      <RouterLink to="/kaki/chat" class="btn btn--ghost">Back to messages</RouterLink>
    </div>

    <!-- ----------------------------------------------------------- bubbles -->
    <div v-else ref="scroller" class="scroll">
      <p v-if="!messages.length" class="empty">
        Say hello to {{ conversation?.other.displayName }}.
      </p>

      <template v-for="row in grouped" :key="row.id">
        <p v-if="row.kind === 'day'" class="day">{{ row.label }}</p>

        <div
          v-else
          class="row"
          :class="{ 'row--mine': mine(row) }"
          @mouseleave="openMenuId === row.id && (openMenuId = null)"
        >
          <div class="bubble" :class="{ 'bubble--mine': mine(row), 'bubble--gone': row.deleted }">
            <!-- quoted reply -->
            <div v-if="row.replyTo" class="quote">
              <span class="quote__who">
                {{ row.replyTo.senderId === myId ? 'You' : conversation.other.displayName }}
              </span>
              <span class="quote__body">
                {{ row.replyTo.deleted ? 'Message deleted' : row.replyTo.body }}
              </span>
            </div>

            <p v-if="row.deleted" class="gone">Message deleted</p>
            <p v-else class="bubble__body">{{ row.body }}</p>

            <p class="meta">
              <span>{{ clockTime(row.createdAt) }}</span>
              <span v-if="row.edited" class="meta__edited">edited</span>
              <!-- Ticks appear only on your own messages. One = stored,
                   two = the other person has opened the thread past it. -->
              <span
                v-if="row.status && !row.deleted"
                class="ticks"
                :class="{ 'ticks--read': row.status === 'read' }"
                :title="row.status === 'read' ? 'Read' : 'Sent'"
              >
                <svg viewBox="0 0 20 12" aria-hidden="true">
                  <path d="M1 6.5 4.2 10 10.5 2" />
                  <path v-if="row.status === 'read'" d="M8 6.5 11.2 10 17.5 2" />
                </svg>
                <span class="sr-only">{{ row.status === 'read' ? 'Read' : 'Sent' }}</span>
              </span>
            </p>
          </div>

          <button
            v-if="!row.deleted"
            class="row__more"
            type="button"
            :aria-label="`Options for this message`"
            @click="openMenuId = openMenuId === row.id ? null : row.id"
          >⋯</button>

          <div v-if="openMenuId === row.id" class="popover" role="menu">
            <button type="button" @click="startReply(row)">Reply</button>
            <!-- Edit and delete appear only on your own messages. The server
                 enforces this too; hiding them is a courtesy, not the control. -->
            <template v-if="mine(row)">
              <button type="button" @click="startEdit(row)">Edit</button>
              <button type="button" class="popover__danger" @click="remove(row)">Delete</button>
            </template>
          </div>
        </div>
      </template>
    </div>

    <!-- ---------------------------------------------------------- composer -->
    <form v-if="!closed && !loading" class="composer" @submit.prevent="send">
      <div v-if="replyingTo || editing" class="context">
        <div class="context__text">
          <span class="context__label">{{ editing ? 'Editing' : 'Replying to' }}</span>
          <span class="context__body">{{ (editing ?? replyingTo).body }}</span>
        </div>
        <button type="button" class="context__x" aria-label="Cancel" @click="cancelComposerState">×</button>
      </div>

      <div class="composer__row">
        <textarea
          ref="composer"
          v-model="draft"
          class="composer__input"
          rows="1"
          maxlength="2000"
          :placeholder="editing ? 'Edit your message' : 'Message…'"
          @keydown.enter.exact.prevent="send"
        />
        <button class="composer__send" type="submit" :disabled="!draft.trim()" aria-label="Send">
          {{ editing ? '✓' : '↑' }}
        </button>
      </div>
    </form>

    <!-- ------------------------------------------------------------ report -->
    <Teleport to="body">
    <div v-if="showReport" class="sheet" @click.self="showReport = false">
      <div class="sheet__panel">
        <h2 class="sheet__title">Report {{ conversation?.other.displayName }}</h2>
        <p class="sheet__hint">
          Reports are private. Reporting harassment also blocks this person.
        </p>

        <label class="field">
          <span class="field__label">What happened</span>
          <select v-model="reportCategory" class="field__input">
            <option value="harassment">Harassment or abuse</option>
            <option value="misleading_profile">Misleading profile</option>
            <option value="spam">Spam or scam</option>
            <option value="other">Something else</option>
          </select>
        </label>

        <label class="field">
          <span class="field__label">Details</span>
          <textarea
            v-model="reportDetails"
            class="field__input"
            rows="4"
            maxlength="1000"
            placeholder="What happened? Messages from this chat will be included."
          />
        </label>

        <div class="sheet__actions">
          <button class="btn btn--ghost" type="button" @click="showReport = false">Cancel</button>
          <button
            class="btn btn--primary"
            type="button"
            :disabled="!reportDetails.trim() || reportBusy"
            @click="submitReport"
          >{{ reportBusy ? 'Sending…' : 'Send report' }}</button>
        </div>
      </div>
    </div>
    </Teleport>
  </div>
</template>

<style scoped>
.thread {
  display: grid;
  grid-template-rows: auto 1fr auto;
  height: calc(100dvh - var(--header-height));
  position: relative;
}

/* Backgrounds are a data attribute rather than inline style, so the set is
   closed and nothing user-supplied reaches CSS. */
.thread[data-bg='default'] { background: var(--ink-900); }
.thread[data-bg='dusk'] { background: linear-gradient(180deg, #1a1130, #0b0a14); }
.thread[data-bg='neon'] { background: radial-gradient(120% 80% at 50% 0%, #2a0a3d, #07060d); }
.thread[data-bg='paper'] { background: #efe9dd; }
.thread[data-bg='forest'] { background: linear-gradient(180deg, #0d1f18, #060d0a); }
.thread[data-bg='mono'] { background: #101010; }

.thread[data-bg='paper'] .bubble:not(.bubble--mine) { background: #fff; color: #1a1a1a; }
.thread[data-bg='paper'] .day,
.thread[data-bg='paper'] .empty { color: #5b5346; }

/* ------------------------------------------------------------------- bar */

.bar {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--gutter);
  border-bottom: var(--border-hairline);
  background: var(--glass-tint);
  backdrop-filter: var(--glass-blur);
  position: sticky;
  top: 0;
  z-index: 5;
}

.bar__back {
  font-size: var(--step-1);
  text-decoration: none;
  color: var(--text-200);
  padding: 0 var(--space-1);
}

.bar__who { display: flex; align-items: center; gap: var(--space-3); flex: 1; min-width: 0; }

.avatar {
  display: grid;
  place-items: center;
  width: 2.25rem;
  height: 2.25rem;
  border-radius: 50%;
  background: linear-gradient(145deg, var(--accent-400), var(--accent-600));
  color: #fff;
  font-weight: 600;
  flex-shrink: 0;
}

.bar__name { margin: 0; font-weight: 600; font-size: var(--step-0); }
.bar__sub { margin: 0; font-size: var(--step--2); color: var(--text-400); }

.bar__menu {
  border: 0;
  background: none;
  color: var(--text-300);
  font-size: var(--step-2);
  line-height: 1;
  cursor: pointer;
  padding: 0 var(--space-2);
}

/* --------------------------------------------------------------- bubbles */

.scroll {
  overflow-y: auto;
  padding: var(--space-5) var(--gutter) var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  scroll-behavior: smooth;
}

.day {
  align-self: center;
  margin: var(--space-4) 0 var(--space-2);
  padding: 2px var(--space-3);
  border-radius: var(--radius-pill);
  background: color-mix(in oklab, var(--ink-700) 70%, transparent);
  font-size: var(--step--2);
  color: var(--text-400);
}

.empty {
  margin: auto;
  max-width: 32ch;
  text-align: center;
  color: var(--text-400);
  font-size: var(--step--1);
}

.row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  position: relative;
  max-width: 78%;
}

.row--mine { align-self: flex-end; flex-direction: row-reverse; }

.bubble {
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-lg);
  background: var(--ink-750);
  color: var(--text-100);
  border-bottom-left-radius: var(--radius-sm);
  word-break: break-word;
}

.bubble--mine {
  background: linear-gradient(145deg, var(--accent-500), var(--accent-600));
  color: #fff;
  border-bottom-left-radius: var(--radius-lg);
  border-bottom-right-radius: var(--radius-sm);
}

.bubble--gone { background: transparent; border: 1px dashed var(--ink-500); }

.bubble__body { margin: 0; white-space: pre-wrap; }

.gone { margin: 0; font-style: italic; color: var(--text-400); font-size: var(--step--1); }

.quote {
  display: block;
  margin-bottom: var(--space-2);
  padding-left: var(--space-3);
  border-left: 3px solid color-mix(in oklab, currentColor 45%, transparent);
  opacity: 0.8;
  font-size: var(--step--2);
}

.quote__who { display: block; font-weight: 600; }
.quote__body { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 24ch; }

.meta {
  display: flex;
  gap: var(--space-2);
  justify-content: flex-end;
  margin: var(--space-1) 0 0;
  font-size: var(--step--2);
  opacity: 0.65;
}

.meta__edited { font-style: italic; }

/* Ticks sit in the bubble's own colour until they turn read, when they take
   a distinct accent — the colour change is what the eye catches, not the
   second stroke, which is small at this size. */
.ticks { display: inline-flex; align-items: center; }

.ticks svg {
  width: 1.05rem;
  height: 0.75rem;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.ticks--read {
  color: var(--cyan-400);
  opacity: 1;
}

.bubble--mine .ticks--read { color: #7ff0ff; }

.row__more {
  opacity: 0;
  border: 0;
  background: none;
  color: var(--text-400);
  cursor: pointer;
  font-size: var(--step-0);
  padding: 0 var(--space-1);
  transition: opacity var(--dur-fast) var(--ease-glide);
}

.row:hover .row__more,
.row__more:focus-visible { opacity: 1; }

.popover {
  position: absolute;
  top: 100%;
  z-index: 10;
  display: grid;
  min-width: 9rem;
  padding: var(--space-1);
  border-radius: var(--radius-md);
  border: var(--border-soft);
  background: var(--ink-800);
  box-shadow: var(--shadow-lg);
}

.row--mine .popover { right: 0; }

.popover button {
  text-align: left;
  padding: var(--space-2) var(--space-3);
  border: 0;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--text-200);
  font: inherit;
  cursor: pointer;
}

.popover button:hover { background: var(--ink-700); }
.popover__danger { color: var(--rose-400); }

/* -------------------------------------------------------------- composer */

.composer {
  padding: var(--space-3) var(--gutter) var(--space-4);
  border-top: var(--border-hairline);
  background: var(--glass-tint);
  backdrop-filter: var(--glass-blur);
}

.context {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-bottom: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border-left: 3px solid var(--accent-500);
  border-radius: var(--radius-sm);
  background: var(--ink-800);
}

.context__text { flex: 1; min-width: 0; display: grid; }
.context__label { font-size: var(--step--2); color: var(--accent-300); }
.context__body {
  font-size: var(--step--1);
  color: var(--text-300);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.context__x { border: 0; background: none; color: var(--text-400); font-size: var(--step-1); cursor: pointer; }

.composer__row { display: flex; align-items: flex-end; gap: var(--space-3); }

.composer__input {
  flex: 1;
  resize: none;
  max-height: 8rem;
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-xl);
  border: var(--border-soft);
  background: var(--ink-800);
  color: var(--text-100);
  font: inherit;
}

.composer__input:focus-visible { outline: 2px solid var(--accent-500); outline-offset: 1px; }

.composer__send {
  display: grid;
  place-items: center;
  width: 2.75rem;
  height: 2.75rem;
  border-radius: 50%;
  border: 0;
  background: var(--accent-500);
  color: #fff;
  font-size: var(--step-1);
  cursor: pointer;
  transition: transform var(--dur-fast) var(--ease-spring);
}

.composer__send:active:not(:disabled) { transform: scale(0.92); }
.composer__send:disabled { opacity: 0.4; cursor: not-allowed; }

/* ----------------------------------------------------------------- sheet */

.sheet {
  position: fixed;
  inset: 0;
  /* Above the site header, which is position:fixed at z-index 100 for signed-in
     users — at a lower value the navbar sits on top of the dialog. */
  z-index: 200;
  display: grid;
  place-items: center;
  padding: var(--gutter);
  background: rgba(4, 3, 8, 0.6);
  backdrop-filter: blur(8px);
}

.sheet__panel {
  width: min(28rem, 100%);
  max-height: 85vh;
  overflow-y: auto;
  padding: var(--space-6);
  border-radius: var(--radius-xl);
  border: var(--border-soft);
  background: var(--ink-800);
  box-shadow: var(--shadow-lg);
}

.sheet__title { margin: 0 0 var(--space-2); font-size: var(--step-2); }
.sheet__label { margin: 0 0 var(--space-3); font-size: var(--step--1); color: var(--text-300); }
.sheet__hint { margin: var(--space-2) 0 0; font-size: var(--step--2); color: var(--text-400); }
.sheet__section { padding-block: var(--space-4); border-top: var(--border-hairline); }
.sheet__section--danger { display: grid; gap: var(--space-2); }

.swatches { display: flex; flex-wrap: wrap; gap: var(--space-2); }

.swatch {
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-md);
  border: 2px solid transparent;
  color: var(--text-200);
  font-size: var(--step--2);
  cursor: pointer;
  text-transform: capitalize;
}

/* Each swatch previews its own background, so its label needs a colour chosen
   against THAT background rather than the page's — in light mode the inherited
   text colour is near-black and disappears on the dark previews. */
.swatch[data-bg='default'] { background: var(--ink-900); color: var(--text-100); }
.swatch[data-bg='dusk'] { background: linear-gradient(180deg, #1a1130, #0b0a14); color: #efeaff; }
.swatch[data-bg='neon'] { background: radial-gradient(120% 80% at 50% 0%, #2a0a3d, #07060d); color: #ffd9f2; }
.swatch[data-bg='paper'] { background: #efe9dd; color: #1a1a1a; }
.swatch[data-bg='forest'] { background: linear-gradient(180deg, #0d1f18, #060d0a); color: #d8f0e4; }
.swatch[data-bg='mono'] { background: #101010; color: #f0f0f0; }

.swatch--on { border-color: var(--accent-500); }

.danger {
  padding: var(--space-3);
  border-radius: var(--radius-md);
  border: 1px solid color-mix(in oklab, var(--rose-400) 40%, transparent);
  background: color-mix(in oklab, var(--rose-400) 10%, transparent);
  color: var(--rose-400);
  font: inherit;
  cursor: pointer;
  text-align: left;
}

.sheet__close {
  width: 100%;
  margin-top: var(--space-4);
  padding: var(--space-3);
  border-radius: var(--radius-md);
  border: var(--border-soft);
  background: var(--ink-700);
  color: var(--text-100);
  font: inherit;
  cursor: pointer;
}

.sheet__actions { display: flex; gap: var(--space-3); justify-content: flex-end; margin-top: var(--space-4); }

.field { display: grid; gap: var(--space-2); margin-top: var(--space-4); }
.field__label { font-size: var(--step--1); color: var(--text-300); }
.field__input {
  padding: var(--space-3);
  border-radius: var(--radius-md);
  border: var(--border-soft);
  background: var(--ink-700);
  color: var(--text-100);
  font: inherit;
}

.centered { display: grid; place-content: center; gap: var(--space-3); text-align: center; padding: var(--space-8); }

.notice--ok {
  margin: var(--space-3) var(--gutter) 0;
  padding: var(--space-3);
  border-radius: var(--radius-md);
  background: color-mix(in oklab, var(--mint-400) 14%, transparent);
  color: var(--mint-400);
}

@media (max-width: 560px) {
  .row { max-width: 88%; }
}
</style>
