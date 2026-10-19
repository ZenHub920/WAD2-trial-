<script setup>
import { ref, onMounted } from 'vue';
import { api, formatShortDate } from '../api.js';
import LoadingSpinner from '../components/LoadingSpinner.vue';

const concerts = ref([]);
const loading = ref(true);
const error = ref(false);

onMounted(async () => {
  try {
    const data = await api.externalConcerts();
    concerts.value = data.events.slice(0, 3);
  } catch {
    error.value = true;
  } finally {
    loading.value = false;
  }
});

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
      <div class="hero__glow" aria-hidden="true" />
      <div class="container hero__inner">

        <h1 class="hero__title">
          Nobody should skip a show
          <span class="hero__accent">for want of company.</span>
        </h1>

        <p class="lede hero__lede">
          Find people going to the same concert and make plans together.
        </p>

        <div class="hero__actions">
          <RouterLink to="/concerts" class="btn btn--primary">Browse concerts</RouterLink>
          <RouterLink to="/groups" class="btn btn--ghost">Find a group</RouterLink>
        </div>

      </div>
    </section>

    <!-- --------------------------------------------------------------- Steps -->
    <section class="section">
      <div class="container">
        <h2 class="steps__title">Go together</h2>

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
        <p v-else-if="!concerts.length" class="empty-note">
          No upcoming concerts are available.
        </p>

        <div v-else class="upcoming__grid">
          <RouterLink
            v-for="concert in concerts"
            :key="concert.id"
            :to="`/concerts/${concert.id}`"
            class="card card--interactive mini"
          >
            <p class="mini__date mono">{{ formatShortDate(concert.event_date) }}</p>
            <h3 class="mini__artist">{{ concert.artist }}</h3>
            <p class="mini__venue">{{ concert.venue }}</p>
          </RouterLink>
        </div>
      </div>
    </section>

  </div>
</template>

<style scoped>
/* ---------------------------------------------------------------- Hero ---- */

.hero {
  position: relative;
  padding-block: var(--space-9) var(--space-8);
  overflow: hidden;
}

.hero__glow {
  position: absolute;
  top: -40%;
  left: 50%;
  width: min(900px, 120vw);
  aspect-ratio: 1;
  translate: -50% 0;
  background: radial-gradient(
    circle,
    var(--accent-glow) 0%,
    transparent 62%
  );
  pointer-events: none;
  animation: drift 14s ease-in-out infinite alternate;
}

@keyframes drift {
  from { transform: translate(-4%, 0) scale(1); }
  to   { transform: translate(4%, 3%) scale(1.08); }
}

.hero__inner {
  position: relative;
}

.hero__title {
  margin-top: var(--space-4);
  font-size: var(--step-6);
  max-width: 18ch;
}

.hero__accent {
  display: block;
  color: var(--accent-400);
}

.hero__lede {
  margin-top: var(--space-5);
  max-width: 58ch;
}

.hero__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  margin-top: var(--space-6);
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
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 255px), 1fr));
}

.mini {
  text-decoration: none;
  display: block;
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
  .hero__glow { animation: none; }
}
</style>
