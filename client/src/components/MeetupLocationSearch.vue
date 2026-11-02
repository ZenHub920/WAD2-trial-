<script setup>
import { nextTick, onBeforeUnmount, ref, useId, watch } from 'vue';
import { api } from '../api.js';

const props = defineProps({
  meetupId: { type: String, required: true },
  label: { type: String, default: 'Search a public place or postal code' },
  disabled: { type: Boolean, default: false },
  resetKey: { type: [String, Number], default: 0 },
  selectionHint: { type: String, default: 'Selection is not saved. Apply or save it using the form below.' },
  manualFallback: { type: Boolean, default: true },
});
const emit = defineEmits(['selected']);
const fieldId = `meetup-place-search-${useId()}`;
const query = ref(''), results = ref([]), selected = ref(null), busy = ref(false), message = ref(''), failed = ref(false);
const input = ref(null), resultList = ref(null);
let generation = 0;
const validLocation = location => typeof location?.label === 'string' && location.label.trim()
  && Number.isFinite(location.latitude) && location.latitude >= 1.1 && location.latitude <= 1.5
  && Number.isFinite(location.longitude) && location.longitude >= 103.5 && location.longitude <= 104.1;
const isSelected = location => selected.value?.label === location.label
  && selected.value?.latitude === location.latitude && selected.value?.longitude === location.longitude;

async function search() {
  if (props.disabled || busy.value || query.value.trim().length < 2) return;
  const request = ++generation;
  busy.value = true; message.value = ''; failed.value = false; results.value = [];
  try {
    const { result } = await api.meetupLocations(props.meetupId, query.value.trim());
    if (request !== generation) return;
    if (result?.status === 'available') {
      results.value = (Array.isArray(result.locations) ? result.locations : []).filter(validLocation);
      if (!results.value.length) message.value = 'No places found. Try a building name, MRT station or postal code.';
      else message.value = `${results.value.length} ${results.value.length === 1 ? 'place' : 'places'} found. Select an address below.${result.stale ? ' Showing a saved address lookup while OneMap is unavailable.' : ''}`;
    } else message.value = `Address search is unavailable.${props.manualFallback ? ' You can still enter a place and its coordinates below.' : ' Try again later or use the concert venue already on the plan.'}`;
  } catch {
    if (request !== generation) return;
    failed.value = true;
    message.value = `Could not search places. Please try again.${props.manualFallback ? ' Manual entry is still available below.' : ''}`;
  } finally { if (request === generation) busy.value = false; }
}
function select(location) {
  if (props.disabled || !validLocation(location)) return;
  selected.value = location;
  emit('selected', location);
}
async function focusResult(event, index = 0) {
  if (!results.value.length) return;
  event.preventDefault();
  await nextTick();
  const buttons = resultList.value?.querySelectorAll('button');
  if (buttons?.length) buttons[(index + buttons.length) % buttons.length].focus();
}
function reset() {
  generation++; query.value = ''; results.value = []; selected.value = null; busy.value = false; message.value = ''; failed.value = false;
}
watch(query, () => { generation++; results.value = []; busy.value = false; message.value = ''; failed.value = false; });
watch([() => props.meetupId, () => props.resetKey], reset);
watch(() => props.disabled, disabled => { if (disabled) { generation++; busy.value = false; } });
onBeforeUnmount(() => { generation++; });
</script>

<template>
  <div class="meetup-location-search" :aria-busy="busy">
    <div class="meetup-location-search__controls">
      <label :for="fieldId">{{ label }}<input :id="fieldId" ref="input" v-model="query" :disabled="disabled" :aria-describedby="`${fieldId}-help`" maxlength="100" placeholder="e.g. City Hall MRT" autocomplete="off" @keydown.enter.prevent="search" @keydown.down="focusResult($event)" /></label>
      <button type="button" class="btn btn--ghost" :disabled="disabled || busy || query.trim().length < 2" @click="search">{{ busy ? 'Searching…' : 'Search OneMap' }}</button>
    </div>
    <p :id="`${fieldId}-help`" class="group-muted meetup-location-search__help">Search for an address, select a result, then apply or save it in this form.</p>
    <p v-if="busy" role="status" class="group-muted">Searching OneMap for places…</p>
    <p v-else-if="message" :class="failed ? 'group-error' : 'group-muted'" :role="failed ? 'alert' : 'status'">{{ message }}</p>
    <ul v-if="results.length" :id="`${fieldId}-results`" ref="resultList" class="meetup-search-results" aria-label="Address search results">
      <li v-for="(location, index) in results" :key="`${location.latitude}:${location.longitude}:${location.label}`">
        <button type="button" class="meetup-search-result" :class="{ 'meetup-search-result--selected': isSelected(location) }" :disabled="disabled" :aria-pressed="isSelected(location)" @click="select(location)" @keydown.down="focusResult($event, index + 1)" @keydown.up="focusResult($event, index - 1)" @keydown.esc.prevent="input?.focus()">
          <span class="meetup-search-result__name"><strong>{{ location.label }}</strong><span v-if="isSelected(location)" class="meetup-search-result__indicator">Selected</span></span>
          <small v-if="location.address">{{ location.address }}</small>
        </button>
      </li>
    </ul>
    <div v-if="selected" class="meetup-location-search__selection" role="status">
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
  display: grid; gap: var(--space-2); width: 100%; padding: var(--space-3); border: 1px solid transparent;
  border-radius: var(--radius-sm); color: var(--text-100); background: transparent; text-align: left; cursor: pointer; overflow-wrap: anywhere;
}
.meetup-search-result:hover, .meetup-search-result--selected {
  background: color-mix(in srgb, var(--rose-400) 9%, var(--ink-800)); border-color: color-mix(in srgb, var(--rose-400) 42%, transparent);
}
.meetup-search-result:focus-visible { outline: 2px solid var(--rose-400); outline-offset: -2px; }
.meetup-search-result:disabled { cursor: default; opacity: .65; }
.meetup-search-result__name { display: flex; justify-content: space-between; align-items: center; gap: var(--space-2); }
.meetup-search-result__indicator { color: var(--rose-400); font-size: var(--step--1); flex-shrink: 0; white-space: nowrap; }
.meetup-search-results small { color: var(--text-300); }
.meetup-location-search__selection { display: grid; gap: var(--space-1); border-left: 2px solid var(--rose-400); padding-left: var(--space-3); }
@media (max-width: 550px) {
  .meetup-location-search__controls { align-items: stretch; flex-direction: column; }
  .meetup-search-result__name { align-items: start; }
}
</style>
