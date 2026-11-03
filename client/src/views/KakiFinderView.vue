<script setup>
/**
 * Finder stages preserve filters while a frozen deck keeps each cursor stable.
 * A swipe advances only after the server has stored its decision.
 */
import { ref, computed, onMounted, watch } from 'vue';
import { RouterLink } from 'vue-router';
import SwipeDeck from '../components/SwipeDeck.vue';
import KakiCard from '../components/kaki/KakiCard.vue';
import UserAvatar from '../components/UserAvatar.vue';
import LoadingSpinner from '../components/LoadingSpinner.vue';
import { currentUser } from '../auth.js';
import { LABELS, formatDate } from '../api.js';
import {
  EMPTY_FILTERS,
  applyFilters,
  clearDecision,
  loadPool,
  loadRecommendations,
  readDecisions,
  writeDecision,
} from '../kaki.js';

const stage = ref('filters'); // filters | deck | matched

const loading = ref(true);
const error = ref(null);
const swipeError = ref(null);
const swipePending = ref(false);
const people = ref([]);
const decisions = ref({});

const filters = ref({ ...EMPTY_FILTERS });
const applied = ref({ ...EMPTY_FILTERS });

/**
 * Ranking state.
 *
 * `ranked` is false until the questionnaire is answered — before that the deck
 * is whatever the filters leave, in pool order, and the page says so rather
 * than implying an order that means nothing.
 */
const ranked = ref(false);
const rankingSolver = ref(null);
const stablePartnerId = ref(null);
const ranking = ref(false);

/** The person on the match screen. */
const matchedWith = ref(null);
const matchedDecision = ref(null);

onMounted(async () => {
  try {
    const [pool, saved] = await Promise.all([loadPool(), readDecisions()]);
    // Eligibility and concert context are already joined in the server pool.
    people.value = pool.people;
    decisions.value = saved;
  } catch (err) {
    error.value = err;
  } finally {
    loading.value = false;
  }
});

/* ---- Filter options, derived from what is actually in the pool ----------
 * Offering an artist nobody is looking for company at produces an empty deck
 * and reads as a bug, so every option here comes from the loaded data. */

const artists = computed(() =>
  [...new Set(people.value.map((p) => p.artist))].sort(),
);

/** Dates for the chosen artist — the prototype's date list is artist-scoped. */
const dates = computed(() => {
  const pool = filters.value.artist
    ? people.value.filter((p) => p.artist === filters.value.artist)
    : people.value;
  return [...new Set(pool.map((p) => p.eventDate))].sort();
});
watch(() => filters.value.artist, () => {
  if (filters.value.date && !dates.value.includes(filters.value.date)) filters.value.date = '';
});

const sections = computed(() =>
  [...new Set(people.value.map((p) => p.sectionPref))].sort(),
);

/**
 * The deck is a SNAPSHOT, taken when filters are applied — not a live computed.
 *
 * SwipeDeck keeps its own cursor and advances it on every commit. If the array
 * also shrank as each decision was recorded, the item would leave at the
 * cursor's position AND the cursor would move past it, so every second profile
 * would be skipped and the counter would fall by two per swipe. Freezing the
 * list for the duration of the session is what keeps the cursor meaningful.
 *
 * Decisions are still filtered out — just at the moment the deck is built,
 * which is also when an undo from the history screen takes effect.
 */
const deck = ref([]);

/**
 * The deck comes back ordered from the server, which filtered and THEN ranked.
 * Decisions are removed here rather than there, because an undo from the
 * history screen has to take effect without another round trip.
 */
async function buildDeck() {
  if (ranking.value) return;
  ranking.value = true;
  deck.value = [];
  stablePartnerId.value = null;
  try {
    const result = await loadRecommendations(applied.value);
    ranked.value = result.ranked;
    rankingSolver.value = result.solver ?? null;
    stablePartnerId.value = result.stablePartnerId ?? null;
    const decided = new Set(Object.keys(decisions.value));
    deck.value = result.people.filter((person) => !decided.has(person.id));
  } catch {
    // The ranked endpoint is an enhancement; the pool already loaded.
    ranked.value = false;
    const decided = new Set(Object.keys(decisions.value));
    deck.value = applyFilters(people.value, applied.value, decided);
  } finally {
    ranking.value = false;
  }
}

/** Count under the CURRENTLY EDITED filters, so Apply can preview its result. */
const previewCount = computed(() => {
  const decided = new Set(Object.keys(decisions.value));
  return applyFilters(people.value, filters.value, decided).length;
});

function resetFilters() {
  filters.value = { ...EMPTY_FILTERS };
}

async function applyAndContinue() {
  applied.value = { ...filters.value };
  stage.value = 'deck';
  await buildDeck();
}

/* ---- Age range ----------------------------------------------------------
 * Two range inputs stacked on one track. Each clamps against the other so the
 * handles cannot cross and produce an empty range.
 */
function onAgeMin(event) {
  const value = Number(event.target.value);
  filters.value.ageMin = Math.min(value, filters.value.ageMax - 1);
  // Vue skips the DOM patch when the clamped value is unchanged, so pin the thumb here.
  event.target.value = filters.value.ageMin;
}

function onAgeMax(event) {
  const value = Number(event.target.value);
  filters.value.ageMax = Math.max(value, filters.value.ageMin + 1);
  event.target.value = filters.value.ageMax;
}

const agePercent = computed(() => ({
  left: `${((filters.value.ageMin - 18) / 82) * 100}%`,
  right: `${100 - ((filters.value.ageMax - 18) / 82) * 100}%`,
}));

/* ---- Deck outcomes ------------------------------------------------------ */

async function recordSwipe(person, direction) {
  swipeError.value = null;
  const saved = await writeDecision(person, direction === 'right' ? 'like' : 'skip');
  decisions.value = { ...decisions.value, [person.id]: saved };
  return saved;
}

async function undoSwipe(person) {
  swipeError.value = null;
  await clearDecision(person);
  const next = { ...decisions.value };
  delete next[person.id];
  decisions.value = next;
}

function onLike(person) {
  matchedWith.value = person;
  matchedDecision.value = decisions.value[person.id];
  stage.value = 'matched';
}

function backToDeck() {
  matchedDecision.value = null;
  // The deck unmounted when the match screen took over, so SwipeDeck's cursor
  // restarts at zero. Rebuilding here drops everyone already decided, which is
  // safe to do precisely because no live cursor is pointing into the old list.
  buildDeck();
  stage.value = 'deck';
}

</script>

<template>
  <div class="kaki" :class="{ 'kaki--filters': stage === 'filters' }">
    <!-- ------------------------------------------------------------ Head -->
    <header class="kaki__head">
      <button
        v-if="stage !== 'filters'"
        class="kaki__back"
        aria-label="Back"
        :disabled="swipePending || ranking"
        @click="stage === 'matched' ? backToDeck() : stage = 'filters'"
      >
        ←
      </button>
      <div class="kaki__identity"><p class="kaki__eyebrow mono">Kaki finder</p><h1 class="kaki__title">Find a companion</h1></div>
      <div class="kaki__actions">
        <RouterLink
          to="/kaki/history" class="kaki__icon-btn" aria-label="Companion history"
          :aria-disabled="swipePending" @click="swipePending && $event.preventDefault()"
        >
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8" />
            <path d="M12 7v5l3 2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
          </svg>
        </RouterLink>
        <button
          v-if="stage !== 'filters'"
          class="kaki__icon-btn"
          aria-label="Edit filters"
          title="Edit filters"
          :disabled="swipePending || ranking"
          @click="stage = 'filters'"
        >
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M4 7h16M7 12h10M10 17h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
          </svg>
        </button>
      </div>
    </header>

    <ol class="kaki__progress" aria-label="Finding a companion">
      <li :aria-current="stage === 'filters' ? 'step' : undefined"><span aria-hidden="true">01</span>Your concert</li>
      <li :aria-current="stage === 'deck' ? 'step' : undefined"><span aria-hidden="true">02</span>Meet the fans</li>
      <li :aria-current="stage === 'matched' ? 'step' : undefined"><span aria-hidden="true">03</span>Like & connect</li>
    </ol>

    <div v-if="loading" class="kaki__state loading-state"><LoadingSpinner />Loading people…</div>

    <div v-else-if="error" class="notice notice--error">
      <h3>{{ error.status === 401 ? 'Sign in to find a companion' : 'Could not load the finder' }}</h3>
      <p v-if="error.status !== 401">Companion profiles could not be loaded. Please refresh and try again.</p>
      <RouterLink v-if="error.status === 401" to="/login" class="btn btn--primary">Sign in</RouterLink>
    </div>
    <!-- --------------------------------------------------------- Filters -->
    <section v-else-if="stage === 'filters'" class="kaki__panel kaki__filter-workspace" aria-labelledby="kaki-filter-heading">
      <div class="kaki__filter-main">
      <p class="kaki__eyebrow mono">Start with the show</p>
      <h2 id="kaki-filter-heading" class="kaki__h2">Filter people</h2>
      <p class="kaki__hint">People appear at concerts you have joined. A like becomes a match only when you both like each other.</p>

      <div class="kaki__concert-fields">
      <label class="field">
        <span>Artist</span>
        <select v-model="filters.artist">
          <option value="">All artists</option>
          <option v-for="artist in artists" :key="artist" :value="artist">{{ artist }}</option>
        </select>
      </label>

      <label class="field">
        <span>Concert date</span>
        <select v-model="filters.date">
          <option value="">All concert dates</option>
          <option v-for="date in dates" :key="date" :value="date">{{ formatDate(date) }}</option>
        </select>
      </label>
      </div>

      <details class="kaki__refine">
      <summary><span>Refine who you meet<small>{{ filters.section ? LABELS.section[filters.section] : 'All sections' }} · Ages {{ filters.ageMin }}–{{ filters.ageMax }}</small></span><svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m6 8 4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg></summary>
      <div class="kaki__refine-fields">
      <label class="field">
        <span>Section</span>
        <select v-model="filters.section">
          <option value="">All sections</option>
          <option v-for="section in sections" :key="section" :value="section">
            {{ LABELS.section[section] }}
          </option>
        </select>
      </label>

      <div class="range">
        <div class="range__head">
          <span>Age range</span>
          <span class="range__values">
            <strong>{{ filters.ageMin }}</strong> – <strong>{{ filters.ageMax }}</strong>
          </span>
        </div>
        <div class="range__track">
          <div class="range__fill" :style="{ left: agePercent.left, right: agePercent.right }" />
          <input
            type="range" min="18" max="100" :value="filters.ageMin"
            aria-label="Minimum age" @input="onAgeMin"
          />
          <input
            type="range" min="18" max="100" :value="filters.ageMax"
            aria-label="Maximum age" @input="onAgeMax"
          />
        </div>
      </div>
      </div>
      </details>

      <div class="kaki__filter-footer">
        <p class="kaki__count" aria-live="polite"><strong class="key-figure">{{ previewCount }}</strong> {{ previewCount === 1 ? 'person matches' : 'people match' }} these filters<span v-if="!people.length">. Join a concert from <RouterLink to="/concerts">Concerts</RouterLink> to find eligible companions.</span></p>

      <div class="kaki__buttons">
        <button class="btn btn--ghost" @click="resetFilters">Reset</button>
        <button class="btn btn--primary" :disabled="previewCount === 0" @click="applyAndContinue">
          Find people
        </button>
      </div>
      </div>
      </div>
      <aside class="kaki__guide" aria-label="How companion matching works">
        <div class="kaki__guide-mark" aria-hidden="true"><svg viewBox="0 0 32 32" fill="none"><path d="M10 22c-4-3-6-6-6-10a6 6 0 0 1 12-1 6 6 0 0 1 12 1c0 5-5 9-12 14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg></div>
        <h3>Same show.<br> Someone new.</h3>
        <p>Your filters set the scene. Your private preferences help order the profiles.</p>
        <ol><li><strong>Explore one at a time</strong><span>See their concert vibe and match reasons.</span></li><li><strong>Like when it feels right</strong><span>It becomes a match when they like you too.</span></li><li><strong>Make a plan together</strong><span>Open a chat after a mutual match, then plan your meetup.</span></li></ol>
      </aside>
    </section>

    <!-- ------------------------------------------------------------ Deck -->
    <section v-else-if="stage === 'deck'" class="kaki__panel">
      <div class="kaki__deck-heading"><div><p class="kaki__eyebrow mono">Your concert company</p><h2 class="kaki__h2">Meet the fans</h2></div><span class="kaki__deck-count">Both likes to connect</span></div>
      <!-- Say what order this is in. Ranked or not, the viewer should never
           have to guess whether the deck means anything. -->
      <p v-if="ranking" class="rank-note loading-state" role="status"><LoadingSpinner />Ranking your matches…</p>
      <p v-else-if="ranked" class="rank-note rank-note--on">
        Ordered by how well you match, using your questionnaire answers.
        <span v-if="stablePartnerId">Your strongest mutual match is first.</span>
      </p>
      <p v-else class="rank-note">
        Filtered, not ranked.
        <RouterLink to="/profile#preferences">Tell us what you enjoy</RouterLink>
        and we will order these by how well you match.
      </p>

      <div v-if="swipeError" class="notice notice--error" role="alert">
        <p>Could not save this change. Please try again.</p>
        <RouterLink v-if="swipeError.status === 401" to="/login">Sign in</RouterLink>
        <p v-else>Your choice has not been saved. Try the same profile again.</p>
      </div>
      <p v-if="!ranking && deck.length === 0" class="kaki__state">
        No one left under these filters.
        <button class="btn btn--text" @click="stage = 'filters'">Change filters</button>
      </p>
      <SwipeDeck
        v-else-if="!ranking"
        :items="deck"
        :show-profile="false"
        noun-singular="profile"
        noun-plural="profiles"
        yes-label="Like"
        no-label="Skip"
        yes-past="Liked"
        no-past="Skipped"
        :commit-item="recordSwipe"
        :undo-item="undoSwipe"
        @pending-change="swipePending = $event"
        @commit-error="swipeError = $event"
        @shortlist="onLike"
      >
        <template #card="{ item }">
          <KakiCard :person="item" :viewer="currentUser" />
        </template>
        <template #empty>
          <p>You're all caught up. Check Messages for your matches.</p>
        </template>
      </SwipeDeck>
    </section>

    <!-- --------------------------------------------------------- Matched -->
    <section v-else-if="stage === 'matched'" class="kaki__panel kaki__panel--centre">

      <p class="kaki__connection-state"><span aria-hidden="true">{{ matchedDecision?.mutual ? '✓' : '↗' }}</span>{{ matchedDecision?.mutual ? 'Mutual match' : 'Like sent' }}</p>

      <h2 class="kaki__h2 kaki__h2--centre">
        {{ matchedDecision?.mutual ? 'You matched with' : 'You liked' }}
        {{ matchedWith.user.displayName.split(' ')[0] }}{{ matchedDecision?.mutual ? '!' : '.' }}
      </h2>

      <div class="match__avatars">
        <UserAvatar :src="currentUser?.avatarUrl" :name="currentUser?.displayName ?? 'You'" :size="86" />
        <UserAvatar :src="matchedWith.user.avatarUrl" :name="matchedWith.user.displayName" :size="86" />
      </div>

      <p class="match__note">
        {{ matchedDecision?.mutual
          ? 'You both liked each other.'
          : 'Waiting for them to like you back.' }}
      </p>
      <RouterLink v-if="matchedDecision?.mutual" to="/messages" class="btn btn--primary">
        Messages
      </RouterLink>

      <button class="btn btn--text" @click="backToDeck">Keep swiping</button>
    </section>
  </div>
</template>

<style scoped>
/* Profile cards retain their readable deck width; the setup can use a second
   column to explain the next action without crowding its primary controls. */
.kaki {
  max-width: var(--app-width);
  margin: 0 auto;
  padding: var(--space-4) var(--space-4) var(--space-8);
  min-height: 70vh;
}
.kaki--filters {
  max-width: min(100%, 980px);
}

.kaki__head {
  display: grid;
  grid-template-columns: 2.75rem minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: var(--space-5);
}

.kaki__identity {
  grid-column: 2;
  text-align: center;
  min-width: 0;
}
.kaki__eyebrow {
  margin: 0 0 var(--space-1);
  color: var(--accent-400);
  font-size: var(--step--2);
  font-weight: 700;
  letter-spacing: .08em;
  text-transform: uppercase;
}
.kaki__title {
  margin: 0;
  text-align: center;
  font-family: var(--font-display);
  font-size: var(--step-2);
  font-weight: 800;
  color: var(--text-100);
  overflow-wrap: anywhere;
}

.kaki__back,
.kaki__icon-btn {
  display: grid;
  place-items: center;
  width: 2.75rem;
  height: 2.75rem;
  border: 1px solid var(--panel-edge);
  background: var(--panel-bg);
  box-shadow: var(--panel-shadow);
  border-radius: var(--radius-md);
  color: var(--text-100);
  font-size: var(--step-1);
  cursor: pointer;
  transition: transform var(--dur-fast) var(--ease-settle), background var(--dur-fast) var(--ease-settle), box-shadow var(--dur-fast) var(--ease-settle);
}

.kaki__back:hover,
.kaki__icon-btn:hover {
  background: var(--ink-700);
}

.kaki__icon-btn svg {
  width: 20px;
  height: 20px;
}

.kaki__actions {
  display: flex;
  gap: var(--space-1);
}
.kaki__progress {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  list-style: none;
  padding: 0;
  margin: 0 0 var(--space-5);
  border-bottom: 1px solid var(--panel-edge);
}
.kaki__progress li {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-1);
  margin-bottom: -1px;
  border-bottom: 2px solid transparent;
  color: var(--text-400);
  font-size: var(--step--2);
  font-weight: 700;
  transition: border-color var(--dur-base) var(--ease-settle), color var(--dur-base) var(--ease-settle);
}
.kaki__progress li span {
  font-variant-numeric: tabular-nums;
  opacity: .65;
}
.kaki__progress li[aria-current='step'] {
  border-bottom-color: var(--accent-400);
  color: var(--accent-400);
}

.kaki__hint {
  margin: 0 0 var(--space-3);
  color: var(--text-300);
  font-size: var(--step--1);
}

.kaki__panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  animation: kaki-workspace-in var(--dur-slow) var(--ease-settle) both;
}
.kaki__filter-workspace {
  display: grid;
  grid-template-columns: minmax(0, 1.45fr) minmax(0, 1fr);
  gap: var(--space-5);
  align-items: start;
}
.kaki__filter-main {
  display: grid;
  gap: var(--space-3);
  padding: var(--space-5);
  border: 1px solid var(--panel-edge);
  border-radius: var(--radius-lg);
  background: var(--panel-bg);
  box-shadow: var(--panel-shadow);
}
.kaki__concert-fields {
  display: grid;
  gap: var(--space-4);
}
.kaki__concert-fields .field,
.kaki__refine-fields .field {
  display: grid;
  gap: var(--space-2);
  font-size: var(--step--1);
  font-weight: 700;
}
.kaki__refine {
  margin-top: var(--space-2);
  border: 1px solid var(--panel-edge);
  border-radius: var(--radius-md);
  background: var(--ink-850);
}
.kaki__refine summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  list-style: none;
  color: var(--text-100);
  font-size: var(--step--1);
  font-weight: 700;
  cursor: pointer;
}
.kaki__refine summary::-webkit-details-marker { display: none; }
.kaki__refine summary small {
  display: block;
  margin-top: var(--space-1);
  color: var(--text-300);
  font-size: var(--step--2);
  font-weight: 400;
}
.kaki__refine summary svg {
  width: 20px;
  height: 20px;
  flex: none;
  color: var(--accent-400);
  transition: transform var(--dur-base) var(--ease-settle);
}
.kaki__refine[open] summary svg { transform: rotate(180deg); }
.kaki__refine-fields {
  display: grid;
  gap: var(--space-4);
  padding: var(--space-4);
  border-top: 1px solid var(--panel-edge);
  animation: kaki-workspace-in var(--dur-base) var(--ease-settle) both;
}
.kaki__filter-footer {
  border-top: 1px solid var(--panel-edge);
  margin-top: var(--space-2);
  padding-top: var(--space-4);
}
.kaki__guide {
  padding: var(--space-5) var(--space-3);
  border-left: 1px solid var(--panel-edge);
  color: var(--text-300);
}
.kaki__guide-mark {
  display: grid;
  place-items: center;
  width: 3rem;
  height: 3rem;
  margin-bottom: var(--space-4);
  border: 1px solid color-mix(in srgb, var(--accent-400) 40%, var(--panel-edge));
  border-radius: var(--radius-md);
  background: var(--accent-glow);
  color: var(--accent-400);
  box-shadow: inset 0 1px 0 var(--panel-highlight);
}
.kaki__guide-mark svg { width: 28px; height: 28px; }
.kaki__guide h3 {
  margin: 0 0 var(--space-3);
  color: var(--text-100);
  font-family: var(--font-display);
  font-size: var(--step-2);
  line-height: 1.15;
}
.kaki__guide > p { margin: 0; font-size: var(--step--1); line-height: 1.6; }
.kaki__guide ol {
  display: grid;
  gap: var(--space-4);
  padding: 0;
  margin: var(--space-5) 0 0;
  counter-reset: companion-step;
  list-style: none;
}
.kaki__guide li {
  position: relative;
  display: grid;
  gap: var(--space-1);
  padding-left: 1.8rem;
  font-size: var(--step--1);
  line-height: 1.5;
}
.kaki__guide li::before {
  counter-increment: companion-step;
  content: counter(companion-step, decimal-leading-zero);
  position: absolute;
  left: 0;
  top: .15em;
  color: var(--accent-400);
  font-family: var(--font-mono);
  font-size: var(--step--2);
}
.kaki__guide strong { color: var(--text-200); }
.kaki__deck-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
}
.kaki__deck-heading .kaki__h2 { margin-bottom: 0; }
.kaki__deck-count {
  color: var(--text-300);
  font-size: var(--step--2);
  text-align: right;
}

.kaki__panel--centre {
  align-items: center;
  text-align: center;
  gap: var(--space-4);
  padding-top: var(--space-6);
}

.kaki__h2 {
  margin: 0 0 var(--space-2);
  overflow-wrap: anywhere;
  font-family: var(--font-display);
  font-size: var(--step-2);
  font-weight: 800;
  color: var(--text-100);
}

.kaki__h2--centre {
  text-align: center;
  margin: 0;
}

.rank-note {
  margin: 0 0 var(--space-2);
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-md);
  background: var(--ink-850);
  border: 1px solid var(--panel-edge);
  box-shadow: inset 0 1px 0 var(--panel-highlight);
  color: var(--text-300);
  font-size: var(--step--1);
}
.rank-note--on {
  border-left: 3px solid var(--accent-500);
  color: var(--text-200);
}

.kaki__state {
  padding: var(--space-6) 0;
  text-align: center;
  color: var(--text-300);
}

.kaki__count {
  margin: var(--space-1) 0 0;
  font-size: var(--step--1);
  color: var(--text-300);
  line-height: 1.5;
}
.kaki__count strong { color: var(--accent-400); font-size: var(--step-1); font-variant-numeric: tabular-nums; }

/* ---- Fields ------------------------------------------------------------ */


/* ---- Age range --------------------------------------------------------- */

.range {
  margin: var(--space-2) 0;
}

.range__head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  font-size: var(--step-0);
  font-weight: 700;
  color: var(--text-100);
  margin-bottom: var(--space-3);
}

.range__values {
  font-variant-numeric: tabular-nums;
  color: var(--text-200);
}

.range__track {
  position: relative;
  height: 24px;
}

.range__track::before {
  content: '';
  position: absolute;
  inset-inline: 0;
  top: 10px;
  height: 4px;
  background: var(--ink-600);
  border-radius: var(--radius-pill);
}

.range__fill {
  position: absolute;
  top: 10px;
  height: 4px;
  background: var(--accent-500);
  border-radius: var(--radius-pill);
}

/* Both inputs occupy the same space. Pointer events are disabled on the track
   and re-enabled on the thumbs, so whichever thumb is nearer takes the drag
   instead of the upper input swallowing every gesture. */
.range__track input {
  position: absolute;
  inset-inline: 0;
  top: 0;
  width: 100%;
  margin: 0;
  background: none;
  appearance: none;
  pointer-events: none;
}

.range__track input::-webkit-slider-thumb {
  appearance: none;
  pointer-events: auto;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--accent-600);
  border: 2px solid var(--ink-800);
  cursor: grab;
  box-shadow: 0 2px 4px color-mix(in srgb, var(--text-100) 18%, transparent);
  transition: box-shadow var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out);
}

.range__track input::-moz-range-thumb {
  pointer-events: auto;
  width: 20px;
  height: 20px;
  border: 2px solid var(--ink-800);
  border-radius: 50%;
  background: var(--accent-600);
  cursor: grab;
  box-shadow: 0 2px 4px color-mix(in srgb, var(--text-100) 18%, transparent);
  transition: box-shadow var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out);
}
.range__track input:active::-webkit-slider-thumb { cursor: grabbing; transform: scale(1.13); box-shadow: 0 0 0 5px var(--focus-halo); }
.range__track input:active::-moz-range-thumb { cursor: grabbing; transform: scale(1.13); box-shadow: 0 0 0 5px var(--focus-halo); }
.range__track input:focus-visible::-webkit-slider-thumb { box-shadow: 0 0 0 5px var(--focus-halo); }
.range__track input:focus-visible::-moz-range-thumb { box-shadow: 0 0 0 5px var(--focus-halo); }

/* ---- Buttons ----------------------------------------------------------- */

.kaki__buttons {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-3);
  margin-top: var(--space-3);
}

.btn {
  padding: var(--space-3) var(--space-5);
  border-radius: var(--radius-md);
  border: none;
  font-family: var(--font-body);
  font-size: var(--step-0);
  font-weight: 700;
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-out), opacity var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-settle), box-shadow var(--dur-fast) var(--ease-settle);
}
.btn:active:not(:disabled), .kaki__back:active:not(:disabled), .kaki__icon-btn:active:not(:disabled) { transform: translateY(1px) scale(.98); box-shadow: inset 0 1px 3px color-mix(in srgb, var(--text-100) 14%, transparent); }
.kaki :where(.btn, .kaki__back, .kaki__icon-btn, summary):focus-visible { outline: 2px solid var(--accent-400); outline-offset: 3px; }

.btn--primary {
  background: var(--accent-600);
  color: #fff;
}

.btn--primary:hover:not(:disabled) {
  background: var(--accent-500);
}

.btn--primary:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.btn--ghost {
  background: var(--ink-800);
  color: var(--text-100);
  border: var(--border-hairline);
}

.btn--ghost:hover {
  background: var(--ink-700);
}

.btn--text {
  background: none;
  color: var(--text-300);
  font-weight: 600;
  text-decoration: underline;
}

/* ---- Match ------------------------------------------------------------- */

.match__avatars {
  display: flex;
  gap: var(--space-4);
  padding: var(--space-4);
  border: 1px solid var(--panel-edge);
  border-radius: var(--radius-pill);
  background: linear-gradient(120deg, var(--accent-glow), transparent), var(--panel-bg);
  box-shadow: var(--panel-shadow);
}
.kaki__connection-state {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  margin: 0;
  color: var(--accent-400);
  font-size: var(--step--1);
  font-weight: 700;
}
.kaki__connection-state span { display: grid; place-items: center; width: 1.6rem; height: 1.6rem; border: 1px solid var(--accent-400); border-radius: 50%; background: var(--accent-glow); }


.match__note {
  margin: 0;
  font-size: var(--step--2);
  color: var(--text-400);
  max-width: 28ch;
}
@keyframes kaki-workspace-in {
  from { opacity: 0; transform: translateY(7px); }
  to { opacity: 1; transform: translateY(0); }
}
@media (max-width: 680px) {
  .kaki__filter-workspace { grid-template-columns: minmax(0, 1fr); }
  .kaki__guide { border-left: 0; border-top: 1px solid var(--panel-edge); padding: var(--space-5) var(--space-2) 0; }
  .kaki__guide-mark { display: none; }
  .kaki__guide h3 { font-size: var(--step-1); }
  .kaki__guide h3 br { display: none; }
  .kaki__guide ol { gap: var(--space-3); }
  .kaki__filter-main { padding: var(--space-4); }
}
@media (max-width: 380px) {
  .kaki__progress li { flex-direction: column; gap: var(--space-1); }
  .kaki__deck-heading { align-items: start; }
}

@media (prefers-reduced-motion: reduce) {
  .btn, .kaki__back, .kaki__icon-btn, .kaki__progress li, .kaki__refine summary svg {
    transition: none;
  }
  .kaki__panel, .kaki__refine-fields { animation: none; }
  .range__track input::-webkit-slider-thumb { transition: none; }
  .range__track input::-moz-range-thumb { transition: none; }
  .btn:active:not(:disabled), .kaki__back:active:not(:disabled), .kaki__icon-btn:active:not(:disabled) { transform: none; }
  .range__track input:active::-webkit-slider-thumb { transform: none; }
  .range__track input:active::-moz-range-thumb { transform: none; }
}
</style>
