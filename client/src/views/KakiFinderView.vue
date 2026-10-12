<script setup>
/**
 * Finder stages preserve filters while a frozen deck keeps each cursor stable.
 * A swipe advances only after the server has stored its decision.
 */
import { ref, computed, onMounted } from 'vue';
import { RouterLink } from 'vue-router';
import SwipeDeck from '../components/SwipeDeck.vue';
import KakiCard from '../components/kaki/KakiCard.vue';
import { currentUser } from '../auth.js';
import { LABELS, formatDate } from '../api.js';
import {
  EMPTY_FILTERS,
  applyFilters,
  avatarFor,
  clearDecision,
  loadPool,
  readDecisions,
  writeDecision,
} from '../kaki.js';

const stage = ref('filters'); // filters | ready | tutorial | deck | matched

const loading = ref(true);
const error = ref(null);
const swipeError = ref(null);
const swipePending = ref(false);
const people = ref([]);
const decisions = ref({});

const filters = ref({ ...EMPTY_FILTERS });
const applied = ref({ ...EMPTY_FILTERS });

/** The person on the match screen. */
const matchedWith = ref(null);
const matchedDecision = ref(null);
const tutorialStep = ref(0);

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

function buildDeck() {
  const decided = new Set(Object.keys(decisions.value));
  deck.value = applyFilters(people.value, applied.value, decided);
}

/** Count under the CURRENTLY EDITED filters, so Apply can preview its result. */
const previewCount = computed(() => {
  const decided = new Set(Object.keys(decisions.value));
  return applyFilters(people.value, filters.value, decided).length;
});

function resetFilters() {
  filters.value = { ...EMPTY_FILTERS };
}

function applyAndContinue() {
  applied.value = { ...filters.value };
  buildDeck();
  stage.value = 'ready';
}

/* ---- Age range ----------------------------------------------------------
 * Two range inputs stacked on one track. Each clamps against the other so the
 * handles cannot cross and produce an empty range.
 */
function onAgeMin(event) {
  const value = Number(event.target.value);
  filters.value.ageMin = Math.min(value, filters.value.ageMax - 1);
}

function onAgeMax(event) {
  const value = Number(event.target.value);
  filters.value.ageMax = Math.max(value, filters.value.ageMin + 1);
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

/* ---- Tutorial -----------------------------------------------------------
 * Three coach marks from the prototype. Kept as an overlay on the real deck
 * rather than a set of illustrations, so what is pointed at is the live UI.
 */
const TUTORIAL = [
  { title: 'View profile history here', hint: 'Everyone you skipped, with an undo.' },
  { title: 'View filters here', hint: 'Change artist, date, section or age at any time.' },
  { title: 'Swipe card left or right', hint: 'Left to skip, right to like. A match needs both people to like each other.' },
];

function nextTutorial() {
  if (tutorialStep.value < TUTORIAL.length - 1) {
    tutorialStep.value += 1;
  } else {
    stage.value = 'deck';
  }
}

const viewer = computed(() => currentUser.value);

const matchAvatars = computed(() => {
  if (!matchedWith.value) return null;
  return {
    them: avatarFor(matchedWith.value.user),
    you: avatarFor(viewer.value ?? { displayName: 'You', id: 'you' }),
  };
});
</script>

<template>
  <div class="kaki">
    <!-- ------------------------------------------------------------ Head -->
    <header class="kaki__head">
      <button
        v-if="stage !== 'filters'"
        class="kaki__back"
        aria-label="Back"
        :disabled="swipePending"
        @click="stage === 'matched' ? backToDeck() : stage = 'filters'"
      >
        ←
      </button>
      <h1 class="kaki__title">Kaki Finder</h1>
      <div class="kaki__actions">
        <RouterLink
          to="/kaki/history" class="kaki__icon-btn" aria-label="Profile history"
          :aria-disabled="swipePending" @click="swipePending && $event.preventDefault()"
        >
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8" />
            <path d="M12 7v5l3 2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
          </svg>
        </RouterLink>
        <button
          class="kaki__icon-btn"
          aria-label="Filters"
          :disabled="swipePending"
          @click="stage = 'filters'"
        >
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M4 7h16M7 12h10M10 17h4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
          </svg>
        </button>
      </div>
    </header>

    <div v-if="loading" class="kaki__state">Loading people…</div>

    <div v-else-if="error" class="notice notice--error">
      <h3>{{ error.status === 401 ? 'Sign in to find a Kaki' : 'Could not load the finder' }}</h3>
      <p v-if="error.status !== 401" class="mono">{{ error.message }}</p>
      <RouterLink v-if="error.status === 401" to="/login" class="btn btn--primary">Sign in</RouterLink>
    </div>
    <!-- --------------------------------------------------------- Filters -->
    <section v-else-if="stage === 'filters'" class="kaki__panel">
      <h2 class="kaki__h2">Select filters to find Kaki</h2>

      <label class="field">
        <span class="sr-only">Artist</span>
        <select v-model="filters.artist">
          <option value="">Select artist from your Concerts</option>
          <option v-for="artist in artists" :key="artist" :value="artist">{{ artist }}</option>
        </select>
      </label>

      <label class="field">
        <span class="sr-only">Concert date</span>
        <select v-model="filters.date">
          <option value="">Concert Date(s)</option>
          <option v-for="date in dates" :key="date" :value="date">{{ formatDate(date) }}</option>
        </select>
      </label>

      <label class="field">
        <span class="sr-only">Section</span>
        <select v-model="filters.section">
          <option value="">Section</option>
          <option v-for="section in sections" :key="section" :value="section">
            {{ LABELS.section[section] }}
          </option>
        </select>
      </label>

      <!-- Seat number is in the prototype but has no column in the schema, so
           the control is shown disabled rather than silently doing nothing. -->
      <label class="field field--disabled">
        <span class="sr-only">Seat number</span>
        <select disabled>
          <option>Seat Number — not stored yet</option>
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
        <p class="range__note">Profiles carry an age band, so a band is kept when it overlaps.</p>
      </div>

      <!-- Gender is in the prototype, but the API's public user shape does not
           expose it. Shown disabled for the same reason as seat number. -->
      <label class="field field--disabled">
        <span class="sr-only">Gender</span>
        <select disabled>
          <option>Gender — not exposed by the API</option>
        </select>
      </label>

      <p class="kaki__count">
        {{ previewCount }} {{ previewCount === 1 ? 'person' : 'people' }} match these filters
      </p>

      <div class="kaki__buttons">
        <button class="btn btn--ghost" @click="resetFilters">Reset</button>
        <button class="btn btn--primary" :disabled="previewCount === 0" @click="applyAndContinue">
          Apply
        </button>
      </div>
    </section>

    <!-- ----------------------------------------------------------- Ready -->
    <section v-else-if="stage === 'ready'" class="kaki__panel kaki__panel--centre">
      <div class="ready__art" aria-hidden="true">
        <svg viewBox="0 0 120 70" fill="none">
          <circle cx="24" cy="18" r="9" stroke="currentColor" stroke-width="3" />
          <path d="M6 58c0-11 8-18 18-18s18 7 18 18" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
          <circle cx="96" cy="18" r="9" stroke="currentColor" stroke-width="3" />
          <path d="M78 58c0-11 8-18 18-18s18 7 18 18" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
          <circle cx="56" cy="40" r="4" fill="currentColor" />
          <circle cx="68" cy="34" r="4" fill="currentColor" />
          <path d="M60 40V20l12-4v18" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
        </svg>
      </div>
      <h2 class="kaki__h2 kaki__h2--centre">Ready to find your Kaki?</h2>
      <p class="ready__count">{{ deck.length }} {{ deck.length === 1 ? 'profile' : 'profiles' }} waiting</p>
      <button class="btn btn--primary btn--block" @click="stage = 'tutorial'; tutorialStep = 0">
        Start tutorial
      </button>
      <button class="btn btn--text" @click="stage = 'deck'">Skip tutorial</button>
    </section>

    <!-- -------------------------------------------------------- Tutorial -->
    <section v-else-if="stage === 'tutorial'" class="kaki__panel kaki__panel--centre">
      <div class="coach">
        <p class="coach__title">{{ TUTORIAL[tutorialStep].title }}</p>
        <p class="coach__hint">{{ TUTORIAL[tutorialStep].hint }}</p>
      </div>
      <div class="coach__dots" aria-hidden="true">
        <span v-for="(t, i) in TUTORIAL" :key="i" :class="{ on: i === tutorialStep }" />
      </div>
      <button class="btn btn--primary btn--block" @click="nextTutorial">
        {{ tutorialStep === TUTORIAL.length - 1 ? 'Start swiping' : 'Next' }}
      </button>
    </section>

    <!-- ------------------------------------------------------------ Deck -->
    <section v-else-if="stage === 'deck'" class="kaki__panel">
      <div v-if="swipeError" class="notice notice--error" role="alert">
        <p>Could not save this change. The deck has not moved; please try again.</p>
        <RouterLink v-if="swipeError.status === 401" to="/login">Sign in</RouterLink>
        <p v-else class="mono">{{ swipeError.message }}</p>
      </div>
      <p v-if="deck.length === 0" class="kaki__state">
        No one left under these filters.
        <button class="btn btn--text" @click="stage = 'filters'">Change filters</button>
      </p>
      <SwipeDeck
        v-else
        :items="deck"
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
          <KakiCard :person="item" :viewer="viewer" />
        </template>
        <template #empty>
          <p>All decisions are saved. A like becomes a match when they like you back.</p>
        </template>
      </SwipeDeck>
    </section>

    <!-- --------------------------------------------------------- Matched -->
    <section v-else-if="stage === 'matched'" class="kaki__panel kaki__panel--centre">
      <div class="ready__art" aria-hidden="true">
        <svg viewBox="0 0 120 70" fill="none">
          <circle cx="24" cy="18" r="9" stroke="currentColor" stroke-width="3" />
          <path d="M6 58c0-11 8-18 18-18s18 7 18 18" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
          <circle cx="96" cy="18" r="9" stroke="currentColor" stroke-width="3" />
          <path d="M78 58c0-11 8-18 18-18s18 7 18 18" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
          <circle cx="56" cy="40" r="4" fill="currentColor" />
          <circle cx="68" cy="34" r="4" fill="currentColor" />
          <path d="M60 40V20l12-4v18" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
        </svg>
      </div>

      <h2 class="kaki__h2 kaki__h2--centre">
        {{ matchedDecision?.mutual ? 'You matched with' : 'You liked' }}
        {{ matchedWith.user.displayName.split(' ')[0] }}{{ matchedDecision?.mutual ? '!' : '.' }}
      </h2>

      <div class="match__avatars">
        <span class="match__avatar" :style="{ background: matchAvatars.you.bg, color: matchAvatars.you.fg }">
          {{ matchAvatars.you.initials }}
        </span>
        <span class="match__avatar" :style="{ background: matchAvatars.them.bg, color: matchAvatars.them.fg }">
          {{ matchAvatars.them.initials }}
        </span>
      </div>

      <p class="match__note">
        {{ matchedDecision?.mutual
          ? 'You both liked each other. Messaging arrives with the Chat section.'
          : 'Your like is saved. It becomes a match only if they like you back.' }}
      </p>

      <button class="btn btn--text" @click="backToDeck">Keep swiping</button>
    </section>
  </div>
</template>

<style scoped>
/* The prototype is a phone. The finder keeps those proportions on a desktop
   screen rather than stretching, which is what the rest of the app does. */
.kaki {
  max-width: var(--app-width);
  margin: 0 auto;
  padding: var(--space-4) var(--space-4) var(--space-8);
  min-height: 70vh;
}

.kaki__head {
  display: grid;
  grid-template-columns: 2.5rem 1fr auto;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: var(--space-5);
}

.kaki__title {
  margin: 0;
  grid-column: 2;
  text-align: center;
  font-family: var(--font-display);
  font-size: var(--step-2);
  font-weight: 800;
  color: var(--text-100);
}

.kaki__back,
.kaki__icon-btn {
  display: grid;
  place-items: center;
  width: 2.25rem;
  height: 2.25rem;
  border: none;
  background: transparent;
  border-radius: var(--radius-pill);
  color: var(--text-100);
  font-size: var(--step-1);
  cursor: pointer;
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

.kaki__panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.kaki__panel--centre {
  align-items: center;
  text-align: center;
  gap: var(--space-4);
  padding-top: var(--space-6);
}

.kaki__h2 {
  margin: 0 0 var(--space-2);
  font-family: var(--font-display);
  font-size: var(--step-2);
  font-weight: 800;
  color: var(--text-100);
}

.kaki__h2--centre {
  text-align: center;
  margin: 0;
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
  text-align: center;
}

/* ---- Fields ------------------------------------------------------------ */

.field select {
  width: 100%;
  padding: var(--space-3) var(--space-4);
  background: var(--ink-800);
  border: var(--border-hairline);
  border-radius: var(--radius-md);
  color: var(--text-100);
  font-family: var(--font-body);
  font-size: var(--step-0);
  font-weight: 600;
  appearance: none;

  /* Chevron, so the control matches the prototype without an icon font. */
  background-image: linear-gradient(45deg, transparent 50%, var(--text-100) 50%),
    linear-gradient(135deg, var(--text-100) 50%, transparent 50%);
  background-position: calc(100% - 20px) 55%, calc(100% - 14px) 55%;
  background-size: 6px 6px, 6px 6px;
  background-repeat: no-repeat;
}

.field--disabled select {
  opacity: 0.55;
  cursor: not-allowed;
}

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
}

.range__track input::-moz-range-thumb {
  pointer-events: auto;
  width: 20px;
  height: 20px;
  border: 2px solid var(--ink-800);
  border-radius: 50%;
  background: var(--accent-600);
  cursor: grab;
}

.range__note {
  margin: var(--space-2) 0 0;
  font-size: var(--step--2);
  color: var(--text-400);
}

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
  transition: background var(--dur-fast) var(--ease-out), opacity var(--dur-fast) var(--ease-out);
}

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
  background: var(--accent-600);
  color: #fff;
}

.btn--ghost:hover {
  background: var(--accent-500);
}

.btn--block {
  width: 100%;
}

.btn--text {
  background: none;
  color: var(--text-300);
  font-weight: 600;
  text-decoration: underline;
}

/* ---- Ready / tutorial / match ------------------------------------------ */

.ready__art {
  color: var(--accent-600);
  width: 160px;
}

.ready__art svg {
  width: 100%;
  height: auto;
}

.ready__count {
  margin: 0;
  color: var(--text-300);
  font-size: var(--step--1);
}

.coach {
  background: var(--ink-800);
  border: var(--border-hairline);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
  padding: var(--space-4) var(--space-5);
}

.coach__title {
  margin: 0;
  font-weight: 800;
  font-size: var(--step-1);
  color: var(--text-100);
}

.coach__hint {
  margin: var(--space-2) 0 0;
  font-size: var(--step--1);
  color: var(--text-300);
}

.coach__dots {
  display: flex;
  gap: var(--space-2);
}

.coach__dots span {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--ink-600);
}

.coach__dots span.on {
  background: var(--accent-600);
}

.match__avatars {
  display: flex;
  gap: var(--space-4);
}

.match__avatar {
  display: grid;
  place-items: center;
  width: 86px;
  height: 86px;
  border-radius: 50%;
  font-family: var(--font-display);
  font-size: var(--step-2);
  font-weight: 800;
}

.match__note {
  margin: 0;
  font-size: var(--step--2);
  color: var(--text-400);
  max-width: 28ch;
}

@media (prefers-reduced-motion: reduce) {
  .btn {
    transition: none;
  }
}
</style>
