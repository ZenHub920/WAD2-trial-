<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api, LABELS, formatDate } from '../api.js';
import { currentUser } from '../auth.js';
import VibeChart from '../components/VibeChart.vue';
import SwipeDeck from '../components/SwipeDeck.vue';
import PartyCard from '../components/PartyCard.vue';
import { useCountUp } from '../composables/useCountUp.js';

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
const participation = ref(null);
const participationLoading = ref(false);
const participationBusy = ref(false);
const participationError = ref('');
const participationLoadError = ref(false);
const participationRetry = ref(0);
const participationNeedsSignIn = ref(false);
const sectionPref = ref('seated_any');
const arrivalPref = ref('doors');
let participationRequest = 0;

watch(
  [() => props.id, () => currentUser.value?.id, () => participationRetry.value],
  async ([concertId, userId]) => {
    const requestId = ++participationRequest;
    participationBusy.value = false;
    participation.value = null;
    participationError.value = '';
    participationLoadError.value = false;
    participationNeedsSignIn.value = false;
    sectionPref.value = 'seated_any';
    arrivalPref.value = 'doors';
    participationLoading.value = Boolean(userId);
    if (!userId) return;
    try {
      const result = await api.participation(concertId);
      if (requestId !== participationRequest) return;
      participation.value = result.participation;
      if (result.participation) {
        sectionPref.value = result.participation.sectionPref;
        arrivalPref.value = result.participation.arrivalPref;
      }
    } catch (err) {
      if (requestId !== participationRequest) return;
      participationNeedsSignIn.value = err.status === 401;
      participationLoadError.value = err.status !== 401;
      participationError.value = err.status === 401
        ? 'Your session has expired. Sign in to join.'
        : `Could not load your Kaki participation: ${err.message}`;
    } finally {
      if (requestId === participationRequest) participationLoading.value = false;
    }
  },
  { immediate: true },
);

async function saveParticipation() {
  if (participationBusy.value || participationLoading.value) return;
  const requestId = participationRequest;
  participationBusy.value = true;
  participationError.value = '';
  try {
    const result = await api.joinConcert(props.id, {
      sectionPref: sectionPref.value,
      arrivalPref: arrivalPref.value,
    });
    if (requestId === participationRequest) participation.value = result.participation;
  } catch (err) {
    if (requestId === participationRequest) {
      participationNeedsSignIn.value = err.status === 401;
      participationError.value = err.status === 401
        ? 'Your session has expired. Sign in to join.'
        : `Could not save your Kaki participation: ${err.message}`;
    }
  } finally {
    if (requestId === participationRequest) participationBusy.value = false;
  }
}

async function leaveParticipation() {
  if (participationBusy.value || participationLoading.value || !participation.value) return;
  const requestId = participationRequest;
  participationBusy.value = true;
  participationError.value = '';
  try {
    await api.leaveConcert(props.id);
    if (requestId === participationRequest) participation.value = null;
  } catch (err) {
    if (requestId === participationRequest) {
      participationNeedsSignIn.value = err.status === 401;
      participationError.value = err.status === 401
        ? 'Your session has expired. Sign in to leave.'
        : `Could not leave Kaki: ${err.message}`;
    }
  } finally {
    if (requestId === participationRequest) participationBusy.value = false;
  }
}

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

/* ---- Judging mode -------------------------------------------------------
 * Two ways to read the same set. The deck is for deciding one at a time, which
 * is how preference data would really be collected; the list is for scanning
 * and comparing. The choice is remembered, because it reflects what a person
 * came to do rather than a passing preference.
 */
const mode = ref(localStorage.getItem('encore-browse-mode') === 'list' ? 'list' : 'deck');

watch(mode, (value) => localStorage.setItem('encore-browse-mode', value));

/** Shortlisted and passed ids, so the deck's decisions survive a mode switch. */
const shortlisted = ref([]);
const passed = ref([]);

const undecided = computed(() => {
  const seen = new Set([...shortlisted.value, ...passed.value]);
  return parties.value.filter((p) => !seen.has(p.id));
});

function onShortlist(party) {
  if (!shortlisted.value.includes(party.id)) shortlisted.value.push(party.id);
}

function onPass(party) {
  if (!passed.value.includes(party.id)) passed.value.push(party.id);
}

/** The expanded card. Null when nothing is open. */
const opened = ref(null);

function openParty(party) {
  opened.value = party;
}

function closeParty() {
  opened.value = null;
}

/* A dialog that cannot be dismissed from the keyboard is not a dialog. The
 * listener is bound only while something is open so it never competes with the
 * deck's own arrow-key handling. */
function onGlobalKeydown(event) {
  if (event.key === 'Escape' && opened.value) {
    event.stopPropagation();
    closeParty();
  }
}

watch(opened, (value) => {
  if (value) {
    window.addEventListener('keydown', onGlobalKeydown);
    // Stop the page behind scrolling under the overlay.
    document.body.style.overflow = 'hidden';
  } else {
    window.removeEventListener('keydown', onGlobalKeydown);
    document.body.style.overflow = '';
  }
});

onUnmounted(() => {
  window.removeEventListener('keydown', onGlobalKeydown);
  document.body.style.overflow = '';
});

function resetDecisions() {
  shortlisted.value = [];
  passed.value = [];
}

/* Headline forecast numbers count up, because they are the figures the page is
 * actually about. Everything else on the page renders statically. */
const forecastMatched = useCountUp(() => preview.value?.metrics?.matched ?? 0, {
  duration: 1000,
});
const forecastFirstChoice = useCountUp(
  () => Math.round((preview.value?.metrics?.firstChoiceRate ?? 0) * 100),
  { duration: 1100 },
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
              <strong class="tabular">{{ forecastMatched }}</strong>
              of {{ preview.metrics.eligibleSeekers }} placed
            </p>
            <p class="head__forecast-note">
              <span class="tag tag--mint">{{ preview.metrics.blockingPairs }} blocking pairs</span>
              <span class="tag tabular">{{ forecastFirstChoice }}% first choice</span>
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

      <section class="kaki-join card" aria-labelledby="kaki-join-title">
        <div class="kaki-join__intro">
          <h2 id="kaki-join-title">Find a concert Kaki</h2>
          <p>Joining Kaki lets you discover other concertgoers. It does not enroll you in the stable group matching round or submit a group request.</p>
        </div>
        <p v-if="!currentUser" class="kaki-join__state">
          <RouterLink to="/login" class="btn btn--primary">Sign in to join Kaki</RouterLink>
        </p>
        <p v-else-if="participationLoading" class="kaki-join__state" role="status">Loading your participation…</p>
        <div v-else-if="participationNeedsSignIn" class="kaki-join__state">
          <p role="alert">{{ participationError }}</p>
          <RouterLink to="/login" class="btn btn--primary">Sign in</RouterLink>
        </div>
        <div v-else-if="participationLoadError" class="kaki-join__state">
          <p class="kaki-join__error" role="alert">{{ participationError }}</p>
          <button class="btn btn--ghost" type="button" @click="participationRetry++">Retry loading participation</button>
        </div>
        <form v-else class="kaki-join__form" @submit.prevent="saveParticipation">
          <p v-if="participation" class="kaki-join__joined">You have joined Kaki for this concert.</p>
          <div class="kaki-join__fields">
            <label>
              Preferred section
              <select v-model="sectionPref" :disabled="participationBusy" required>
                <option v-for="(label, value) in LABELS.section" :key="value" :value="value">{{ label }}</option>
              </select>
            </label>
            <label>
              Arrival plan
              <select v-model="arrivalPref" :disabled="participationBusy" required>
                <option v-for="(label, value) in LABELS.arrival" :key="value" :value="value">{{ label }}</option>
              </select>
            </label>
          </div>
          <p v-if="participationError" class="kaki-join__error" role="alert">{{ participationError }}</p>
          <div class="kaki-join__actions">
            <RouterLink v-if="participation" to="/kaki" class="btn btn--ghost">Explore Kaki Finder</RouterLink>
            <button type="submit" class="btn btn--primary" :disabled="participationBusy">
              {{ participationBusy ? 'Working…' : participation ? 'Save preferences' : 'Join Kaki' }}
            </button>
            <button v-if="participation" type="button" class="btn btn--ghost" :disabled="participationBusy" @click="leaveParticipation">Leave Kaki</button>
          </div>
        </form>
      </section>

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
      <div v-if="tab === 'parties'" class="browse">
        <div class="browse__bar">
          <div class="segmented" role="group" aria-label="How to browse groups">
            <button
              type="button"
              class="segmented__btn"
              :class="{ 'segmented__btn--on': mode === 'deck' }"
              :aria-pressed="mode === 'deck'"
              @click="mode = 'deck'"
            >
              Decide
            </button>
            <button
              type="button"
              class="segmented__btn"
              :class="{ 'segmented__btn--on': mode === 'list' }"
              :aria-pressed="mode === 'list'"
              @click="mode = 'list'"
            >
              Compare
            </button>
            <span class="segmented__thumb" :class="`segmented__thumb--${mode}`" aria-hidden="true" />
          </div>

          <div v-if="shortlisted.length || passed.length" class="browse__tally">
            <span class="tag tag--mint tabular">{{ shortlisted.length }} shortlisted</span>
            <span class="tag tabular">{{ passed.length }} passed</span>
            <button type="button" class="browse__reset" @click="resetDecisions">Start over</button>
          </div>
        </div>

        <!-- Deck mode --------------------------------------------------- -->
        <div v-if="mode === 'deck'" class="judge">
          <p v-if="!parties.length" class="notice">
            No groups have listed spare tickets yet.
          </p>
          <template v-else>
            <div class="judge__deck">
              <SwipeDeck
                :items="undecided"
                @shortlist="onShortlist"
                @pass="onPass"
                @open="openParty"
              >
                <template #card="{ item, isTop }">
                  <PartyCard :party="item" :show-chart="isTop" />
                </template>
              </SwipeDeck>
            </div>

            <!-- The panel is not filler: it is where a person learns that
                 shortlisting is an input to the algorithm, not a request sent
                 to the group. That distinction is the whole product. -->
            <aside class="judge__aside">
              <h3 class="judge__title">What this does</h3>
              <p class="judge__body">
                Shortlisting builds your preference list. It does not message anyone.
                When the round runs, the algorithm reads every list at once and finds
                an assignment nobody would want to break.
              </p>

              <div class="judge__shortlist">
                <p class="judge__label">
                  Your shortlist
                  <span class="tabular judge__label-count">{{ shortlisted.length }}</span>
                </p>
                <TransitionGroup name="chip" tag="ul" class="judge__chips">
                  <li v-for="id in shortlisted" :key="id" class="judge__chip">
                    {{ parties.find((p) => p.id === id)?.host.displayName }}
                  </li>
                </TransitionGroup>
                <p v-if="!shortlisted.length" class="judge__empty">
                  Nothing yet. Drag a card right, or press →.
                </p>
              </div>
            </aside>
          </template>
        </div>

        <!-- Compare mode ------------------------------------------------ -->
        <div v-else class="listing">
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

    <!-- ------------------------------------------------------ Expanded card -->
    <Teleport to="body">
      <Transition name="sheet">
        <div v-if="opened" class="sheet" @click.self="closeParty">
          <div
            class="sheet__panel"
            role="dialog"
            aria-modal="true"
            :aria-label="`${opened.host.displayName}'s group`"
          >
            <button class="sheet__close" type="button" aria-label="Close" @click="closeParty">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
            <PartyCard :party="opened" />
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.kaki-join { display: grid; gap: var(--space-4); margin-bottom: var(--space-6); padding: var(--space-5); }
.kaki-join__intro h2 { font-size: var(--step-1); }
.kaki-join__intro p { margin-top: var(--space-2); color: var(--text-300); }
.kaki-join__form { display: grid; gap: var(--space-4); }
.kaki-join__joined { color: var(--mint-400); }
.kaki-join__fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-4); }
.kaki-join__fields label { display: grid; gap: var(--space-2); color: var(--text-300); font-size: var(--step--1); }
.kaki-join__fields select { min-width: 0; width: 100%; padding: var(--space-3); border: var(--border-soft); border-radius: var(--radius-md); background: var(--ink-700); }
.kaki-join__actions { display: flex; flex-wrap: wrap; gap: var(--space-3); }
.kaki-join__error { color: var(--rose-400); }
@media (max-width: 600px) { .kaki-join__fields { grid-template-columns: 1fr; } }

/* ---- Browse: mode switch ------------------------------------------------ */

.browse {
  display: grid;
  gap: var(--space-5);
}

.browse__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--space-3);
}

/* A sliding thumb rather than two independently styled buttons: the movement
   shows that these are two states of one control, and where you came from. */
.segmented {
  position: relative;
  display: inline-flex;
  padding: 3px;
  border-radius: var(--radius-pill);
  border: var(--border-hairline);
  background: var(--ink-850);
}

.segmented__btn {
  position: relative;
  z-index: 1;
  padding: var(--space-2) var(--space-5);
  border: 0;
  border-radius: var(--radius-pill);
  background: none;
  color: var(--text-300);
  font: inherit;
  font-size: var(--step--1);
  font-weight: 500;
  cursor: pointer;
  transition: color var(--dur-base) var(--ease-glide);
}

.segmented__btn--on {
  color: var(--ink-900);
}

.segmented__btn:focus-visible {
  outline: 2px solid var(--accent-500);
  outline-offset: 2px;
}

.segmented__thumb {
  position: absolute;
  top: 3px;
  bottom: 3px;
  width: calc(50% - 3px);
  border-radius: var(--radius-pill);
  background: linear-gradient(180deg, var(--accent-400), var(--accent-500));
  box-shadow: var(--shadow-accent);
  transition: transform var(--dur-base) var(--ease-spring-soft);
}

.segmented__thumb--deck { transform: translateX(0); }
.segmented__thumb--list { transform: translateX(100%); }

.browse__tally {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.browse__reset {
  border: 0;
  background: none;
  padding: 0;
  color: var(--text-400);
  font: inherit;
  font-size: var(--step--2);
  text-decoration: underline;
  text-underline-offset: 3px;
  cursor: pointer;
}

.browse__reset:hover { color: var(--text-200); }

/* Deck and explanation share a row so the deck is anchored to the page's left
   edge like everything else, instead of floating in the middle of the column. */
.judge {
  display: grid;
  grid-template-columns: minmax(0, 26rem) minmax(0, 1fr);
  gap: var(--space-7);
  align-items: start;
}

.judge__deck {
  min-width: 0;
}

.judge__aside {
  position: sticky;
  top: calc(var(--header-height) + var(--space-5));
  display: grid;
  gap: var(--space-4);
  padding: var(--space-5);
  border-radius: var(--radius-lg);
  border: var(--border-hairline);
  background: var(--ink-850);
}

.judge__title {
  margin: 0;
  font-family: var(--font-display);
  font-size: var(--step-1);
  letter-spacing: -0.015em;
}

.judge__body {
  margin: 0;
  max-width: 46ch;
  font-size: var(--step--1);
  line-height: 1.6;
  color: var(--text-300);
}

.judge__shortlist {
  padding-top: var(--space-4);
  border-top: var(--border-hairline);
}

.judge__label {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin: 0 0 var(--space-3);
  font-size: var(--step--2);
  color: var(--text-400);
}

.judge__label-count {
  padding: 1px var(--space-2);
  border-radius: var(--radius-pill);
  background: color-mix(in oklab, var(--mint-400) 16%, transparent);
  color: var(--mint-400);
}

.judge__chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.judge__chip {
  padding: var(--space-1) var(--space-3);
  border-radius: var(--radius-pill);
  border: 1px solid color-mix(in oklab, var(--mint-400) 28%, transparent);
  background: color-mix(in oklab, var(--mint-400) 10%, transparent);
  color: var(--text-200);
  font-size: var(--step--2);
}

.judge__empty {
  margin: 0;
  font-size: var(--step--2);
  color: var(--text-400);
}

/* A name arriving in the shortlist is the only confirmation that a swipe did
   anything, so it gets a spring rather than a fade. */
.chip-enter-active {
  transition:
    transform var(--dur-slow) var(--ease-spring),
    opacity var(--dur-fast) linear;
}

.chip-leave-active {
  transition:
    transform var(--dur-fast) var(--ease-glide),
    opacity var(--dur-fast) linear;
  position: absolute;
}

.chip-enter-from {
  opacity: 0;
  transform: scale(0.6);
}

.chip-leave-to {
  opacity: 0;
  transform: scale(0.8);
}

@media (max-width: 900px) {
  .judge {
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-5);
  }

  .judge__aside {
    position: static;
  }
}

/* ---- Expanded card ------------------------------------------------------ */

.sheet {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: grid;
  place-items: center;
  padding: var(--gutter);
  background: rgba(4, 3, 8, 0.6);
  backdrop-filter: blur(8px);
}

.sheet__panel {
  position: relative;
  width: min(32rem, 100%);
  max-height: 85vh;
  overflow-y: auto;
  padding: var(--space-6);
  border-radius: var(--radius-xl);
  border: 1px solid var(--ink-500);
  background: var(--ink-800);
  box-shadow: var(--shadow-lg);
}

/* Keep the card's own badges clear of the close button, which sits over the
   same corner. */
.sheet__panel :deep(.face__head) {
  padding-right: var(--space-7);
}

.sheet__close {
  position: absolute;
  top: var(--space-4);
  right: var(--space-4);
  z-index: 2;
  display: grid;
  place-items: center;
  width: 2rem;
  height: 2rem;
  border-radius: 50%;
  border: var(--border-hairline);
  background: var(--ink-700);
  color: var(--text-300);
  cursor: pointer;
  transition:
    background var(--dur-fast) var(--ease-glide),
    transform var(--dur-fast) var(--ease-spring);
}

.sheet__close svg {
  width: 0.95rem;
  height: 0.95rem;
  fill: none;
  stroke: currentColor;
  stroke-width: 2.5;
  stroke-linecap: round;
}

.sheet__close:hover {
  background: var(--ink-600);
  color: var(--text-100);
}

.sheet__close:active { transform: scale(0.92); }

/* The panel scales up from slightly small as it fades in, which reads as the
   card you tapped growing rather than a new surface appearing over it. */
.sheet-enter-active,
.sheet-leave-active {
  transition: opacity var(--dur-base) var(--ease-glide);
}

.sheet-enter-active .sheet__panel {
  transition: transform var(--dur-slow) var(--ease-spring-soft);
}

.sheet-leave-active .sheet__panel {
  transition: transform var(--dur-fast) var(--ease-glide);
}

.sheet-enter-from,
.sheet-leave-to {
  opacity: 0;
}

.sheet-enter-from .sheet__panel {
  transform: scale(0.92) translateY(12px);
}

.sheet-leave-to .sheet__panel {
  transform: scale(0.97);
}

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

/* .meter now lives in base.css — both this listing and the swipe card use it. */

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
