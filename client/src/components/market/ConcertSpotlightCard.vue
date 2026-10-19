<script setup>
import { computed } from 'vue';
import { formatDate } from '../../api.js';
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

</script>

<template>
  <article class="spot card card--interactive">
    <h3 class="spot__artist">
      <RouterLink :to="`/concerts/${concert.id}`" class="spot__link">{{ concert.artist }}</RouterLink>
    </h3>
    <p v-if="concert.tour_name" class="spot__tour">{{ concert.tour_name }}</p>
    <p v-if="concert.blurb" class="spot__description">{{ concert.blurb }}</p>
    <p class="spot__venue">{{ concert.venue }}, {{ concert.city }}</p>
    <p class="spot__date">
      <span class="mono">{{ formatDate(concert.event_date) }}</span>
    </p>

    <div class="spot__activity">
      <p v-if="activityLoading"><LoadingSpinner /> Loading group activity…</p>
      <template v-else>
        <p>{{ openSlots === null ? 'Group places unavailable' : `${openSlots} group ${openSlots === 1 ? 'place' : 'places'} available` }}</p>
        <p>{{ openSeekers === null ? 'Group finder activity unavailable' : openSeekers === 0 ? 'No active group finders' : `${openSeekers} active group ${openSeekers === 1 ? 'finder' : 'finders'}` }}</p>
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
        <span>{{ ticketCount }} {{ ticketCount === 1 ? 'ticket' : 'tickets' }} for sale · Listing totals from {{ from }}</span>
      </span>
      <span v-else-if="ticketCount === 0" class="spot__resale spot__resale--none">No tickets for sale</span>
      <span v-else class="spot__resale spot__resale--none">Tickets for sale unavailable</span>
      <RouterLink :to="`/concerts/${concert.id}`" class="spot__see">View concert</RouterLink>
    </footer>
  </article>
</template>

<style scoped>
.spot {
  position: relative;
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow-wrap: anywhere;
  gap: var(--space-2);
  padding: var(--space-5);
  overflow: hidden;
}

.spot__official {
  position: relative;
  z-index: 1;
  align-self: start;
  color: var(--accent-400);
  font-size: var(--step--1);
}

.spot__artist {
  margin-top: var(--space-2);
  font-size: var(--step-1);
  line-height: 1.2;
}

.spot__link {
  color: var(--text-100);
  text-decoration: none;
}

.spot__link:focus-visible { outline: none; }

/* The card's hit area. Sits under the footer button, which is raised. */
.spot__link::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
}

.spot:focus-within { border-color: var(--accent-500); }

.spot__tour { color: var(--accent-400); font-size: var(--step--1); }
.spot__venue { color: var(--text-300); font-size: var(--step--1); }
.spot__description { color: var(--text-300); font-size: var(--step--1); white-space: pre-line; }
.spot__activity { display: grid; gap: var(--space-1); margin-block: var(--space-3); color: var(--text-300); font-size: var(--step--1); }

.spot__date {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-top: var(--space-1);
  color: var(--text-400);
  font-size: var(--step--2);
  letter-spacing: 0.03em;
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
  padding: var(--space-2) var(--space-3);
  border: var(--border-soft);
  border-radius: var(--radius-pill);
  background: var(--ink-800);
  color: var(--text-100);
  font-size: var(--step--2);
  font-weight: 600;
  transition:
    background var(--dur-fast) var(--ease-out),
    border-color var(--dur-fast) var(--ease-out);
}

.spot__see:hover {
  background: var(--accent-500);
  border-color: var(--accent-500);
  color: #fff;
}
</style>
