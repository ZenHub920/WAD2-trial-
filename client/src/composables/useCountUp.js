/**
 * Animated number transitions.
 *
 * Counting a figure up is only worth doing when the figure is the point — a
 * headline metric, a score that just changed. It is applied here to the round
 * forecast and the stability counters, not to every number on the page.
 *
 * Driven by requestAnimationFrame against wall-clock time rather than a
 * per-frame increment, so the duration holds on a slow frame instead of the
 * animation running long.
 */

import { ref, watch, onUnmounted } from 'vue';
import { reducedMotion } from './useReducedMotion.js';

/** Decelerating curve. Matches --ease-settle closely enough to feel related. */
function easeOutQuart(t) {
  return 1 - (1 - t) ** 4;
}

/**
 * @param {import('vue').Ref<number>|(() => number)} source  the target value
 * @param {object} [options]
 * @param {number} [options.duration=900]
 * @param {number} [options.decimals=0]
 * @param {boolean} [options.enabled=true] hold at zero until this turns true,
 *   so a count-up can wait for the element to scroll into view
 */
export function useCountUp(source, options = {}) {
  const { duration = 900, decimals = 0, enabled = true } = options;

  const displayed = ref(0);
  let frame = null;
  let startedAt = 0;
  let from = 0;
  let to = 0;

  const read = () => {
    const raw = typeof source === 'function' ? source() : source.value;
    return Number.isFinite(raw) ? raw : 0;
  };

  function stop() {
    if (frame !== null) {
      cancelAnimationFrame(frame);
      frame = null;
    }
  }

  function tick(now) {
    const elapsed = now - startedAt;
    const t = Math.min(1, elapsed / duration);
    const value = from + (to - from) * easeOutQuart(t);

    const factor = 10 ** decimals;
    displayed.value = Math.round(value * factor) / factor;

    if (t < 1) {
      frame = requestAnimationFrame(tick);
    } else {
      displayed.value = to;
      frame = null;
    }
  }

  function run(target) {
    stop();
    to = target;

    if (reducedMotion() || duration <= 0) {
      displayed.value = to;
      return;
    }

    from = displayed.value;
    if (from === to) return;

    startedAt = performance.now();
    frame = requestAnimationFrame(tick);
  }

  const gate = typeof enabled === 'boolean' ? ref(enabled) : enabled;

  watch(
    [() => read(), () => gate.value],
    ([target, open]) => {
      if (!open) return;
      run(target);
    },
    { immediate: true },
  );

  onUnmounted(stop);

  return displayed;
}
