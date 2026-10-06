<script setup>
import { ref, onMounted, onUnmounted } from 'vue';

defineProps({ theme: { type: String, default: 'dark' } });
defineEmits(['toggle-theme']);

const scrolled = ref(false);
const menuOpen = ref(false);

function onScroll() {
  scrolled.value = window.scrollY > 12;
}

onMounted(() => window.addEventListener('scroll', onScroll, { passive: true }));
onUnmounted(() => window.removeEventListener('scroll', onScroll));
</script>

<template>
  <header class="header" :class="{ 'header--scrolled': scrolled }">
    <div class="header__inner container container--wide">
      <RouterLink to="/" class="brand" @click="menuOpen = false">
        <span class="brand__mark" aria-hidden="true">
          <span class="brand__bar" v-for="n in 4" :key="n" :style="{ '--i': n }" />
        </span>
        <span class="brand__word">Encore</span>
      </RouterLink>

      <button
        class="header__toggle"
        :aria-expanded="menuOpen"
        aria-label="Toggle navigation"
        @click="menuOpen = !menuOpen"
      >
        <span :class="{ open: menuOpen }" />
      </button>

      <nav class="nav" :class="{ 'nav--open': menuOpen }" aria-label="Main">
        <RouterLink to="/concerts" @click="menuOpen = false">Concerts</RouterLink>
        <RouterLink to="/method" @click="menuOpen = false">How it works</RouterLink>
        <button class="theme-btn" @click="$emit('toggle-theme')">
          <span aria-hidden="true">{{ theme === 'dark' ? '☾' : '☀' }}</span>
          <span class="sr-only">Switch to {{ theme === 'dark' ? 'light' : 'dark' }} theme</span>
        </button>
        <RouterLink to="/concerts" class="btn btn--primary nav__cta" @click="menuOpen = false">
          Find a group
        </RouterLink>
      </nav>
    </div>
  </header>
</template>

<style scoped>
.header {
  position: sticky;
  top: 0;
  z-index: 100;
  height: var(--header-height);
  display: flex;
  align-items: center;
  background: color-mix(in oklab, var(--ink-900) 78%, transparent);
  backdrop-filter: blur(14px) saturate(140%);
  border-bottom: 1px solid transparent;
  transition:
    border-color var(--dur-base) var(--ease-out),
    background var(--dur-base) var(--ease-out);
}

.header--scrolled {
  border-bottom-color: var(--ink-600);
  background: color-mix(in oklab, var(--ink-900) 92%, transparent);
}

.header__inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-5);
}

/* ---- Brand: four bars, like a level meter ------------------------------- */

.brand {
  display: inline-flex;
  align-items: center;
  gap: var(--space-3);
  text-decoration: none;
  color: var(--text-100);
}

.brand__mark {
  display: flex;
  align-items: flex-end;
  gap: 2px;
  height: 20px;
}

.brand__bar {
  width: 3px;
  border-radius: 2px;
  background: var(--accent-500);
  height: calc(6px + var(--i) * 3px);
  transform-origin: bottom;
  transition: height var(--dur-base) var(--ease-spring);
}

.brand:hover .brand__bar {
  animation: pulse 900ms var(--ease-out) infinite;
  animation-delay: calc(var(--i) * 80ms);
}

@keyframes pulse {
  0%, 100% { transform: scaleY(1); }
  50% { transform: scaleY(1.7); }
}

.brand__word {
  font-family: var(--font-display);
  font-size: var(--step-1);
  font-weight: 700;
  letter-spacing: -0.03em;
}

/* ---- Navigation --------------------------------------------------------- */

.nav {
  display: flex;
  align-items: center;
  gap: var(--space-5);
}

.nav a:not(.nav__cta) {
  color: var(--text-300);
  text-decoration: none;
  font-size: var(--step--1);
  font-weight: 500;
  position: relative;
  padding-block: var(--space-2);
  transition: color var(--dur-fast) var(--ease-out);
}

.nav a:not(.nav__cta)::after {
  content: '';
  position: absolute;
  left: 0;
  bottom: 0;
  height: 2px;
  width: 100%;
  background: var(--accent-500);
  border-radius: 2px;
  transform: scaleX(0);
  transform-origin: left;
  transition: transform var(--dur-base) var(--ease-out);
}

.nav a:not(.nav__cta):hover,
.nav a.router-link-active:not(.nav__cta) {
  color: var(--text-100);
}

.nav a.router-link-active:not(.nav__cta)::after,
.nav a:not(.nav__cta):hover::after {
  transform: scaleX(1);
}

.theme-btn {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border-radius: var(--radius-pill);
  border: var(--border-hairline);
  color: var(--text-300);
  font-size: var(--step-0);
  transition:
    color var(--dur-fast) var(--ease-out),
    border-color var(--dur-fast) var(--ease-out),
    transform var(--dur-base) var(--ease-spring);
}

.theme-btn:hover {
  color: var(--accent-400);
  border-color: var(--accent-500);
  transform: rotate(-20deg);
}

/* ---- Mobile ------------------------------------------------------------- */

.header__toggle {
  display: none;
  width: 38px;
  height: 38px;
  place-items: center;
  border-radius: var(--radius-sm);
}

.header__toggle span {
  position: relative;
  display: block;
  width: 20px;
  height: 2px;
  border-radius: 2px;
  background: var(--text-100);
  transition: background var(--dur-fast) var(--ease-out);
}

.header__toggle span::before,
.header__toggle span::after {
  content: '';
  position: absolute;
  left: 0;
  width: 20px;
  height: 2px;
  border-radius: 2px;
  background: var(--text-100);
  transition: transform var(--dur-base) var(--ease-out);
}

.header__toggle span::before { transform: translateY(-6px); }
.header__toggle span::after { transform: translateY(6px); }

.header__toggle span.open { background: transparent; }
.header__toggle span.open::before { transform: rotate(45deg); }
.header__toggle span.open::after { transform: rotate(-45deg); }

@media (max-width: 820px) {
  .header__toggle {
    display: grid;
  }

  .nav {
    position: fixed;
    inset: var(--header-height) 0 auto 0;
    flex-direction: column;
    align-items: stretch;
    gap: var(--space-4);
    padding: var(--space-5) var(--gutter) var(--space-6);
    background: var(--ink-850);
    border-bottom: var(--border-hairline);
    box-shadow: var(--shadow-lg);
    transform: translateY(-120%);
    opacity: 0;
    pointer-events: none;
    transition:
      transform var(--dur-base) var(--ease-out),
      opacity var(--dur-fast) var(--ease-out);
  }

  .nav--open {
    transform: translateY(0);
    opacity: 1;
    pointer-events: auto;
  }

  .nav a:not(.nav__cta) {
    font-size: var(--step-1);
  }

  .theme-btn {
    align-self: flex-start;
  }
}
</style>
