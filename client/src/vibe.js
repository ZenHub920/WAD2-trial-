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
