<script setup>
// Swapping a stable pairing exposes a pair who both prefer each other.
import { ref, computed } from 'vue';

const swapped = ref(false);

const people = {
  left: [
    { id: 'A', name: 'Amira', wants: 'Pit, queue early' },
    { id: 'B', name: 'Bryan', wants: 'Pit, when doors open' },
  ],
  right: [
    { id: 'C', name: "Chloe's group", wants: 'Pit, 1 place' },
    { id: 'D', name: "Daniel's group", wants: 'Upper bowl, 1 place' },
  ],
};

// Both seekers rank C first; C ranks A first. So A-C and B-D is stable, and the
// swap (A-D, B-C) leaves A and C both preferring each other.
const pairing = computed(() =>
  swapped.value
    ? { A: 'D', B: 'C' }
    : { A: 'C', B: 'D' },
);

const blockingPair = computed(() => (swapped.value ? ['A', 'C'] : null));

const isBlocking = (id) => blockingPair.value?.includes(id) ?? false;

/** Endpoint coordinates for the connector lines, in the SVG's own units. */
const lineFor = (seekerId) => {
  const rowOf = { A: 0, B: 1 };
  const targetRow = { C: 0, D: 1 }[pairing.value[seekerId]];
  return {
    y1: 26 + rowOf[seekerId] * 76,
    y2: 26 + targetRow * 76,
  };
};
</script>

<template>
  <div class="demo">
    <div class="demo__controls">
      <button
        class="switch"
        :class="{ 'switch--on': swapped }"
        role="switch"
        :aria-checked="swapped"
        @click="swapped = !swapped"
      >
        <span class="switch__track"><span class="switch__thumb" /></span>
        <span class="switch__label">
          {{ swapped ? 'Swapped pairing' : 'Stable pairing' }}
        </span>
      </button>

      <p class="demo__verdict" :class="swapped ? 'is-bad' : 'is-good'">
        <span class="demo__dot" />
        {{ swapped ? '1 blocking pair' : '0 blocking pairs' }}
      </p>
    </div>

    <div class="demo__board">
      <div class="demo__column">
        <p class="demo__heading">Looking for a group</p>
        <div
          v-for="person in people.left"
          :key="person.id"
          class="person"
          :class="{ 'person--blocking': isBlocking(person.id) }"
        >
          <span class="person__id mono">{{ person.id }}</span>
          <span class="person__body">
            <strong>{{ person.name }}</strong>
            <em>{{ person.wants }}</em>
          </span>
        </div>
      </div>

      <svg class="demo__links" viewBox="0 0 100 128" preserveAspectRatio="none" aria-hidden="true">
        <line
          v-for="seeker in ['A', 'B']"
          :key="seeker"
          class="link"
          x1="2"
          x2="98"
          :y1="lineFor(seeker).y1"
          :y2="lineFor(seeker).y2"
        />
        <!-- The blocking pair is in the top row; the arc is not an assignment. -->
        <path
          v-if="blockingPair"
          class="link link--defect"
          d="M 2 26 Q 50 -6 98 26"
        />
      </svg>

      <div class="demo__column">
        <p class="demo__heading">Groups with available places</p>
        <div
          v-for="person in people.right"
          :key="person.id"
          class="person person--right"
          :class="{ 'person--blocking': isBlocking(person.id) }"
        >
          <span class="person__body">
            <strong>{{ person.name }}</strong>
            <em>{{ person.wants }}</em>
          </span>
          <span class="person__id mono">{{ person.id }}</span>
        </div>
      </div>
    </div>

    <Transition name="explain">
      <p v-if="swapped" class="demo__explain demo__explain--bad">
        <strong>Amira and Chloe's group prefer each other</strong> to their current
        matches. This is a blocking pair.
      </p>
      <p v-else class="demo__explain demo__explain--good">
        <strong>The pairing is stable.</strong> No person and group would both
        prefer each other to their current matches.
      </p>
    </Transition>
  </div>
</template>

<style scoped>
.demo {
  border: var(--border-hairline);
  border-radius: var(--radius-lg);
  background: var(--ink-800);
  padding: var(--space-5);
}

@media (min-width: 760px) {
  .demo {
    padding: var(--space-6);
  }
}

/* ---- Controls ----------------------------------------------------------- */

.demo__controls {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4);
  align-items: center;
  justify-content: space-between;
  padding-bottom: var(--space-5);
  margin-bottom: var(--space-5);
  border-bottom: var(--border-hairline);
}

.switch {
  display: inline-flex;
  align-items: center;
  gap: var(--space-3);
}

.switch__track {
  position: relative;
  width: 46px;
  height: 26px;
  border-radius: var(--radius-pill);
  background: var(--ink-600);
  transition: background var(--dur-base) var(--ease-out);
}

.switch--on .switch__track {
  background: var(--rose-400);
}

.switch__thumb {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--text-100);
  transition: transform var(--dur-base) var(--ease-spring);
}

.switch--on .switch__thumb {
  transform: translateX(20px);
}

.switch__label {
  font-size: var(--step--1);
  font-weight: 500;
  color: var(--text-200);
}

.demo__verdict {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  font-family: var(--font-mono);
  font-size: var(--step--1);
  font-weight: 500;
}

.demo__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: currentColor;
  box-shadow: 0 0 0 4px color-mix(in oklab, currentColor 20%, transparent);
}

.is-good { color: var(--mint-400); }
.is-bad  { color: var(--rose-400); }

/* ---- Board -------------------------------------------------------------- */

.demo__board {
  display: grid;
  grid-template-columns: 1fr;
  gap: var(--space-4);
}

@media (min-width: 720px) {
  .demo__board {
    grid-template-columns: 1fr 90px 1fr;
    align-items: start;
    gap: var(--space-2);
  }
}

.demo__heading {
  font-family: var(--font-mono);
  font-size: var(--step--2);
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: var(--text-400);
  margin-bottom: var(--space-3);
  height: 1.2em;
}

.person {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-md);
  border: var(--border-hairline);
  background: var(--ink-750);
  height: 64px;
  transition:
    border-color var(--dur-base) var(--ease-out),
    background var(--dur-base) var(--ease-out),
    box-shadow var(--dur-base) var(--ease-out);
}

.person + .person {
  margin-top: var(--space-3);
}

.person--right {
  justify-content: space-between;
  text-align: right;
}

.person--blocking {
  border-color: var(--rose-400);
  background: color-mix(in oklab, var(--rose-400) 10%, var(--ink-750));
  box-shadow: 0 0 0 3px color-mix(in oklab, var(--rose-400) 16%, transparent);
}

.person__id {
  flex-shrink: 0;
  width: 26px;
  height: 26px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: var(--ink-600);
  font-size: var(--step--2);
  font-weight: 500;
  color: var(--text-200);
}

.person--blocking .person__id {
  background: var(--rose-400);
  color: var(--ink-900);
}

.person__body {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.person__body strong {
  font-size: var(--step--1);
  color: var(--text-100);
  font-weight: 550;
}

.person__body em {
  font-style: normal;
  font-size: var(--step--2);
  color: var(--text-400);
}

/* ---- Connector lines ---------------------------------------------------- */

.demo__links {
  display: none;
  height: 155px;
  width: 100%;
  overflow: visible;
}

@media (min-width: 720px) {
  .demo__links {
    display: block;
    margin-top: calc(1.2em + var(--space-3));
  }
}

.link {
  stroke: var(--accent-500);
  stroke-width: 2.5;
  stroke-linecap: round;
  fill: none;
  opacity: 0.55;
  vector-effect: non-scaling-stroke;
  transition:
    stroke var(--dur-base) var(--ease-out),
    opacity var(--dur-base) var(--ease-out);
}

.link--defect {
  stroke: var(--rose-400);
  stroke-width: 2.5;
  stroke-dasharray: 5 5;
  animation: crawl 900ms linear infinite;
}

@keyframes crawl {
  to { stroke-dashoffset: -20; }
}

@media (prefers-reduced-motion: reduce) {
  .link--defect { animation: none; }
}

/* ---- Explanation -------------------------------------------------------- */

.demo__explain {
  margin-top: var(--space-5);
  padding: var(--space-4);
  border-radius: var(--radius-md);
  font-size: var(--step--1);
  line-height: 1.55;
  border-left: 3px solid;
}

.demo__explain--bad {
  border-left-color: var(--rose-400);
  background: color-mix(in oklab, var(--rose-400) 8%, transparent);
  color: var(--text-200);
}

.demo__explain--good {
  border-left-color: var(--mint-400);
  background: color-mix(in oklab, var(--mint-400) 8%, transparent);
  color: var(--text-200);
}

.explain-enter-active,
.explain-leave-active {
  transition: opacity var(--dur-fast) var(--ease-out);
}

.explain-enter-from,
.explain-leave-to {
  opacity: 0;
}
</style>
