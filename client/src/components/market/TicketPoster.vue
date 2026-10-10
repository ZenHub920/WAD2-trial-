<script setup>
import { ref, computed, watch } from 'vue';
import { formatShortDate } from '../../api.js';
import { hueFor } from '../../market.js';

/**
 * The listing's image, or — when there is none, or it fails to load — a poster
 * generated from the concert, so a card never shows an empty box.
 */
const props = defineProps({
  listing: { type: Object, required: true },
  ratio: { type: String, default: '3 / 2' },
  compact: { type: Boolean, default: false },
});

const failed = ref(false);
watch(() => props.listing.imageUrl, () => { failed.value = false; });

const showImage = computed(() => props.listing.imageUrl && !failed.value);
const hue = computed(() => hueFor(props.listing.concert.id));
</script>

<template>
  <div class="poster" :class="{ 'poster--compact': compact }" :style="{ aspectRatio: ratio }">
    <img
      v-if="showImage"
      :src="listing.imageUrl"
      :alt="`${listing.concert.artist} poster`"
      loading="lazy"
      @error="failed = true"
    />
    <div v-else class="poster__art" :style="{ '--hue': hue }" aria-hidden="true">
      <p class="poster__artist">{{ listing.concert.artist }}</p>
      <p v-if="listing.concert.tourName" class="poster__tour">{{ listing.concert.tourName }}</p>
      <p class="poster__meta">
        {{ formatShortDate(listing.showDate ?? listing.concert.eventDate) }}
        · {{ listing.concert.venue }}
      </p>
    </div>
  </div>
</template>

<style scoped>
.poster {
  container-type: inline-size;
  position: relative;
  width: 100%;
  overflow: hidden;
  border-radius: var(--radius-sm);
  background: var(--ink-700);
}

.poster img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.poster__art {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  padding: var(--space-5);
  color: #fff;
  background:
    radial-gradient(120% 90% at 85% 10%, hsl(calc(var(--hue) + 50) 90% 62% / 0.85), transparent 55%),
    radial-gradient(90% 80% at 10% 100%, hsl(calc(var(--hue) - 30) 85% 45% / 0.9), transparent 60%),
    linear-gradient(140deg, hsl(var(--hue) 70% 32%), hsl(calc(var(--hue) + 25) 75% 18%));
}

.poster__artist {
  font-family: var(--font-display);
  font-weight: 700;
  /* Scale with the poster, not the page, so long names fit a narrow card. */
  font-size: min(var(--step-4), 10cqi);
  overflow-wrap: anywhere;
  line-height: 0.95;
  letter-spacing: -0.03em;
  text-transform: uppercase;
  text-wrap: balance;
}

.poster__tour {
  margin-top: var(--space-2);
  font-size: var(--step--1);
  font-weight: 500;
  opacity: 0.9;
}

.poster__meta {
  margin-top: var(--space-1);
  font-family: var(--font-mono);
  font-size: var(--step--2);
  letter-spacing: 0.04em;
  opacity: 0.75;
}

.poster--compact .poster__art {
  padding: var(--space-3);
}

.poster--compact .poster__artist {
  font-size: min(var(--step-1), 11cqi);
}

.poster--compact .poster__tour {
  font-size: var(--step--2);
  margin-top: var(--space-1);
}

.poster--compact .poster__meta {
  display: none;
}
</style>
