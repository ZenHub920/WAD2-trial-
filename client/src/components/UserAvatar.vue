<script setup>
/**
 * A person's picture, or a grey silhouette when they have none.
 *
 * The fallback is deliberately a silhouette rather than an initial. An initial
 * reads as a placeholder waiting to be replaced; a silhouette reads as a
 * settled state, which is what "no picture" is here — optional means optional.
 *
 * A broken image URL falls back to the same silhouette rather than showing the
 * browser's broken-image glyph, because a deleted file on the server should
 * not look like a bug in the page.
 */

import { ref, computed, watch } from 'vue';

const props = defineProps({
  src: { type: String, default: null },
  name: { type: String, default: '' },
  size: { type: Number, default: 40 },
  /** Draws a ring, for unread threads and new matches. */
  ring: { type: Boolean, default: false },
});

const failed = ref(false);
watch(() => props.src, () => { failed.value = false; });

const showImage = computed(() => Boolean(props.src) && !failed.value);

const dimension = computed(() => `${props.size}px`);
</script>

<template>
  <span
    class="avatar"
    :class="{ 'avatar--ring': ring }"
    :style="{ width: dimension, height: dimension }"
  >
    <img
      v-if="showImage"
      :src="src"
      :alt="name ? `${name}'s profile picture` : 'Profile picture'"
      class="avatar__img"
      @error="failed = true"
    />
    <svg
      v-else
      class="avatar__fallback"
      viewBox="0 0 40 40"
      role="img"
      :aria-label="name ? `${name} has no profile picture` : 'No profile picture'"
    >
      <circle cx="20" cy="20" r="20" class="avatar__bg" />
      <circle cx="20" cy="15.5" r="6.4" class="avatar__person" />
      <path
        d="M6.6 36.5a13.8 13.8 0 0 1 26.8 0"
        class="avatar__person"
        transform="translate(0 0.5)"
      />
    </svg>
  </span>
</template>

<style scoped>
.avatar {
  display: inline-grid;
  place-items: center;
  border-radius: 50%;
  overflow: hidden;
  flex-shrink: 0;
  background: var(--ink-700);
  line-height: 0;
}

.avatar--ring {
  box-shadow: 0 0 0 2px var(--ink-900), 0 0 0 4px var(--accent-500);
}

.avatar__img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.avatar__fallback { width: 100%; height: 100%; display: block; }

.avatar__bg { fill: color-mix(in oklab, var(--text-400) 22%, transparent); }

/* The silhouette is a single flat grey: a figure, not a portrait, so it does
   not read as a real person with an unloaded photo. */
.avatar__person {
  fill: color-mix(in oklab, var(--text-400) 70%, transparent);
  stroke: color-mix(in oklab, var(--text-400) 70%, transparent);
  stroke-width: 0;
}
</style>
