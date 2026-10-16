<script setup>
import { computed } from 'vue';

/**
 * One price-range control: a two-handle slider over typed From/To boxes, both
 * editing the same value.
 *
 * The bounds are not a fixed 0–100,000. They come from what is actually listed,
 * so the whole track is usable — on a fixed scale every real ticket would sit in
 * the first half-percent of it and the slider would be decoration.
 *
 * A handle resting on its bound emits `''`, not a number: "as cheap as it gets"
 * is not a filter, and the page's chips and reset logic read an empty string as
 * "this bound is not set".
 */
const props = defineProps({
  /** `{ min, max }`, each a number of dollars or `''` for unbounded. */
  modelValue: { type: Object, required: true },
  floor: { type: Number, default: 0 },
  ceil: { type: Number, default: 500 },
});
const emit = defineEmits(['update:modelValue']);

const span = computed(() => Math.max(1, props.ceil - props.floor));
/** About a hundred stops across the track, rounded to something people think in. */
const step = computed(() => {
  const raw = span.value / 100;
  if (raw <= 1) return 1;
  if (raw <= 5) return 5;
  if (raw <= 10) return 10;
  return Math.round(raw / 10) * 10;
});

const clamp = (value) => Math.min(props.ceil, Math.max(props.floor, value));

// Resolved positions: an unset bound sits at its end of the track.
const lo = computed(() => (props.modelValue.min === '' ? props.floor : clamp(Number(props.modelValue.min))));
const hi = computed(() => (props.modelValue.max === '' ? props.ceil : clamp(Number(props.modelValue.max))));

const percent = (value) => ((value - props.floor) / span.value) * 100;
const fillStyle = computed(() => ({
  left: `${percent(lo.value)}%`,
  width: `${Math.max(0, percent(hi.value) - percent(lo.value))}%`,
}));

/**
 * When both handles are bunched at the top the upper one is buried under the
 * lower one's hit area, so the lower input is raised once it crosses halfway.
 */
const loOnTop = computed(() => lo.value > props.floor + span.value / 2);

const money = new Intl.NumberFormat('en-SG', { maximumFractionDigits: 0 });
const label = computed(() => {
  const from = props.modelValue.min === '' ? 'Any' : `$${money.format(lo.value)}`;
  const to = props.modelValue.max === '' ? 'any' : `$${money.format(hi.value)}`;
  return props.modelValue.min === '' && props.modelValue.max === ''
    ? 'Any price'
    : `${from} to ${to}`;
});

/** A bound sitting on its end of the track is not a filter. */
function publish(nextLo, nextHi) {
  emit('update:modelValue', {
    min: nextLo <= props.floor ? '' : nextLo,
    max: nextHi >= props.ceil ? '' : nextHi,
  });
}

function dragLo(event) {
  const value = clamp(Number(event.target.value));
  publish(Math.min(value, hi.value), hi.value);
}

function dragHi(event) {
  const value = clamp(Number(event.target.value));
  publish(lo.value, Math.max(value, lo.value));
}

/* ---- The typed boxes ----------------------------------------------------
 * Kept as text rather than number inputs: a number input lets a stray "e" or
 * "-" through and reports an empty string for them, which is indistinguishable
 * from a cleared box.
 */

function digits(value) {
  return String(value).replace(/[^\d]/g, '');
}

function typeLo(event) {
  const raw = digits(event.target.value);
  event.target.value = raw;
  if (raw === '') return publish(props.floor, hi.value);
  publish(clamp(Number(raw)), hi.value);
}

function typeHi(event) {
  const raw = digits(event.target.value);
  event.target.value = raw;
  if (raw === '') return publish(lo.value, props.ceil);
  publish(lo.value, clamp(Number(raw)));
}

/** Crossed bounds are only resolved on blur, so typing "4" on the way to "400" is not fought. */
function settle() {
  if (lo.value > hi.value) publish(hi.value, lo.value);
}

const loText = computed(() => (props.modelValue.min === '' ? '' : String(lo.value)));
const hiText = computed(() => (props.modelValue.max === '' ? '' : String(hi.value)));
</script>

<template>
  <div class="range">
    <div class="range__slider">
      <div class="range__track" aria-hidden="true">
        <div class="range__fill" :style="fillStyle" />
      </div>
      <input
        class="range__input"
        :style="{ zIndex: loOnTop ? 4 : 2 }"
        type="range"
        :min="floor"
        :max="ceil"
        :step="step"
        :value="lo"
        aria-label="Minimum price"
        :aria-valuetext="`$${money.format(lo)}`"
        @input="dragLo"
      />
      <input
        class="range__input"
        :style="{ zIndex: 3 }"
        type="range"
        :min="floor"
        :max="ceil"
        :step="step"
        :value="hi"
        aria-label="Maximum price"
        :aria-valuetext="`$${money.format(hi)}`"
        @input="dragHi"
      />
    </div>

    <div class="range__boxes">
      <span class="range__box">
        <span class="range__prefix" aria-hidden="true">$</span>
        <input
          type="text"
          inputmode="numeric"
          autocomplete="off"
          :value="loText"
          :placeholder="String(floor)"
          aria-label="Minimum price, in dollars"
          @input="typeLo"
          @blur="settle"
        />
      </span>
      <span class="range__dash" aria-hidden="true">–</span>
      <span class="range__box">
        <span class="range__prefix" aria-hidden="true">$</span>
        <input
          type="text"
          inputmode="numeric"
          autocomplete="off"
          :value="hiText"
          :placeholder="String(ceil)"
          aria-label="Maximum price, in dollars"
          @input="typeHi"
          @blur="settle"
        />
      </span>
    </div>

    <p class="range__read" role="status">{{ label }}</p>
  </div>
</template>

<style scoped>
.range { display: grid; gap: var(--space-2); }

/* ---- Slider -------------------------------------------------------------- */

.range__slider {
  position: relative;
  display: flex;
  align-items: center;
  height: 26px;
  /* The thumbs are centred on the ends, so the track is inset by half a thumb
     to keep the fill from running past them. */
  padding-inline: 9px;
}

.range__track {
  position: absolute;
  inset-inline: 0;
  height: 4px;
  border-radius: var(--radius-pill);
  background: var(--ink-600);
}

.range__fill {
  position: absolute;
  height: 100%;
  border-radius: inherit;
  background: var(--accent-500);
}

/* Both inputs cover the whole track; only their thumbs take the pointer, so the
   one underneath is still reachable. */
.range__input {
  position: absolute;
  inset-inline: 0;
  width: 100%;
  height: 26px;
  margin: 0;
  background: transparent;
  pointer-events: none;
  -webkit-appearance: none;
  appearance: none;
}

.range__input:focus { outline: none; }

.range__input::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  pointer-events: auto;
  width: 18px;
  height: 18px;
  border: 2px solid var(--accent-500);
  border-radius: 50%;
  background: var(--ink-800);
  box-shadow: var(--shadow-sm);
  cursor: grab;
}

.range__input::-moz-range-thumb {
  pointer-events: auto;
  width: 14px;
  height: 14px;
  border: 2px solid var(--accent-500);
  border-radius: 50%;
  background: var(--ink-800);
  cursor: grab;
}

.range__input:active::-webkit-slider-thumb { cursor: grabbing; }
.range__input:focus-visible::-webkit-slider-thumb { box-shadow: 0 0 0 4px var(--accent-glow); }
.range__input:focus-visible::-moz-range-thumb { box-shadow: 0 0 0 4px var(--accent-glow); }

/* ---- Typed boxes --------------------------------------------------------- */

.range__boxes {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.range__box {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 1px;
  min-width: 0;
  min-height: 40px;
  padding-inline: var(--space-3);
  border: var(--border-soft);
  border-radius: var(--radius-md);
  background: var(--ink-800);
  transition:
    border-color var(--dur-fast) var(--ease-out),
    box-shadow var(--dur-fast) var(--ease-out);
}

.range__box:focus-within {
  border-color: var(--accent-500);
  box-shadow: 0 0 0 3px var(--accent-glow);
}

.range__prefix { color: var(--text-400); font-size: var(--step--1); }

.range__box input {
  width: 100%;
  min-width: 0;
  padding: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--text-200);
  font: inherit;
  font-size: var(--step--1);
  font-variant-numeric: tabular-nums;
}

.range__box input::placeholder { color: var(--text-400); }

.range__dash { flex: none; color: var(--text-400); }

.range__read {
  color: var(--text-400);
  font-size: var(--step--2);
  font-variant-numeric: tabular-nums;
  font-weight: 400;
}
</style>
