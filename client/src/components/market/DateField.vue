<script setup>
import { computed, nextTick, ref, watch } from 'vue';

/**
 * A three-segment date field: DD / MM / YYYY.
 *
 * Replaces `<input type="date">`, whose segments are browser-owned: one
 * Backspace there wipes the whole segment, because the browser treats "02" as a
 * single value rather than two characters. These are ordinary text inputs, so a
 * Backspace removes exactly one digit — and when a segment is already empty it
 * steps back and removes the last digit of the one before, so repeated presses
 * walk the whole date back a digit at a time.
 *
 * Emits a `YYYY-MM-DD` string once the date is complete AND real, and an empty
 * string otherwise — a half-typed date must not filter anything out.
 */
const props = defineProps({
  modelValue: { type: String, default: '' },
  /** id of the element naming this group, since a <label> cannot point at three inputs. */
  labelledBy: { type: String, default: undefined },
});
const emit = defineEmits(['update:modelValue']);

const SEGMENTS = [
  { name: 'day', size: 2, label: 'Day', placeholder: 'DD' },
  { name: 'month', size: 2, label: 'Month', placeholder: 'MM' },
  { name: 'year', size: 4, label: 'Year', placeholder: 'YYYY' },
];

const day = ref('');
const month = ref('');
const year = ref('');
const values = { day, month, year };

const dayEl = ref(null);
const monthEl = ref(null);
const yearEl = ref(null);
const elements = { day: dayEl, month: monthEl, year: yearEl };

const sizeOf = (name) => SEGMENTS.find((s) => s.name === name).size;
const indexOf = (name) => SEGMENTS.findIndex((s) => s.name === name);

/** The last value we emitted, so an echo back through modelValue is not re-parsed. */
let emitted = '';

const filled = computed(() => day.value && month.value && year.value.length === 4);
/** Flagged only once all three are filled — nobody wants "31" marked wrong while they type. */
const invalid = computed(() => Boolean(filled.value && !toIso()));

function isReal(y, m, d) {
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

function toIso() {
  if (!filled.value) return '';
  const y = Number(year.value);
  const m = Number(month.value);
  const d = Number(day.value);
  if (!isReal(y, m, d)) return '';
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function publish() {
  const iso = toIso();
  if (iso === emitted) return;
  emitted = iso;
  emit('update:modelValue', iso);
}

// Reset (and any other outside change) refills the segments.
watch(() => props.modelValue, (value) => {
  if (value === emitted) return;
  emitted = value ?? '';
  if (!value) {
    day.value = '';
    month.value = '';
    year.value = '';
    return;
  }
  const [y, m, d] = value.split('-');
  year.value = y ?? '';
  month.value = m ?? '';
  day.value = d ?? '';
}, { immediate: true });

/**
 * `select` highlights what is there so the next digit replaces it; `end` puts the
 * caret after it so the next Backspace eats it. Moving forward wants the first,
 * moving back wants the second — otherwise retyping a filled date inserts into
 * the old digits instead of replacing them.
 */
function focusSegment(name, mode = 'end') {
  nextTick(() => {
    const input = elements[name].value;
    if (!input) return;
    input.focus();
    if (mode === 'select') {
      input.select();
      return;
    }
    const at = input.value.length;
    input.setSelectionRange(at, at);
  });
}

function step(name, delta) {
  const next = SEGMENTS[indexOf(name) + delta];
  if (next) focusSegment(next.name, delta > 0 ? 'select' : 'end');
  return Boolean(next);
}

/** Highest value a day or month segment can hold, given what is typed so far. */
function maxOf(name) {
  if (name === 'month') return 12;
  const m = Number(month.value);
  if (!m || m > 12) return 31;
  // Without a year yet, allow 29 Feb; the full-date check catches non-leap years.
  return new Date(Number(year.value) || 2000, m, 0).getDate();
}

/**
 * Keeps day and month within range as they are typed: a first digit that cannot
 * start a valid two-digit value ("4" for a month) is taken as "04", and a second
 * digit that would overshoot ("13") or make zero ("00") is dropped.
 */
function clampSegment(name, digits) {
  if (name === 'year' || !digits) return digits;
  const max = maxOf(name);
  if (digits.length === 1) return Number(digits) > Math.floor(max / 10) ? `0${digits}` : digits;
  const n = Number(digits);
  return n === 0 || n > max ? digits.slice(0, 1) : digits;
}

function onInput(name, event) {
  const digits = clampSegment(name, event.target.value.replace(/\D/g, '').slice(0, sizeOf(name)));
  values[name].value = digits;
  // The DOM may hold characters we just stripped; put it back in step.
  event.target.value = digits;
  // A full segment hands over, so the date can be typed straight through.
  if (digits.length === sizeOf(name)) step(name, 1);
  publish();
}

function onKeydown(name, event) {
  const input = event.target;
  const atStart = input.selectionStart === 0 && input.selectionEnd === 0;
  const atEnd = input.selectionStart === input.value.length && input.selectionEnd === input.value.length;

  if (event.key === 'Backspace' && !values[name].value) {
    // Empty segment: carry the delete back to the previous one, one digit only.
    const previous = SEGMENTS[indexOf(name) - 1];
    if (!previous) return;
    event.preventDefault();
    values[previous.name].value = values[previous.name].value.slice(0, -1);
    focusSegment(previous.name, 'end');
    publish();
    return;
  }

  if (event.key === 'ArrowLeft' && atStart) {
    if (step(name, -1)) event.preventDefault();
  } else if (event.key === 'ArrowRight' && atEnd) {
    if (step(name, 1)) event.preventDefault();
  } else if (event.key === '/' || event.key === '-' || event.key === '.') {
    event.preventDefault();
    step(name, 1);
  }
}

/** "2" means February, not the year 2 — pad on the way out, not while typing. */
function onBlur(name) {
  const value = values[name].value;
  if (name !== 'year' && value.length === 1) values[name].value = value.padStart(2, '0');
  publish();
}

/** A pasted "14/11/2026" or "2026-11-14" fills the whole field. */
function onPaste(event) {
  const text = event.clipboardData?.getData('text') ?? '';
  const digits = text.replace(/\D/g, '');
  if (digits.length < 6) return;
  event.preventDefault();
  if (/^\d{4}\D/.test(text)) {
    year.value = digits.slice(0, 4);
    month.value = digits.slice(4, 6);
    day.value = digits.slice(6, 8);
  } else {
    day.value = digits.slice(0, 2);
    month.value = digits.slice(2, 4);
    year.value = digits.slice(4, 8);
  }
  focusSegment('year');
  publish();
}

/** Clicking the field itself (padding or a separator) starts at the first unfilled segment, day first. */
function onFieldMousedown(event) {
  if (event.target.tagName === 'INPUT') return;
  event.preventDefault();
  const next = SEGMENTS.find((s) => values[s.name].value.length < s.size) ?? SEGMENTS[0];
  focusSegment(next.name, 'select');
}
</script>

<template>
  <div
    class="datefield"
    :class="{ 'datefield--invalid': invalid }"
    role="group"
    :aria-labelledby="labelledBy"
    :aria-invalid="invalid || undefined"
    @paste="onPaste"
    @mousedown="onFieldMousedown"
  >
    <template v-for="(segment, index) in SEGMENTS" :key="segment.name">
      <span v-if="index" class="datefield__sep" aria-hidden="true">/</span>
      <input
        :ref="(el) => { elements[segment.name].value = el; }"
        class="datefield__seg"
        :class="`datefield__seg--${segment.name}`"
        type="text"
        inputmode="numeric"
        autocomplete="off"
        :value="values[segment.name].value"
        :placeholder="segment.placeholder"
        :maxlength="segment.size"
        :aria-label="segment.label"
        @input="onInput(segment.name, $event)"
        @keydown="onKeydown(segment.name, $event)"
        @blur="onBlur(segment.name)"
        @focus="$event.target.select()"
      />
    </template>
  </div>
</template>

<style scoped>
/* Matches the other controls in the filter drawer, which style their own inputs. */
.datefield {
  display: flex;
  align-items: center;
  gap: 2px;
  min-height: 44px;
  padding: var(--space-2) var(--space-3);
  border: var(--border-soft);
  border-radius: var(--radius-md);
  background: var(--ink-800);
  color: var(--text-400);
  font-size: var(--step--1);
  transition:
    border-color var(--dur-fast) var(--ease-out),
    box-shadow var(--dur-fast) var(--ease-out);
}

.datefield:focus-within {
  border-color: var(--accent-500);
  box-shadow: 0 0 0 3px var(--accent-glow);
}

.datefield--invalid {
  border-color: var(--rose-400);
}

.datefield--invalid:focus-within {
  box-shadow: 0 0 0 3px color-mix(in oklab, var(--rose-400) 25%, transparent);
}

.datefield__seg {
  /* No shrinking: a flex item narrower than its content clips the placeholder. */
  flex: none;
  padding: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--text-200);
  font: inherit;
  font-variant-numeric: tabular-nums;
  text-align: center;
}

.datefield__seg::placeholder { color: var(--text-400); }

/* Wide enough for the DD/MM/YYYY placeholder, whose letters are wider than the
   digits that replace them, so the separators never shift as the date is typed. */
.datefield__seg--day,
.datefield__seg--month { width: 2.9ch; }
.datefield__seg--year { width: 5.2ch; }

.datefield__sep { color: var(--text-400); }
</style>
