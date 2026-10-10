<script setup>
/** Profile History — server-backed skipped profiles, likes and mutual matches. */
import { ref, computed, onMounted } from 'vue';
import { RouterLink } from 'vue-router';
import { avatarFor, clearDecision, loadPool, readDecisions, relativeTime } from '../kaki.js';
import { formatShortDate } from '../api.js';

const loading = ref(true);
const error = ref(null);
const people = ref([]);
const decisions = ref({});
const query = ref('');
const confirming = ref(null);
const undoing = ref(false);
const undoError = ref(null);

onMounted(async () => {
  try {
    const [pool, saved] = await Promise.all([loadPool(), readDecisions()]);
    people.value = pool.people;
    decisions.value = saved;
  } catch (err) {
    error.value = err;
  } finally {
    loading.value = false;
  }
});

/** Decided people, newest first, joined back to their profile. */
const decided = computed(() => {
  const byId = new Map(people.value.map((p) => [p.id, p]));
  return Object.entries(decisions.value)
    .map(([id, record]) => ({ person: byId.get(id), ...record }))
    // Decisions for ineligible or withdrawn people cannot be acted on here.
    .filter((row) => row.person)
    .sort((a, b) => b.at - a.at);
});

const matches = (text) => {
  const needle = query.value.trim().toLowerCase();
  return !needle || text.toLowerCase().includes(needle);
};

const skipped = computed(() =>
  decided.value.filter(
    (row) =>
      row.decision === 'skip' &&
      matches(`${row.person.user.displayName} ${row.person.artist}`),
  ),
);

const liked = computed(() =>
  decided.value.filter(
    (row) =>
      row.decision === 'like' &&
      matches(`${row.person.user.displayName} ${row.person.artist}`),
  ),
);

function confirm(row) {
  undoError.value = null;
  confirming.value = row;
}

async function undo() {
  if (undoing.value) return;
  undoing.value = true;
  undoError.value = null;
  try {
    await clearDecision(confirming.value.person);
    const next = { ...decisions.value };
    delete next[confirming.value.person.id];
    decisions.value = next;
    confirming.value = null;
  } catch (err) {
    undoError.value = err;
  } finally {
    undoing.value = false;
  }
}
</script>

<template>
  <div class="hist">
    <header class="hist__head">
      <RouterLink to="/kaki" class="hist__back" aria-label="Back to Kaki Finder">←</RouterLink>
      <h1 class="hist__title">Profile History</h1>
      <span />
    </header>

    <p class="hist__lede">Your skips, likes and mutual matches — undo any decision.</p>

    <label class="hist__search">
      <span class="sr-only">Search by name or concert</span>
      <input v-model="query" type="search" placeholder="Search by name or concert" />
    </label>

    <p v-if="loading" class="hist__state">Loading…</p>

    <div v-else-if="error" class="notice notice--error">
      <h3>{{ error.status === 401 ? 'Sign in to view your history' : 'Could not load history' }}</h3>
      <p v-if="error.status !== 401" class="mono">{{ error.message }}</p>
      <RouterLink v-if="error.status === 401" to="/login" class="btn btn--primary">Sign in</RouterLink>
    </div>
    <template v-else>
      <p v-if="skipped.length === 0 && liked.length === 0" class="hist__state">
        Nothing yet. Skipped and liked profiles show up here.
      </p>

      <section v-if="skipped.length" class="hist__section">
        <h2 class="hist__h2">Skipped</h2>
        <ul class="hist__list">
          <li v-for="row in skipped" :key="row.person.id" class="hist__row">
            <span
              class="hist__avatar"
              :style="{
                background: avatarFor(row.person.user).bg,
                color: avatarFor(row.person.user).fg,
              }"
              aria-hidden="true"
            >{{ avatarFor(row.person.user).initials }}</span>

            <span class="hist__who">
              <strong>{{ row.person.user.displayName }}</strong>
              <span class="hist__sub">
                {{ row.person.artist }} ({{ formatShortDate(row.person.eventDate) }})
              </span>
              <span class="hist__time">{{ relativeTime(row.at) }}</span>
            </span>

            <button class="hist__undo" @click="confirm(row)">↺ Undo Skip</button>
          </li>
        </ul>
      </section>

      <section v-if="liked.length" class="hist__section">
        <h2 class="hist__h2">Likes and matches</h2>
        <ul class="hist__list">
          <li v-for="row in liked" :key="row.person.id" class="hist__row">
            <span
              class="hist__avatar"
              :style="{
                background: avatarFor(row.person.user).bg,
                color: avatarFor(row.person.user).fg,
              }"
              aria-hidden="true"
            >{{ avatarFor(row.person.user).initials }}</span>

            <span class="hist__who">
              <strong>{{ row.person.user.displayName }}</strong>
              <span class="hist__sub">
                {{ row.person.artist }} ({{ formatShortDate(row.person.eventDate) }})
              </span>
              <span class="hist__time">{{ relativeTime(row.at) }}</span>
              <span class="hist__time">
                {{ row.mutual ? 'Matched — mutual like' : 'Liked — waiting for their like' }}
              </span>
            </span>

            <button class="hist__undo" @click="confirm(row)">↺ Undo</button>
          </li>
        </ul>
      </section>
    </template>

    <!-- Undo always removes the saved server decision. -->
    <div v-if="confirming" class="sheet" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
      <div class="sheet__card">
        <p id="confirm-title" class="sheet__title">
          Put {{ confirming.person.user.displayName }} back in the deck?
        </p>
        <p class="sheet__body">
          {{ confirming.decision === 'like' && confirming.mutual
            ? 'This will remove the mutual match and put this profile back in your deck.'
            : 'They will appear again next time you swipe.' }}
        </p>
        <p v-if="undoError" class="notice notice--error" role="alert">
          Could not undo. Your decision is unchanged.
          <RouterLink v-if="undoError.status === 401" to="/login">Sign in</RouterLink>
          <span v-else class="mono">{{ undoError.message }}</span>
        </p>
        <div class="sheet__buttons">
          <button class="btn btn--ghost" :disabled="undoing" @click="confirming = null">Cancel</button>
          <button class="btn btn--primary" :disabled="undoing" @click="undo">
            {{ undoing ? 'Saving…' : 'Confirm' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.hist {
  max-width: var(--app-width);
  margin: 0 auto;
  padding: var(--space-4) var(--space-4) var(--space-8);
}

.hist__head {
  display: grid;
  grid-template-columns: 2.5rem 1fr 2.5rem;
  align-items: center;
  margin-bottom: var(--space-2);
}

.hist__title {
  margin: 0;
  text-align: center;
  font-family: var(--font-display);
  font-size: var(--step-2);
  font-weight: 800;
  color: var(--text-100);
}

.hist__back {
  display: grid;
  place-items: center;
  width: 2.25rem;
  height: 2.25rem;
  border-radius: var(--radius-pill);
  color: var(--text-100);
  text-decoration: none;
  font-size: var(--step-1);
}

.hist__back:hover {
  background: var(--ink-700);
}

.hist__lede {
  margin: 0 0 var(--space-4);
  text-align: center;
  font-size: var(--step--1);
  color: var(--text-300);
}

.hist__search input {
  width: 100%;
  padding: var(--space-3) var(--space-4);
  background: var(--ink-800);
  border: var(--border-hairline);
  border-radius: var(--radius-md);
  font-family: var(--font-body);
  font-size: var(--step-0);
  color: var(--text-100);
}

.hist__state {
  padding: var(--space-6) 0;
  text-align: center;
  color: var(--text-300);
}

.hist__section {
  margin-top: var(--space-5);
}

.hist__h2 {
  margin: 0 0 var(--space-3);
  font-size: var(--step--1);
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-300);
}

.hist__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.hist__row {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3);
  background: var(--ink-850);
  border: var(--border-hairline);
  border-radius: var(--radius-md);
}

.hist__avatar {
  display: grid;
  place-items: center;
  width: 46px;
  height: 46px;
  border-radius: 50%;
  font-weight: 800;
  font-size: var(--step--1);
}

.hist__who {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.hist__who strong {
  color: var(--text-100);
  font-size: var(--step-0);
}

.hist__sub,
.hist__time {
  font-size: var(--step--2);
  color: var(--text-300);
}

.hist__time {
  color: var(--text-400);
}

.hist__undo {
  padding: var(--space-2) var(--space-3);
  background: var(--accent-600);
  color: #fff;
  border: none;
  border-radius: var(--radius-pill);
  font-family: var(--font-body);
  font-size: var(--step--2);
  font-weight: 700;
  cursor: pointer;
  white-space: nowrap;
}

.hist__undo:hover {
  background: var(--accent-500);
}

/* ---- Confirmation sheet ------------------------------------------------ */

.sheet {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: grid;
  place-items: center;
  padding: var(--space-5);
  background: rgba(47, 25, 95, 0.35);
}

.sheet__card {
  width: min(100%, 340px);
  padding: var(--space-5);
  background: var(--ink-800);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg);
  text-align: center;
}

.sheet__title {
  margin: 0 0 var(--space-2);
  font-weight: 800;
  color: var(--text-100);
}

.sheet__body {
  margin: 0 0 var(--space-4);
  font-size: var(--step--1);
  color: var(--text-300);
}

.sheet__buttons {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-3);
}

.btn {
  padding: var(--space-3) var(--space-4);
  border: none;
  border-radius: var(--radius-md);
  font-family: var(--font-body);
  font-weight: 700;
  cursor: pointer;
}

.btn--primary {
  background: var(--accent-600);
  color: #fff;
}

.btn--ghost {
  background: var(--ink-700);
  color: var(--text-100);
}
</style>
