<script setup>
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue';
import { api } from '../api.js';

const props = defineProps({
  meetupId: { type: String, required: true },
  label: { type: String, default: 'Search a public place or postal code' },
  disabled: { type: Boolean, default: false },
  resetKey: { type: [String, Number], default: 0 },
  selectionHint: { type: String, default: 'Selection is not saved. Apply or save it using the form below.' },
  manualFallback: { type: Boolean, default: true },
});
const emit = defineEmits(['selected', 'selection-invalidated']);
const fieldId = `meetup-place-search-${useId()}`;
const query = ref(''), results = ref([]), selected = ref(null), busy = ref(false), message = ref(''), failed = ref(false);
const input = ref(null), resultList = ref(null);
const descriptionIds = computed(() => [`${fieldId}-help`,
  ...(busy.value || message.value ? [`${fieldId}-status`] : []),
  ...(selected.value ? [`${fieldId}-selection`] : []),
].join(' '));
let generation = 0;
const validLocation = location => typeof location?.label === 'string' && location.label.trim()
  && Number.isFinite(location.latitude) && location.latitude >= 1.1 && location.latitude <= 1.5
  && Number.isFinite(location.longitude) && location.longitude >= 103.5 && location.longitude <= 104.1;
const sameLocation = (left, right) => left?.label === right?.label
  && left?.latitude === right?.latitude && left?.longitude === right?.longitude;
const isSelected = location => sameLocation(selected.value, location);

async function search() {
  if (props.disabled || busy.value || query.value.trim().length < 2) return;
  const request = ++generation, requestedQuery = query.value.trim(), meetupId = props.meetupId;
  const stillCurrent = () => request === generation && requestedQuery === query.value.trim()
    && meetupId === props.meetupId && !props.disabled;
  busy.value = true; message.value = ''; failed.value = false; results.value = [];
  try {
    const { result } = await api.meetupLocations(meetupId, requestedQuery);
    if (!stillCurrent()) return;
    if (result?.status === 'available') {
      results.value = (Array.isArray(result.locations) ? result.locations : []).filter(validLocation);
      if (!results.value.length) message.value = 'No places found. Try a building name, MRT station or postal code.';
      else message.value = `${results.value.length} ${results.value.length === 1 ? 'place' : 'places'} found. Select an address below.${result.stale ? ' Showing a saved address lookup while OneMap is unavailable.' : ''}`;
    } else message.value = `Address search is unavailable.${props.manualFallback ? ' You can still enter a place and its coordinates below.' : ' Try again later or use the concert venue already on the plan.'}`;
  } catch {
    if (!stillCurrent()) return;
    failed.value = true;
    message.value = `Could not search places. Please try again.${props.manualFallback ? ' Manual entry is still available below.' : ''}`;
  } finally { if (request === generation) busy.value = false; }
}
function select(location) {
  const current = results.value.find(result => sameLocation(result, location));
  if (props.disabled || busy.value || !current || !validLocation(current)) return;
  generation++;
  selected.value = { ...current };
  message.value = ''; failed.value = false;
  emit('selected', { ...current });
}
async function focusResult(event, index = 0) {
  if (props.disabled || !results.value.length) return;
  event.preventDefault();
  await nextTick();
  const buttons = resultList.value?.querySelectorAll('button');
  if (buttons?.length) buttons[(index + buttons.length) % buttons.length].focus();
}
function reset() {
  // A parent reset also follows deliberate manual entry. Do not invalidate that draft.
  generation++; selected.value = null; query.value = ''; results.value = []; busy.value = false; message.value = ''; failed.value = false;
}
watch(query, () => {
  const previous = selected.value;
  generation++; selected.value = null; results.value = []; busy.value = false; failed.value = false;
  message.value = previous ? 'Selection changed. Select a result for the new search to use its address.' : '';
  if (previous) emit('selection-invalidated', { location: { ...previous }, reason: 'query' });
}, { flush: 'sync' });
watch([() => props.meetupId, () => props.resetKey], reset, { flush: 'sync' });
watch(() => props.disabled, disabled => { if (disabled) { generation++; busy.value = false; } });
onBeforeUnmount(() => { generation++; });
</script>

<template>
  <div class="meetup-location-search" :aria-busy="busy">
    <div class="meetup-location-search__controls">
      <label :for="fieldId">{{ label }}<input :id="fieldId" ref="input" v-model="query" :disabled="disabled" :aria-describedby="descriptionIds" :aria-controls="results.length ? `${fieldId}-results` : undefined" maxlength="100" placeholder="e.g. City Hall MRT" autocomplete="off" @keydown.enter.prevent="search" @keydown.down="focusResult($event)" /></label>
      <button type="button" class="btn btn--ghost" :disabled="disabled || busy || query.trim().length < 2" @click="search">{{ busy ? 'Searching…' : 'Search OneMap' }}</button>
    </div>
    <p :id="`${fieldId}-help`" class="group-muted meetup-location-search__help">Search for an address, select a result, then apply or save it in this form.</p>
    <p v-if="busy" :id="`${fieldId}-status`" role="status" class="group-muted">Searching OneMap for places…</p>
    <p v-else-if="message" :id="`${fieldId}-status`" :class="failed ? 'group-error' : 'group-muted'" :role="failed ? 'alert' : 'status'">{{ message }}</p>
    <ul v-if="results.length" :id="`${fieldId}-results`" ref="resultList" class="meetup-search-results" aria-label="Address search results">
      <li v-for="(location, index) in results" :key="`${location.latitude}:${location.longitude}:${location.label}`">
        <button type="button" class="meetup-search-result" :class="{ 'meetup-search-result--selected': isSelected(location) }" :disabled="disabled" :aria-pressed="isSelected(location)" @click="select(location)" @keydown.down="focusResult($event, index + 1)" @keydown.up="focusResult($event, index - 1)" @keydown.esc.prevent="input?.focus()">
          <span class="meetup-search-result__name"><strong>{{ location.label }}</strong><span v-if="isSelected(location)" class="meetup-search-result__indicator">Selected</span></span>
          <small v-if="location.address">{{ location.address }}</small>
        </button>
      </li>
    </ul>
    <div v-if="selected" :id="`${fieldId}-selection`" class="meetup-location-search__selection" role="status">
      <strong>Selected: {{ selected.label }}.</strong>
      <p>{{ selectionHint }}</p>
    </div>
  </div>
</template>

<style scoped>
.meetup-location-search { display: grid; gap: var(--space-3); min-width: 0; margin-block: var(--space-4); }
.meetup-location-search__controls { display: flex; align-items: end; gap: var(--space-3); }
.meetup-location-search__controls label { flex: 1; min-width: 0; }
.meetup-location-search__controls > button { flex-shrink: 0; }
.meetup-location-search__help, .meetup-location-search__selection p { font-size: var(--step--1); line-height: 1.5; }
.meetup-search-results {
  list-style: none; margin: 0; padding: .2rem; display: grid; gap: var(--space-2);
  max-height: 20rem; overflow: auto; border: var(--border-soft); border-radius: var(--radius-md); background: var(--ink-800);
}
.meetup-search-result {
  display: grid; gap: var(--space-2); width: 100%; min-height: 44px; padding: var(--space-3); border: 1px solid transparent;
  border-radius: var(--radius-sm); color: var(--text-100); background: transparent; text-align: left; cursor: pointer; overflow-wrap: anywhere;
}
.meetup-search-result:hover:not(:disabled), .meetup-search-result--selected {
  background: color-mix(in srgb, var(--accent-400) 9%, var(--ink-800)); border-color: color-mix(in srgb, var(--accent-400) 60%, transparent);
}
.meetup-search-result:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: -2px; }
.meetup-search-result:disabled { cursor: default; opacity: .65; }
.meetup-search-result__name { display: flex; justify-content: space-between; align-items: center; gap: var(--space-2); }
.meetup-search-result__indicator { color: var(--accent-400); font-size: var(--step--1); flex-shrink: 0; white-space: nowrap; }
.meetup-search-results small { color: var(--text-300); }
.meetup-location-search__selection { display: grid; gap: var(--space-1); border-left: 2px solid var(--accent-400); padding-left: var(--space-3); }
@media (max-width: 550px) {
  .meetup-location-search__controls { align-items: stretch; flex-direction: column; }
  .meetup-search-result__name { align-items: start; }
}
</style>
