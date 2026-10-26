/**
 * Scroll-in reveals.
 *
 * `v-reveal` fades an element up the first time it scrolls into view. Pass an
 * index (`v-reveal="i"`) to stagger siblings. The styles live in base.css as
 * `.reveal` / `.is-revealed`, so any page can use the directive.
 *
 * One IntersectionObserver is shared by every element, and each element is
 * released once it has been shown, so long lists stay cheap.
 */

import { reducedMotion } from './useReducedMotion.js';

let observer = null;

function shared() {
  observer ??= new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('is-revealed');
      observer.unobserve(entry.target);
    }
  }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
  return observer;
}

export const vReveal = {
  mounted(el, binding) {
    el.classList.add('reveal');
    if (binding.value != null) el.style.setProperty('--reveal-i', binding.value);
    if (reducedMotion() || typeof IntersectionObserver === 'undefined') {
      el.classList.add('is-revealed');
      return;
    }
    shared().observe(el);
  },
  unmounted(el) {
    observer?.unobserve(el);
  },
};
