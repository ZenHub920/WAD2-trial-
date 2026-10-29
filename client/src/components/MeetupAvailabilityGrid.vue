<script setup>
import { computed, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue';

const props = defineProps({
  grid: { type: Array, required: true },
  participantCount: { type: Number, default: 0 },
  selected: { type: Array, default: () => [] },
  disabled: { type: Boolean, default: false },
});
const emit = defineEmits(['update:selected']);
const root = ref(null), preview = ref(null), focused = ref(null);
const helpId = `availability-help-${useId()}`;
const dateParts = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit', day: '2-digit',
});
const dayLabel = new Intl.DateTimeFormat('en-SG', {
  timeZone: 'Asia/Singapore', weekday: 'short', day: 'numeric', month: 'short',
});
const clock = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Singapore', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
const cells = computed(() => [...new Map(props.grid.filter(slot => Number.isFinite(slot.startsAt))
  .map(slot => [slot.startsAt, { ...slot, day: dateParts.format(slot.startsAt), time: clock.format(slot.startsAt) }])).values()]
  .sort((a, b) => a.startsAt - b.startsAt));
const days = computed(() => [...new Map(cells.value.map(slot => [slot.day, {
  key: slot.day, label: dayLabel.format(slot.startsAt),
}])).values()]);
const times = computed(() => [...new Set(cells.value.map(slot => slot.time))].sort());
const byDayTime = computed(() => new Map(cells.value.map(slot => [`${slot.day}:${slot.time}`, slot])));
const byStamp = computed(() => new Map(cells.value.map(slot => [slot.startsAt, slot])));
const selectedSet = computed(() => new Set(preview.value ?? props.selected));
const count = slot => Math.min(Math.max(0, Number(slot.availableCount) || 0), Math.max(0, props.participantCount));
const heat = slot => props.participantCount > 0 ? Math.ceil(count(slot) / props.participantCount * 4) : 0;
const label = slot => `${dayLabel.format(slot.startsAt)}, ${slot.time}–${clock.format(slot.startsAt + 1800000)}: ${count(slot)} of ${props.participantCount} available. ${selectedSet.value.has(slot.startsAt) ? 'You are available.' : 'You are unavailable.'}`;
let gesture = null, suppressPointerClickUntil = 0;

function publish(selection) {
  const next = [...selection].filter(stamp => byStamp.value.has(stamp)).sort((a, b) => a - b);
  preview.value = next;
  emit('update:selected', next);
}
function paint(stamp) {
  const slot = byStamp.value.get(stamp);
  if (!gesture || !slot || props.disabled) return;
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
function start(event, stamp) {
  if (props.disabled || gesture || event.button !== 0 || event.isPrimary === false) return;
  event.preventDefault();
  focused.value = stamp;
  event.currentTarget.focus({ preventScroll: true });
  gesture = { id: event.pointerId, last: stamp, add: !selectedSet.value.has(stamp), selection: new Set(selectedSet.value) };
  try { root.value?.setPointerCapture?.(event.pointerId); } catch { /* Synthetic events have no active pointer. */ }
  paint(stamp);
}
function move(event) {
  if (!gesture || event.pointerId !== gesture.id) return;
  event.preventDefault();
  const target = document.elementFromPoint?.(event.clientX, event.clientY) ?? event.target;
  const button = target?.closest?.('[data-availability-start]');
  if (button && root.value?.contains(button)) paint(Number(button.dataset.availabilityStart));
}
function finish(event) {
  if (!gesture || (event?.pointerId !== undefined && event.pointerId !== gesture.id)) return;
  const pointerId = gesture.id;
  gesture = null;
  suppressPointerClickUntil = Date.now() + 500;
  if (root.value?.hasPointerCapture?.(pointerId)) root.value.releasePointerCapture(pointerId);
  preview.value = null;
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
  <div class="availability-grid">
    <div class="availability-grid__intro">
      <p :id="helpId">Drag over times you’re free. Start on a selected time to erase. You can also tap a time, or use arrow keys and Space. <span>All times are Singapore time.</span></p>
      <div class="availability-grid__legend" aria-label="Availability colour scale">
        <span>Fewer available</span><i v-for="level in [0, 1, 2, 3, 4]" :key="level" :data-heat="level" aria-hidden="true" /><span>More available</span>
        <span class="availability-grid__your-key">✓ Your times</span>
      </div>
    </div>
    <p v-if="!cells.length" class="group-muted">No time slots in this planning window.</p>
    <div v-else ref="root" class="availability-grid__scroll" @pointermove="move" @pointerup="finish" @pointercancel="finish">
      <table :aria-describedby="helpId" :style="{ minWidth: `${Math.max(18, 4.4 + days.length * 5.9)}rem` }" aria-label="Group availability in Singapore time">
        <thead><tr><th scope="col">Time</th><th v-for="day in days" :key="day.key" scope="col">{{ day.label }}</th></tr></thead>
        <tbody>
          <tr v-for="timeOfDay in times" :key="timeOfDay">
            <th scope="row">{{ timeOfDay }}</th>
            <td v-for="day in days" :key="day.key">
              <template v-for="slot in [byDayTime.get(`${day.key}:${timeOfDay}`)]" :key="slot?.startsAt ?? 'empty'">
                <button v-if="slot" type="button" class="availability-grid__cell" :data-availability-start="slot.startsAt" :data-heat="heat(slot)"
                  :class="{ 'availability-grid__cell--selected': selectedSet.has(slot.startsAt) }"
                  :aria-label="label(slot)" :aria-pressed="selectedSet.has(slot.startsAt)" :disabled="disabled"
                  :tabindex="focused === slot.startsAt ? 0 : -1" @focus="focused = slot.startsAt"
                  @pointerdown="start($event, slot.startsAt)" @click="toggle($event, slot.startsAt)" @keydown="navigate($event, slot)">
                  <span class="availability-grid__check" aria-hidden="true">{{ selectedSet.has(slot.startsAt) ? '✓' : '' }}</span>
                  <span>{{ count(slot) }}/{{ participantCount }}</span>
                </button>
                <span v-else class="availability-grid__outside" aria-label="Outside planning window">—</span>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-if="cells.length" class="availability-grid__hint">{{ selectedSet.size }} half-hour times selected · Colours show saved group availability. Your changes are shared when you save. On touch screens, scroll beside the painted cells.</p>
  </div>
</template>

<style scoped>
.availability-grid { --heat-0: var(--ink-800); --heat-1: #28433f; --heat-2: #326359; --heat-3: #36866e; --heat-4: #399b7e; display: grid; gap: .8rem; }
.availability-grid__intro p { margin: 0 0 .7rem; max-width: 70ch; line-height: 1.55; color: var(--text-200); }
.availability-grid__intro p span { white-space: nowrap; color: var(--text-300); }
.availability-grid__legend { display: flex; flex-wrap: wrap; align-items: center; gap: .35rem; color: var(--text-300); font-size: .8rem; }
.availability-grid__legend i { width: 1.1rem; height: 1.1rem; border: 1px solid var(--ink-500); border-radius: .2rem; }
.availability-grid [data-heat="0"] { background: var(--heat-0); }
.availability-grid [data-heat="1"] { background: var(--heat-1); }
.availability-grid [data-heat="2"] { background: var(--heat-2); }
.availability-grid [data-heat="3"] { background: var(--heat-3); }
.availability-grid [data-heat="4"] { background: var(--heat-4); }
.availability-grid__your-key { margin-left: .55rem; color: var(--text-100); }
.availability-grid__scroll { max-height: 29rem; overflow: auto; border: 1px solid var(--ink-500); border-radius: var(--radius-md); overscroll-behavior: contain; }
table { width: 100%; border-spacing: 4px; min-width: 18rem; table-layout: fixed; }
th { height: 2.4rem; min-width: 5.4rem; padding: .4rem; font-size: .8rem; font-weight: 600; color: var(--text-200); white-space: nowrap; }
thead th { position: sticky; top: 0; z-index: 2; background: var(--ink-900); }
th:first-child { width: 4rem; position: sticky; left: 0; z-index: 1; background: var(--ink-900); }
thead th:first-child { z-index: 3; }
td { padding: 0; min-width: 5.4rem; text-align: center; }
.availability-grid__cell { width: 100%; min-width: 5.4rem; min-height: 2.75rem; border: 2px solid transparent; border-radius: .35rem; color: #fff; cursor: crosshair; font: inherit; font-size: .8rem; font-weight: 600; user-select: none; touch-action: none; display: flex; justify-content: center; align-items: center; gap: .3rem; }
.availability-grid__cell[data-heat="0"] { color: var(--text-200); }
.availability-grid__cell--selected { border-color: var(--text-100); box-shadow: inset 0 0 0 1px var(--ink-900); }
.availability-grid__cell:hover:not(:disabled) { filter: brightness(1.15); }
.availability-grid__cell:focus-visible { outline: 3px solid var(--accent-400); outline-offset: 1px; }
.availability-grid__cell:disabled { cursor: default; opacity: .65; }
.availability-grid__check { width: .8rem; }
.availability-grid__outside { display: block; padding: .5rem; color: var(--text-400); }
.availability-grid__hint { margin: 0; color: var(--text-300); font-size: .8rem; line-height: 1.5; }
@media (max-width: 600px) { table { min-width: 20rem; } th:first-child { width: 3.4rem; } }
</style>
