import { LABELS } from './api.js';

/** The six concert-vibe sliders, in the order Profile shows them. */
export const VIBE_AXES = Object.keys(LABELS.vibe);

/**
 * Whether someone has saved all six concert-vibe ratings. New accounts start
 * with none, so this is false until they save the sliders once (0 counts as an
 * answer). Matching and companion cards rely on these ratings.
 */
export function vibeComplete(vibe) {
  return Boolean(vibe) && VIBE_AXES.every(axis => Number.isInteger(vibe[axis]) && vibe[axis] >= 0 && vibe[axis] <= 4);
}

/**
 * Concert-vibe colours (tokens.css: --vibe-<axis>) wherever a vibe shows up as
 * a chip: the six vibe axes, the matching concepts that mean the same thing,
 * and their labels. Anything else keeps its normal look.
 */
const AXIS_OF = {
  singalong: 'singalong', 'sing along': 'singalong',
  photography: 'photography', group_photos: 'photography', 'group photos': 'photography',
  dancing: 'dancing',
  quiet: 'quiet', 'quiet listening': 'quiet',
  queue_early: 'queue_early', early_queue: 'queue_early', 'queue early': 'queue_early', 'early queueing': 'queue_early',
  merch: 'merch', merch_run: 'merch', merchandise: 'merch', 'merchandise shopping': 'merch',
};
export function vibeAxisOf(...keys) {
  for (const key of keys) {
    const axis = typeof key === 'string' ? AXIS_OF[key.trim().toLowerCase()] : null;
    if (axis) return axis;
  }
  return null;
}
/** Bind onto a chip: `v-bind="vibeChip(concept, label)"`. */
export function vibeChip(...keys) {
  const axis = vibeAxisOf(...keys);
  return axis ? { class: 'vibe-chip', style: { '--vibe-colour': `var(--vibe-${axis})` } } : {};
}
