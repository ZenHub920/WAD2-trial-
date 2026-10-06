<script setup>
import { ref, computed, onMounted } from 'vue';
import { api, formatDate } from '../api.js';

const concerts = ref([]);
const loading = ref(true);
const error = ref(null);
const filter = ref('all');

onMounted(async () => {
  try {
    concerts.value = (await api.concerts()).concerts;
  } catch (err) {
    error.value = err;
  } finally {
    loading.value = false;
  }
});

/** Demand pressure decides what the card emphasises. */
function pressure(concert) {
  if (concert.open_slots === 0) return 'closed';
  const ratio = concert.open_seekers / concert.open_slots;
  if (ratio > 1.6) return 'hot';
  if (ratio < 0.7) return 'open';
  return 'even';
}

const filtered = computed(() => {
  if (filter.value === 'all') return concerts.value;
  return concerts.value.filter((c) => pressure(c) === filter.value);
});

const filters = [
  { id: 'all', label: 'All concerts' },
  { id: 'hot', label: 'Oversubscribed' },
  { id: 'even', label: 'Balanced' },
  { id: 'open', label: 'Slots available' },
];

const PRESSURE_COPY = {
  hot: 'More seekers than slots',
  even: 'Roughly balanced',
  open: 'Spare slots',
  closed: 'No open groups',
};
</script>

<template>
  <div class="container section">
    <header class="page-head">
      <p class="eyebrow">Open rounds</p>
      <h1>Concerts matching now</h1>
      <p class="lede">
        Each concert runs its own matching round. Join as someone looking for a group,
        or list the spare tickets you are holding.
      </p>
    </header>

    <div class="filters" role="group" aria-label="Filter concerts">
      <button
        v-for="option in filters"
        :key="option.id"
        class="filters__btn"
        :class="{ 'filters__btn--on': filter === option.id }"
        :aria-pressed="filter === option.id"
        @click="filter = option.id"
      >
        {{ option.label }}
      </button>
    </div>

    <div v-if="loading" class="grid">
      <div v-for="n in 4" :key="n" class="skeleton" />
    </div>

    <div v-else-if="error" class="notice notice--error">
      <h3>Could not reach the API</h3>
      <p>
        Start the backend from <code>server/</code>:
        <code>npm install &amp;&amp; npm run seed &amp;&amp; npm start</code>
      </p>
      <p class="notice__detail mono">{{ error.message }}</p>
    </div>

    <p v-else-if="!filtered.length" class="notice">
      Nothing matches that filter.
    </p>

    <div v-else class="grid">
      <RouterLink
        v-for="concert in filtered"
        :key="concert.id"
        :to="`/concerts/${concert.id}`"
        class="concert card card--interactive"
        :data-pressure="pressure(concert)"
      >
        <div class="concert__top">
          <p class="concert__date mono">{{ formatDate(concert.event_date) }}</p>
          <span class="concert__pressure">{{ PRESSURE_COPY[pressure(concert)] }}</span>
        </div>

        <h2 class="concert__artist">{{ concert.artist }}</h2>
        <p v-if="concert.tour_name" class="concert__tour">{{ concert.tour_name }}</p>
        <p class="concert__venue">{{ concert.venue }} · {{ concert.city }}</p>

        <p v-if="concert.blurb" class="concert__blurb">{{ concert.blurb }}</p>

        <!-- Supply against demand, as one bar. -->
        <div class="balance" role="img"
             :aria-label="`${concert.open_slots} slots for ${concert.open_seekers} seekers`">
          <div class="balance__track">
            <div
              class="balance__fill"
              :style="{
                width: `${Math.min(100, concert.open_slots === 0 ? 100 :
                  (concert.open_seekers / Math.max(concert.open_slots, 1)) * 50)}%`
              }"
            />
            <div class="balance__mid" />
          </div>
          <div class="balance__legend">
            <span><strong class="tabular">{{ concert.open_slots }}</strong> slots</span>
            <span><strong class="tabular">{{ concert.open_seekers }}</strong> looking</span>
          </div>
        </div>
      </RouterLink>
    </div>
  </div>
</template>

<style scoped>
.page-head {
  max-width: var(--measure);
  margin-bottom: var(--space-6);
}

.page-head h1 {
  margin-block: var(--space-3) var(--space-4);
}

/* ---- Filters ------------------------------------------------------------ */

.filters {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-bottom: var(--space-6);
  padding-bottom: var(--space-5);
  border-bottom: var(--border-hairline);
}

.filters__btn {
  padding: var(--space-2) var(--space-4);
  border-radius: var(--radius-pill);
  border: var(--border-hairline);
  font-size: var(--step--1);
  color: var(--text-300);
  transition:
    background var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out),
    border-color var(--dur-fast) var(--ease-out);
}

.filters__btn:hover {
  color: var(--text-100);
  border-color: var(--ink-500);
}

.filters__btn--on {
  background: var(--accent-500);
  border-color: var(--accent-500);
  color: #fff;
}

/* ---- Grid --------------------------------------------------------------- */

.grid {
  display: grid;
  gap: var(--space-4);
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
}

.concert {
  display: flex;
  flex-direction: column;
  text-decoration: none;
  position: relative;
  overflow: hidden;
}

/* A hairline of colour at the top, keyed to demand pressure. */
.concert::before {
  content: '';
  position: absolute;
  inset: 0 0 auto 0;
  height: 3px;
  background: var(--pressure-colour, var(--ink-500));
  opacity: 0.9;
}

.concert[data-pressure='hot']    { --pressure-colour: var(--rose-400); }
.concert[data-pressure='even']   { --pressure-colour: var(--accent-500); }
.concert[data-pressure='open']   { --pressure-colour: var(--mint-400); }
.concert[data-pressure='closed'] { --pressure-colour: var(--ink-500); }

.concert__top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--space-3);
  flex-wrap: wrap;
}

.concert__date {
  font-size: var(--step--2);
  color: var(--text-400);
  letter-spacing: 0.04em;
}

.concert__pressure {
  font-size: var(--step--2);
  font-weight: 500;
  color: var(--pressure-colour);
}

.concert__artist {
  font-size: var(--step-2);
  margin-top: var(--space-3);
}

.concert__tour {
  color: var(--accent-400);
  font-size: var(--step--1);
  margin-top: 2px;
}

.concert__venue {
  color: var(--text-400);
  font-size: var(--step--1);
  margin-top: var(--space-1);
}

.concert__blurb {
  margin-top: var(--space-4);
  color: var(--text-300);
  font-size: var(--step--1);
  line-height: 1.55;
  flex: 1;
}

/* ---- Supply/demand bar -------------------------------------------------- */

.balance {
  margin-top: var(--space-5);
  padding-top: var(--space-4);
  border-top: var(--border-hairline);
}

.balance__track {
  position: relative;
  height: 6px;
  border-radius: var(--radius-pill);
  background: var(--ink-700);
  overflow: hidden;
}

.balance__fill {
  height: 100%;
  border-radius: var(--radius-pill);
  background: var(--pressure-colour);
  transition: width var(--dur-slow) var(--ease-out);
}

/* The midpoint marks parity: past it, demand exceeds supply. */
.balance__mid {
  position: absolute;
  top: -2px;
  bottom: -2px;
  left: 50%;
  width: 1px;
  background: var(--text-400);
  opacity: 0.55;
}

.balance__legend {
  display: flex;
  justify-content: space-between;
  margin-top: var(--space-2);
  font-size: var(--step--2);
  color: var(--text-400);
}

.balance__legend strong {
  color: var(--text-200);
  font-weight: 600;
}

/* ---- States ------------------------------------------------------------- */

.skeleton {
  height: 280px;
  border-radius: var(--radius-lg);
  background: linear-gradient(100deg, var(--ink-800) 30%, var(--ink-750) 50%, var(--ink-800) 70%);
  background-size: 220% 100%;
  animation: shimmer 1.4s ease-in-out infinite;
}

@keyframes shimmer {
  from { background-position: 180% 0; }
  to   { background-position: -80% 0; }
}

.notice {
  padding: var(--space-6);
  border-radius: var(--radius-lg);
  border: 1px dashed var(--ink-500);
  color: var(--text-400);
}

.notice--error {
  border-style: solid;
  border-color: color-mix(in oklab, var(--rose-400) 40%, var(--ink-600));
  background: color-mix(in oklab, var(--rose-400) 7%, transparent);
  color: var(--text-200);
}

.notice h3 {
  color: var(--rose-400);
  font-size: var(--step-0);
  margin-bottom: var(--space-3);
}

.notice code {
  color: var(--accent-400);
}

.notice__detail {
  margin-top: var(--space-3);
  font-size: var(--step--2);
  color: var(--text-400);
}
</style>
