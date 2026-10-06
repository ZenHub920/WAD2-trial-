<script setup>
/**
 * Swipe deck — the seeker's judgement surface.
 *
 * One group at a time: drag right to shortlist, left to pass. This is not a
 * decorative gesture layer over a list. It is how the preference data the
 * matching engine consumes would actually be gathered, which is why it earns
 * being the loudest interaction in the app.
 *
 * What makes a drag feel physical rather than animated:
 *
 *   1. The card tracks the pointer 1:1 while held. No easing, no lag — a
 *      transition on transform during a drag is what makes a card feel like
 *      it is on elastic.
 *   2. Rotation is proportional to horizontal displacement AND scaled by where
 *      the card was grabbed. Grab it near the bottom and it swings further,
 *      because that is what a held rectangle does.
 *   3. A flick commits on VELOCITY even when it never crossed the distance
 *      threshold. Judging on distance alone makes fast gestures feel ignored.
 *   4. Release below threshold springs back with overshoot, which confirms the
 *      card was caught rather than dropped.
 *
 * Pointer Events throughout, so mouse, touch and pen are one code path.
 *
 * Accessibility is not an afterthought here: the whole deck is operable from
 * the keyboard (arrows, or the buttons), every outcome is announced to a live
 * region, and when reduced motion is requested the physics are skipped
 * entirely rather than merely shortened.
 */

import { ref, computed, watch } from 'vue';
import { useReducedMotion } from '../composables/useReducedMotion.js';

const props = defineProps({
  /** Items to judge. Each needs a stable `id`. */
  items: { type: Array, required: true },
  /** How many cards behind the top one are rendered. */
  depth: { type: Number, default: 2 },
});

const emit = defineEmits(['shortlist', 'pass', 'open', 'exhausted']);

const prefersReduced = useReducedMotion();

const index = ref(0);
const drag = ref({ x: 0, y: 0, active: false, grabBelowCentre: 0 });
const leaving = ref(null); // { id, direction } while a committed card flies out
const history = ref([]); // for undo
const announcement = ref('');

/** Distance past which a release commits, in px. */
const COMMIT_DISTANCE = 110;
/** Velocity past which a release commits regardless of distance, in px/ms. */
const COMMIT_VELOCITY = 0.45;
/** Maximum rotation at full displacement, in degrees. */
const MAX_ROTATION = 14;

let pointerId = null;
let startX = 0;
let startY = 0;
let lastX = 0;
let lastT = 0;
let velocity = 0;

const visible = computed(() =>
  props.items.slice(index.value, index.value + props.depth + 1),
);

const current = computed(() => props.items[index.value] ?? null);
const remaining = computed(() => Math.max(0, props.items.length - index.value));
const progress = computed(() =>
  props.items.length === 0 ? 0 : index.value / props.items.length,
);

/**
 * Intent in [-1, 1], used to drive the stamp overlays and the card's own tint.
 * Normalised against the commit distance so the stamp reaches full strength
 * exactly when releasing would commit — the overlay is a promise, not decoration.
 */
const intent = computed(() => {
  if (!drag.value.active && !leaving.value) return 0;
  if (leaving.value) return leaving.value.direction === 'right' ? 1 : -1;
  return Math.max(-1, Math.min(1, drag.value.x / COMMIT_DISTANCE));
});

function topCardStyle() {
  if (leaving.value) {
    const sign = leaving.value.direction === 'right' ? 1 : -1;
    return {
      transform: `translate3d(${sign * 140}%, ${drag.value.y * 0.4}px, 0) rotate(${sign * 22}deg)`,
      opacity: 0,
      transition: prefersReduced.value
        ? 'none'
        : 'transform 420ms var(--ease-snap), opacity 320ms linear',
    };
  }

  if (!drag.value.active) {
    return {
      transform: 'translate3d(0, 0, 0) rotate(0deg)',
      transition: prefersReduced.value
        ? 'none'
        : 'transform 520ms var(--ease-spring-soft)',
    };
  }

  // Held: follow exactly, no transition.
  const rotation =
    (drag.value.x / COMMIT_DISTANCE) * MAX_ROTATION * drag.value.grabBelowCentre;
  return {
    transform: `translate3d(${drag.value.x}px, ${drag.value.y}px, 0) rotate(${rotation}deg)`,
    transition: 'none',
  };
}

/** Cards behind rise and straighten as the top card is dragged away. */
function stackStyle(offset) {
  const pull = Math.min(1, Math.abs(intent.value));
  const depthStep = offset - pull; // the stack advances as intent grows
  const scale = 1 - depthStep * 0.04;
  const lift = depthStep * 14;

  return {
    transform: `translate3d(0, ${lift}px, 0) scale(${scale})`,
    opacity: offset > props.depth ? 0 : 1 - depthStep * 0.25,
    transition: drag.value.active
      ? 'none'
      : prefersReduced.value
        ? 'none'
        : 'transform 520ms var(--ease-settle), opacity 320ms linear',
    zIndex: 100 - offset,
  };
}

// --------------------------------------------------------------- gestures

function onPointerDown(event) {
  if (leaving.value || !current.value) return;
  // Let interactive children (the open button) handle their own clicks.
  if (event.target.closest('[data-no-drag]')) return;

  pointerId = event.pointerId;
  event.currentTarget.setPointerCapture?.(pointerId);

  const rect = event.currentTarget.getBoundingClientRect();
  // -1 at the top edge, +1 at the bottom. Sign flips the rotation direction so
  // dragging the top-left corner rotates the opposite way to the bottom-left.
  const grab = (event.clientY - rect.top) / rect.height;
  drag.value.grabBelowCentre = Math.max(-1, Math.min(1, (grab - 0.5) * 2)) || 0.35;

  startX = event.clientX;
  startY = event.clientY;
  lastX = event.clientX;
  lastT = event.timeStamp;
  velocity = 0;

  drag.value.active = true;
  drag.value.x = 0;
  drag.value.y = 0;
}

function onPointerMove(event) {
  if (!drag.value.active || event.pointerId !== pointerId) return;

  drag.value.x = event.clientX - startX;
  // Vertical movement is damped: this is a horizontal decision, and letting the
  // card roam freely up and down makes the gesture feel unanchored.
  drag.value.y = (event.clientY - startY) * 0.25;

  const dt = event.timeStamp - lastT;
  if (dt > 0) {
    // Smoothed so a single jittery frame cannot trigger a commit.
    velocity = 0.7 * velocity + 0.3 * ((event.clientX - lastX) / dt);
    lastX = event.clientX;
    lastT = event.timeStamp;
  }
}

function onPointerUp(event) {
  if (!drag.value.active || event.pointerId !== pointerId) return;
  pointerId = null;

  const distance = drag.value.x;
  const flicked = Math.abs(velocity) >= COMMIT_VELOCITY;
  const dragged = Math.abs(distance) >= COMMIT_DISTANCE;

  // A flick and a drag can disagree about direction (dragged left, flicked
  // right on release). Velocity wins, because it is the more recent intent.
  const direction = flicked
    ? velocity > 0 ? 'right' : 'left'
    : distance > 0 ? 'right' : 'left';

  drag.value.active = false;

  if (dragged || flicked) {
    commit(direction);
  } else {
    drag.value.x = 0;
    drag.value.y = 0;
  }
}

function onPointerCancel() {
  pointerId = null;
  drag.value.active = false;
  drag.value.x = 0;
  drag.value.y = 0;
}

// ---------------------------------------------------------------- commit

function commit(direction) {
  const item = current.value;
  if (!item || leaving.value) return;

  const verb = direction === 'right' ? 'Shortlisted' : 'Passed';
  announcement.value = `${verb} ${labelFor(item)}. ${remaining.value - 1} left.`;

  if (prefersReduced.value) {
    finish(item, direction);
    return;
  }

  leaving.value = { id: item.id, direction };
  window.setTimeout(() => finish(item, direction), 300);
}

function finish(item, direction) {
  history.value.push({ item, direction, at: index.value });
  emit(direction === 'right' ? 'shortlist' : 'pass', item);

  index.value += 1;
  leaving.value = null;
  drag.value.x = 0;
  drag.value.y = 0;

  if (index.value >= props.items.length) emit('exhausted');
}

function undo() {
  const last = history.value.pop();
  if (!last) return;
  index.value = last.at;
  drag.value.x = 0;
  drag.value.y = 0;
  announcement.value = `Put ${labelFor(last.item)} back.`;
}

function labelFor(item) {
  return item?.host?.displayName ?? item?.user?.displayName ?? 'this group';
}

// -------------------------------------------------------------- keyboard

function onKeydown(event) {
  if (event.key === 'ArrowRight') {
    event.preventDefault();
    commit('right');
  } else if (event.key === 'ArrowLeft') {
    event.preventDefault();
    commit('left');
  } else if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    if (current.value) emit('open', current.value);
  } else if (event.key === 'Backspace') {
    event.preventDefault();
    undo();
  }
}

// Reset when the underlying set changes (switching concerts).
watch(
  () => props.items,
  () => {
    index.value = 0;
    history.value = [];
    leaving.value = null;
    drag.value.x = 0;
    drag.value.y = 0;
  },
);

defineExpose({ undo, remaining });
</script>

<template>
  <div class="deck">
    <!-- Progress is shown as consumed-of-total rather than a percentage: the
         useful question mid-deck is "how many left", not "how far through". -->
    <div class="deck__status">
      <p class="deck__count">
        <span class="tabular">{{ remaining }}</span>
        {{ remaining === 1 ? 'group' : 'groups' }} to judge
      </p>
      <div class="deck__track" aria-hidden="true">
        <div class="deck__track-fill" :style="{ transform: `scaleX(${progress})` }" />
      </div>
    </div>

    <div
      class="deck__stage"
      role="application"
      :aria-label="
        current
          ? `Judging ${labelFor(current)}. Arrow right to shortlist, arrow left to pass.`
          : 'No groups left to judge'
      "
      tabindex="0"
      @keydown="onKeydown"
    >
      <TransitionGroup name="deck-card">
        <article
          v-for="(item, offset) in visible"
          :key="item.id"
          class="deck__card"
          :class="{
            'deck__card--top': offset === 0,
            'deck__card--held': offset === 0 && drag.active,
            'deck__card--leaving': offset === 0 && leaving,
          }"
          :style="offset === 0 ? { ...topCardStyle(), zIndex: 110 } : stackStyle(offset)"
          :aria-hidden="offset !== 0"
          @pointerdown="offset === 0 && onPointerDown($event)"
          @pointermove="offset === 0 && onPointerMove($event)"
          @pointerup="offset === 0 && onPointerUp($event)"
          @pointercancel="offset === 0 && onPointerCancel()"
        >
          <!-- Stamps. Opacity tracks the gesture so the outcome is legible
               before the user commits to it. -->
          <template v-if="offset === 0">
            <!-- A wash across the whole card in the outcome's colour. It is what
                 makes the stamp read as an overlay on the card rather than an
                 element that collided with the content underneath. -->
            <div
              class="wash"
              :class="intent >= 0 ? 'wash--yes' : 'wash--no'"
              :style="{ opacity: Math.min(0.5, Math.abs(intent) * 0.5) }"
              aria-hidden="true"
            />
            <div
              class="stamp stamp--yes"
              :style="{ opacity: Math.max(0, intent), transform: `rotate(${-8 + intent * 4}deg)` }"
              aria-hidden="true"
            >
              Shortlist
            </div>
            <div
              class="stamp stamp--no"
              :style="{ opacity: Math.max(0, -intent), transform: `rotate(${8 + intent * 4}deg)` }"
              aria-hidden="true"
            >
              Pass
            </div>
          </template>

          <slot name="card" :item="item" :is-top="offset === 0" />

          <button
            v-if="offset === 0"
            class="deck__open"
            data-no-drag
            type="button"
            @click="emit('open', item)"
          >
            Full profile
          </button>
        </article>
      </TransitionGroup>

      <div v-if="!current" class="deck__empty">
        <h3>That's everyone</h3>
        <p>
          Your shortlist is ready for the next matching round. Nothing is final —
          the algorithm still has to find a stable assignment.
        </p>
        <button v-if="history.length" class="btn btn--ghost" type="button" @click="undo">
          Back one
        </button>
      </div>
    </div>

    <!-- Buttons are not a fallback for the gesture; on desktop they are the
         primary control, and they share its exact code path. -->
    <div class="deck__controls">
      <button
        class="circle circle--no"
        type="button"
        :disabled="!current"
        aria-label="Pass on this group"
        @click="commit('left')"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
      <button
        class="circle circle--undo"
        type="button"
        :disabled="!history.length"
        aria-label="Undo last decision"
        @click="undo"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 10h11a5 5 0 010 10H9M3 10l5-5M3 10l5 5" />
        </svg>
      </button>
      <button
        class="circle circle--yes"
        type="button"
        :disabled="!current"
        aria-label="Shortlist this group"
        @click="commit('right')"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12.5l5 5L20 6.5" /></svg>
      </button>
    </div>

    <p class="deck__hint">
      Drag the card, or use <kbd>←</kbd> <kbd>→</kbd> to decide and <kbd>⌫</kbd> to undo.
    </p>

    <p class="sr-only" role="status" aria-live="polite">{{ announcement }}</p>
  </div>
</template>

<style scoped>
.deck {
  display: grid;
  gap: var(--space-4);
}

/* ---------------------------------------------------------------- status */

.deck__status {
  display: grid;
  gap: var(--space-2);
}

.deck__count {
  margin: 0;
  font-size: var(--step--1);
  color: var(--text-300);
}

.deck__track {
  height: 3px;
  border-radius: var(--radius-pill);
  background: var(--ink-700);
  overflow: hidden;
}

.deck__track-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--accent-500), var(--accent-300));
  transform-origin: left center;
  transition: transform var(--dur-slow) var(--ease-settle);
}

/* ----------------------------------------------------------------- stage */

.deck__stage {
  position: relative;
  /* The stage is a fixed box so cards behind have somewhere to sit. Height is
     driven by the card's own aspect rather than its content, which keeps the
     stack from jumping as cards of different lengths reach the top. Tall enough
     that the radar is never cropped — the chart row is the one that flexes, and
     a clipped chart looks like a bug rather than a crop. */
  min-height: 33rem;
  border-radius: var(--radius-xl);
  outline: none;
}

.deck__stage:focus-visible {
  box-shadow: 0 0 0 2px var(--accent-500), 0 0 0 6px var(--accent-glow);
}

.deck__card {
  position: absolute;
  inset: 0;
  /* Fixed rows rather than a flex column: the card's height is set by the stage,
     so the content area must be told it may shrink (min-height: 0) or a tall
     slot overflows and lands on top of the footer. */
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
  gap: var(--space-4);
  padding: var(--space-5);
  border-radius: var(--radius-xl);
  border: 1px solid var(--ink-600);
  background: var(--ink-800);
  box-shadow: var(--shadow-md);
  overflow: hidden;
  will-change: transform, opacity;
  /* The gesture owns horizontal panning; the browser keeps vertical scroll. */
  touch-action: pan-y;
  user-select: none;
  -webkit-user-select: none;
}

.deck__card--top {
  cursor: grab;
  box-shadow: var(--shadow-lg);
}

.deck__card--held {
  cursor: grabbing;
  /* A held card lifts toward the viewer. The border brightening does more work
     than the shadow here, because on a near-black page a shadow has little to
     fall on. */
  border-color: var(--ink-500);
}

.deck__card--leaving {
  pointer-events: none;
}

/* ---------------------------------------------------------------- stamps */

.wash {
  position: absolute;
  inset: 0;
  z-index: 4;
  pointer-events: none;
  /* No transition — bound to the pointer, like the stamp. */
}

.wash--yes {
  background: radial-gradient(
    120% 90% at 0% 40%,
    color-mix(in oklab, var(--mint-400) 55%, transparent),
    transparent 70%
  );
}

.wash--no {
  background: radial-gradient(
    120% 90% at 100% 40%,
    color-mix(in oklab, var(--rose-400) 55%, transparent),
    transparent 70%
  );
}

/* Stamps sit BELOW the card header so they never collide with the name or the
   verified badge, and each one sits on the side the card is travelling away
   from — the stamp trails the gesture, which is why it reads as a consequence
   of the drag rather than a label that happened to appear. */
.stamp {
  position: absolute;
  top: 36%;
  z-index: 5;
  padding: 0.3em 0.75em;
  border-radius: var(--radius-md);
  border: 2.5px solid currentColor;
  font-family: var(--font-display);
  font-size: var(--step-1);
  font-weight: 700;
  letter-spacing: -0.01em;
  pointer-events: none;
  /* No transition: the stamp is bound to the pointer, so easing it would make
     it lag behind the gesture it is describing. */
}

.stamp--yes {
  left: var(--space-5);
  color: var(--mint-400);
  background: color-mix(in oklab, var(--mint-400) 14%, transparent);
  box-shadow: 0 0 28px -6px var(--mint-400);
}

.stamp--no {
  right: var(--space-5);
  color: var(--rose-400);
  background: color-mix(in oklab, var(--rose-400) 14%, transparent);
  box-shadow: 0 0 28px -6px var(--rose-400);
}

/* ----------------------------------------------------------------- open */

.deck__open {
  align-self: start;
  padding: var(--space-2) var(--space-4);
  border-radius: var(--radius-pill);
  border: var(--border-hairline);
  background: var(--ink-700);
  color: var(--text-200);
  font: inherit;
  font-size: var(--step--1);
  cursor: pointer;
  transition:
    background var(--dur-fast) var(--ease-glide),
    transform var(--dur-fast) var(--ease-glide);
}

.deck__open:hover {
  background: var(--ink-600);
  color: var(--text-100);
}

.deck__open:active {
  transform: scale(0.97);
}

/* ---------------------------------------------------------------- empty */

.deck__empty {
  position: absolute;
  inset: 0;
  display: grid;
  place-content: center;
  gap: var(--space-3);
  padding: var(--space-6);
  text-align: center;
  border-radius: var(--radius-xl);
  border: 1px dashed var(--ink-600);
  background: var(--ink-850);
}

.deck__empty h3 {
  margin: 0;
  font-size: var(--step-2);
}

.deck__empty p {
  margin: 0 auto;
  max-width: 34ch;
  color: var(--text-300);
  font-size: var(--step--1);
}

/* ------------------------------------------------------------- controls */

.deck__controls {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: var(--space-4);
}

.circle {
  display: grid;
  place-items: center;
  width: 3.5rem;
  height: 3.5rem;
  border-radius: 50%;
  border: 1px solid var(--ink-600);
  background: var(--ink-800);
  color: var(--text-200);
  cursor: pointer;
  transition:
    transform var(--dur-fast) var(--ease-spring),
    background var(--dur-fast) var(--ease-glide),
    border-color var(--dur-fast) var(--ease-glide),
    box-shadow var(--dur-base) var(--ease-glide);
}

.circle svg {
  width: 1.5rem;
  height: 1.5rem;
  fill: none;
  stroke: currentColor;
  stroke-width: 2.25;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.circle--undo {
  width: 2.75rem;
  height: 2.75rem;
  color: var(--text-400);
}

.circle--undo svg {
  width: 1.1rem;
  height: 1.1rem;
}

.circle:hover:not(:disabled) {
  transform: translateY(-2px) scale(1.06);
}

.circle:active:not(:disabled) {
  transform: translateY(0) scale(0.94);
}

.circle--no:hover:not(:disabled) {
  color: var(--rose-400);
  border-color: var(--rose-400);
  box-shadow: 0 6px 20px -8px var(--rose-400);
}

.circle--yes:hover:not(:disabled) {
  color: var(--mint-400);
  border-color: var(--mint-400);
  box-shadow: 0 6px 20px -8px var(--mint-400);
}

.circle:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.circle:focus-visible {
  outline: 2px solid var(--accent-500);
  outline-offset: 3px;
}

/* ----------------------------------------------------------------- hint */

.deck__hint {
  margin: 0;
  text-align: center;
  font-size: var(--step--2);
  color: var(--text-400);
}

.deck__hint kbd {
  padding: 0.1em 0.4em;
  border-radius: 4px;
  border: 1px solid var(--ink-600);
  background: var(--ink-700);
  font-family: var(--font-mono);
  font-size: 0.95em;
}

/* A card entering the stack from the back fades in place rather than sliding,
   so it does not compete with the card that is leaving. */
.deck-card-enter-from {
  opacity: 0;
}

.deck-card-enter-active {
  transition: opacity var(--dur-base) var(--ease-glide);
}

@media (max-width: 560px) {
  /* Only slightly shorter than desktop. Cutting this down to fit more of the
     page on screen crops the radar, and a clipped chart reads as a bug. */
  .deck__stage {
    min-height: 31rem;
  }

  .deck__card {
    padding: var(--space-4);
  }
}
</style>
