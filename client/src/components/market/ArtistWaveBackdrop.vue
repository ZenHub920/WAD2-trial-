<script setup>
/**
 * The waveform behind the concert page.
 *
 * WHAT IT IS NOT
 * --------------
 * It is not an analyser. Nothing here listens to the Spotify player, and
 * nothing could: the embed is a cross-origin frame, and a page may not read a
 * sound it does not own. It is also not tied to the setlist, the scroll
 * position or the pointer. It simply moves, the way a room's lighting moves.
 * The ONE thing the artist decides is its colour.
 *
 * WHY IT NEVER VISIBLY REPEATS
 * ----------------------------
 * Three lanes drift across at speeds with no common multiple worth waiting
 * for (23s, 37s, 53s), and each one swells on its own slower clock. Their sum
 * is what you watch, so the pattern does not come back round in any sitting —
 * which is the whole difference between something alive and a looping GIF.
 *
 * HOW IT STAYS CHEAP
 * ------------------
 * Only `transform` is animated, so the compositor owns every frame: no
 * scripting, no timers, no layout, nothing to tear down. Each lane is one
 * path drawn twice side by side and slid exactly half its width, which is why
 * the seam never shows.
 */
defineProps({
  /** Two periods of a wave, drawn twice per lane. Amplitude is the variable. */
  lanes: {
    type: Array,
    default: () => [
      { key: 'a', path: 'M0 120 C 100 40, 200 40, 300 120 C 400 200, 500 200, 600 120 C 700 40, 800 40, 900 120 C 1000 200, 1100 200, 1200 120' },
      { key: 'b', path: 'M0 120 C 100 170, 200 170, 300 120 C 400 70, 500 70, 600 120 C 700 170, 800 170, 900 120 C 1000 70, 1100 70, 1200 120' },
      { key: 'c', path: 'M0 120 C 66 10, 134 10, 200 120 C 266 230, 334 230, 400 120 C 466 10, 534 10, 600 120 C 666 230, 734 230, 800 120 C 866 10, 934 10, 1000 120 C 1066 230, 1134 230, 1200 120' },
    ],
  },
});
</script>

<template>
  <!-- Decoration: no label, no tab stop, and nothing can be clicked through it. -->
  <div class="wave" aria-hidden="true" data-test="wave-backdrop">
    <div v-for="lane in lanes" :key="lane.key" :class="['wave__lane', `wave__lane--${lane.key}`]">
      <div class="wave__swell">
        <div class="wave__drift">
          <svg class="wave__tile" viewBox="0 0 1200 240" preserveAspectRatio="none" focusable="false">
            <path :d="lane.path" vector-effect="non-scaling-stroke" />
          </svg>
          <svg class="wave__tile" viewBox="0 0 1200 240" preserveAspectRatio="none" focusable="false">
            <path :d="lane.path" vector-effect="non-scaling-stroke" />
          </svg>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Behind the page's own content, above the page's background. The parent sets
   `isolation: isolate`, which is what keeps a negative z-index from falling
   through the backdrop entirely and disappearing. */
.wave {
  position: fixed;
  inset: 0;
  z-index: -1;
  overflow: hidden;
  pointer-events: none;
  /* Faded at both ends so the waves arrive from off-page rather than being
     cut off by the window edge. */
  mask-image: linear-gradient(90deg, transparent, #000 12%, #000 88%, transparent);
  -webkit-mask-image: linear-gradient(90deg, transparent, #000 12%, #000 88%, transparent);
}

.wave__lane {
  position: absolute;
  left: 0;
  width: 100%;
  height: 34vh;
}

/* Staggered so the three read as depth rather than as one thick band. */
.wave__lane--a { top: calc(50% - 22vh); }
.wave__lane--b { top: calc(50% - 15vh); }
.wave__lane--c { top: calc(50% - 8vh); }

/* Two transforms that must not fight: the swell owns scaleY, the drift owns
   translateX, so each animates a property nothing else is touching. */
.wave__swell {
  width: 100%;
  height: 100%;
  animation: wave-swell 19s ease-in-out infinite alternate;
}
.wave__lane--b .wave__swell { animation-duration: 27s; animation-delay: -6s; }
.wave__lane--c .wave__swell { animation-duration: 13s; animation-delay: -3s; }

.wave__drift {
  display: flex;
  width: 200%;
  height: 100%;
  will-change: transform;
  animation: wave-drift 37s linear infinite;
}
/* Different speeds, and one going the other way, so the three never lock. */
.wave__lane--a .wave__drift { animation-duration: 53s; }
.wave__lane--c .wave__drift { animation-duration: 23s; animation-direction: reverse; }

.wave__tile {
  flex: 0 0 50%;
  width: 50%;
  height: 100%;
}

/* The artist's hue, kept far enough back that text over it is unaffected. */
.wave__tile path {
  fill: none;
  stroke: var(--art-accent, var(--mint-400, #9c3d8f));
  stroke-width: 2.5;
  stroke-linecap: round;
}
.wave__lane--a .wave__tile path { opacity: 0.34; stroke-width: 3; }
.wave__lane--b .wave__tile path { opacity: 0.22; }
.wave__lane--c .wave__tile path { opacity: 0.14; stroke-width: 1.75; }

/* The accent is a mid-lightness colour: on the dark theme it is a line on a
   dark field and can carry more weight before it starts competing with body
   text, so it is held back there rather than pushed. */
:root[data-theme='dark'] .wave__lane--a .wave__tile path { opacity: 0.26; }
:root[data-theme='dark'] .wave__lane--b .wave__tile path { opacity: 0.17; }
:root[data-theme='dark'] .wave__lane--c .wave__tile path { opacity: 0.11; }

@keyframes wave-drift {
  to { transform: translate3d(-50%, 0, 0); }
}

@keyframes wave-swell {
  from { transform: scaleY(0.55); }
  to { transform: scaleY(1.25); }
}

/* Motion is the point of this, so with motion refused it is not worth
   animating a frozen version into the corner of someone's eye — the shape
   stays as a still backdrop and nothing moves. */
@media (prefers-reduced-motion: reduce) {
  .wave__swell,
  .wave__drift {
    animation: none;
  }
}
</style>
