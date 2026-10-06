<script setup>
/**
 * Six-axis radar for a person's vibe vector.
 *
 * The same vector the backend feeds into cosine similarity, drawn so two people's
 * compatibility is legible at a glance rather than as a number.
 */
import { computed } from 'vue';
import { LABELS } from '../api.js';

const props = defineProps({
  vibe: { type: Object, required: true },
  compare: { type: Object, default: null },
  size: { type: Number, default: 160 },
  max: { type: Number, default: 5 },
});

const AXES = ['singalong', 'photography', 'dancing', 'quiet', 'queue_early', 'merch'];

/**
 * Short labels, because the full ones from LABELS.vibe ("Quiet listening") are
 * wider than the space beside the chart and collide with neighbouring content.
 * The long form stays in the accessible description.
 */
const SHORT = {
  singalong: 'Sing',
  photography: 'Photo',
  dancing: 'Dance',
  quiet: 'Quiet',
  queue_early: 'Queue',
  merch: 'Merch',
};

const centre = computed(() => props.size / 2);
const radius = computed(() => props.size / 2 - 22);

/**
 * Horizontal breathing room in the viewBox itself. The left and right axis labels
 * sit outside the chart circle, so without it they are clipped by the card.
 */
const padX = 26;

function point(index, value) {
  // Start at 12 o'clock and go clockwise.
  const angle = (Math.PI * 2 * index) / AXES.length - Math.PI / 2;
  const r = (Math.min(value, props.max) / props.max) * radius.value;
  return {
    x: centre.value + Math.cos(angle) * r,
    y: centre.value + Math.sin(angle) * r,
  };
}

function polygon(vector) {
  return AXES.map((axis, i) => {
    const p = point(i, vector?.[axis] ?? 0);
    return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
  }).join(' ');
}

const rings = [0.33, 0.66, 1];

const axisLines = computed(() =>
  AXES.map((axis, i) => ({ axis, ...point(i, props.max) })),
);

const labelPositions = computed(() =>
  AXES.map((axis, i) => {
    const angle = (Math.PI * 2 * i) / AXES.length - Math.PI / 2;
    return {
      axis,
      label: SHORT[axis],
      x: centre.value + Math.cos(angle) * (radius.value + 11),
      y: centre.value + Math.sin(angle) * (radius.value + 11),
      anchor: Math.abs(Math.cos(angle)) < 0.3 ? 'middle' : Math.cos(angle) > 0 ? 'start' : 'end',
    };
  }),
);
</script>

<template>
  <svg
    class="radar"
    :viewBox="`${-padX} 0 ${size + padX * 2} ${size}`"
    :style="{ maxWidth: `${size + padX * 2}px` }"
    role="img"
    :aria-label="`Vibe profile: ${AXES.map((a) => `${LABELS.vibe[a]} ${vibe?.[a] ?? 0} of ${max}`).join(', ')}`"
  >
    <g class="radar__grid">
      <polygon
        v-for="ring in rings"
        :key="ring"
        :points="polygon(Object.fromEntries(AXES.map((a) => [a, max * ring])))"
      />
      <line
        v-for="line in axisLines"
        :key="line.axis"
        :x1="centre" :y1="centre" :x2="line.x" :y2="line.y"
      />
    </g>

    <polygon v-if="compare" class="radar__compare" :points="polygon(compare)" />
    <polygon class="radar__shape" :points="polygon(vibe)" />

    <g class="radar__labels">
      <text
        v-for="label in labelPositions"
        :key="label.axis"
        :x="label.x"
        :y="label.y"
        :text-anchor="label.anchor"
        dominant-baseline="middle"
      >{{ label.label }}</text>
    </g>
  </svg>
</template>

<style scoped>
.radar {
  width: 100%;
  overflow: visible;
}

.radar__grid polygon {
  fill: none;
  stroke: var(--ink-600);
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
}

.radar__grid line {
  stroke: var(--ink-600);
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
}

.radar__shape {
  fill: color-mix(in oklab, var(--accent-500) 28%, transparent);
  stroke: var(--accent-400);
  stroke-width: 2;
  stroke-linejoin: round;
  vector-effect: non-scaling-stroke;
  transition: all var(--dur-slow) var(--ease-out);
}

.radar__compare {
  fill: color-mix(in oklab, var(--cyan-400) 18%, transparent);
  stroke: var(--cyan-400);
  stroke-width: 1.5;
  stroke-dasharray: 4 3;
  stroke-linejoin: round;
  vector-effect: non-scaling-stroke;
}

.radar__labels text {
  font-family: var(--font-mono);
  font-size: 8.5px;
  fill: var(--text-400);
  letter-spacing: 0.02em;
}
</style>
