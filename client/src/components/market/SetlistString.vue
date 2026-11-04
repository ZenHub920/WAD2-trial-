<script setup>
/**
 * The rhythm string: the whole setlist drawn as one line of bars.
 *
 * WHAT IT IS AND IS NOT
 * ---------------------
 * It is NOT an audio visualiser, and it does not pretend to be one. The
 * previews play inside a cross-origin Spotify frame, and a page cannot read a
 * single sample out of one — the Web Audio API can only analyse audio from its
 * own origin. A line that bounced along to music it cannot hear would be a
 * decoration dressed up as a measurement, and it would keep bouncing with the
 * audio paused.
 *
 * So the string measures something it genuinely knows: the setlist. Each song
 * gets a silhouette derived from its own title, which means the shape is
 * distinct per song, identical every time that song is drawn, and different
 * for every concert. The song currently showing in the reel rises and lights
 * in the artist's colour; the rest sit low. Pressing a segment jumps to it, so
 * the string is a way of moving through the setlist rather than an ornament.
 *
 * Drawn as SVG rather than canvas: a few dozen bars is nothing to the renderer,
 * each one can be a real button for a keyboard and a screen reader, and it
 * scales without a resize observer or a devicePixelRatio dance.
 */
import { computed } from 'vue';

const props = defineProps({
  tracks: { type: Array, default: () => [] },
  /** Index of the song the reel is showing. */
  activeIndex: { type: Number, default: 0 },
  /** From the concert's palette; falls back to the app's own accent. */
  accent: { type: String, default: 'var(--mint-400)' },
  muted: { type: String, default: 'var(--ink-600)' },
  /** Lifts the active segment further while a preview is actually playing. */
  playing: { type: Boolean, default: false },
});
const emit = defineEmits(['select']);

/** Bars per song: enough to read as a phrase, few enough to stay crisp. */
const PER_TRACK = 6;

/** FNV-1a again, so a title always draws the same shape. */
function hash(text) {
  let value = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value;
}

/**
 * Five heights for one song, pulled from successive bytes of its hash.
 * Kept to the upper half of the range so no song reads as silence.
 */
function silhouette(title, index) {
  const seed = hash(`${index}:${title}`);
  return Array.from({ length: PER_TRACK }, (_, i) => {
    const byte = (seed >>> (i * 5)) & 0x1f; // 0–31
    return 0.35 + (byte / 31) * 0.65; // 0.35–1.0
  });
}

const segments = computed(() => props.tracks.map((track, index) => ({
  id: track.id ?? index,
  title: track.title,
  index,
  hasPreview: Boolean(track.embedUrl),
  bars: silhouette(track.title ?? '', index),
})));

/** One flat list, so the row is a single flex container at any track count. */
const bars = computed(() => segments.value.flatMap((segment) =>
  segment.bars.map((level, i) => ({
    key: `${segment.id}:${i}`,
    level,
    nth: i,
    track: segment.index,
  }))));
</script>

<template>
  <div v-if="segments.length" class="string" :style="{ '--accent': accent, '--muted': muted }">
    <div class="string__bars" aria-hidden="true">
      <span
        v-for="bar in bars"
        :key="bar.key"
        :class="['string__bar', { 'string__bar--on': bar.track === activeIndex }]"
        :style="{
          height: `${Math.round(bar.level * (bar.track === activeIndex ? (playing ? 100 : 84) : 26))}%`,
          '--i': bar.nth,
        }"
      />
    </div>

    <!-- The same segments again as real buttons: the drawing is decoration,
         this is what a keyboard and a screen reader actually use. -->
    <div class="string__hits" role="tablist" aria-label="Setlist">
      <button
        v-for="segment in segments"
        :key="segment.id"
        type="button"
        role="tab"
        class="string__hit"
        :aria-selected="segment.index === activeIndex"
        :aria-label="`${segment.index + 1}. ${segment.title}${segment.hasPreview ? ', has a preview' : ''}`"
        @click="emit('select', segment.index)"
      />
    </div>
  </div>
</template>

<style scoped>
.string {
  position: relative;
  width: 100%;
  height: 48px;
  margin-bottom: var(--space-3);
}

/* Fixed-width bars, spread across whatever width the card gives us. The row
   is centred vertically so a quiet song reads as low rather than as missing. */
.string__bars {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 100%;
  gap: 2px;
}

.string__bar {
  flex: 1 1 0;
  min-width: 2px;
  max-width: 4px;
  border-radius: var(--radius-pill);
  background: var(--muted);
  opacity: 0.5;
  transform-origin: center;
  transition:
    height var(--dur-slow) var(--ease-settle),
    background-color var(--dur-base) var(--ease-out),
    opacity var(--dur-base) var(--ease-out);
}

.string__bar--on {
  background: var(--accent);
  opacity: 1;
  /* A slow breath, staggered along the segment, so the lit song reads as the
     live one without implying it is following the audio. */
  animation: string-breathe 2.4s var(--ease-settle) infinite;
  animation-delay: calc(var(--i) * 90ms);
}

@keyframes string-breathe {
  0%, 100% { transform: scaleY(1); }
  50% { transform: scaleY(0.78); }
}

/* One hit area per song, laid over the drawing in the same proportions. */
.string__hits { position: absolute; inset: 0; display: flex; }
.string__hit {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
  border-radius: var(--radius-sm);
}
.string__hit:hover { background: color-mix(in oklab, var(--accent) 12%, transparent); }
.string__hit:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

@media (prefers-reduced-motion: reduce) {
  .string__bar { transition: background-color var(--dur-base) var(--ease-out); animation: none; }
}
</style>
