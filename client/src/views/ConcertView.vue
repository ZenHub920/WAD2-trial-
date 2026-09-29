<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api, LABELS, formatDate } from '../api.js';
import VibeChart from '../components/VibeChart.vue';

const props = defineProps({ id: { type: String, required: true } });
const router = useRouter();

const concert = ref(null);
const parties = ref([]);
const requests = ref([]);
const preview = ref(null);
const loading = ref(true);
const running = ref(false);
const error = ref(null);
const tab = ref('parties');

async function load() {
  loading.value = true;
  error.value = null;
  try {
    const [detail, partyData, requestData] = await Promise.all([
      api.concert(props.id),
      api.parties(props.id),
      api.requests(props.id),
    ]);
    concert.value = detail;
    parties.value = partyData.parties;
    requests.value = requestData.requests;

    // A dry run so the page can show what a round would produce, without
    // committing anything.
    try {
      preview.value = await api.preview(props.id, { baselines: true });
    } catch {
      preview.value = null;
    }
  } catch (err) {
    error.value = err;
  } finally {
    loading.value = false;
  }
}

onMounted(load);
watch(() => props.id, load);

async function runRound() {
  running.value = true;
  try {
    const outcome = await api.runMatch(props.id);
    router.push(`/rounds/${outcome.roundId}`);
  } catch (err) {
    error.value = err;
  } finally {
    running.value = false;
  }
}

const totalSlots = computed(() => parties.value.reduce((a, p) => a + p.capacity, 0));

const canRun = computed(
  () => parties.value.length > 0 && requests.value.length > 0 && !running.value,
);
</script>

<template>
  <div class="container section">
    <RouterLink to="/concerts" class="back">← All concerts</RouterLink>

    <div v-if="loading" class="skeleton-hero" />

    <div v-else-if="error" class="notice notice--error">
      <h3>Could not load this concert</h3>
      <p class="mono">{{ error.message }}</p>
    </div>

    <template v-else-if="concert">
      <!-- ------------------------------------------------------------ Head -->
      <header class="head">
        <div class="head__text">
          <p class="eyebrow">{{ formatDate(concert.concert.event_date) }}</p>
          <h1>{{ concert.concert.artist }}</h1>
          <p v-if="concert.concert.tour_name" class="head__tour">
            {{ concert.concert.tour_name }}
          </p>
          <p class="head__venue">
            {{ concert.concert.venue }} · {{ concert.concert.city }}
            <template v-if="concert.concert.doors_time">
              · doors {{ concert.concert.doors_time }}
            </template>
          </p>
          <p v-if="concert.concert.blurb" class="head__blurb">{{ concert.concert.blurb }}</p>
        </div>

        <aside class="head__panel">
          <h2 class="head__panel-title">This round</h2>
          <dl class="counts">
            <div>
              <dt>Groups</dt>
              <dd class="tabular">{{ parties.length }}</dd>
            </div>
            <div>
              <dt>Open slots</dt>
              <dd class="tabular">{{ totalSlots }}</dd>
            </div>
            <div>
              <dt>Looking</dt>
              <dd class="tabular">{{ requests.length }}</dd>
            </div>
          </dl>

          <div v-if="preview && !preview.empty" class="head__forecast">
            <p class="head__forecast-label">If the round ran now</p>
            <p class="head__forecast-value">
              <strong class="tabular">{{ preview.metrics.matched }}</strong>
              of {{ preview.metrics.eligibleSeekers }} placed
            </p>
            <p class="head__forecast-note">
              <span class="tag tag--mint">{{ preview.metrics.blockingPairs }} blocking pairs</span>
              <span class="tag">{{ Math.round(preview.metrics.firstChoiceRate * 100) }}% first choice</span>
            </p>
          </div>

          <div class="head__actions">
            <button class="btn btn--primary" :disabled="!canRun" @click="runRound">
              {{ running ? 'Running…' : 'Run matching round' }}
            </button>
            <RouterLink :to="`/concerts/${id}/algorithm`" class="btn btn--ghost">
              Watch it run
            </RouterLink>
          </div>

          <RouterLink
            v-if="concert.latestRound"
            :to="`/rounds/${concert.latestRound.id}`"
            class="head__previous"
          >
            Last round: {{ concert.latestRound.matched }} matched
            <span :class="concert.latestRound.isStable ? 'ok' : 'bad'">
              {{ concert.latestRound.isStable ? '· verified stable' : '· UNSTABLE' }}
            </span>
          </RouterLink>
        </aside>
      </header>

      <!-- ------------------------------------------------------------ Tabs -->
      <div class="tabs" role="tablist">
        <button
          role="tab"
          :aria-selected="tab === 'parties'"
          class="tabs__btn"
          :class="{ 'tabs__btn--on': tab === 'parties' }"
          @click="tab = 'parties'"
        >
          Groups with spare tickets
          <span class="tabs__count tabular">{{ parties.length }}</span>
        </button>
        <button
          role="tab"
          :aria-selected="tab === 'seekers'"
          class="tabs__btn"
          :class="{ 'tabs__btn--on': tab === 'seekers' }"
          @click="tab = 'seekers'"
        >
          People looking
          <span class="tabs__count tabular">{{ requests.length }}</span>
        </button>
      </div>

      <!-- --------------------------------------------------------- Listings -->
      <div v-if="tab === 'parties'" class="listing">
        <p v-if="!parties.length" class="notice">No groups have listed spare tickets yet.</p>
        <article v-for="party in parties" :key="party.id" class="card entry">
          <div class="entry__main">
            <div class="entry__head">
              <h3>{{ party.host.displayName }}</h3>
              <span v-if="party.host.verified" class="tag tag--mint">Verified</span>
              <span class="tag">{{ party.capacity }} {{ party.capacity === 1 ? 'slot' : 'slots' }}</span>
            </div>
            <p class="entry__meta">
              {{ party.host.ageBand }} · {{ party.host.homeRegion.replace('_', ' ') }} ·
              {{ party.host.languages.join(', ') }}
            </p>
            <div class="entry__tags">
              <span class="tag tag--accent">{{ LABELS.section[party.section] }}</span>
              <span class="tag">{{ LABELS.spendBand[party.spendBand] }}</span>
              <span class="tag">{{ LABELS.arrival[party.arrivalPlan] }}</span>
              <span
                v-for="(on, key) in party.plans"
                v-show="on"
                :key="key"
                class="tag tag--cyan"
              >{{ LABELS.plans[key] }}</span>
            </div>
            <div class="entry__reliability">
              <span class="entry__reliability-label">Reliability</span>
              <span class="meter">
                <span class="meter__fill" :style="{ width: `${party.host.reliability * 100}%` }" />
              </span>
              <span class="tabular entry__reliability-value">
                {{ Math.round(party.host.reliability * 100) }}%
              </span>
            </div>
          </div>
          <div class="entry__chart">
            <VibeChart :vibe="party.host.vibe" :size="150" />
          </div>
        </article>
      </div>

      <div v-else class="listing">
        <p v-if="!requests.length" class="notice">Nobody is looking for a group yet.</p>
        <article v-for="request in requests" :key="request.id" class="card entry">
          <div class="entry__main">
            <div class="entry__head">
              <h3>{{ request.user.displayName }}</h3>
              <span v-if="request.user.verified" class="tag tag--mint">Verified</span>
            </div>
            <p class="entry__meta">
              {{ request.user.ageBand }} · {{ request.user.homeRegion.replace('_', ' ') }} ·
              {{ request.user.languages.join(', ') }}
            </p>
            <div class="entry__tags">
              <span class="tag tag--accent">{{ LABELS.section[request.sectionPref] }}</span>
              <span class="tag">up to {{ LABELS.spendBand[request.spendBandMax] }}</span>
              <span class="tag">{{ LABELS.arrival[request.arrivalPref] }}</span>
              <span
                v-for="(on, key) in request.plansWanted"
                v-show="on"
                :key="key"
                class="tag tag--cyan"
              >{{ LABELS.plans[key] }}</span>
            </div>
            <div class="entry__reliability">
              <span class="entry__reliability-label">Reliability</span>
              <span class="meter">
                <span class="meter__fill" :style="{ width: `${request.user.reliability * 100}%` }" />
              </span>
              <span class="tabular entry__reliability-value">
                {{ Math.round(request.user.reliability * 100) }}%
              </span>
            </div>
          </div>
          <div class="entry__chart">
            <VibeChart :vibe="request.user.vibe" :size="150" />
          </div>
        </article>
      </div>
    </template>
  </div>
</template>

<style scoped>
.back {
  display: inline-block;
  margin-bottom: var(--space-5);
  color: var(--text-400);
  text-decoration: none;
  font-size: var(--step--1);
  transition: color var(--dur-fast) var(--ease-out);
}

.back:hover { color: var(--accent-400); }

/* ---- Head --------------------------------------------------------------- */

.head {
  display: grid;
  gap: var(--space-6);
  padding-bottom: var(--space-7);
  margin-bottom: var(--space-6);
  border-bottom: var(--border-hairline);
}

@media (min-width: 960px) {
  .head {
    grid-template-columns: 1fr 340px;
    gap: var(--space-8);
    align-items: start;
  }
}

.head__text h1 {
  margin-block: var(--space-3) var(--space-2);
  font-size: var(--step-5);
}

.head__tour {
  color: var(--accent-400);
  font-size: var(--step-0);
}

.head__venue {
  color: var(--text-400);
  font-size: var(--step--1);
  margin-top: var(--space-2);
}

.head__blurb {
  margin-top: var(--space-4);
  color: var(--text-300);
  max-width: var(--measure);
}

.head__panel {
  background: var(--ink-800);
  border: var(--border-hairline);
  border-radius: var(--radius-lg);
  padding: var(--space-5);
  position: sticky;
  top: calc(var(--header-height) + var(--space-4));
}

.head__panel-title {
  font-family: var(--font-mono);
  font-size: var(--step--2);
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: var(--text-400);
  font-weight: 500;
}

.counts {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--space-3);
  margin-top: var(--space-4);
  padding-bottom: var(--space-4);
  border-bottom: var(--border-hairline);
}

.counts dt {
  font-size: var(--step--2);
  color: var(--text-400);
}

.counts dd {
  font-family: var(--font-display);
  font-size: var(--step-2);
  font-weight: 700;
  color: var(--text-100);
  line-height: 1.1;
}

.head__forecast {
  padding-block: var(--space-4);
  border-bottom: var(--border-hairline);
}

.head__forecast-label {
  font-size: var(--step--2);
  color: var(--text-400);
  text-transform: uppercase;
  letter-spacing: 0.1em;
  font-family: var(--font-mono);
}

.head__forecast-value {
  margin-top: var(--space-2);
  font-size: var(--step-0);
  color: var(--text-200);
}

.head__forecast-value strong {
  font-family: var(--font-display);
  font-size: var(--step-2);
  color: var(--accent-400);
}

.head__forecast-note {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-top: var(--space-3);
}

.head__actions {
  display: grid;
  gap: var(--space-2);
  margin-top: var(--space-4);
}

.head__previous {
  display: block;
  margin-top: var(--space-4);
  padding-top: var(--space-3);
  border-top: var(--border-hairline);
  font-size: var(--step--2);
  color: var(--text-400);
  text-decoration: none;
}

.head__previous:hover { color: var(--text-200); }
.head__previous .ok { color: var(--mint-400); }
.head__previous .bad { color: var(--rose-400); font-weight: 600; }

/* ---- Tabs --------------------------------------------------------------- */

.tabs {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-bottom: var(--space-5);
}

.tabs__btn {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-md);
  border: var(--border-hairline);
  font-size: var(--step--1);
  color: var(--text-300);
  transition:
    background var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out),
    border-color var(--dur-fast) var(--ease-out);
}

.tabs__btn:hover { color: var(--text-100); border-color: var(--ink-500); }

.tabs__btn--on {
  background: var(--ink-750);
  border-color: var(--accent-500);
  color: var(--text-100);
}

.tabs__count {
  padding: 1px var(--space-2);
  border-radius: var(--radius-pill);
  background: var(--ink-700);
  font-size: var(--step--2);
}

.tabs__btn--on .tabs__count {
  background: var(--accent-500);
  color: #fff;
}

/* ---- Listings ----------------------------------------------------------- */

.listing {
  display: grid;
  gap: var(--space-4);
}

@media (min-width: 1000px) {
  .listing {
    grid-template-columns: repeat(2, 1fr);
  }
}

.entry {
  display: grid;
  grid-template-columns: 1fr;
  gap: var(--space-4);
}

@media (min-width: 520px) {
  .entry {
    grid-template-columns: 1fr 150px;
    align-items: center;
  }
}

.entry__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}

.entry__head h3 {
  font-size: var(--step-1);
}

.entry__meta {
  margin-top: var(--space-1);
  font-size: var(--step--2);
  color: var(--text-400);
  text-transform: capitalize;
}

.entry__tags {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-top: var(--space-3);
}

.entry__reliability {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  margin-top: var(--space-4);
}

.entry__reliability-label {
  font-size: var(--step--2);
  color: var(--text-400);
  white-space: nowrap;
}

.entry__reliability-value {
  font-size: var(--step--2);
  color: var(--text-300);
  min-width: 3ch;
}

.meter {
  flex: 1;
  height: 5px;
  border-radius: var(--radius-pill);
  background: var(--ink-700);
  overflow: hidden;
}

.meter__fill {
  display: block;
  height: 100%;
  border-radius: var(--radius-pill);
  background: linear-gradient(90deg, var(--accent-600), var(--accent-400));
  transition: width var(--dur-slow) var(--ease-out);
}

.entry__chart {
  justify-self: center;
}

/* ---- States ------------------------------------------------------------- */

.skeleton-hero {
  height: 320px;
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
  grid-column: 1 / -1;
  padding: var(--space-6);
  border-radius: var(--radius-lg);
  border: 1px dashed var(--ink-500);
  color: var(--text-400);
}

.notice--error {
  border-style: solid;
  border-color: color-mix(in oklab, var(--rose-400) 40%, var(--ink-600));
  background: color-mix(in oklab, var(--rose-400) 7%, transparent);
}

.notice h3 { color: var(--rose-400); margin-bottom: var(--space-2); }
</style>
