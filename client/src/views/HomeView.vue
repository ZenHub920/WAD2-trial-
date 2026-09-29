<script setup>
import { ref, onMounted } from 'vue';
import { api, formatShortDate } from '../api.js';
import StabilityDemo from '../components/StabilityDemo.vue';

const concerts = ref([]);
const loading = ref(true);

onMounted(async () => {
  try {
    const data = await api.concerts();
    concerts.value = data.concerts.slice(0, 3);
  } catch {
    concerts.value = [];
  } finally {
    loading.value = false;
  }
});

const steps = [
  {
    n: '01',
    title: 'Say what your night looks like',
    body:
      'Section, budget, whether you queue at noon or turn up at doors, and what you ' +
      'want either side of the show. Not a bio — the things that actually decide ' +
      'whether two people enjoy the same evening.',
  },
  {
    n: '02',
    title: 'We build everyone\'s ranking',
    body:
      'You never rank strangers by hand. The system scores every compatible pairing ' +
      'from both directions at once — because a host putting up a spare ticket and ' +
      'someone looking for one do not care about the same things.',
  },
  {
    n: '03',
    title: 'Matching runs when the round closes',
    body:
      'Not first-come-first-served. Everyone is considered together, and the result ' +
      'is provably stable: there is no pair of people who would both rather have ' +
      'been matched with each other.',
  },
];
</script>

<template>
  <div>
    <!-- ---------------------------------------------------------------- Hero -->
    <section class="hero">
      <div class="hero__glow" aria-hidden="true" />
      <div class="container hero__inner">
        <p class="eyebrow">Concert companion matching</p>

        <h1 class="hero__title">
          Nobody should skip a show
          <span class="hero__accent">for want of company.</span>
        </h1>

        <p class="lede hero__lede">
          You wanted the ticket. Your friends did not want the artist. Encore groups
          concert-goers by how they actually want to spend the night — and does it with
          an algorithm that will not leave two people wishing they had been paired
          with each other.
        </p>

        <div class="hero__actions">
          <RouterLink to="/concerts" class="btn btn--primary">Browse concerts</RouterLink>
          <RouterLink to="/method" class="btn btn--ghost">How the matching works</RouterLink>
        </div>

        <dl class="hero__stats">
          <div>
            <dt>Blocking pairs</dt>
            <dd class="tabular">0</dd>
            <p>in every matching we publish</p>
          </div>
          <div>
            <dt>Ranking</dt>
            <dd class="tabular">8</dd>
            <p>signals scored per pairing</p>
          </div>
          <div>
            <dt>Guarantee</dt>
            <dd>Optimal</dd>
            <p>best stable result for seekers</p>
          </div>
        </dl>
      </div>
    </section>

    <!-- --------------------------------------------------------- The problem -->
    <section class="section">
      <div class="container problem">
        <div class="problem__text prose">
          <p class="eyebrow">The gap</p>
          <h2>Ticketing solved supply. It never solved company.</h2>
          <p>
            Resale markets will find you a seat in ninety seconds. Nothing will find you
            someone to sit in it with. So the fan who wants the pit goes with the friend
            who wants to sit down, or does not go at all.
          </p>
          <p>
            The forums that try to fill the gap run on speed: whoever replies to the
            thread first gets the spare ticket. That is not matching, it is a race — and
            it reliably pairs people who have nothing in common beyond the date.
          </p>
        </div>

        <figure class="problem__compare">
          <figcaption>Two ways to fill a spare ticket</figcaption>
          <div class="compare">
            <div class="compare__col compare__col--bad">
              <h3>First reply wins</h3>
              <ul>
                <li>Fastest responder, not best fit</li>
                <li>No account of budget or section</li>
                <li>People keep looking after "matching"</li>
                <li>Pairs dissolve before the date</li>
              </ul>
            </div>
            <div class="compare__col compare__col--good">
              <h3>Stable matching</h3>
              <ul>
                <li>Everyone considered together</li>
                <li>Eight compatibility signals, both directions</li>
                <li>No pair would rather swap</li>
                <li>Result is provable, not asserted</li>
              </ul>
            </div>
          </div>
        </figure>
      </div>
    </section>

    <!-- ------------------------------------------------------------ The idea -->
    <section class="section stability">
      <div class="container">
        <div class="stability__head prose">
          <p class="eyebrow">What "stable" means</p>
          <h2>A match is only good if nobody wants out of it.</h2>
          <p>
            Two people form a <strong>blocking pair</strong> when they would both rather
            be with each other than with whoever they were given. One blocking pair is
            one broken group. Drag the slider and watch one appear.
          </p>
        </div>

        <StabilityDemo />
      </div>
    </section>

    <!-- --------------------------------------------------------------- Steps -->
    <section class="section">
      <div class="container">
        <p class="eyebrow">How it runs</p>
        <h2 class="steps__title">Three things happen between signing up and standing in the room.</h2>

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
            <p class="eyebrow">Open rounds</p>
            <h2>Matching now</h2>
          </div>
          <RouterLink to="/concerts" class="btn btn--ghost">See all concerts</RouterLink>
        </div>

        <div v-if="loading" class="upcoming__grid">
          <div v-for="n in 3" :key="n" class="skeleton-card" />
        </div>

        <p v-else-if="!concerts.length" class="empty-note">
          No concerts loaded. Start the API with <code>npm start</code> in
          <code>server/</code>, then seed it with <code>npm run seed</code>.
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
            <div class="mini__meta">
              <span class="tag">{{ concert.open_slots }} slots</span>
              <span class="tag tag--accent">{{ concert.open_seekers }} looking</span>
            </div>
          </RouterLink>
        </div>
      </div>
    </section>

    <!-- ----------------------------------------------------------------- CTA -->
    <section class="section">
      <div class="container">
        <div class="cta">
          <div class="cta__content">
            <h2>Watch the algorithm decide.</h2>
            <p>
              Every round records its proposals step by step. Play one back and see
              exactly who proposed to whom, who was displaced, and why the result holds.
            </p>
            <RouterLink to="/concerts" class="btn btn--primary">Open a round</RouterLink>
          </div>
          <div class="cta__viz" aria-hidden="true">
            <span v-for="n in 28" :key="n" class="cta__bar" :style="{ '--i': n }" />
          </div>
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

.hero__stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  gap: var(--space-5);
  margin-top: var(--space-8);
  padding-top: var(--space-6);
  border-top: var(--border-hairline);
}

.hero__stats dt {
  font-family: var(--font-mono);
  font-size: var(--step--2);
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: var(--text-400);
}

.hero__stats dd {
  font-family: var(--font-display);
  font-size: var(--step-4);
  font-weight: 700;
  color: var(--text-100);
  line-height: 1;
  margin-block: var(--space-2) var(--space-1);
}

.hero__stats p {
  font-size: var(--step--1);
  color: var(--text-400);
}

/* ------------------------------------------------------------- Problem ---- */

.problem {
  display: grid;
  gap: var(--space-7);
}

@media (min-width: 940px) {
  .problem {
    grid-template-columns: 1fr 1fr;
    gap: var(--space-8);
    align-items: center;
  }
}

.problem__text h2 {
  margin-block: var(--space-3) var(--space-4);
}

.problem__compare figcaption {
  font-family: var(--font-mono);
  font-size: var(--step--2);
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: var(--text-400);
  margin-bottom: var(--space-3);
}

.compare {
  display: grid;
  gap: var(--space-4);
}

@media (min-width: 560px) {
  .compare {
    grid-template-columns: 1fr 1fr;
  }
}

.compare__col {
  padding: var(--space-5);
  border-radius: var(--radius-lg);
  border: var(--border-hairline);
  background: var(--ink-800);
}

.compare__col h3 {
  font-size: var(--step-0);
  margin-bottom: var(--space-4);
  padding-bottom: var(--space-3);
  border-bottom: var(--border-hairline);
}

.compare__col ul {
  list-style: none;
  padding: 0;
  display: grid;
  gap: var(--space-3);
  font-size: var(--step--1);
  color: var(--text-300);
}

.compare__col li {
  display: flex;
  gap: var(--space-2);
  align-items: flex-start;
  line-height: 1.45;
}

.compare__col li::before {
  flex-shrink: 0;
  font-family: var(--font-mono);
  font-size: var(--step--1);
  line-height: 1.45;
}

.compare__col--bad { border-color: color-mix(in oklab, var(--rose-400) 26%, var(--ink-600)); }
.compare__col--bad h3 { color: var(--rose-400); }
.compare__col--bad li::before { content: '×'; color: var(--rose-400); }

.compare__col--good { border-color: color-mix(in oklab, var(--mint-400) 26%, var(--ink-600)); }
.compare__col--good h3 { color: var(--mint-400); }
.compare__col--good li::before { content: '✓'; color: var(--mint-400); }

/* ----------------------------------------------------------- Stability ---- */

.stability__head {
  margin-bottom: var(--space-6);
}

.stability__head h2 {
  margin-block: var(--space-3) var(--space-4);
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
  grid-template-columns: repeat(auto-fill, minmax(255px, 1fr));
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

.mini__meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-top: var(--space-4);
}

.skeleton-card {
  height: 176px;
  border-radius: var(--radius-lg);
  background: linear-gradient(
    100deg,
    var(--ink-800) 30%,
    var(--ink-750) 50%,
    var(--ink-800) 70%
  );
  background-size: 220% 100%;
  animation: shimmer 1.4s ease-in-out infinite;
}

@keyframes shimmer {
  from { background-position: 180% 0; }
  to   { background-position: -80% 0; }
}

.empty-note {
  padding: var(--space-6);
  border: 1px dashed var(--ink-500);
  border-radius: var(--radius-lg);
  color: var(--text-400);
  font-size: var(--step--1);
}

.empty-note code {
  color: var(--accent-400);
}

/* ----------------------------------------------------------------- CTA ---- */

.cta {
  position: relative;
  overflow: hidden;
  border-radius: var(--radius-xl);
  border: var(--border-hairline);
  background:
    radial-gradient(120% 140% at 0% 0%, color-mix(in oklab, var(--accent-500) 14%, transparent), transparent 58%),
    var(--ink-800);
  padding: var(--space-7) var(--space-6);
  display: grid;
  gap: var(--space-6);
}

@media (min-width: 880px) {
  .cta {
    grid-template-columns: 1fr auto;
    align-items: center;
    padding: var(--space-8);
  }
}

.cta__content h2 {
  max-width: 16ch;
}

.cta__content p {
  margin-block: var(--space-4) var(--space-5);
  color: var(--text-300);
  max-width: 48ch;
}

.cta__viz {
  display: flex;
  align-items: flex-end;
  gap: 4px;
  height: 130px;
}

.cta__bar {
  width: 5px;
  border-radius: 3px;
  background: linear-gradient(to top, var(--accent-600), var(--accent-400));
  height: 22%;
  animation: eq 1600ms var(--ease-out) infinite alternate;
  animation-delay: calc(var(--i) * -70ms);
  opacity: 0.85;
}

@keyframes eq {
  from { height: 14%; }
  to   { height: 100%; }
}

@media (prefers-reduced-motion: reduce) {
  .cta__bar { animation: none; height: 55%; }
  .hero__glow { animation: none; }
}
</style>
