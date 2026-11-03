<script setup>
/**
 * The record in the corner of a concert card.
 *
 * It spins while the card is hovered and opens the setlist when pressed. The
 * setlist itself is only fetched on the first open — the card already knows
 * from the concert list whether one exists, so an unopened disc costs nothing.
 *
 * ON TOUCH there is no hover, so a disc that only spins on hover would sit
 * still and look like decoration on every phone. Below the hover breakpoint it
 * turns continuously instead, which is what tells someone it can be pressed.
 */
import { ref } from 'vue';
import { api } from '../../api.js';
import LoadingSpinner from '../LoadingSpinner.vue';
import SetlistPanel from './SetlistPanel.vue';

const props = defineProps({
  concertId: { type: String, required: true },
  artist: { type: String, required: true },
  /** The summary from the concert list: `null` when nothing has been entered. */
  summary: { type: Object, default: null },
});

const open = ref(false);
const setlist = ref(null);
const loading = ref(false);
const error = ref('');

async function openSetlist() {
  open.value = true;
  if (setlist.value || loading.value) return;
  loading.value = true;
  error.value = '';
  try {
    setlist.value = (await api.concertSetlist(props.concertId)).setlist;
  } catch {
    error.value = 'Could not load the setlist. Please try again.';
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <!-- No setlist, no disc: an empty panel is worse than no affordance. -->
  <button
    v-if="summary?.trackCount"
    type="button"
    class="disc"
    :aria-label="`Setlist for ${artist}, ${summary.trackCount} songs`"
    @click.stop.prevent="openSetlist"
  >
    <span class="disc__face" aria-hidden="true">
      <span class="disc__label" />
    </span>
    <span class="disc__count" aria-hidden="true">{{ summary.trackCount }}</span>
  </button>

  <SetlistPanel
    v-if="open"
    :artist="artist"
    :setlist="setlist"
    :loading="loading"
    :error="error"
    @close="open = false"
  />
</template>

<style scoped>
.disc {
  position: absolute;
  right: var(--space-2);
  bottom: var(--space-2);
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  cursor: pointer;
  /* Above the card's own link so the press opens the setlist, not the concert. */
  z-index: 2;
}

.disc__face {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  /* Grooves: repeating rings over a dark body, so it reads as vinyl at 36px. */
  background:
    repeating-radial-gradient(
      circle at 50% 50%,
      rgba(255, 255, 255, 0.14) 0 1px,
      transparent 1px 3px
    ),
    radial-gradient(circle at 30% 30%, #4a4458, #141019 70%);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.45);
  animation: disc-spin 2.6s linear infinite;
  animation-play-state: paused;
  transition: transform var(--dur-base) var(--ease-out), box-shadow var(--dur-base) var(--ease-out);
}

.disc__label {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--mint-500);
  box-shadow: inset 0 0 0 2px var(--ink-900, #141019);
}

.disc__count {
  position: absolute;
  right: 0;
  bottom: 0;
  min-width: 18px;
  height: 18px;
  padding: 0 4px;
  border-radius: var(--radius-pill);
  background: var(--mint-500);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  line-height: 18px;
  text-align: center;
}

:root[data-theme='dark'] .disc__count { color: #08070c; }

/* Hover belongs to the whole card, not the disc: the record answers when the
   concert is being looked at, which is what was asked for. */
:where(.spot, .concert-card, .card):hover .disc__face,
.disc:hover .disc__face,
.disc:focus-visible .disc__face {
  animation-play-state: running;
}

.disc:hover .disc__face,
.disc:focus-visible .disc__face {
  transform: scale(1.08);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.55);
}

@keyframes disc-spin {
  to { transform: rotate(360deg); }
}

/* No hover to depend on: keep it turning so it reads as something to press. */
@media (hover: none) {
  .disc__face { animation-play-state: running; }
}

@media (prefers-reduced-motion: reduce) {
  .disc__face {
    animation: none;
  }
  .disc:hover .disc__face,
  .disc:focus-visible .disc__face { transform: none; }
}
</style>
