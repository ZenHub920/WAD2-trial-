<script setup>
import { computed } from 'vue';
import { formatDate } from '../../api.js';
import { priceParts } from '../../market.js';
import MarketIcon from './MarketIcon.vue';

/**
 * One recommended concert in the market's default view.
 *
 * The whole card opens the concert page, exactly as the cards on the Concerts
 * page do — the artist heading holds the real link and its ::after layer is
 * stretched over the card, which keeps the markup valid (no nested interactive
 * elements) while leaving the "See tickets" button pressable on top of it.
 */
const props = defineProps({
  concert: { type: Object, required: true },
  rank: { type: Number, default: 0 },
  tier: { type: Object, required: true },
  heat: { type: Object, required: true },
  onSale: { type: Number, default: 0 },
  fromCents: { type: Number, default: null },
});

defineEmits(['filter']);

/** Demand as a share of the bar; parity sits at the midpoint, as on Concerts. */
const demandWidth = computed(() => {
  const { seekers, slots, listings } = props.heat;
  const places = slots + listings;
  if (!places) return seekers ? 100 : 0;
  return Math.min(100, (seekers / places) * 50);
});

/** `$99`, not `$99.00` — the footer has one line to say two things. */
const from = computed(() => {
  if (props.fromCents === null) return '';
  const { symbol, whole, fraction } = priceParts(props.fromCents);
  return `${symbol}${whole}${fraction}`;
});

const countdown = computed(() => {
  const days = props.heat.days;
  if (days === null) return '';
  if (days === 0) return 'tonight';
  if (days === 1) return 'tomorrow';
  if (days < 14) return `in ${days} days`;
  if (days < 60) return `in ${Math.round(days / 7)} weeks`;
  return `in ${Math.round(days / 30)} months`;
});
</script>

<template>
  <article class="spot card card--interactive" :data-tier="tier.id">
    <header class="spot__head">
      <span v-if="rank <= 3" class="spot__rank tabular">{{ rank }}</span>
      <span class="spot__tier">
        <MarketIcon v-if="tier.id === 'surging' || tier.id === 'hot'" name="flame" :size="13" />
        {{ tier.label }}
      </span>
    </header>

    <h3 class="spot__artist">
      <RouterLink :to="`/concerts/${concert.id}`" class="spot__link">{{ concert.artist }}</RouterLink>
    </h3>
    <p v-if="concert.tour_name" class="spot__tour">{{ concert.tour_name }}</p>
    <p class="spot__venue">{{ concert.venue }} · {{ concert.city }}</p>
    <p class="spot__date">
      <span class="mono">{{ formatDate(concert.event_date) }}</span>
      <span v-if="countdown" class="spot__countdown">{{ countdown }}</span>
    </p>

    <div
      class="spot__demand"
      role="img"
      :aria-label="`${heat.seekers} looking, ${heat.slots + heat.listings} places open`"
    >
      <div class="spot__track">
        <div class="spot__fill" :style="{ width: `${demandWidth}%` }" />
        <div class="spot__parity" />
      </div>
      <div class="spot__legend">
        <span><strong class="tabular">{{ heat.seekers }}</strong> looking</span>
        <span><strong class="tabular">{{ heat.slots + heat.listings }}</strong> places</span>
      </div>
    </div>

    <footer class="spot__foot">
      <span v-if="onSale" class="spot__resale">
        <MarketIcon name="ticket" :size="15" />
        <!-- One element, so the flex gap does not open up mid-sentence. -->
        <span><span class="tabular">From {{ from }}</span> · {{ onSale }} listed</span>
      </span>
      <span v-else class="spot__resale spot__resale--none">
        <MarketIcon name="ticket" :size="15" />
        No resale listed yet
      </span>
      <button
        v-if="onSale"
        type="button"
        class="spot__see"
        @click="$emit('filter', concert.artist)"
      >
        See tickets
      </button>
    </footer>
  </article>
</template>

<style scoped>
.spot {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-5);
  overflow: hidden;
}

/* A hairline keyed to demand, so a row of cards reads as a ranking at a glance. */
.spot::before {
  content: '';
  position: absolute;
  inset: 0 0 auto 0;
  height: 3px;
  background: var(--tier-colour, var(--ink-500));
}

.spot[data-tier='surging'] { --tier-colour: var(--rose-400); }
.spot[data-tier='hot']     { --tier-colour: var(--amber-400); }
.spot[data-tier='steady']  { --tier-colour: var(--accent-500); }
.spot[data-tier='open']    { --tier-colour: var(--mint-400); }

.spot__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  min-height: 24px;
}

.spot__rank {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: var(--radius-pill);
  background: color-mix(in oklab, var(--tier-colour) 16%, transparent);
  color: var(--tier-colour);
  font-size: var(--step--2);
  font-weight: 700;
}

.spot__tier {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  margin-left: auto;
  color: var(--tier-colour);
  font-size: var(--step--2);
  font-weight: 600;
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

.spot__countdown {
  padding: 1px var(--space-2);
  border-radius: var(--radius-pill);
  background: var(--ink-700);
  color: var(--text-300);
  letter-spacing: 0;
}

.spot__demand {
  margin-top: auto;
  padding-top: var(--space-4);
}

.spot__track {
  position: relative;
  height: 6px;
  border-radius: var(--radius-pill);
  background: var(--ink-700);
  overflow: hidden;
}

.spot__fill {
  height: 100%;
  border-radius: var(--radius-pill);
  background: var(--tier-colour);
  transition: width var(--dur-slower) var(--ease-settle);
}

.spot__parity {
  position: absolute;
  top: -2px;
  bottom: -2px;
  left: 50%;
  width: 1px;
  background: var(--text-400);
  opacity: 0.5;
}

.spot__legend {
  display: flex;
  justify-content: space-between;
  margin-top: var(--space-2);
  color: var(--text-400);
  font-size: var(--step--2);
}

.spot__legend strong { color: var(--text-200); font-weight: 600; }

.spot__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-3);
  margin-top: var(--space-4);
  padding-top: var(--space-3);
  border-top: var(--border-hairline);
}

.spot__resale {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  /* Matches the button's height, so the footers — and the bars above them —
     line up across a row whether or not a card has tickets to link to. */
  min-height: 34px;
  min-width: 0;
  color: var(--text-200);
  font-size: var(--step--2);
  /* Never break mid-phrase: if it will not fit beside the button, the button wraps. */
  white-space: nowrap;
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
