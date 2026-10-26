<script setup>
import StabilityDemo from '../components/StabilityDemo.vue';
import { vReveal } from '../composables/useReveal.js';

const ways = [
  {
    title: 'Find a companion',
    body: "Join a concert's companion finder and browse people with similar preferences. When you both like each other, you can message one another.",
    to: '/kaki',
    action: 'Find a companion',
    icon: 'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8Z',
  },
  {
    title: 'Join a group',
    body: 'Browse groups for your concert and request a place. The host reviews your request. This is separate from companion likes and automatic matching rounds.',
    to: '/groups',
    action: 'Find a group',
    icon: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm13 10v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  },
  {
    title: 'Bring your friends',
    body: "Create a group, invite your friends and add everyone's preferences. Open places to new people or connect with another group at the same show.",
    to: '/groups/connect',
    action: 'Manage my groups',
    icon: 'M12 5v14M5 12h14',
  },
];
</script>

<template>
  <div class="container section method">
    <header class="page-banner">
      <h1>How it works</h1>
      <p class="lede">Choose your concert, find your people and make a plan.</p>
    </header>

    <ol class="ways">
      <li v-for="(way, i) in ways" :key="way.title" v-reveal="i">
        <section class="way">
          <span class="way__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none"><path :d="way.icon" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
          </span>
          <span class="way__n" aria-hidden="true">0{{ i + 1 }}</span>
          <h2>{{ way.title }}</h2>
          <p>{{ way.body }}</p>
          <RouterLink :to="way.to" class="btn btn--ghost">
            {{ way.action }}
            <svg class="way__arrow" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
          </RouterLink>
        </section>
      </li>
    </ol>

    <details id="gale-shapley" v-reveal class="card about">
      <summary>About automatic matching</summary>
      <p>Automatic matching rounds pair group finders with groups using ranked preferences and available group places.</p>
      <div id="stability">
        <p>A stable assignment has no group finder and group who would both prefer each other to their current match. The example below illustrates this rule.</p>
        <StabilityDemo />
      </div>
    </details>
  </div>
</template>

<style scoped>
.method {
  max-width: 1000px;
}

header .lede {
  margin-top: var(--space-4);
}

.ways {
  display: grid;
  gap: var(--space-5);
  margin-top: var(--space-7);
  padding: 0;
  list-style: none;
}

@media (min-width: 860px) {
  .ways { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}

.way {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  padding: var(--space-6);
  border: var(--border-hairline);
  border-radius: var(--radius-lg);
  background: color-mix(in srgb, var(--ink-800) 78%, transparent);
  backdrop-filter: blur(16px);
  transition:
    transform var(--dur-base) var(--ease-out),
    box-shadow var(--dur-base) var(--ease-out),
    border-color var(--dur-base) var(--ease-out);
}

.way:hover {
  transform: translateY(-6px);
  border-color: var(--accent-400);
  box-shadow: 0 20px 40px -20px var(--accent-400);
}

.way::after {
  content: '';
  position: absolute;
  inset: auto 0 0 0;
  height: 3px;
  background: linear-gradient(90deg, var(--accent-400), var(--mint-400));
  transform: scaleX(0);
  transform-origin: left;
  transition: transform var(--dur-slow) var(--ease-settle);
}

.way:hover::after { transform: scaleX(1); }

.way__icon {
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

.way__icon svg { width: 26px; height: 26px; }
.way:hover .way__icon { transform: rotate(-8deg) scale(1.08); }

.way__n {
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

.way:hover .way__n { -webkit-text-stroke-color: var(--accent-300); }

.way h2 {
  margin-top: var(--space-5);
  font-size: var(--step-1);
}

.way p {
  flex: 1;
  margin-block: var(--space-3) var(--space-5);
  color: var(--text-300);
  font-size: var(--step--1);
}

.way .btn { align-self: start; }

.way__arrow {
  width: 1.1em;
  height: 1.1em;
  transition: transform var(--dur-base) var(--ease-spring);
}

.way:hover .way__arrow { transform: translateX(4px); }

.about {
  margin-top: var(--space-6);
}

.about p {
  max-width: 65ch;
  margin-block: var(--space-3) var(--space-4);
  color: var(--text-300);
}

summary {
  cursor: pointer;
  font-weight: 700;
  color: var(--text-100);
}

@media (prefers-reduced-motion: reduce) {
  .way:hover { transform: none; }
}
</style>
