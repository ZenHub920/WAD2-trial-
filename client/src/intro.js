import { ref } from 'vue';

/**
 * True while the opening title sequence is on screen.
 *
 * The header's own wordmark hides itself during that time, so the flying title
 * can land in its place without the two briefly overlapping.
 */
export const introActive = ref(false);

/** Set by the header so the title knows exactly where to fly to. */
export const BRAND_TARGET = 'data-brand-target';
