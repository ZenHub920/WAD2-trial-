<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { introActive } from '../intro.js';

/**
 * The opening title sequence.
 *
 * The wordmark builds in the middle of the screen, holds, then flies into the
 * header and becomes the site logo — so the title is not a splash the product
 * appears *after*, it is the product's own logo arriving.
 *
 * The flight is a FLIP: the title is rendered at exactly the header logo's size
 * and blown up with `scale()`, so landing means animating back to scale 1 at a
 * measured offset. Matching the two by eye would drift the moment the typeface,
 * the header height or the viewport changed.
 */

const LETTERS = [...'Encore'];
const REVEAL_MS = 900;   // bars rise, letters arrive
const HOLD_MS = 320;     // a beat, so it reads as a title and not a glitch
const FLIGHT_MS = 900;   // centre -> header
const CLEAR_MS = 240;    // the veil's last fade

const brand = ref(null);
const root = ref(null);
const phase = ref('reveal'); // reveal -> fly -> done
const visible = ref(false);

let timers = [];
const after = (ms, fn) => timers.push(setTimeout(fn, ms));
const sleep = (ms) => new Promise((resolve) => after(ms, resolve));

/** Anything already in flight is abandoned; whatever called this decides what comes next. */
function clearTimers() {
  timers.forEach(clearTimeout);
  timers = [];
}

function finish() {
  clearTimers();
  phase.value = 'done';
  visible.value = false;
  introActive.value = false;
}

async function play() {
  await sleep(REVEAL_MS + HOLD_MS);

  const target = document.querySelector('[data-brand-target]');
  const el = brand.value;
  if (!target || !el) return finish();

  // The title is centred with `left/top: 50%`, so its untransformed centre is
  // the viewport's centre whatever scale it is currently wearing.
  const to = target.getBoundingClientRect();
  const dx = to.left + to.width / 2 - window.innerWidth / 2;
  const dy = to.top + to.height / 2 - window.innerHeight / 2;
  const scale = Number(el.dataset.scale ?? 1);

  phase.value = 'fly';

  // translate(-50%,-50%) keeps it centred; the second translate is the measured
  // journey; scale and rotate pivot on its own centre and so do not move it.
  const flight = el.animate(
    [
      { transform: `translate(-50%, -50%) translate(0px, 0px) scale(${scale}) rotate(0deg)` },
      { transform: `translate(-50%, -50%) translate(${dx}px, ${dy}px) scale(1) rotate(-360deg)` },
    ],
    { duration: FLIGHT_MS, easing: 'cubic-bezier(0.76, 0, 0.24, 1)', fill: 'forwards' },
  );

  try {
    await flight.finished;
  } catch {
    // Cancelled by a skip; the finish below is the same either way.
  }
  await sleep(CLEAR_MS);
  finish();
}

/** Click or any key cuts straight to the site. */
function skip() {
  if (!visible.value) return;
  finish();
}

function onKeydown() {
  skip();
}

const SEEN_KEY = 'encore-intro-seen';

/**
 * Once per tab, like a film's opening titles — not once per page load. Someone
 * refreshing a chat or coming back from sign-in has already arrived.
 * `?intro` forces a replay, which is what to use when demonstrating it.
 */
function shouldPlay() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  if (new URLSearchParams(window.location.search).has('intro')) return true;
  try {
    if (sessionStorage.getItem(SEEN_KEY)) return false;
    sessionStorage.setItem(SEEN_KEY, '1');
  } catch {
    // Storage blocked (private mode): play it, rather than never playing it.
  }
  return true;
}

onMounted(async () => {
  if (!shouldPlay()) return;

  visible.value = true;
  introActive.value = true;

  // Measuring before the webfont lands would size the title to a fallback face.
  // Raced against a deadline, because a slow or blocked font CDN must delay the
  // title by a moment, not hold the whole site behind it.
  try {
    await Promise.race([document.fonts?.ready, sleep(700)]);
  } catch {
    // Font loading API unavailable; the measurement below still works.
  }
  await nextTick();
  if (!visible.value || !brand.value) return;

  // Rendered at the header's size, then blown up — so the landing is scale 1.
  // Capped so a long word still breathes on a phone.
  const width = brand.value.offsetWidth || 1;
  const scale = Math.max(1.6, Math.min(6, (window.innerWidth * 0.72) / width));
  brand.value.dataset.scale = String(scale);
  brand.value.style.setProperty('--scale', scale);

  window.addEventListener('keydown', onKeydown, { once: true });
  play();
});

onBeforeUnmount(() => {
  clearTimers();
  window.removeEventListener('keydown', onKeydown);
  introActive.value = false;
});
</script>

<template>
  <Teleport to="body">
    <!-- Decorative: the page underneath is already rendered and readable, so a
         screen reader should never meet this at all. -->
    <div
      v-if="visible"
      ref="root"
      class="intro"
      :class="`intro--${phase}`"
      aria-hidden="true"
      @click="skip"
    >
      <div class="intro__veil" />

      <div ref="brand" class="intro__brand">
        <span class="intro__mark">
          <span v-for="n in 4" :key="n" class="intro__bar" :style="{ '--i': n }" />
        </span>
        <span class="intro__word">
          <span
            v-for="(letter, index) in LETTERS"
            :key="index"
            class="intro__letter"
            :style="{ '--i': index }"
          >{{ letter }}</span>
        </span>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.intro {
  position: fixed;
  inset: 0;
  z-index: 300; /* above the fixed header (100) and the skip link (200) */
  cursor: pointer;
}

/* Once the title is flying, the page beneath is live again. */
.intro--fly,
.intro--done { pointer-events: none; }

.intro__veil {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(circle at 50% 42%, color-mix(in oklab, var(--accent-500) 18%, transparent), transparent 55%),
    var(--ink-900);
  opacity: 1;
  transition: opacity 760ms var(--ease-out);
}

.intro--fly .intro__veil { opacity: 0; }

/* ---- The title ----------------------------------------------------------
 * Deliberately the header logo's exact size and spacing. The reveal only
 * scales it up, so the flight home is a return to scale 1.
 */

.intro__brand {
  position: fixed;
  top: 50%;
  left: 50%;
  display: inline-flex;
  align-items: center;
  gap: var(--space-3);
  color: var(--text-100);
  white-space: nowrap;
  transform: translate(-50%, -50%) scale(var(--scale, 4));
  transform-origin: center;
  will-change: transform;
}

/* ---- Equaliser mark ------------------------------------------------------ */

.intro__mark {
  display: flex;
  align-items: flex-end;
  gap: 2px;
  height: 20px;
}

.intro__bar {
  width: 3px;
  height: calc(6px + var(--i) * 3px);
  border-radius: 2px;
  background: var(--accent-500);
  transform-origin: bottom;
  animation: intro-bar 760ms var(--ease-spring) backwards;
  animation-delay: calc(var(--i) * 70ms);
}

/* Rises from nothing, overshoots like a meter catching a beat, then settles. */
@keyframes intro-bar {
  0%   { transform: scaleY(0); opacity: 0; }
  45%  { transform: scaleY(1.9); opacity: 1; }
  70%  { transform: scaleY(0.8); }
  100% { transform: scaleY(1); opacity: 1; }
}

/* ---- Wordmark ------------------------------------------------------------ */

.intro__word {
  display: flex;
  font-family: var(--font-display);
  font-size: var(--step-1);
  font-weight: 700;
  letter-spacing: -0.03em;
}

.intro__letter {
  display: inline-block;
  animation: intro-letter 520ms var(--ease-settle) backwards;
  animation-delay: calc(260ms + var(--i) * 52ms);
}

@keyframes intro-letter {
  from {
    opacity: 0;
    transform: translateY(0.45em) rotate(6deg);
    filter: blur(3px);
  }
  to {
    opacity: 1;
    transform: none;
    filter: blur(0);
  }
}

/* The letters stop fading in once the flight starts, or they would replay
   their entrance while travelling. */
.intro--fly .intro__letter,
.intro--fly .intro__bar { animation: none; }

@media (prefers-reduced-motion: reduce) {
  .intro { display: none; }
}
</style>
