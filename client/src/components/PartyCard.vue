<script setup>
/**
 * The face of a group listing.
 *
 * Shared by the swipe deck and the expanded detail panel, so a card that is
 * dragged and a card that is opened are demonstrably the same object. The
 * `dense` variant drops the radar and tightens spacing for the stacked list.
 */

import { computed } from 'vue';
import { LABELS } from '../api.js';
import VibeChart from './VibeChart.vue';

const props = defineProps({
  party: { type: Object, required: true },
  dense: { type: Boolean, default: false },
  /** Hide the radar when the card is behind others and will not be read. */
  showChart: { type: Boolean, default: true },
});

const host = computed(() => props.party.host);

const activePlans = computed(() =>
  Object.entries(props.party.plans ?? {})
    .filter(([, on]) => on)
    .map(([key]) => LABELS.plans[key]),
);

const reliabilityPct = computed(() => Math.round((host.value.reliability ?? 0) * 100));

const region = computed(() => (host.value.homeRegion ?? '').replace(/_/g, ' '));
</script>

<template>
  <div class="face" :class="{ 'face--dense': dense }">
    <header class="face__head">
      <div class="face__id">
        <h3 class="face__name">{{ host.displayName }}</h3>
        <p class="face__meta">
          {{ host.ageBand }} · {{ region }} · {{ (host.languages ?? []).join(', ') }}
        </p>
      </div>
      <div class="face__badges">
        <span v-if="host.verified" class="tag tag--mint">Verified</span>
        <span class="tag tag--slots tabular">
          {{ party.capacity }} {{ party.capacity === 1 ? 'slot' : 'slots' }}
        </span>
      </div>
    </header>

    <div class="face__tags">
      <span class="tag tag--accent">{{ LABELS.section[party.section] }}</span>
      <span class="tag">{{ LABELS.spendBand[party.spendBand] }}</span>
      <span class="tag">{{ LABELS.arrival[party.arrivalPlan] }}</span>
      <span v-for="plan in activePlans" :key="plan" class="tag tag--cyan">{{ plan }}</span>
    </div>

    <!-- The row is always present when not dense, so the grid keeps the same
         shape whether or not the radar is drawn. Cards behind the top one skip
         the SVG (nobody reads them) without changing the layout. -->
    <div v-if="!dense" class="face__chart">
      <VibeChart v-if="showChart" :vibe="host.vibe" :size="184" />
    </div>

    <!-- Reliability is the signal a party weights at 26% when judging seekers,
         so it is given a real meter rather than a number in a list. -->
    <div class="face__reliability">
      <div class="face__reliability-row">
        <span class="face__reliability-label">Shows up</span>
        <span class="tabular face__reliability-value">{{ reliabilityPct }}%</span>
      </div>
      <span class="meter meter--lg">
        <span
          class="meter__fill"
          :style="{ width: `${reliabilityPct}%` }"
          :class="{
            'meter__fill--low': reliabilityPct < 55,
            'meter__fill--high': reliabilityPct >= 80,
          }"
        />
      </span>
    </div>
  </div>
</template>

<style scoped>
/* Header and footer are fixed; the chart is the only row allowed to absorb or
   give up space, so the card fits whatever height the deck stage gives it. */
.face {
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr) auto;
  gap: var(--space-4);
  min-height: 0;
  height: 100%;
}

.face__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-3);
}

.face__name {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--step-2);
  line-height: 1.1;
  letter-spacing: -0.02em;
}

.face__meta {
  margin: var(--space-1) 0 0;
  font-size: var(--step--1);
  color: var(--text-300);
}

.face__badges {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: var(--space-2);
  flex-shrink: 0;
}

.tag--slots {
  background: var(--ink-700);
}

.face__tags {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.face__chart {
  display: grid;
  place-items: center;
  min-height: 0;
  overflow: hidden;
}

/* When the chart is absent (dense listing, or a card behind in the stack) the
   row must not reserve space it is not using. */
.face--dense {
  grid-template-rows: auto auto auto;
}

.face__reliability {
  display: grid;
  gap: var(--space-2);
}

.face__reliability-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  font-size: var(--step--1);
}

.face__reliability-label {
  color: var(--text-400);
}

.face__reliability-value {
  color: var(--text-200);
  font-variant-numeric: tabular-nums;
}

.meter--lg {
  height: 6px;
}

/* The meter fills from empty when it first appears, so the bar reads as a
   measurement being taken rather than a static graphic. */
.meter--lg .meter__fill {
  transition: width var(--dur-slower) var(--ease-settle);
}

.meter__fill--low {
  background: linear-gradient(90deg, var(--amber-500), var(--amber-400));
}

.meter__fill--high {
  background: linear-gradient(90deg, var(--mint-500), var(--mint-400));
}

.face--dense {
  gap: var(--space-3);
}

.face--dense .face__name {
  font-size: var(--step-1);
}
</style>
