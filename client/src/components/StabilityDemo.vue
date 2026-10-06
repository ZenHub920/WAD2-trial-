<script setup>
/**
 * Interactive explainer for blocking pairs.
 *
 * Four people, two possible pairings. One is stable; the other contains a pair who
 * would both rather be together — which is the whole idea the product rests on, so
 * it is worth letting someone feel it rather than reading it.
 */
import { ref, computed } from 'vue';

const swapped = ref(false);

const people = {
  left: [
    { id: 'A', name: 'Amira', wants: 'Pit, queue early', ranks: ['C', 'D'] },
    { id: 'B', name: 'Bryan', wants: 'Pit, arrive at doors', ranks: ['C', 'D'] },
  ],
  right: [
    { id: 'C', name: "Chloe's group", wants: 'Pit · 1 slot', ranks: ['A', 'B'] },
    { id: 'D', name: "Daniel's group", wants: 'Upper bowl · 1 slot', ranks: ['A', 'B'] },
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
          :class="{ 'link--blocking': isBlocking(seeker) && isBlocking(pairing[seeker]) }"
          x1="2"
          x2="98"
          :y1="lineFor(seeker).y1"
          :y2="lineFor(seeker).y2"
        />
        <!--
          The pair that would defect. Amira (left, row 0) and Chloe's group
          (right, row 0) both sit in the top row, so the arc bows ABOVE that row
          rather than crossing — a straight line there would be mistaken for an
          assignment, and crossing rows would point at the wrong two people.
        -->
        <path
          v-if="blockingPair"
          class="link link--defect"
          d="M 2 26 Q 50 -6 98 26"
        />
      </svg>

      <div class="demo__column">
        <p class="demo__heading">Groups with a spare ticket</p>
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
        <strong>Amira and Chloe's group both prefer each other</strong> to what they were
        given — Amira ranked Chloe's group first, and Chloe's group ranked Amira first.
        They will pair up privately and the arrangement collapses. That is a blocking
        pair, and it is what the algorithm exists to rule out.
      </p>
      <p v-else class="demo__explain demo__explain--good">
        <strong>No pair can improve by defecting.</strong> Amira got her first choice;
        Bryan would prefer Chloe's group, but they rank Amira above him and have no
        spare slot. Nobody has both the desire and the opportunity to leave.
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

.link--blocking {
  stroke: var(--rose-400);
  opacity: 0.4;
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
