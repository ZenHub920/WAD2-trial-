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

import { ref, onMounted, onUnmounted } from 'vue';
import { reducedMotion } from './useReducedMotion.js';

export function useInView(options = {}) {
  const { threshold = 0.15, rootMargin = '0px 0px -8% 0px', once = true } = options;

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

    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
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

    if (target.value) observer.observe(target.value);
  });

  onUnmounted(() => {
    observer?.disconnect();
    observer = null;
  });

  return { target, inView };
}
