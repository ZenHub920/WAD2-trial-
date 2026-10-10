/**
 * Reactive `prefers-reduced-motion`.
 *
 * base.css already neutralises CSS transitions for people who ask for reduced
 * motion, but it cannot touch animation driven from JavaScript — the swipe
 * deck's spring, the FLIP expansion, the count-ups. Those need to read the
 * preference themselves, which is what this exposes.
 *
 * The listener is attached once per module rather than once per component, so
 * fifty subscribers cost one matchMedia handler.
 */

import { ref, readonly } from 'vue';

const QUERY = '(prefers-reduced-motion: reduce)';

const prefersReduced = ref(false);

if (typeof window !== 'undefined' && window.matchMedia) {
  const mq = window.matchMedia(QUERY);
  prefersReduced.value = mq.matches;
  mq.addEventListener('change', (event) => {
    prefersReduced.value = event.matches;
  });
}

export function useReducedMotion() {
  return readonly(prefersReduced);
}

/** Imperative read, for code paths outside a component's reactive scope. */
export function reducedMotion() {
  return prefersReduced.value;
}
