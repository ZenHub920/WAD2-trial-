<script setup>
/**
 * The setlist on the concert page: one song at a time, looping.
 *
 * WHY IT ROTATES BUT THE SOUND DOES NOT
 * -------------------------------------
 * Browsers refuse to start audio without a gesture, and they are right to.
 * So the card advances on its own while the player inside it stays silent
 * until somebody presses play — the rotation is a way to browse a long running
 * order in a small space, not a jukebox that starts talking at you.
 *
 * Rotation stops while the pointer is on the reel, and stops for good once a
 * song is actually played: a list that slides away mid-song would be the one
 * thing worse than not having it.
 */
import { computed, onUnmounted, ref, watch } from 'vue';

const props = defineProps({
  artist: { type: String, required: true },
  setlist: { type: Object, default: null },
});

/** Long enough to read a title and decide, short enough to feel alive. */
const STEP_MS = 4200;

const index = ref(0);
const hovered = ref(false);
const engaged = ref(false);
const playing = ref(false);

const tracks = computed(() => props.setlist?.tracks ?? []);
const current = computed(() => tracks.value[index.value] ?? null);
const paused = computed(() => hovered.value || engaged.value || tracks.value.length < 2);

let timer = null;
function start() {
  clearInterval(timer);
  timer = setInterval(() => {
    if (!paused.value) index.value = (index.value + 1) % tracks.value.length;
  }, STEP_MS);
}
watch(tracks, (list) => {
  if (index.value >= list.length) index.value = 0;
  start();
}, { immediate: true });
onUnmounted(() => clearInterval(timer));

function go(delta) {
  const count = tracks.value.length;
  if (!count) return;
  index.value = (index.value + delta + count) % count;
  playing.value = false;
  start();
}

/** Choosing a song from the string is the same move as pressing an arrow. */
function selectSong(next) {
  index.value = next;
  playing.value = false;
  engaged.value = true;
}

/** Pressing play mounts the frame and stops the reel moving for this visit. */
function play() {
  playing.value = true;
  engaged.value = true;
}

const STATUS_TEXT = {
  rumoured: 'Rumoured — from earlier dates on this tour, so it may change',
  announced: 'Announced',
  played: 'As played',
};
</script>

<template>
  <section v-if="tracks.length" class="reel card" aria-labelledby="setlist-title">
    <header class="reel__head">
      <div>
        <h2 id="setlist-title">Setlist</h2>
        <p class="group-muted reel__status">
          {{ STATUS_TEXT[setlist.status] ?? 'Announced' }} ·
          {{ setlist.trackCount }} songs<template v-if="setlist.previewCount">
            · {{ setlist.previewCount }} with a preview</template>
        </p>
      </div>
      <p v-if="paused && tracks.length > 1" class="reel__held group-muted">Paused</p>
    </header>

    <div
      class="reel__stage"
      @mouseenter="hovered = true"
      @mouseleave="hovered = false"
      @focusin="hovered = true"
      @focusout="hovered = false"
    >
      <button
        type="button"
        class="reel__arrow"
        aria-label="Previous song"
        :disabled="tracks.length < 2"
        @click="go(-1)"
      >‹</button>

      <Transition name="reel-card" mode="out-in">
        <article v-if="current" :key="current.id" class="reel__song">
          <p class="reel__position mono">{{ current.position }} of {{ tracks.length }}</p>
          <p class="reel__title">{{ current.title }}</p>

          <!-- One frame, mounted only after a press: see the note above. -->
          <iframe
            v-if="playing && current.embedUrl"
            class="reel__player"
            :src="current.embedUrl"
            :title="`Spotify preview of ${current.title}`"
            height="152"
            loading="lazy"
            allow="encrypted-media; clipboard-write"
            referrerpolicy="no-referrer"
          />
          <button
            v-else-if="current.embedUrl"
            type="button"
            class="btn btn--ghost reel__play"
            @click="play"
          >
            ▶ Preview
          </button>
          <p v-else class="group-muted reel__none">No preview linked for this song yet.</p>
        </article>
      </Transition>

      <button
        type="button"
        class="reel__arrow"
        aria-label="Next song"
        :disabled="tracks.length < 2"
        @click="go(1)"
      >›</button>
    </div>

    <!-- The whole running order, for anyone who would rather not wait for it
         to come round. Also what a screen reader reads as a list. -->
    <details class="reel__all">
      <summary>Show the whole setlist</summary>
      <ol class="reel__list">
        <li v-for="track in tracks" :key="track.id">
          <button
            type="button"
            class="reel__jump"
            :aria-current="track.id === current?.id ? 'true' : undefined"
            @click="selectSong(track.position - 1)"
          >
            <span class="mono">{{ track.position }}</span>
            <span>{{ track.title }}</span>
            <span v-if="track.embedUrl" class="reel__dot" aria-label="has a preview">♪</span>
          </button>
        </li>
      </ol>
    </details>
  </section>
</template>

<style scoped>
.reel { display: grid; gap: var(--space-4); }
.reel__head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-3); }
.reel__head h2 { margin: 0; }
.reel__status { margin: 4px 0 0; font-size: var(--step--1); }
.reel__held { margin: 0; font-size: var(--step--1); }

.reel__stage {
  display: grid;
  grid-template-columns: 44px 1fr 44px;
  align-items: center;
  gap: var(--space-3);
  min-height: 160px;
  padding: var(--space-4);
  /* Tinted by the concert's hue where the page has one. Border and glow only:
     the fill stays a theme surface, so light and dark mode both keep their
     own contrast rather than inheriting an artist's. */
  border: 1px solid color-mix(in oklab, var(--art-accent, var(--ink-600)) 32%, transparent);
  border-radius: var(--radius-md);
  background: var(--ink-850);
  box-shadow: inset 0 0 40px -24px var(--art-accent, transparent);
}

.reel__arrow {
  width: 44px;
  height: 44px;
  border: var(--border-soft);
  border-radius: 50%;
  background: var(--ink-800);
  color: var(--text-200);
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
}
.reel__arrow:hover:not(:disabled) { border-color: var(--mint-400); color: var(--mint-400); }
.reel__arrow:disabled { opacity: 0.4; cursor: not-allowed; }

.reel__song { display: grid; gap: var(--space-3); justify-items: stretch; text-align: center; min-width: 0; }
.reel__position { color: var(--text-300); font-size: var(--step--1); margin: 0; }
.reel__title { margin: 0; font-size: var(--step-2); font-weight: 600; line-height: 1.25; }
/* Fills the stage rather than floating in the middle of it. */
.reel__player { width: 100%; border: 0; border-radius: var(--radius-sm); }
.reel__play { min-height: 44px; }
.reel__none { font-size: var(--step--1); margin: 0; }

.reel__all > summary { cursor: pointer; font-size: var(--step--1); color: var(--text-300); min-height: 44px; display: flex; align-items: center; }
.reel__list { display: grid; gap: 2px; list-style: none; margin: var(--space-2) 0 0; padding: 0; }
.reel__jump {
  display: grid;
  grid-template-columns: 2.2rem 1fr auto;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  min-height: 40px;
  padding: var(--space-1) var(--space-3);
  border: 0;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-200);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.reel__jump:hover { background: var(--ink-800); }
.reel__jump[aria-current='true'] { background: var(--ink-800); color: var(--mint-400); }
.reel__dot { color: var(--mint-400); }

.reel-card-enter-active, .reel-card-leave-active {
  transition: opacity var(--dur-base) var(--ease-out), transform var(--dur-base) var(--ease-out);
}
.reel-card-enter-from { opacity: 0; transform: translateY(10px); }
.reel-card-leave-to { opacity: 0; transform: translateY(-10px); }

@media (prefers-reduced-motion: reduce) {
  .reel-card-enter-active, .reel-card-leave-active { transition: none; }
  .reel-card-enter-from, .reel-card-leave-to { transform: none; }
}

@media (max-width: 600px) {
  .reel__stage { grid-template-columns: 36px 1fr 36px; gap: var(--space-2); padding: var(--space-3); }
  .reel__arrow { width: 36px; height: 36px; }
  .reel__title { font-size: var(--step-1); }
}
</style>
