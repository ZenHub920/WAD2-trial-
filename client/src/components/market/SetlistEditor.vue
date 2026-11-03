<script setup>
/**
 * Where an operator types the running order. Only operators ever see it.
 *
 * One song per line, because that is how a setlist is copied from anywhere
 * else — a poster, a message, another site. A Spotify link may follow the
 * title after a pipe, and is optional, so an order can go up the moment it is
 * known and the links can be filled in later.
 *
 * The server validates the links again and refuses anything that is not a
 * Spotify track, so the preview below is a convenience, not the gate.
 */
import { computed, ref, watch } from 'vue';
import { api } from '../../api.js';
import LoadingSpinner from '../LoadingSpinner.vue';

const props = defineProps({
  concertId: { type: String, required: true },
  setlist: { type: Object, default: null },
});
const emit = defineEmits(['saved']);

const open = ref(false);
const saving = ref(false);
const error = ref('');
const notice = ref('');
const status = ref('announced');
const text = ref('');

/** Fill the box from whatever is stored, so editing starts from the truth. */
watch(() => props.setlist, (value) => {
  status.value = value?.status ?? 'announced';
  text.value = (value?.tracks ?? [])
    .map((track) => (track.spotifyUrl ? `${track.title} | ${track.spotifyUrl}` : track.title))
    .join('\n');
}, { immediate: true });

/** Parsed the same way the request will be built, so the count is honest. */
const parsed = computed(() => text.value
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => {
    const at = line.lastIndexOf('|');
    if (at === -1) return { title: line, spotify: '' };
    return { title: line.slice(0, at).trim(), spotify: line.slice(at + 1).trim() };
  })
  .filter((track) => track.title));

const linked = computed(() => parsed.value.filter((track) => track.spotify).length);

async function save() {
  saving.value = true;
  error.value = '';
  notice.value = '';
  try {
    const result = await api.saveConcertSetlist(props.concertId, {
      status: status.value,
      tracks: parsed.value,
    });
    emit('saved', result.setlist);
    notice.value = 'Setlist saved.';
  } catch (err) {
    error.value = err?.body?.error === 'invalid_spotify_link'
      ? 'One of the links is not a Spotify track. Use the Share → Copy link on a song.'
      : err?.body?.error === 'invalid_track_title'
        ? 'One of the lines has no song title.'
        : 'Could not save the setlist. Please try again.';
  } finally {
    saving.value = false;
  }
}

async function clear() {
  saving.value = true;
  error.value = '';
  try {
    await api.clearConcertSetlist(props.concertId);
    emit('saved', null);
    text.value = '';
    notice.value = 'Setlist removed.';
  } catch {
    error.value = 'Could not remove the setlist. Please try again.';
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <section class="editor card" aria-labelledby="setlist-editor-title">
    <header class="editor__head">
      <div>
        <h2 id="setlist-editor-title">Setlist · operator</h2>
        <p class="group-muted editor__hint">
          Only operators see this. Setlists are entered by hand because running orders change.
        </p>
      </div>
      <button type="button" class="btn btn--ghost" @click="open = !open">
        {{ open ? 'Close' : (setlist ? 'Edit setlist' : 'Add setlist') }}
      </button>
    </header>

    <form v-if="open" class="editor__form" @submit.prevent="save">
      <label class="editor__field">
        <span>How certain is this order?</span>
        <select v-model="status" :disabled="saving">
          <option value="rumoured">Rumoured — from earlier dates</option>
          <option value="announced">Announced</option>
          <option value="played">As played</option>
        </select>
      </label>

      <label class="editor__field">
        <span>One song per line. Add a Spotify link after a <code>|</code> if you have it.</span>
        <textarea
          v-model="text"
          rows="10"
          :disabled="saving"
          spellcheck="false"
          placeholder="Beautiful Things | https://open.spotify.com/track/...&#10;Ghost Town&#10;Encore | spotify:track:..."
        />
      </label>

      <p class="group-muted editor__count">
        {{ parsed.length }} songs · {{ linked }} with a link
      </p>

      <p v-if="error" class="group-error" role="alert">{{ error }}</p>
      <p v-if="notice" class="group-success" role="status">{{ notice }}</p>

      <div class="editor__actions">
        <button class="btn btn--primary" :disabled="saving">
          <LoadingSpinner v-if="saving" />{{ saving ? 'Saving…' : 'Save setlist' }}
        </button>
        <button
          v-if="setlist"
          type="button"
          class="btn btn--ghost"
          :disabled="saving"
          @click="clear"
        >
          Remove setlist
        </button>
      </div>
    </form>
  </section>
</template>

<style scoped>
.editor { display: grid; gap: var(--space-3); }
.editor__head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-3); flex-wrap: wrap; }
.editor__head h2 { margin: 0; font-size: var(--step-1); }
.editor__hint { margin: 4px 0 0; font-size: var(--step--1); max-width: 60ch; }
.editor__form { display: grid; gap: var(--space-3); }
.editor__field { display: grid; gap: var(--space-2); font-size: var(--step--1); }
.editor__field textarea { width: 100%; min-height: 200px; font-family: var(--font-mono, monospace); font-size: var(--step--1); line-height: 1.6; resize: vertical; }
.editor__count { font-size: var(--step--1); }
.editor__actions { display: flex; gap: var(--space-2); flex-wrap: wrap; }
.editor__actions .btn { min-height: 44px; }
@media (max-width: 600px) {
  .editor__head { flex-direction: column; align-items: stretch; }
}
</style>
