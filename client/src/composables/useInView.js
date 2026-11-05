/**
 * Reveal-on-scroll, via IntersectionObserver.
 *
 * Deliberately one-shot: the element reveals the first time it enters the
 * viewport and then the observer is disconnected. Re-animating on every scroll
 * past is the thing that makes a page feel restless, and it punishes anyone who
 * scrolls back to re-read something.
 *
 * Returns a template ref to attach, plus a boolean to drive the class.
 */

import { ref, onMounted, onUnmounted, watch } from 'vue';
import { reducedMotion } from './useReducedMotion.js';

export function useInView(options = {}) {
  const {
    threshold = 0.15,
    rootMargin = '0px 0px -8% 0px',
    once = true,
    // A ref to wait for before watching. A section measured while the page is
    // still filling in can be judged on a layout that is about to change, and
    // a one-shot reveal has no way back once it has latched.
    until = null,
  } = options;

  const target = ref(null);
  const inView = ref(false);
  let observer = null;

  onMounted(() => {
    // No observer, or motion is unwanted: show it immediately rather than
    // leaving content stuck in its hidden pre-reveal state.
    if (reducedMotion() || typeof IntersectionObserver === 'undefined') {
      inView.value = true;
      return;
    }

    // `isIntersecting` is true for any overlap at all, including the single
    // row of pixels an element shows while still effectively off screen, and
    // the observer always delivers one callback with the starting state. So
    // the threshold is checked here too, or a tall viewport counts a section
    // below the fold as seen before anyone has scrolled.
    const needed = Math.min(...[threshold].flat());

    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio >= needed) {
            inView.value = true;
            if (once) {
              observer?.disconnect();
              observer = null;
            }
          } else if (!once) {
            inView.value = false;
          }
        }
      },
      { threshold, rootMargin },
    );

    const start = () => {
      if (target.value && observer) observer.observe(target.value);
    };

    if (!until) {
      start();
      return;
    }

    if (until.value) start();
    else watch(until, (ready) => ready && start(), { once: true });
  });

  onUnmounted(() => {
    observer?.disconnect();
    observer = null;
  });

  return { target, inView };
}
