<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { api, formatShortDate, formatDate } from '../api.js';
import LoadingSpinner from '../components/LoadingSpinner.vue';
import { vReveal } from '../composables/useReveal.js';
import { useCountUp } from '../composables/useCountUp.js';
import { useReducedMotion } from '../composables/useReducedMotion.js';

const concerts = ref([]);
const loading = ref(true);
const error = ref(false);
// Ticketmaster image URLs occasionally 404; those cards fall back to the artwork.
const brokenImages = ref(new Set());
const reduced = useReducedMotion();

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

// The busiest upcoming shows rotate through the hero; a photo breaks ties.
const slides = computed(() =>
  [...concerts.value]
    .sort((a, b) => peopleCount(b) - peopleCount(a) || hasImage(b) - hasImage(a))
    .slice(0, 5),
);

const SLIDE_MS = 5000;
const activeSlide = ref(0);
const paused = ref(false);
const featured = computed(() => slides.value[activeSlide.value] ?? null);
let slideTimer = null;

function startSlides() {
  clearInterval(slideTimer);
  slideTimer = setInterval(() => {
    if (!paused.value && slides.value.length > 1) {
      activeSlide.value = (activeSlide.value + 1) % slides.value.length;
    }
  }, SLIDE_MS);
}

// Picking a dot restarts the countdown so the chosen slide gets its full time.
function goToSlide(i) {
  activeSlide.value = i;
  startSlides();
}

watch(slides, () => {
  if (activeSlide.value >= slides.value.length) activeSlide.value = 0;
});
onMounted(startSlides);
onUnmounted(() => clearInterval(slideTimer));

// The featured card leans toward the pointer. Values are written as CSS
// variables so the browser does the transform work.
const tilt = ref({ x: 0, y: 0 });
function onTilt(event) {
  if (reduced.value) return;
  const box = event.currentTarget.getBoundingClientRect();
  tilt.value = {
    x: ((event.clientX - box.left) / box.width - 0.5) * 2,
    y: ((event.clientY - box.top) / box.height - 0.5) * 2,
  };
}
function resetTilt() {
  tilt.value = { x: 0, y: 0 };
}

const upcoming = computed(() => {
  const shown = new Set(slides.value.map((c) => c.id));
  return concerts.value.filter((c) => !shown.has(c.id)).slice(0, 6);
});

const totals = computed(() => concerts.value.reduce((sum, c) => ({
  shows: sum.shows + 1,
  looking: sum.looking + (c.open_seekers ?? 0),
  groups: sum.groups + (c.open_parties ?? 0),
}), { shows: 0, looking: 0, groups: 0 }));
const shownShows = useCountUp(() => totals.value.shows, { duration: 1200 });
const shownLooking = useCountUp(() => totals.value.looking, { duration: 1200 });
const shownGroups = useCountUp(() => totals.value.groups, { duration: 1200 });

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
    icon: 'M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm12-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  },
  {
    n: '02',
    title: 'Choose your company',
    body: 'Find a companion or request a place in a group.',
    icon: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm13 10v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  },
  {
    n: '03',
    title: 'Make a plan together',
    body: 'Pick a time and place to meet before the show.',
    icon: 'M12 21s-7-5.5-7-11a7 7 0 0 1 14 0c0 5.5-7 11-7 11Zm0-8a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  },
];

const titleWords = ['Meet', 'before', 'the', 'music.'];
</script>

<template>
  <div class="home">
    <!-- ---------------------------------------------------------------- Hero -->
    <section class="hero">
      <div class="hero__backdrop" aria-hidden="true">
        <span class="orb orb--one" />
        <span class="orb orb--two" />
        <span class="orb orb--three" />
        <span class="hero__grid" />
      </div>

      <div class="container hero__inner">
        <div class="hero__copy">
          <h1 class="hero__title">
            <span class="sr-only">Meet before the music. Walk in together.</span>
            <span aria-hidden="true">
              <template v-for="(word, i) in titleWords" :key="word">
                <span class="word" :style="{ '--w': i }">{{ word }}</span>{{ ' ' }}
              </template>
              <span class="hero__accent word" :style="{ '--w': titleWords.length }">Walk in together.</span>
            </span>
          </h1>

          <p class="lede hero__lede">
            Got your tickets? Find fans going to the same concert who share your taste, and plan where to meet before the show so no one has to go alone.
          </p>

          <div class="hero__actions">
            <RouterLink to="/concerts" class="btn btn--primary btn--glow">
              Browse concerts
              <svg class="btn__arrow" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
            </RouterLink>
            <RouterLink to="/groups" class="btn btn--ghost">Find a group</RouterLink>
          </div>

          <dl v-if="!loading && !error" class="stats">
            <div>
              <dt>Upcoming shows</dt>
              <dd class="tabular">{{ shownShows }}</dd>
            </div>
            <div v-if="totals.looking">
              <dt>Fans looking</dt>
              <dd class="tabular">{{ shownLooking }}</dd>
            </div>
            <div v-if="totals.groups">
              <dt>Open groups</dt>
              <dd class="tabular">{{ shownGroups }}</dd>
            </div>
          </dl>
        </div>

        <div
          v-if="featured"
          class="carousel"
          :class="{ 'carousel--paused': paused }"
          :style="{ '--tx': tilt.x, '--ty': tilt.y }"
          @mouseenter="paused = true"
          @mouseleave="paused = false; resetTilt()"
          @mousemove="onTilt"
          @focusin="paused = true"
          @focusout="paused = false"
        >
          <span class="carousel__layer carousel__layer--back" aria-hidden="true" />
          <span class="carousel__layer carousel__layer--mid" aria-hidden="true" />
          <Transition name="deal" mode="out-in">
            <RouterLink
              :key="featured.id"
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
                <span class="poster__shade" aria-hidden="true" />
                <span class="feature__badge">{{ peopleCount(featured) ? 'Most people looking' : 'Up next' }}</span>
                <div class="feature__overlay">
                  <p class="feature__date mono">{{ formatShortDate(featured.event_date) }}</p>
                  <p class="feature__artist">{{ featured.artist }}</p>
                </div>
              </div>
              <div class="feature__body">
                <p class="feature__meta">{{ formatDate(featured.event_date) }} · {{ featured.venue }}</p>
                <p class="people" :class="{ 'people--quiet': !peopleCount(featured) }">
                  {{ peopleLine(featured) }}
                </p>
              </div>
              <span class="feature__shine" aria-hidden="true" />
            </RouterLink>
          </Transition>
          <div v-if="slides.length > 1" class="carousel__dots" role="tablist" aria-label="Featured concerts">
            <button
              v-for="(slide, i) in slides"
              :key="slide.id"
              type="button"
              role="tab"
              class="carousel__dot"
              :class="{ 'carousel__dot--active': i === activeSlide }"
              :style="{ '--slide-ms': `${SLIDE_MS}ms` }"
              :aria-selected="i === activeSlide"
              :aria-label="slide.artist"
              @click="goToSlide(i)"
            >
              <span v-if="i === activeSlide" :key="activeSlide" class="carousel__progress" />
            </button>
          </div>
        </div>
        <div v-else-if="loading" class="feature feature--placeholder" aria-hidden="true" />
      </div>
    </section>

    <!-- --------------------------------------------------------------- Steps -->
    <section class="section">
      <div class="container">
        <h2 v-reveal class="section__title">How it <span class="text-gradient">works</span></h2>

        <ol class="steps">
          <li v-for="(step, i) in steps" :key="step.n" v-reveal="i">
            <div class="step">
            <span class="step__icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none"><path :d="step.icon" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
            </span>
            <span class="step__n">{{ step.n }}</span>
            <h3>{{ step.title }}</h3>
            <p>{{ step.body }}</p>
            </div>
          </li>
        </ol>
      </div>
    </section>

    <!-- ------------------------------------------------------------ Concerts -->
    <section class="section">
      <div class="container">
        <div v-reveal class="upcoming__head">
          <h2 class="section__title">Find your <span class="text-gradient">next show</span></h2>
          <RouterLink to="/concerts" class="btn btn--ghost">
            See all concerts
            <svg class="btn__arrow" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
          </RouterLink>
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
          <div v-for="(concert, i) in upcoming" :key="concert.id" v-reveal="i % 3">
          <RouterLink :to="`/concerts/${concert.id}`" class="mini">
            <div class="poster">
              <img
                v-if="hasImage(concert)"
                :src="concert.hero_image_url"
                alt=""
                loading="lazy"
                @error="markBroken(concert)"
              />
              <span v-else class="poster__initial" aria-hidden="true">{{ concert.artist.charAt(0) }}</span>
              <span class="mini__date mono">{{ formatShortDate(concert.event_date) }}</span>
            </div>
            <div class="mini__body">
              <h3 class="mini__artist">{{ concert.artist }}</h3>
              <p class="mini__venue">{{ concert.venue }}</p>
              <p class="people" :class="{ 'people--quiet': !peopleCount(concert) }">
                {{ peopleLine(concert) }}
              </p>
            </div>
          </RouterLink>
          </div>
        </div>
      </div>
    </section>

    <!-- ----------------------------------------------------------------- CTA -->
    <section class="section">
      <div class="container">
        <div v-reveal class="cta">
          <span class="cta__orb" aria-hidden="true" />
          <h2>Don’t go alone.</h2>
          <p>Swipe through fans heading to the same show, or join a group that already has a plan.</p>
          <div class="cta__actions">
            <RouterLink to="/kaki" class="btn btn--light">Find a companion</RouterLink>
            <RouterLink to="/groups" class="btn btn--outline-light">Browse groups</RouterLink>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.home {
  overflow-x: clip;
}

.text-gradient {
  background: linear-gradient(100deg, var(--accent-400), var(--mint-400) 55%, var(--accent-500));
  background-size: 200% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  animation: shimmer 6s ease-in-out infinite alternate;
}

@keyframes shimmer {
  to { background-position: 100% 0; }
}

/* ---------------------------------------------------------------- Hero ---- */

.hero {
  position: relative;
  isolation: isolate;
  padding-block: var(--space-8) var(--space-8);
}

/* Slow drifting colour behind the hero, faded out at the bottom edge. */
.hero__backdrop {
  position: absolute;
  inset: 0;
  z-index: -1;
  overflow: hidden;
  mask-image: linear-gradient(to bottom, #000 70%, transparent);
}

.orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(70px);
  opacity: 0.55;
  animation: drift 18s ease-in-out infinite alternate;
}

.orb--one {
  width: 520px;
  height: 520px;
  top: -180px;
  left: -120px;
  background: var(--accent-300);
}

.orb--two {
  width: 420px;
  height: 420px;
  top: 10%;
  right: -100px;
  background: var(--accent-400);
  opacity: 0.35;
  animation-duration: 22s;
  animation-direction: alternate-reverse;
}

.orb--three {
  width: 360px;
  height: 360px;
  bottom: -120px;
  left: 35%;
  background: var(--mint-400);
  opacity: 0.25;
  animation-duration: 26s;
}

@keyframes drift {
  0% { transform: translate(0, 0) scale(1); }
  50% { transform: translate(60px, 40px) scale(1.12); }
  100% { transform: translate(-40px, 70px) scale(0.95); }
}

/* A faint dot grid gives the colour something to sit on. */
.hero__grid {
  position: absolute;
  inset: 0;
  background-image: radial-gradient(var(--ink-500) 1px, transparent 1px);
  background-size: 28px 28px;
  opacity: 0.5;
  mask-image: radial-gradient(ellipse at 30% 30%, #000, transparent 70%);
}

.hero__inner {
  display: grid;
  gap: var(--space-8);
  align-items: center;
}

@media (min-width: 900px) {
  .hero__inner {
    grid-template-columns: 1.1fr 1fr;
  }
}

.hero__title {
  font-size: var(--step-6);
  line-height: 1.05;
  letter-spacing: -0.02em;
  max-width: 16ch;
}

.word {
  display: inline-block;
  animation: rise var(--dur-slower) var(--ease-settle) both;
  animation-delay: calc(120ms + var(--w) * 90ms);
}

@keyframes rise {
  from { opacity: 0; transform: translateY(0.5em); filter: blur(6px); }
  to { opacity: 1; transform: none; filter: none; }
}

.hero__accent {
  display: block;
  background: linear-gradient(100deg, var(--accent-400), var(--mint-400) 50%, var(--accent-400));
  background-size: 200% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  animation:
    rise var(--dur-slower) var(--ease-settle) both,
    shimmer 5s ease-in-out 1s infinite alternate;
  animation-delay: calc(120ms + var(--w) * 90ms), 1s;
}

.hero__lede {
  margin-top: var(--space-5);
  max-width: 48ch;
  animation: rise var(--dur-slower) var(--ease-settle) 600ms both;
}

.hero__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  margin-top: var(--space-6);
  animation: rise var(--dur-slower) var(--ease-settle) 720ms both;
}

.btn__arrow {
  width: 1.1em;
  height: 1.1em;
  transition: transform var(--dur-base) var(--ease-spring);
}

.btn:hover .btn__arrow {
  transform: translateX(4px);
}

.btn--glow {
  box-shadow: 0 10px 30px -8px var(--accent-400);
}

.btn--glow:hover {
  box-shadow: 0 14px 38px -8px var(--accent-400);
  transform: translateY(-2px);
}

.stats {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-6);
  margin-top: var(--space-7);
  animation: rise var(--dur-slower) var(--ease-settle) 840ms both;
}

.stats > div {
  padding-left: var(--space-4);
  border-left: 2px solid var(--accent-300);
}

.stats dt {
  font-size: var(--step--1);
  color: var(--text-400);
}

.stats dd {
  font-family: var(--font-display);
  font-size: var(--step-4);
  font-weight: 800;
  line-height: 1.1;
  color: var(--text-100);
}

/* ---------------------------------------------------------- Carousel ---- */

.carousel {
  position: relative;
  perspective: 1200px;
  animation: rise var(--dur-slower) var(--ease-settle) 300ms both;
}

/* Two cards peeking out behind the featured one make it read as a stack. */
.carousel__layer {
  position: absolute;
  inset: 0 0 calc(var(--space-4) + 8px) 0;
  border-radius: var(--radius-xl);
  border: var(--border-hairline);
  background: var(--ink-800);
  transition: transform var(--dur-slow) var(--ease-settle);
}

.carousel__layer--back {
  transform: rotate(6deg) translate(18px, 10px) scale(0.94);
  background: linear-gradient(135deg, var(--accent-300), var(--ink-800));
  opacity: 0.7;
}

.carousel__layer--mid {
  transform: rotate(-3deg) translate(-10px, 6px) scale(0.97);
  opacity: 0.85;
}

.carousel:hover .carousel__layer--back {
  transform: rotate(9deg) translate(30px, 12px) scale(0.94);
}

.carousel:hover .carousel__layer--mid {
  transform: rotate(-5deg) translate(-20px, 8px) scale(0.97);
}

.feature {
  position: relative;
  display: block;
  overflow: hidden;
  border: var(--border-hairline);
  border-radius: var(--radius-xl);
  background: var(--ink-800);
  box-shadow: var(--shadow-lg);
  text-decoration: none;
  transform: rotateY(calc(var(--tx, 0) * 7deg)) rotateX(calc(var(--ty, 0) * -7deg));
  transition:
    transform var(--dur-slow) var(--ease-settle),
    box-shadow var(--dur-base) var(--ease-out);
}

.carousel:hover .feature {
  box-shadow: 0 30px 70px -20px var(--accent-400);
}

/* A soft highlight that follows the pointer across the card. */
.feature__shine {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: radial-gradient(
    circle at calc(50% + var(--tx, 0) * 50%) calc(50% + var(--ty, 0) * 50%),
    rgba(255, 255, 255, 0.28),
    transparent 55%
  );
  opacity: 0;
  transition: opacity var(--dur-base) var(--ease-out);
}

.carousel:hover .feature__shine {
  opacity: 1;
}

.feature--placeholder {
  aspect-ratio: 4 / 3;
  background: var(--ink-850);
  box-shadow: none;
  animation: pulse 1.4s ease-in-out infinite alternate;
}

@keyframes pulse {
  to { opacity: 0.5; }
}

.poster__shade {
  position: absolute;
  inset: 0;
  background: linear-gradient(to top, rgba(20, 10, 40, 0.85), rgba(20, 10, 40, 0.1) 55%, transparent);
}

.feature__badge {
  position: absolute;
  top: var(--space-4);
  left: var(--space-4);
  padding: var(--space-1) var(--space-3);
  border-radius: var(--radius-pill);
  background: rgba(255, 255, 255, 0.9);
  color: var(--accent-600);
  font-size: var(--step--2);
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.feature__overlay {
  position: absolute;
  left: var(--space-5);
  right: var(--space-5);
  bottom: var(--space-4);
  color: #fff;
}

.feature__date {
  font-size: var(--step--2);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  opacity: 0.85;
}

.feature__artist {
  font-family: var(--font-display);
  font-weight: 800;
  font-size: var(--step-4);
  line-height: 1.05;
  text-shadow: 0 2px 20px rgba(0, 0, 0, 0.35);
}

.feature__body {
  padding: var(--space-4) var(--space-5) var(--space-5);
}

.feature__meta {
  color: var(--text-300);
  font-size: var(--step--1);
}

/* Slides are dealt like cards: the old one slides off left, the new one in from the right. */
.deal-enter-active {
  transition:
    opacity var(--dur-slow) var(--ease-settle),
    transform var(--dur-slow) var(--ease-settle),
    filter var(--dur-slow) var(--ease-settle);
}

.deal-leave-active {
  transition:
    opacity var(--dur-base) var(--ease-snap),
    transform var(--dur-base) var(--ease-snap),
    filter var(--dur-base) var(--ease-snap);
}

.deal-enter-from {
  opacity: 0;
  transform: translateX(60px) rotate(4deg) scale(0.95);
  filter: blur(4px);
}

.deal-leave-to {
  opacity: 0;
  transform: translateX(-60px) rotate(-4deg) scale(0.95);
  filter: blur(4px);
}

.carousel__dots {
  position: relative;
  display: flex;
  justify-content: center;
  gap: var(--space-2);
  margin-top: var(--space-5);
}

.carousel__dot {
  position: relative;
  overflow: hidden;
  width: 8px;
  height: 8px;
  padding: 0;
  border: none;
  border-radius: 999px;
  background: var(--ink-500);
  cursor: pointer;
  transition:
    width var(--dur-base) var(--ease-out),
    background var(--dur-base) var(--ease-out);
}

.carousel__dot--active {
  width: 36px;
  background: var(--accent-300);
}

/* The active dot fills up over the slide's time, so you can see when it moves on. */
.carousel__progress {
  position: absolute;
  inset: 0;
  background: var(--accent-400);
  transform-origin: left;
  animation: fill var(--slide-ms) linear both;
}

.carousel--paused .carousel__progress {
  animation-play-state: paused;
}

@keyframes fill {
  from { transform: scaleX(0); }
  to { transform: scaleX(1); }
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

.poster--feature {
  aspect-ratio: 4 / 3;
}

.poster img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform var(--dur-slower) var(--ease-settle);
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
  margin-top: var(--space-3);
  font-size: var(--step--1);
  font-weight: 700;
  color: var(--accent-500);
}

/* A live dot with a ring that pulses out of it. */
.people::before {
  content: '';
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--mint-400);
  box-shadow: 0 0 0 0 var(--mint-400);
  animation: ping 1.8s var(--ease-out) infinite;
}

@keyframes ping {
  0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--mint-400) 60%, transparent); }
  100% { box-shadow: 0 0 0 8px transparent; }
}

.people--quiet {
  font-weight: 600;
  color: var(--text-400);
}

.people--quiet::before {
  background: var(--ink-500);
  animation: none;
}

/* --------------------------------------------------------------- Sections - */

.section__title {
  font-size: var(--step-4);
  letter-spacing: -0.01em;
}

/* --------------------------------------------------------------- Steps ---- */

.steps {
  list-style: none;
  padding: 0;
  margin-top: var(--space-6);
  display: grid;
  gap: var(--space-5);
}

@media (min-width: 860px) {
  .steps {
    grid-template-columns: repeat(3, 1fr);
  }
}

.step {
  position: relative;
  overflow: hidden;
  padding: var(--space-6);
  border: var(--border-hairline);
  border-radius: var(--radius-lg);
  background: var(--ink-800);
}

.step {
  height: 100%;
  transition:
    transform var(--dur-base) var(--ease-out),
    box-shadow var(--dur-base) var(--ease-out),
    border-color var(--dur-base) var(--ease-out);
}

.step:hover {
  transform: translateY(-6px);
  border-color: var(--accent-400);
  box-shadow: 0 20px 40px -20px var(--accent-400);
}

.step::after {
  content: '';
  position: absolute;
  inset: auto 0 0 0;
  height: 3px;
  background: linear-gradient(90deg, var(--accent-400), var(--mint-400));
  transform: scaleX(0);
  transform-origin: left;
  transition: transform var(--dur-slow) var(--ease-settle);
}

.step:hover::after {
  transform: scaleX(1);
}

.step__icon {
  display: grid;
  place-items: center;
  width: 52px;
  height: 52px;
  border-radius: var(--radius-md);
  background: linear-gradient(135deg, var(--accent-400), var(--mint-400));
  color: #fff;
  box-shadow: 0 10px 24px -10px var(--accent-400);
  transition: transform var(--dur-base) var(--ease-spring);
}

.step__icon svg {
  width: 26px;
  height: 26px;
}

.step:hover .step__icon {
  transform: rotate(-8deg) scale(1.08);
}

.step__n {
  position: absolute;
  top: var(--space-3);
  right: var(--space-5);
  font-family: var(--font-display);
  font-size: var(--step-6);
  font-weight: 800;
  line-height: 1;
  color: transparent;
  -webkit-text-stroke: 1.5px var(--ink-500);
  transition: -webkit-text-stroke-color var(--dur-base) var(--ease-out);
}

.step:hover .step__n {
  -webkit-text-stroke-color: var(--accent-300);
}

.step h3 {
  font-size: var(--step-1);
  margin-block: var(--space-5) var(--space-2);
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

.upcoming__grid {
  display: grid;
  gap: var(--space-5);
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 280px), 1fr));
}

.mini {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: var(--border-hairline);
  border-radius: var(--radius-lg);
  background: var(--ink-800);
  text-decoration: none;
}

.mini {
  height: 100%;
  transition:
    transform var(--dur-base) var(--ease-out),
    box-shadow var(--dur-base) var(--ease-out),
    border-color var(--dur-base) var(--ease-out);
}

.mini:hover {
  transform: translateY(-6px);
  border-color: var(--accent-400);
  box-shadow: 0 24px 44px -22px var(--accent-400);
}

.mini:hover .poster img {
  transform: scale(1.08);
}

.mini__date {
  position: absolute;
  top: var(--space-3);
  left: var(--space-3);
  padding: var(--space-1) var(--space-3);
  border-radius: var(--radius-pill);
  background: rgba(255, 255, 255, 0.92);
  color: var(--accent-600);
  font-size: var(--step--2);
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
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

.mini__artist {
  font-size: var(--step-2);
  margin-bottom: var(--space-1);
  transition: color var(--dur-base) var(--ease-out);
}

.mini:hover .mini__artist {
  color: var(--accent-400);
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

/* ----------------------------------------------------------------- CTA ---- */

.cta {
  position: relative;
  overflow: hidden;
  isolation: isolate;
  padding: var(--space-8) var(--space-6);
  border-radius: var(--radius-xl);
  background: linear-gradient(120deg, var(--accent-600), #5b2a86 45%, #9c3d8f);
  color: #fff;
  text-align: center;
}

.cta__orb {
  position: absolute;
  z-index: -1;
  width: 420px;
  height: 420px;
  top: -160px;
  right: -80px;
  border-radius: 50%;
  background: #efc3f5;
  filter: blur(80px);
  opacity: 0.45;
  animation: drift 14s ease-in-out infinite alternate;
}

.cta h2 {
  font-size: var(--step-5);
  color: #fff;
}

.cta p {
  max-width: 44ch;
  margin: var(--space-3) auto 0;
  color: rgba(255, 255, 255, 0.82);
}

.cta__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: var(--space-3);
  margin-top: var(--space-6);
}

@media (prefers-reduced-motion: reduce) {
  .feature,
  .carousel__layer,
  .step:hover,
  .mini:hover {
    transform: none;
  }
}
</style>
