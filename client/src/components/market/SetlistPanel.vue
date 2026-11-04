<script setup>
/**
 * The setlist, opened from the disc on a concert card.
 *
 * Only ONE Spotify frame is mounted at a time — the song currently chosen.
 * Twenty embedded players on one panel would mean twenty third-party frames,
 * each loading its own scripts, which is slow to open and heavy on anyone's
 * data. Skimming is exactly the behaviour that suits a single reused player:
 * pick a song, hear it, pick the next.
 *
 * Teleported to the body for the same reason ConfirmDialog is: the cards it
 * opens from are stacking contexts, so a panel left inside one renders beneath
 * the site header no matter how high its z-index goes.
 */
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import LoadingSpinner from '../LoadingSpinner.vue';

defineProps({
  artist: { type: String, required: true },
  setlist: { type: Object, default: null },
  loading: { type: Boolean, default: false },
  error: { type: String, default: '' },
});
const emit = defineEmits(['close']);

const playing = ref(null);
const dialog = ref(null);
const closeEl = ref(null);
let returnFocus = null;

/** How honest the heading is about this running order. */
const STATUS_TEXT = {
  rumoured: 'Rumoured — from earlier dates on this tour, so it may change',
  announced: 'Announced',
  played: 'As played',
};

function onKey(event) {
  if (event.key === 'Escape') emit('close');
}

onMounted(async () => {
  returnFocus = document.activeElement;
  document.addEventListener('keydown', onKey);
  await nextTick();
  closeEl.value?.focus();
});
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKey);
  if (returnFocus?.isConnected) returnFocus.focus();
});
</script>

<template>
  <Teleport to="body">
    <div class="sheet" @click.self="emit('close')">
      <section
        ref="dialog"
        class="sheet__panel"
        role="dialog"
        aria-modal="true"
        :aria-label="`Setlist for ${artist}`"
        tabindex="-1"
      >
        <header class="sheet__head">
          <div>
            <h2 class="sheet__title">{{ artist }}</h2>
            <p v-if="setlist" class="sheet__status">
              {{ STATUS_TEXT[setlist.status] ?? 'Announced' }}
            </p>
          </div>
          <button ref="closeEl" type="button" class="sheet__close" aria-label="Close setlist" @click="emit('close')">
            ×
          </button>
        </header>

        <p v-if="loading" class="loading-state" role="status"><LoadingSpinner />Loading the setlist…</p>
        <p v-else-if="error" class="group-error" role="alert">{{ error }}</p>
        <p v-else-if="!setlist?.tracks?.length" class="group-muted">
          No setlist has been added for this concert yet.
        </p>

        <template v-else>
          <p class="sheet__meta group-muted">
            {{ setlist.trackCount }} songs<template v-if="setlist.previewCount">
              · {{ setlist.previewCount }} with a preview</template>
          </p>

          <ol class="tracks">
            <li v-for="track in setlist.tracks" :key="track.id" class="track">
              <button
                v-if="track.embedUrl"
                type="button"
                class="track__row track__row--playable"
                :aria-pressed="playing === track.id"
                @click="playing = playing === track.id ? null : track.id"
              >
                <span class="track__no mono">{{ track.position }}</span>
                <span class="track__title">{{ track.title }}</span>
                <span class="track__cue" aria-hidden="true">{{ playing === track.id ? '▌▌' : '▶' }}</span>
              </button>
              <div v-else class="track__row track__row--quiet">
                <span class="track__no mono">{{ track.position }}</span>
                <span class="track__title">{{ track.title }}</span>
                <span class="track__cue track__cue--none" aria-hidden="true">—</span>
              </div>

              <!-- Mounted only while chosen, so one frame exists at a time. -->
              <iframe
                v-if="playing === track.id"
                class="track__player"
                :src="track.embedUrl"
                :title="`Spotify preview of ${track.title}`"
                height="152"
                loading="lazy"
                allow="encrypted-media; clipboard-write"
                referrerpolicy="no-referrer"
              />
            </li>
          </ol>

          <p v-if="setlist.previewCount < setlist.trackCount" class="sheet__note group-muted">
            Songs without a preview have not been linked yet.
          </p>
        </template>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.sheet {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: grid;
  place-items: center;
  padding: var(--space-4);
  background: rgba(8, 7, 12, 0.6);
  backdrop-filter: blur(3px);
}

.sheet__panel {
  width: min(560px, 100%);
  max-height: min(80vh, 720px);
  overflow-y: auto;
  display: grid;
  gap: var(--space-3);
  align-content: start;
  padding: var(--space-5);
  border: var(--border-soft);
  border-radius: var(--radius-lg, var(--radius-md));
  background: var(--ink-850);
  box-shadow: var(--shadow-lg);
}

.sheet__head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-3); }
.sheet__title { margin: 0; font-size: var(--step-2); }
.sheet__status { margin: 4px 0 0; color: var(--text-300); font-size: var(--step--1); }
.sheet__meta { font-size: var(--step--1); }
.sheet__note { font-size: var(--step--1); }

.sheet__close {
  flex: none;
  width: 40px;
  height: 40px;
  border: var(--border-soft);
  border-radius: 50%;
  background: var(--ink-800);
  color: var(--text-200);
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
}
.sheet__close:hover { border-color: var(--mint-400); }

.tracks { display: grid; gap: 2px; list-style: none; margin: 0; padding: 0; }
.track { display: grid; gap: var(--space-2); }

.track__row {
  display: grid;
  grid-template-columns: 2.2rem 1fr auto;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  min-height: 44px;
  padding: var(--space-2) var(--space-3);
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-200);
  font: inherit;
  text-align: left;
}

.track__row--playable { cursor: pointer; }
.track__row--playable:hover { background: var(--ink-800); }
.track__row--playable[aria-pressed='true'] { background: var(--ink-800); color: var(--mint-400); }
.track__row--quiet { color: var(--text-300); }

.track__no { color: var(--text-300); font-size: var(--step--1); }
.track__title { min-width: 0; }
.track__cue { color: var(--mint-400); font-size: var(--step--1); }
.track__cue--none { color: var(--text-300); }

/* Full bleed: the negative margin cancels the panel's own padding so the
   player reaches both edges instead of sitting in a frame of white. */
.track__player {
  display: block;
  width: calc(100% + var(--space-5) * 2);
  margin: 0 calc(var(--space-5) * -1);
  border: 0;
  border-radius: 0;
}

@media (max-width: 600px) {
  .track__player {
    width: calc(100% + var(--space-4) * 2);
    margin: 0 calc(var(--space-4) * -1);
  }
}

@media (max-width: 600px) {
  .sheet { padding: var(--space-2); }
  .sheet__panel { padding: var(--space-4); max-height: 88vh; }
}
</style>
