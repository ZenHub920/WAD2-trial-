<script setup>
import { ref, computed, onMounted } from 'vue';
import { api, formatShortDate, formatDate } from '../api.js';
import LoadingSpinner from '../components/LoadingSpinner.vue';

const concerts = ref([]);
const loading = ref(true);
const error = ref(false);
// Ticketmaster image URLs occasionally 404; those cards fall back to the artwork.
const brokenImages = ref(new Set());

// The local list carries the companion counts; the provider list only adds
// concerts that have not been imported yet. Either may fail on its own.
onMounted(async () => {
  const [local, external] = await Promise.allSettled([api.concerts(), api.externalConcerts()]);
  if (local.status === 'rejected' && external.status === 'rejected') {
    error.value = true;
    loading.value = false;
    return;
  }
  const byId = new Map();
  for (const event of external.value?.events ?? []) byId.set(event.id, event);
  for (const concert of local.value?.concerts ?? []) {
    byId.set(concert.id, { ...byId.get(concert.id), ...concert });
  }
  const today = new Date().toISOString().slice(0, 10);
  concerts.value = [...byId.values()]
    // Locally seeded demo concerts have no provider source; keep them off the homepage.
    .filter((c) => c.source === 'ticketmaster' && c.event_date >= today)
    .sort((a, b) => a.event_date.localeCompare(b.event_date));
  loading.value = false;
});

const peopleCount = (c) => (c.open_seekers ?? 0) + (c.open_slots ?? 0);

// The busiest upcoming show leads the page; a photo breaks ties.
const featured = computed(() => {
  let best = null;
  for (const concert of concerts.value) {
    if (!best || peopleCount(concert) > peopleCount(best)
      || (peopleCount(concert) === peopleCount(best) && hasImage(concert) && !hasImage(best))) {
      best = concert;
    }
  }
  return best;
});

const upcoming = computed(() =>
  concerts.value.filter((c) => c.id !== featured.value?.id).slice(0, 6),
);

function hasImage(concert) {
  return Boolean(concert.hero_image_url) && !brokenImages.value.has(concert.id);
}

function markBroken(concert) {
  brokenImages.value = new Set(brokenImages.value).add(concert.id);
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const people = (n) => (n === 1 ? '1 person' : `${n} people`);

function peopleLine(c) {
  const seekers = c.open_seekers ?? 0;
  const groups = c.open_parties ?? 0;
  if (seekers && groups) return `${people(seekers)} looking · ${plural(groups, 'group')} open`;
  if (seekers) return `${people(seekers)} looking for company`;
  if (groups) return `${plural(groups, 'group')} with ${plural(c.open_slots ?? 0, 'spot')} left`;
  return 'Be the first to look for company';
}

const steps = [
  {
    n: '01',
    title: 'Pick your concert',
    body: 'Choose a show and tell us what you enjoy.',
  },
  {
    n: '02',
    title: 'Choose your company',
    body: 'Find a companion or request a place in a group.',
  },
  {
    n: '03',
    title: 'Make a plan together',
    body: 'Pick a time and place to meet before the show.',
  },
];
</script>

<template>
  <div>
    <!-- ---------------------------------------------------------------- Hero -->
    <section class="hero">
      <div class="container hero__inner">
        <div class="hero__copy">
          <h1 class="hero__title">
            Meet before the music.
            <span class="hero__accent">Walk in together.</span>
          </h1>

          <p class="lede hero__lede">
            Your next concert, with your kind of people. Meet fans who share your taste and plan where to meet before the show.
          </p>

          <div class="hero__actions">
            <RouterLink to="/concerts" class="btn btn--primary">Browse concerts</RouterLink>
            <RouterLink to="/groups" class="btn btn--ghost">Find a group</RouterLink>
          </div>
        </div>

        <RouterLink
          v-if="featured"
          :to="`/concerts/${featured.id}`"
          class="feature"
          :aria-label="`${featured.artist}, ${formatDate(featured.event_date)} at ${featured.venue}. ${peopleLine(featured)}`"
        >
          <div class="poster poster--feature">
            <img
              v-if="hasImage(featured)"
              :src="featured.hero_image_url"
              alt=""
              @error="markBroken(featured)"
            />
            <span v-else class="poster__initial" aria-hidden="true">{{ featured.artist.charAt(0) }}</span>
          </div>
          <div class="feature__body">
            <p class="feature__eyebrow mono">{{ peopleCount(featured) ? 'Most people looking' : 'Up next' }}</p>
            <p class="feature__artist">{{ featured.artist }}</p>
            <p class="feature__meta">{{ formatDate(featured.event_date) }} · {{ featured.venue }}</p>
            <p class="people" :class="{ 'people--quiet': !peopleCount(featured) }">
              {{ peopleLine(featured) }}
            </p>
          </div>
        </RouterLink>
        <div v-else-if="loading" class="feature feature--placeholder" aria-hidden="true" />
      </div>
    </section>

    <!-- --------------------------------------------------------------- Steps -->
    <section class="section">
      <div class="container">
        <h2 class="steps__title">Get started</h2>

        <ol class="steps">
          <li v-for="step in steps" :key="step.n" class="step">
            <span class="step__n mono">{{ step.n }}</span>
            <h3>{{ step.title }}</h3>
            <p>{{ step.body }}</p>
          </li>
        </ol>
      </div>
    </section>

    <!-- ------------------------------------------------------------ Concerts -->
    <section class="section">
      <div class="container">
        <div class="upcoming__head">
          <div>
            <h2>Find your next show</h2>
          </div>
          <RouterLink to="/concerts" class="btn btn--ghost">See all concerts</RouterLink>
        </div>

        <div v-if="loading" class="loading-state">
          <LoadingSpinner /> Loading concerts…
        </div>

        <p v-else-if="error" class="empty-note" role="alert">
          Concerts could not be loaded. Try again later.
        </p>
        <p v-else-if="!upcoming.length" class="empty-note">
          No upcoming concerts are available.
        </p>

        <div v-else class="upcoming__grid">
          <RouterLink
            v-for="concert in upcoming"
            :key="concert.id"
            :to="`/concerts/${concert.id}`"
            class="card card--interactive mini"
          >
            <div class="poster">
              <img
                v-if="hasImage(concert)"
                :src="concert.hero_image_url"
                alt=""
                loading="lazy"
                @error="markBroken(concert)"
              />
              <span v-else class="poster__initial" aria-hidden="true">{{ concert.artist.charAt(0) }}</span>
            </div>
            <div class="mini__body">
              <p class="mini__date mono">{{ formatShortDate(concert.event_date) }}</p>
              <h3 class="mini__artist">{{ concert.artist }}</h3>
              <p class="mini__venue">{{ concert.venue }}</p>
              <p class="people" :class="{ 'people--quiet': !peopleCount(concert) }">
                {{ peopleLine(concert) }}
              </p>
            </div>
          </RouterLink>
        </div>
      </div>
    </section>

  </div>
</template>

<style scoped>
/* ---------------------------------------------------------------- Hero ---- */

.hero {
  padding-block: var(--space-8) var(--space-7);
}

.hero__inner {
  display: grid;
  gap: var(--space-7);
  align-items: center;
}

@media (min-width: 900px) {
  .hero__inner {
    grid-template-columns: 1.1fr 1fr;
    gap: var(--space-8);
  }
}

.hero__title {
  font-size: var(--step-6);
  max-width: 18ch;
}

.hero__accent {
  display: block;
  color: var(--accent-400);
}

.hero__lede {
  margin-top: var(--space-5);
  max-width: 48ch;
}

.hero__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  margin-top: var(--space-6);
}

/* Featured concert: the hero's evidence that real shows and people are here. */
.feature {
  display: block;
  overflow: hidden;
  border: var(--border-hairline);
  border-radius: var(--radius-xl);
  background: var(--ink-800);
  box-shadow: var(--shadow-lg);
  text-decoration: none;
  transition:
    transform var(--dur-base) var(--ease-out),
    border-color var(--dur-base) var(--ease-out);
}

.feature:hover {
  transform: translateY(-3px);
  border-color: var(--ink-500);
}

.feature--placeholder {
  aspect-ratio: 4 / 3;
  background: var(--ink-850);
  box-shadow: none;
}

.feature__body {
  padding: var(--space-5) var(--space-6) var(--space-6);
}

.feature__eyebrow {
  font-size: var(--step--2);
  color: var(--accent-400);
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.feature__artist {
  font-family: var(--font-display);
  font-weight: 800;
  font-size: var(--step-3);
  line-height: 1.1;
  color: var(--text-100);
  margin-block: var(--space-2);
}

.feature__meta {
  color: var(--text-300);
  font-size: var(--step--1);
}

/* ---------------------------------------------------------------- Poster -- */

.poster {
  position: relative;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  display: grid;
  place-items: center;
  background: linear-gradient(135deg, var(--accent-300), var(--ink-700) 70%);
}

.poster img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.poster__initial {
  font-family: var(--font-display);
  font-weight: 800;
  font-size: var(--step-5);
  color: var(--accent-500);
  opacity: 0.55;
}

.poster--feature .poster__initial {
  font-size: var(--step-6);
}

/* ---------------------------------------------------------------- People -- */

.people {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-top: var(--space-4);
  font-size: var(--step--1);
  font-weight: 700;
  color: var(--accent-500);
}

.people::before {
  content: '';
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--mint-400);
}

.people--quiet {
  font-weight: 600;
  color: var(--text-400);
}

.people--quiet::before {
  background: var(--ink-500);
}

/* --------------------------------------------------------------- Steps ---- */

.steps__title {
  margin-block: var(--space-3) var(--space-6);
  max-width: 24ch;
}

.steps {
  list-style: none;
  padding: 0;
  display: grid;
  gap: var(--space-5);
  counter-reset: step;
}

@media (min-width: 860px) {
  .steps {
    grid-template-columns: repeat(3, 1fr);
  }
}

.step {
  position: relative;
  padding-top: var(--space-5);
  border-top: 2px solid var(--ink-600);
  transition: border-color var(--dur-base) var(--ease-out);
}

.step:hover {
  border-top-color: var(--accent-500);
}

.step__n {
  font-size: var(--step--2);
  color: var(--accent-400);
  letter-spacing: 0.1em;
}

.step h3 {
  font-size: var(--step-1);
  margin-block: var(--space-2) var(--space-3);
}

.step p {
  color: var(--text-300);
  font-size: var(--step--1);
}

/* ------------------------------------------------------------ Upcoming ---- */

.upcoming__head {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4);
  align-items: flex-end;
  justify-content: space-between;
  margin-bottom: var(--space-6);
}

.upcoming__head h2 {
  margin-top: var(--space-2);
}

.upcoming__grid {
  display: grid;
  gap: var(--space-4);
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 280px), 1fr));
}

.mini {
  text-decoration: none;
  display: flex;
  flex-direction: column;
  padding: 0;
  overflow: hidden;
}

.mini__body {
  display: flex;
  flex-direction: column;
  flex: 1;
  padding: var(--space-4) var(--space-5) var(--space-5);
}

.mini__body .people {
  margin-top: auto;
  padding-top: var(--space-4);
}

.mini__date {
  font-size: var(--step--2);
  color: var(--accent-400);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.mini__artist {
  font-size: var(--step-2);
  margin-block: var(--space-2) var(--space-1);
}

.mini__venue {
  color: var(--text-400);
  font-size: var(--step--1);
}

.empty-note {
  padding: var(--space-6);
  border: 1px dashed var(--ink-500);
  border-radius: var(--radius-lg);
  color: var(--text-400);
  font-size: var(--step--1);
}

@media (prefers-reduced-motion: reduce) {
  .feature,
  .feature:hover {
    transition: none;
    transform: none;
  }
}
</style>
