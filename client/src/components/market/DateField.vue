<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';

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
 *
 * The calendar button opens a month grid for people who would rather pick than
 * type. Dates listed in `markedDates` get a dot, so the concerts filter can show
 * which days have shows.
 */
const props = defineProps({
  modelValue: { type: String, default: '' },
  /** id of the element naming this group, since a <label> cannot point at three inputs. */
  labelledBy: { type: String, default: undefined },
  /** `YYYY-MM-DD` strings to mark in the calendar. */
  markedDates: { type: Array, default: () => [] },
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
  if (event.target.tagName === 'INPUT' || event.target.closest('.datefield__toggle')) return;
  event.preventDefault();
  const next = SEGMENTS.find((s) => values[s.name].value.length < s.size) ?? SEGMENTS[0];
  focusSegment(next.name, 'select');
}

// ---------------------------------------------------------------- Calendar --

const root = ref(null);
const toggleEl = ref(null);
const gridEl = ref(null);
const open = ref(false);
/** First day of the month on show. */
const view = ref(new Date());
/** The day keyboard focus sits on inside the grid. */
const cursor = ref('');

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const pad = (n) => String(n).padStart(2, '0');
const isoOf = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const today = isoOf(new Date());
const marked = computed(() => new Set(props.markedDates.map((d) => String(d).slice(0, 10))));

const monthLabel = computed(() => view.value.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }));

/** Six weeks, Monday first, padded with the neighbouring months' days. */
const weeks = computed(() => {
  const first = new Date(view.value.getFullYear(), view.value.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7;
  return Array.from({ length: 6 }, (_, w) => Array.from({ length: 7 }, (_, d) => {
    const date = new Date(first.getFullYear(), first.getMonth(), 1 - offset + w * 7 + d);
    return {
      iso: isoOf(date),
      day: date.getDate(),
      outside: date.getMonth() !== first.getMonth(),
      label: date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
    };
  }));
});

function showMonthOf(iso) {
  const [y, m] = iso.split('-').map(Number);
  view.value = new Date(y, m - 1, 1);
}

function focusCursor() {
  nextTick(() => gridEl.value?.querySelector(`[data-iso="${cursor.value}"]`)?.focus());
}

function openCalendar() {
  const start = toIso() || today;
  cursor.value = start;
  showMonthOf(start);
  open.value = true;
  focusCursor();
}

function closeCalendar({ refocus = true } = {}) {
  if (!open.value) return;
  open.value = false;
  if (refocus) nextTick(() => toggleEl.value?.focus());
}

function shiftMonth(delta) {
  view.value = new Date(view.value.getFullYear(), view.value.getMonth() + delta, 1);
}

function pick(iso) {
  const [y, m, d] = iso.split('-');
  year.value = y;
  month.value = m;
  day.value = d;
  publish();
  closeCalendar();
}

function clearDate() {
  day.value = '';
  month.value = '';
  year.value = '';
  publish();
  closeCalendar();
}

/** Arrow keys walk the grid a day or a week at a time, crossing months as needed. */
function onGridKeydown(event) {
  const moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
  if (!(event.key in moves)) return;
  event.preventDefault();
  const [y, m, d] = cursor.value.split('-').map(Number);
  const next = new Date(y, m - 1, d + moves[event.key]);
  cursor.value = isoOf(next);
  if (next.getMonth() !== view.value.getMonth() || next.getFullYear() !== view.value.getFullYear()) showMonthOf(cursor.value);
  focusCursor();
}

// A click anywhere outside closes the calendar without stealing focus back.
function onDocumentPointer(event) {
  if (!root.value?.contains(event.target)) closeCalendar({ refocus: false });
}

watch(open, (isOpen) => {
  if (isOpen) document.addEventListener('pointerdown', onDocumentPointer);
  else document.removeEventListener('pointerdown', onDocumentPointer);
});
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocumentPointer));
</script>

<template>
  <div ref="root" class="datefield-wrap" @keydown.esc="closeCalendar()">
  <div
    class="datefield"
    :class="{ 'datefield--invalid': invalid, 'datefield--open': open }"
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
    <button
      ref="toggleEl"
      type="button"
      class="datefield__toggle"
      :aria-expanded="open"
      aria-haspopup="dialog"
      aria-label="Choose a date from the calendar"
      @click="open ? closeCalendar() : openCalendar()"
    >
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="2" stroke="currentColor" stroke-width="1.8" /><path d="M3.5 10h17M8 3v4M16 3v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg>
    </button>
  </div>

  <Transition name="cal">
    <div v-if="open" class="cal" role="dialog" aria-label="Choose a date">
      <div class="cal__head">
        <button type="button" class="cal__nav" aria-label="Previous month" @click="shiftMonth(-1)">‹</button>
        <p class="cal__month" aria-live="polite">{{ monthLabel }}</p>
        <button type="button" class="cal__nav" aria-label="Next month" @click="shiftMonth(1)">›</button>
      </div>
      <div ref="gridEl" class="cal__grid" role="grid" @keydown="onGridKeydown">
        <div class="cal__row" role="row">
          <span v-for="name in WEEKDAYS" :key="name" class="cal__weekday" role="columnheader">{{ name }}</span>
        </div>
        <div v-for="(week, w) in weeks" :key="w" class="cal__row" role="row">
          <button
            v-for="cell in week"
            :key="cell.iso"
            type="button"
            role="gridcell"
            class="cal__day"
            :class="{
              'cal__day--outside': cell.outside,
              'cal__day--today': cell.iso === today,
              'cal__day--selected': cell.iso === modelValue,
              'cal__day--marked': marked.has(cell.iso),
            }"
            :data-iso="cell.iso"
            :tabindex="cell.iso === cursor ? 0 : -1"
            :aria-label="marked.has(cell.iso) ? `${cell.label}, has concerts` : cell.label"
            :aria-selected="cell.iso === modelValue"
            @click="pick(cell.iso)"
          >{{ cell.day }}</button>
        </div>
      </div>
      <div class="cal__foot">
        <button type="button" class="cal__link" @click="pick(today)">Today</button>
        <span v-if="marked.size" class="cal__legend"><i aria-hidden="true" /> Has concerts</span>
        <button type="button" class="cal__link" @click="clearDate">Clear</button>
      </div>
    </div>
  </Transition>
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

.datefield-wrap {
  position: relative;
}

.datefield--open {
  border-color: var(--accent-400);
  box-shadow: 0 0 0 3px var(--accent-glow);
}

.datefield__toggle {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  margin-left: auto;
  border-radius: var(--radius-sm);
  color: var(--accent-400);
  transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
}

.datefield__toggle svg { width: 18px; height: 18px; }

.datefield__toggle:hover,
.datefield--open .datefield__toggle {
  background: var(--accent-glow);
  color: var(--accent-500);
}

/* ---------------------------------------------------------------- Calendar */

.cal {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 50;
  width: 300px;
  max-width: calc(100vw - 2 * var(--gutter));
  padding: var(--space-4);
  border: var(--border-hairline);
  border-radius: var(--radius-lg);
  background: color-mix(in srgb, var(--ink-800) 94%, transparent);
  backdrop-filter: blur(18px) saturate(150%);
  -webkit-backdrop-filter: blur(18px) saturate(150%);
  box-shadow: 0 24px 50px -20px rgba(47, 25, 95, 0.45);
  transform-origin: top right;
}

.cal-enter-active { transition: opacity var(--dur-base) var(--ease-out), transform var(--dur-base) var(--ease-spring-soft); }
.cal-leave-active { transition: opacity var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out); }
.cal-enter-from,
.cal-leave-to { opacity: 0; transform: translateY(-6px) scale(0.96); }

.cal__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--space-3);
}

.cal__month {
  font-family: var(--font-display);
  font-weight: 700;
  color: var(--text-100);
}

.cal__nav {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  color: var(--text-200);
  font-size: 1.3rem;
  line-height: 1;
  transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
}

.cal__nav:hover { background: var(--accent-glow); color: var(--accent-500); }

.cal__grid { display: grid; gap: 2px; }

.cal__row {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2px;
}

.cal__weekday {
  padding-block: var(--space-1);
  text-align: center;
  font-size: var(--step--2);
  font-weight: 700;
  color: var(--text-400);
}

.cal__day {
  position: relative;
  aspect-ratio: 1;
  border-radius: 50%;
  color: var(--text-200);
  font-size: var(--step--1);
  font-variant-numeric: tabular-nums;
  transition:
    background var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out),
    transform var(--dur-fast) var(--ease-spring);
}

.cal__day:hover { background: var(--accent-glow); color: var(--accent-500); transform: scale(1.08); }
.cal__day--outside { color: var(--text-400); opacity: 0.5; }

.cal__day--today {
  font-weight: 800;
  color: var(--accent-500);
  box-shadow: inset 0 0 0 1.5px var(--accent-400);
}

.cal__day--marked::after {
  content: '';
  position: absolute;
  left: 50%;
  bottom: 4px;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--mint-400);
  transform: translateX(-50%);
}

.cal__day--selected,
.cal__day--selected:hover {
  background: linear-gradient(135deg, var(--accent-500), var(--mint-400));
  color: #fff;
  font-weight: 800;
  box-shadow: 0 6px 14px -6px var(--accent-400);
}

.cal__day--selected::after { background: #fff; }

.cal__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  margin-top: var(--space-3);
  padding-top: var(--space-3);
  border-top: var(--border-hairline);
}

.cal__link {
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-sm);
  color: var(--accent-400);
  font-size: var(--step--1);
  font-weight: 700;
}

.cal__link:hover { background: var(--accent-glow); }

.cal__legend {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  color: var(--text-400);
  font-size: var(--step--2);
}

.cal__legend i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--mint-400);
}

</style>
