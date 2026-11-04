<script setup>
import { computed, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue';
import { formatMeetupDay, formatMeetupClock, singaporeDayKey } from '../utils/meetupTime.js';

const props = defineProps({
  grid: { type: Array, required: true },
  participantCount: { type: Number, default: 0 },
  selected: { type: Array, default: () => [] },
  disabled: { type: Boolean, default: false },
});
const emit = defineEmits(['update:selected']);
const root = ref(null), preview = ref(null), focused = ref(null), hovered = ref(null);
const horizontalOverflow = ref(false), touchPainting = ref(false);
const helpId = `availability-help-${useId()}`;
const scrollHelpId = `availability-scroll-${useId()}`;
const cells = computed(() => [...new Map(props.grid.filter(slot => Number.isFinite(slot.startsAt))
  .map(slot => [slot.startsAt, { ...slot, day: singaporeDayKey(slot.startsAt), time: formatMeetupClock(slot.startsAt) }])).values()]
  .sort((a, b) => a.startsAt - b.startsAt));
const days = computed(() => [...new Map(cells.value.map(slot => [slot.day, {
  key: slot.day, label: formatMeetupDay(slot.startsAt),
}])).values()]);
const times = computed(() => [...new Set(cells.value.map(slot => slot.time))].sort());
const byDayTime = computed(() => new Map(cells.value.map(slot => [`${slot.day}:${slot.time}`, slot])));
const byStamp = computed(() => new Map(cells.value.map(slot => [slot.startsAt, slot])));
const selectedSet = computed(() => new Set(preview.value ?? props.selected));
const inspected = computed(() => byStamp.value.get(hovered.value ?? focused.value) ?? cells.value[0]);
const count = slot => Math.min(Math.max(0, Number(slot.availableCount) || 0), Math.max(0, props.participantCount));
const heat = slot => props.participantCount > 0 ? Math.ceil(count(slot) / props.participantCount * 4) : 0;
const label = slot => `${formatMeetupDay(slot.startsAt)}, ${slot.time}–${formatMeetupClock(slot.startsAt + 1800000)}: ${count(slot)} of ${props.participantCount} available. ${selectedSet.value.has(slot.startsAt) ? 'You are available.' : 'You are unavailable.'}`;
let gesture = null, holdTimer, suppressPointerClickUntil = 0;

function publish(selection) {
  const next = [...selection].filter(stamp => byStamp.value.has(stamp)).sort((a, b) => a - b);
  preview.value = next;
  emit('update:selected', next);
}
function paint(stamp) {
  const slot = byStamp.value.get(stamp);
  if (!gesture || gesture.phase !== 'painting' || !slot || props.disabled) return;
  const previous = byStamp.value.get(gesture.last);
  const targets = previous?.day === slot.day
    ? cells.value.filter(cell => cell.day === slot.day && cell.startsAt >= Math.min(previous.startsAt, stamp) && cell.startsAt <= Math.max(previous.startsAt, stamp))
    : [slot];
  for (const target of targets) {
    if (gesture.add) gesture.selection.add(target.startsAt);
    else gesture.selection.delete(target.startsAt);
  }
  gesture.last = stamp;
  publish(gesture.selection);
}
function claimGesture() {
  if (!gesture || gesture.phase !== 'pending' || props.disabled) return;
  clearTimeout(holdTimer);
  gesture.phase = 'painting';
  focused.value = gesture.last;
  root.value?.querySelector(`[data-availability-start="${gesture.last}"]`)?.focus({ preventScroll: true });
  touchPainting.value = gesture.type === 'touch';
  try { root.value?.setPointerCapture?.(gesture.id); } catch { /* Synthetic events have no active pointer. */ }
  paint(gesture.last);
}
function start(event, stamp) {
  if (props.disabled || gesture || event.button !== 0 || event.isPrimary === false) return;
  gesture = {
    id: event.pointerId, type: event.pointerType, phase: 'pending', last: stamp,
    x: event.clientX ?? 0, y: event.clientY ?? 0,
    add: !selectedSet.value.has(stamp), selection: new Set(selectedSet.value),
  };
  if (event.pointerType === 'touch') {
    // A normal swipe remains native scrolling; only a deliberate hold claims painting.
    holdTimer = setTimeout(claimGesture, 300);
  } else {
    event.preventDefault();
    claimGesture();
  }
}
function move(event) {
  if (!gesture || event.pointerId !== gesture.id) return;
  if (gesture.phase === 'pending' && Math.hypot((event.clientX ?? gesture.x) - gesture.x, (event.clientY ?? gesture.y) - gesture.y) > 8) {
    clearTimeout(holdTimer);
    gesture.phase = 'scrolling';
  }
  if (gesture.phase !== 'painting') return;
  event.preventDefault();
  const target = document.elementFromPoint?.(event.clientX, event.clientY) ?? event.target;
  const button = target?.closest?.('[data-availability-start]');
  if (button && root.value?.contains(button)) paint(Number(button.dataset.availabilityStart));
}
function finish(event) {
  if (!gesture || (event?.pointerId !== undefined && event.pointerId !== gesture.id)) return;
  if (gesture.phase === 'pending' && event?.type === 'pointerup') claimGesture();
  clearTimeout(holdTimer);
  const pointerId = gesture.id;
  gesture = null;
  touchPainting.value = false;
  suppressPointerClickUntil = Date.now() + 500;
  if (root.value?.hasPointerCapture?.(pointerId)) root.value.releasePointerCapture(pointerId);
  preview.value = null;
}
function allowMultiTouch(event) {
  if (event.touches.length > 1) finish({ type: 'pointercancel' });
}
function preventClaimedTouchScroll(event) {
  allowMultiTouch(event);
  // Pointer-event cancellation alone cannot suppress a browser's native pan.
  if (gesture?.type === 'touch' && gesture.phase === 'painting' && event.cancelable) event.preventDefault();
}
function preventPaintingMenu(event) {
  if (touchPainting.value) event.preventDefault();
}
function toggle(event, stamp) {
  if (props.disabled || (event.detail > 0 && Date.now() < suppressPointerClickUntil)) return;
  const selection = new Set(props.selected);
  selection.has(stamp) ? selection.delete(stamp) : selection.add(stamp);
  publish(selection);
  preview.value = null;
}
function navigate(event, slot) {
  const column = cells.value.filter(cell => cell.day === slot.day);
  const index = column.findIndex(cell => cell.startsAt === slot.startsAt);
  let next;
  if (event.key === 'ArrowUp') next = column[index - 1];
  else if (event.key === 'ArrowDown') next = column[index + 1];
  else if (event.key === 'Home') next = column[0];
  else if (event.key === 'End') next = column.at(-1);
  else if (['ArrowLeft', 'ArrowRight'].includes(event.key)) {
    const dayIndex = days.value.findIndex(day => day.key === slot.day) + (event.key === 'ArrowRight' ? 1 : -1);
    next = byDayTime.value.get(`${days.value[dayIndex]?.key}:${slot.time}`);
  } else return;
  event.preventDefault();
  if (next) {
    focused.value = next.startsAt;
    root.value?.querySelector(`[data-availability-start="${next.startsAt}"]`)?.focus();
  }
}
watch(() => props.disabled, disabled => { if (disabled) finish(); });
watch(() => cells.value.map(slot => slot.startsAt).join(','), () => {
  finish();
  if (!byStamp.value.has(focused.value)) focused.value = cells.value[0]?.startsAt ?? null;
}, { immediate: true });
watch(root, (element, _, cleanup) => {
  if (!element) return;
  let active = true;
  const measure = () => { if (active) horizontalOverflow.value = element.scrollWidth > element.clientWidth + 1; };
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
  observer?.observe(element);
  const table = element.querySelector('table');
  if (table) observer?.observe(table);
  element.addEventListener('touchmove', preventClaimedTouchScroll, { passive: false });
  element.addEventListener('touchstart', allowMultiTouch, { passive: true });
  window.addEventListener('resize', measure);
  measure();
  cleanup(() => {
    active = false;
    observer?.disconnect();
    element.removeEventListener('touchmove', preventClaimedTouchScroll);
    element.removeEventListener('touchstart', allowMultiTouch);
    window.removeEventListener('resize', measure);
  });
}, { flush: 'post' });
onMounted(() => {
  window.addEventListener('pointerup', finish);
  window.addEventListener('pointercancel', finish);
  window.addEventListener('blur', finish);
});
onBeforeUnmount(() => {
  finish();
  window.removeEventListener('pointerup', finish);
  window.removeEventListener('pointercancel', finish);
  window.removeEventListener('blur', finish);
});
</script>

<template>
  <div class="availability-grid" :class="{ 'availability-grid--short': days.length <= 2 && times.length <= 8 }">
    <div class="availability-grid__intro">
      <p :id="helpId"><span class="availability-grid__mouse-help">Drag to mark when you’re free. Drag from a selected time to erase.</span><span class="availability-grid__touch-help">Tap a time, or hold then drag to paint or erase. Swipe to scroll.</span> <span>All times are Singapore time.</span></p>
      <div class="availability-grid__legend" aria-label="Availability colour scale">
        <span>Fewer available</span><i v-for="level in [0, 1, 2, 3, 4]" :key="level" :data-heat="level" aria-hidden="true" /><span>More available</span>
        <span class="availability-grid__your-key">✓ Your times</span>
      </div>
    </div>
    <p v-if="!cells.length" class="group-muted">No time slots in this planning window.</p>
    <p v-if="horizontalOverflow && cells.length" :id="scrollHelpId" class="availability-grid__scroll-hint">Scroll sideways for more days <span aria-hidden="true">→</span></p>
    <div v-if="cells.length" ref="root" class="availability-grid__scroll" :data-touch-painting="touchPainting" @pointermove="move" @pointerup="finish" @pointercancel="finish" @contextmenu="preventPaintingMenu" @mouseleave="hovered = null">
      <table :aria-describedby="horizontalOverflow ? `${helpId} ${scrollHelpId}` : helpId" :style="{ minWidth: `${2.5 + days.length * 3.25}rem` }" aria-label="Group availability in Singapore time">
        <thead><tr><th scope="col">Time</th><th v-for="day in days" :key="day.key" scope="col">{{ day.label }}</th></tr></thead>
        <tbody>
          <tr v-for="timeOfDay in times" :key="timeOfDay" :class="{ 'availability-grid__hour': timeOfDay.endsWith(':00') }">
            <th scope="row">{{ timeOfDay }}</th>
            <td v-for="day in days" :key="day.key">
              <template v-for="slot in [byDayTime.get(`${day.key}:${timeOfDay}`)]" :key="slot?.startsAt ?? 'empty'">
                <button v-if="slot" type="button" class="availability-grid__cell" :data-availability-start="slot.startsAt" :data-heat="heat(slot)"
                  :class="{ 'availability-grid__cell--selected': selectedSet.has(slot.startsAt) }"
                  :aria-label="label(slot)" :title="label(slot)" :aria-pressed="selectedSet.has(slot.startsAt)" :disabled="disabled"
                  :tabindex="focused === slot.startsAt ? 0 : -1" @focus="focused = slot.startsAt"
                  @mouseenter="hovered = slot.startsAt"
                  @pointerdown="start($event, slot.startsAt)" @click="toggle($event, slot.startsAt)" @keydown="navigate($event, slot)">
                  <span class="availability-grid__check" aria-hidden="true">{{ selectedSet.has(slot.startsAt) ? '✓' : '' }}</span>
                  <span class="availability-grid__count">{{ count(slot) }}/{{ participantCount }}</span>
                </button>
                <span v-else class="availability-grid__outside" aria-label="Outside planning window">—</span>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div v-if="inspected" class="availability-grid__inspection" aria-live="polite" aria-atomic="true">
      <span>{{ formatMeetupDay(inspected.startsAt) }} · {{ inspected.time }}–{{ formatMeetupClock(inspected.startsAt + 1800000) }}</span>
      <strong>{{ count(inspected) }} of {{ participantCount }} available</strong>
      <span>{{ selectedSet.has(inspected.startsAt) ? 'You’re available' : 'You’re unavailable' }}</span>
    </div>
    <p v-if="cells.length" class="availability-grid__hint">Arrow keys move; Space selects.</p>
  </div>
</template>

<style scoped>
.availability-grid {
  --heat-0: var(--ink-800);
  --heat-1: #28433f;
  --heat-2: #326359;
  --heat-3: #36866e;
  --heat-4: #399b7e;
  display: grid;
  gap: .8rem;
}
.availability-grid__intro p {
  margin: 0 0 .75rem;
  max-width: 70ch;
  line-height: 1.55;
  color: var(--text-200);
}
.availability-grid__intro p span {
  color: var(--text-300);
}
.availability-grid__intro .availability-grid__mouse-help,
.availability-grid__intro .availability-grid__touch-help { color: var(--text-200); }
.availability-grid__touch-help { display: none; }
.availability-grid__legend {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: .35rem;
  color: var(--text-300);
  font-size: .875rem;
}
.availability-grid__legend i {
  width: .8rem;
  height: .8rem;
  border: 1px solid var(--ink-500);
  border-radius: 1px;
}
.availability-grid [data-heat="0"] {
  background: var(--heat-0);
}
.availability-grid [data-heat="1"] {
  background: var(--heat-1);
}
.availability-grid [data-heat="2"] {
  background: var(--heat-2);
}
.availability-grid [data-heat="3"] {
  background: var(--heat-3);
}
.availability-grid [data-heat="4"] {
  background: var(--heat-4);
}
.availability-grid__your-key {
  margin-left: .55rem;
  color: var(--text-100);
}
.availability-grid__scroll {
  width: 100%;
  min-width: 0;
  max-width: 100%;
  max-height: 25rem;
  overflow: auto;
  border: 1px solid var(--ink-500);
  border-radius: 5px;
  overscroll-behavior-x: contain;
  overscroll-behavior-y: auto;
  touch-action: manipulation;
  background: var(--ink-900);
  box-shadow: inset 0 1px 5px color-mix(in srgb, var(--ink-500) 20%, transparent), var(--shadow-sm);
}
.availability-grid__scroll[data-touch-painting='true'] { outline: 2px solid var(--accent-400); outline-offset: 2px; }
.availability-grid__scroll-hint { margin: 0; color: var(--text-300); font-size: .875rem; }
table {
  width: 100%;
  border-spacing: 0;
  table-layout: fixed;
  border-collapse: separate;
}
th {
  height: 26px;
  padding: 0 3px;
  font-size: .85rem;
  font-weight: 600;
  color: var(--text-200);
  white-space: nowrap;
}
thead th {
  height: 42px;
  white-space: normal;
  line-height: 1.3;
  position: sticky;
  top: 0;
  z-index: 3;
  background: var(--ink-900);
}
th:first-child {
  width: 2.5rem;
  position: sticky;
  left: 0;
  z-index: 2;
  background: var(--ink-900);
}
thead th:first-child {
  z-index: 4;
}
td {
  padding: 0;
  text-align: center;
  border-left: 1px solid var(--ink-900);
  border-top: 1px solid var(--ink-900);
}
.availability-grid__hour td {
  border-top-color: var(--ink-500);
}
.availability-grid__hour > th {
  color: var(--text-100);
}
.availability-grid__cell {
  width: 100%;
  min-height: 1.5625rem;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 0;
  color: #fff;
  cursor: crosshair;
  font: inherit;
  font-size: .85rem;
  font-weight: 600;
  user-select: none;
  touch-action: manipulation;
  -webkit-touch-callout: none;
  display: flex;
  justify-content: center;
  align-items: center;
  transition: filter 100ms ease, box-shadow 100ms ease;
}
.availability-grid__cell[data-heat="0"] {
  color: var(--text-200);
}
.availability-grid__cell--selected {
  border-color: var(--text-100);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ink-900) 50%, transparent);
}
.availability-grid__cell:hover:not(:disabled) {
  filter: brightness(1.15);
}
.availability-grid__cell:focus-visible {
  position: relative;
  z-index: 1;
  outline: 2px solid var(--accent-400);
  outline-offset: -1px;
}
.availability-grid__cell:active:not(:disabled) {
  box-shadow: inset 0 2px 4px color-mix(in srgb, var(--ink-900) 50%, transparent);
}
.availability-grid__cell:disabled {
  cursor: default;
  opacity: .65;
}
.availability-grid__check {
  width: .8rem;
}
.availability-grid__count {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
.availability-grid__outside {
  display: block;
  height: 1.5625rem;
  color: var(--text-400);
}
.availability-grid__hint {
  margin: 0;
  color: var(--text-300);
  font-size: .875rem;
  line-height: 1.5;
}
.availability-grid__inspection {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: .3rem 1rem;
  color: var(--text-300);
  font-size: .875rem;
  min-height: 1.6rem;
}
.availability-grid__inspection strong {
  color: var(--text-100);
}
.availability-grid--short .availability-grid__cell,
.availability-grid--short .availability-grid__outside { min-height: 2.75rem; }
@media (max-width: 600px), (any-pointer: coarse) {
  .availability-grid__mouse-help { display: none; }
  .availability-grid__touch-help { display: inline; }
  .availability-grid__cell, .availability-grid__outside {
    min-height: 2.75rem;
  }
}
@media (prefers-reduced-motion: reduce) {
  .availability-grid__cell { transition: none; }
}
</style>
