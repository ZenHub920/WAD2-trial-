<script setup>
import { computed, ref } from 'vue';
import { formatDate, formatShortDate } from '../../api.js';
import { priceParts } from '../../market.js';
import MarketIcon from './MarketIcon.vue';
import LoadingSpinner from '../LoadingSpinner.vue';

/** One concert, with group activity and fan ticket inventory kept separate. */
const props = defineProps({
  concert: { type: Object, required: true },
  openSeekers: { type: Number, default: null },
  openSlots: { type: Number, default: null },
  ticketCount: { type: Number, default: null },
  fromCents: { type: Number, default: null },
  ticketsLoading: { type: Boolean, default: false },
  activityLoading: { type: Boolean, default: false },
});

/** `$99`, not `$99.00` — the footer has one line to say two things. */
const from = computed(() => {
  if (props.fromCents === null) return '';
  const { symbol, whole, fraction } = priceParts(props.fromCents);
  return `${symbol}${whole}${fraction}`;
});

// Ticketmaster image URLs occasionally 404; the card then shows the artwork.
const broken = ref(false);
const image = computed(() => (!broken.value && props.concert.hero_image_url) || null);
const busy = computed(() => (props.openSeekers ?? 0) + (props.openSlots ?? 0) > 0);
</script>

<template>
  <article class="spot">
    <div class="spot__poster">
      <img v-if="image" :src="image" alt="" loading="lazy" @error="broken = true" />
      <span v-else class="spot__initial" aria-hidden="true">{{ concert.artist.charAt(0) }}</span>
      <span class="spot__date-badge mono">{{ formatShortDate(concert.event_date) }}</span>
      <span v-if="busy" class="spot__live">Active</span>
    </div>

    <div class="spot__body">
      <h3 class="spot__artist">
        <RouterLink :to="`/concerts/${concert.id}`" class="spot__link">{{ concert.artist }}</RouterLink>
      </h3>
      <p v-if="concert.tour_name" class="spot__tour">{{ concert.tour_name }}</p>
      <p v-if="concert.blurb" class="spot__description">{{ concert.blurb }}</p>
      <p class="spot__meta">
        <MarketIcon name="pin" :size="14" />
        {{ concert.venue }}, {{ concert.city }}
      </p>
      <p class="spot__meta">
        <MarketIcon name="calendar" :size="14" />
        {{ formatDate(concert.event_date) }}
      </p>

      <div class="spot__activity">
        <p v-if="activityLoading"><LoadingSpinner /> Loading group activity…</p>
        <template v-else>
          <p :class="{ 'spot__stat--on': openSlots }">{{ openSlots === null ? 'Group spots unavailable' : openSlots === 0 ? 'No open spots in groups' : `${openSlots} open ${openSlots === 1 ? 'spot' : 'spots'} in groups` }}</p>
          <p :class="{ 'spot__stat--on': openSeekers }">{{ openSeekers === null ? 'Group activity unavailable' : openSeekers === 0 ? 'Nobody looking for a group yet' : `${openSeekers} ${openSeekers === 1 ? 'person' : 'people'} looking for a group` }}</p>
        </template>
      </div>

      <a
        v-if="concert.official_url"
        :href="concert.official_url"
        class="spot__official"
        target="_blank"
        rel="noopener noreferrer"
      >Buy on Ticketmaster ↗</a>

      <footer class="spot__foot">
        <span v-if="ticketsLoading" class="spot__resale"><LoadingSpinner /> Loading tickets…</span>
        <span v-else-if="ticketCount" class="spot__resale">
          <MarketIcon name="ticket" :size="15" />
          <span>{{ ticketCount }} fan-listed {{ ticketCount === 1 ? 'ticket' : 'tickets' }} · from {{ from }}</span>
        </span>
        <span v-else-if="ticketCount === 0" class="spot__resale spot__resale--none">No fan-listed tickets</span>
        <span v-else class="spot__resale spot__resale--none">Fan-listed tickets unavailable</span>
        <RouterLink :to="`/concerts/${concert.id}`" class="spot__see">
          View concert
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
        </RouterLink>
      </footer>
    </div>
  </article>
</template>

<style scoped>
.spot {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  overflow: hidden;
  overflow-wrap: anywhere;
  border: var(--border-hairline);
  border-radius: var(--radius-lg);
  background: var(--ink-800);
  box-shadow: var(--shadow-sm);
  transition:
    transform var(--dur-base) var(--ease-out),
    box-shadow var(--dur-base) var(--ease-out),
    border-color var(--dur-base) var(--ease-out);
}

.spot:hover,
.spot:focus-within {
  transform: translateY(-6px);
  border-color: var(--accent-400);
  box-shadow: 0 24px 44px -22px var(--accent-400);
}

/* ---------------------------------------------------------------- Poster -- */

.spot__poster {
  position: relative;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  display: grid;
  place-items: center;
  background: linear-gradient(135deg, var(--accent-300), var(--ink-700) 70%);
}

.spot__poster img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform var(--dur-slower) var(--ease-settle);
}

.spot:hover .spot__poster img {
  transform: scale(1.08);
}

.spot__initial {
  font-family: var(--font-display);
  font-weight: 800;
  font-size: var(--step-5);
  color: var(--accent-500);
  opacity: 0.55;
}

.spot__date-badge,
.spot__live {
  position: absolute;
  top: var(--space-3);
  padding: var(--space-1) var(--space-3);
  border-radius: var(--radius-pill);
  font-size: var(--step--2);
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.spot__date-badge {
  left: var(--space-3);
  background: rgba(255, 255, 255, 0.92);
  color: var(--accent-600);
}

.spot__live {
  right: var(--space-3);
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  background: rgba(30, 12, 60, 0.75);
  color: #fff;
  backdrop-filter: blur(6px);
}

.spot__live::before {
  content: '';
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #e69ddb;
  animation: ping 1.8s var(--ease-out) infinite;
}

@keyframes ping {
  0% { box-shadow: 0 0 0 0 rgba(230, 157, 219, 0.7); }
  100% { box-shadow: 0 0 0 8px transparent; }
}

/* ------------------------------------------------------------------ Body -- */

.spot__body {
  display: flex;
  flex-direction: column;
  flex: 1;
  gap: var(--space-2);
  padding: var(--space-4) var(--space-5) var(--space-5);
}

.spot__artist {
  font-size: var(--step-2);
  line-height: 1.15;
}

.spot__link {
  color: var(--text-100);
  text-decoration: none;
  transition: color var(--dur-base) var(--ease-out);
}

.spot:hover .spot__link { color: var(--accent-400); }
.spot__link:focus-visible { outline: none; }

/* The card's hit area. Sits under the footer button, which is raised. */
.spot__link::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
}

.spot__tour { color: var(--accent-400); font-size: var(--step--1); font-weight: 600; }
.spot__description { color: var(--text-300); font-size: var(--step--1); white-space: pre-line; }

.spot__meta {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--text-300);
  font-size: var(--step--1);
}

.spot__meta :deep(svg) { flex: none; color: var(--accent-400); }

.spot__activity {
  display: grid;
  gap: var(--space-1);
  margin-block: var(--space-2);
  padding: var(--space-3);
  border-radius: var(--radius-md);
  background: var(--ink-750);
  color: var(--text-400);
  font-size: var(--step--1);
}

.spot__stat--on {
  color: var(--accent-500);
  font-weight: 700;
}

.spot__official {
  position: relative;
  z-index: 1;
  align-self: start;
  color: var(--accent-400);
  font-size: var(--step--1);
  font-weight: 600;
}

.spot__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-3);
  margin-top: auto;
  padding-top: var(--space-3);
  border-top: var(--border-hairline);
}

.spot__resale {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  /* Matches the button's height so footers line up across the row. */
  min-height: 34px;
  min-width: 0;
  color: var(--text-200);
  font-size: var(--step--2);
  overflow-wrap: anywhere;
}

.spot__resale--none { color: var(--text-400); }

.spot__see {
  position: relative;
  z-index: 1;
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-2) var(--space-4);
  border-radius: var(--radius-pill);
  background: var(--accent-500);
  color: #fff;
  font-size: var(--step--2);
  font-weight: 700;
  text-decoration: none;
  transition:
    background var(--dur-fast) var(--ease-out),
    box-shadow var(--dur-base) var(--ease-out);
}

.spot__see svg {
  width: 14px;
  height: 14px;
  transition: transform var(--dur-base) var(--ease-spring);
}

.spot__see:hover {
  background: var(--accent-400);
  box-shadow: 0 8px 20px -8px var(--accent-400);
}

.spot:hover .spot__see svg {
  transform: translateX(3px);
}

@media (prefers-reduced-motion: reduce) {
  .spot:hover,
  .spot:focus-within { transform: none; }
}
</style>
