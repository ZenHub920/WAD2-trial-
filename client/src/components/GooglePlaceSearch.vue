<script setup>
/**
 * Pick a place on a Google map of Singapore, or search for one.
 *
 * Clicking the map drops a pin there and fills the box with that spot's name:
 * a place's own name when its icon is clicked, otherwise the nearest named
 * place ("Near Tampines Hub"), keeping the exact clicked coordinates. Searching
 * and picking a suggestion moves the map and pin too. Either way it emits
 * { label, address, latitude, longitude }, the same shape MeetupLocationSearch
 * emits. If Google cannot load, it emits "unavailable" so the page can fall
 * back to the OneMap search.
 */
import { nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue';
import { loadLibrary, loadPlaces } from '../googleMaps.js';
import '../assets/suggest.css';

const props = defineProps({
  label: { type: String, default: 'Search a place' },
  placeholder: { type: String, default: 'Start typing a place or address' },
  disabled: { type: Boolean, default: false },
  resetKey: { type: [String, Number], default: 0 },
  selectionHint: { type: String, default: '' },
  /** What a map click chooses, for the hint and the map's label. */
  mapHint: { type: String, default: 'Click where you will be starting from. You can zoom and drag the map first.' },
  mapLabel: { type: String, default: 'Map of Singapore: click to choose your starting point' },
  /** A saved spot to show before anything is picked ({ lat, lng }). */
  pinAt: { type: Object, default: null },
});
const emit = defineEmits(['selected', 'selection-invalidated', 'unavailable']);
const fieldId = `google-place-${useId()}`;
const listId = `${fieldId}-list`;
const query = ref(''), suggestions = ref([]), open = ref(false), active = ref(-1);
const selected = ref(null), busy = ref(false), message = ref(''), failed = ref(false);
let places = null, sessionToken = null, timer, generation = 0;
const mapEl = ref(null), mapReady = ref(false);
/** 'map': click the map; 'type': type an address. Both move the same pin. */
const mode = ref('map');
async function useMode(next) {
  mode.value = next;
  if (next === 'type') { await nextTick(); document.getElementById(fieldId)?.focus(); }
}
let map = null, marker = null;
const SINGAPORE = { lat: 1.3521, lng: 103.8198 };

// Singapore only, matching where meetups happen (and the server's checks).
const inSingapore = (lat, lng) => lat >= 1.1 && lat <= 1.5 && lng >= 103.5 && lng <= 104.1;

async function ready() {
  if (places) return places;
  try {
    places = await loadPlaces();
    return places;
  } catch {
    failed.value = true;
    emit('unavailable');
    return null;
  }
}

function onInput(event) {
  query.value = event.target.value;
  if (selected.value) {
    const previous = selected.value;
    selected.value = null;
    emit('selection-invalidated', { location: previous, reason: 'query' });
  }
  clearTimeout(timer);
  const text = query.value.trim();
  if (text.length < 2) { suggestions.value = []; open.value = false; return; }
  timer = setTimeout(() => suggest(text), 250);
}

async function suggest(text) {
  const request = ++generation;
  const lib = await ready();
  if (!lib || request !== generation) return;
  busy.value = true; message.value = '';
  try {
    sessionToken ??= new lib.AutocompleteSessionToken();
    const { suggestions: found } = await lib.AutocompleteSuggestion.fetchAutocompleteSuggestions({
      input: text, sessionToken, includedRegionCodes: ['sg'], language: 'en',
    });
    if (request !== generation) return;
    suggestions.value = found.filter((item) => item.placePrediction).slice(0, 6).map((item) => ({
      prediction: item.placePrediction,
      main: item.placePrediction.mainText?.text ?? item.placePrediction.text.text,
      secondary: item.placePrediction.secondaryText?.text ?? '',
    }));
    active.value = suggestions.value.length ? 0 : -1;
    open.value = true;
    if (!suggestions.value.length) message.value = 'No places found. Try a building, MRT station or postal code.';
  } catch {
    if (request !== generation) return;
    suggestions.value = []; open.value = false;
    message.value = 'Could not look up places. Please try again.';
  } finally {
    if (request === generation) busy.value = false;
  }
}

async function pick(index) {
  const suggestion = suggestions.value[index];
  if (!suggestion || props.disabled) return;
  const request = ++generation;
  open.value = false; busy.value = true; message.value = '';
  try {
    const place = suggestion.prediction.toPlace();
    await place.fetchFields({ fields: ['displayName', 'formattedAddress', 'location'] });
    if (request !== generation) return;
    const latitude = place.location?.lat(), longitude = place.location?.lng();
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !inSingapore(latitude, longitude)) {
      message.value = 'Choose a place in Singapore.';
      return;
    }
    const location = { label: place.displayName || suggestion.main, address: place.formattedAddress || suggestion.secondary, latitude, longitude };
    choose(location);
    sessionToken = null; // a pick ends the billing session
  } catch {
    if (request === generation) message.value = 'Could not load that place. Please pick it again.';
  } finally {
    if (request === generation) busy.value = false;
  }
}

/** Fill the box, pin the map and tell the page. */
function choose(location) {
  query.value = location.label;
  selected.value = location;
  pin(location.latitude, location.longitude);
  emit('selected', { ...location });
}
function pin(lat, lng) {
  if (!map || !marker) return;
  marker.setPosition({ lat, lng });
  marker.setVisible(true);
  map.panTo({ lat, lng });
  if (map.getZoom() < 15) map.setZoom(15);
}

async function setUpMap() {
  try {
    const [{ Map }, { Marker }] = await Promise.all([loadLibrary('maps'), loadLibrary('marker')]);
    if (!mapEl.value) return;
    map = new Map(mapEl.value, {
      center: SINGAPORE, zoom: 11, clickableIcons: true, streetViewControl: false, mapTypeControl: false,
      fullscreenControl: false, gestureHandling: 'cooperative',
      restriction: { latLngBounds: { north: 1.5, south: 1.15, west: 103.55, east: 104.1 }, strictBounds: false },
    });
    marker = new Marker({ map, visible: false });
    map.addListener('click', onMapClick);
    mapReady.value = true;
    showSaved();
  } catch {
    failed.value = true;
    emit('unavailable');
  }
}

/** A click on a place icon uses that place; anywhere else, the nearest named place. */
async function onMapClick(event) {
  if (props.disabled || mode.value !== 'map' || !event.latLng) return;
  if (event.placeId) event.stop(); // keep Google's own info window closed
  const lat = event.latLng.lat(), lng = event.latLng.lng();
  if (!inSingapore(lat, lng)) { message.value = 'Choose a place in Singapore.'; return; }
  const request = ++generation;
  open.value = false; busy.value = true; message.value = '';
  pin(lat, lng);
  try {
    const lib = await ready();
    if (!lib || request !== generation) return;
    let location = null;
    if (event.placeId) {
      const place = new lib.Place({ id: event.placeId });
      await place.fetchFields({ fields: ['displayName', 'formattedAddress', 'location'] });
      location = { label: place.displayName, address: place.formattedAddress, latitude: place.location.lat(), longitude: place.location.lng() };
    } else {
      const { places: nearby } = await lib.Place.searchNearby({
        fields: ['displayName', 'formattedAddress'], maxResultCount: 1,
        locationRestriction: { center: { lat, lng }, radius: 150 },
      });
      const near = nearby?.[0];
      location = { label: near ? `Near ${near.displayName}` : 'Pinned location', address: near?.formattedAddress ?? '', latitude: lat, longitude: lng };
    }
    if (request !== generation) return;
    choose(location);
  } catch {
    if (request !== generation) return;
    // Naming the spot failed, but the pin itself is still a usable starting point.
    choose({ label: 'Pinned location', address: '', latitude: lat, longitude: lng });
  } finally {
    if (request === generation) busy.value = false;
  }
}

function onKeydown(event) {
  if (!open.value || !suggestions.value.length) {
    if (event.key === 'Enter') event.preventDefault();
    return;
  }
  if (event.key === 'ArrowDown') { event.preventDefault(); active.value = (active.value + 1) % suggestions.value.length; }
  else if (event.key === 'ArrowUp') { event.preventDefault(); active.value = (active.value - 1 + suggestions.value.length) % suggestions.value.length; }
  else if (event.key === 'Enter') { event.preventDefault(); void pick(active.value); }
  else if (event.key === 'Escape') { open.value = false; }
}

function reset() {
  generation++; clearTimeout(timer);
  query.value = ''; suggestions.value = []; open.value = false; selected.value = null;
  busy.value = false; message.value = ''; sessionToken = null;
  marker?.setVisible(false);
}
onMounted(setUpMap);
/** Show a saved spot (e.g. a place being corrected) until something new is picked. */
function showSaved() {
  const at = props.pinAt;
  if (!selected.value && at && Number.isFinite(at.lat) && Number.isFinite(at.lng)) pin(at.lat, at.lng);
}
watch(() => props.pinAt, showSaved);
watch(() => props.resetKey, reset);
onBeforeUnmount(() => { generation++; clearTimeout(timer); });
</script>

<template>
  <div class="google-place">
    <p class="google-place__label">{{ label }}</p>
    <div class="google-place__modes" role="group" aria-label="How to choose your starting point">
      <button type="button" class="btn" :class="mode === 'map' ? 'btn--primary' : 'btn--ghost'" :aria-pressed="mode === 'map'" :disabled="disabled" @click="useMode('map')">Select on the map</button>
      <button type="button" class="btn" :class="mode === 'type' ? 'btn--primary' : 'btn--ghost'" :aria-pressed="mode === 'type'" :disabled="disabled" @click="useMode('type')">Type it in</button>
    </div>
    <label v-show="mode === 'type'" :for="fieldId" class="google-place__visually-hidden">{{ label }}</label>
    <span v-show="mode === 'type'" class="suggest">
      <input
        :id="fieldId"
        :value="query"
        :placeholder="placeholder"
        :disabled="disabled || failed"
        maxlength="100"
        role="combobox"
        autocomplete="off"
        aria-autocomplete="list"
        :aria-expanded="open"
        :aria-controls="listId"
        :aria-activedescendant="open && active >= 0 ? `${listId}-${active}` : undefined"
        @input="onInput"
        @keydown="onKeydown"
        @focus="open = suggestions.length > 0"
        @blur="open = false"
      />
      <ul v-show="open && suggestions.length" :id="listId" class="suggest__list" role="listbox">
        <!-- mousedown, not click: picking must happen before the input's blur closes the list. -->
        <li v-for="(item, index) in suggestions" :id="`${listId}-${index}`" :key="index" role="option"
          class="suggest__option google-place__option" :class="{ 'suggest__option--active': index === active }"
          :aria-selected="index === active" @mousedown.prevent="pick(index)" @mousemove="active = index">
          <strong>{{ item.main }}</strong><small v-if="item.secondary">{{ item.secondary }}</small>
        </li>
      </ul>
    </span>
    <p class="google-place__hint">{{ mode === 'map' ? mapHint : 'Pick a suggestion and the pin moves there.' }}</p>
    <div ref="mapEl" class="google-place__map" :class="{ 'google-place__map--disabled': disabled, 'google-place__map--picking': mode === 'map' }" role="application" :aria-label="mapLabel"></div>
    <p v-if="busy" class="group-muted google-place__status" role="status">Looking up places…</p>
    <p v-else-if="message" class="group-muted google-place__status" role="status">{{ message }}</p>
    <div v-if="selected" class="google-place__selection" role="status">
      <strong>Selected: {{ selected.label }}</strong>
      <small v-if="selected.address">{{ selected.address }}</small>
      <p v-if="selectionHint">{{ selectionHint }}</p>
    </div>
  </div>
</template>

<style scoped>
.google-place { display: grid; gap: var(--space-2); min-width: 0; margin-block: var(--space-4); }
.google-place__label { margin: 0; font-size: var(--step--1); font-weight: 600; color: var(--text-200); }
.google-place__modes { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.google-place__visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.google-place input {
  width: 100%; min-height: 44px; padding: var(--space-2) var(--space-3); border: var(--border-soft);
  border-radius: var(--radius-md); background: var(--field-bg); color: var(--text-100); font: inherit;
}
.google-place__option { display: grid; gap: 2px; }
.google-place__option small { color: var(--text-300); font-size: var(--step--1); }
.google-place__status { margin: 0; font-size: var(--step--1); }
.google-place__selection { display: grid; gap: 2px; border-left: 2px solid var(--accent-400); padding-left: var(--space-3); font-size: var(--step--1); }
.google-place__selection small { color: var(--text-300); }
.google-place__selection p { margin: 0; color: var(--text-300); }
.google-place__credit { margin: 0; color: var(--text-400); font-size: var(--step--2); }
.google-place__hint { margin: 0; color: var(--text-300); font-size: var(--step--1); }
.google-place__map { width: 100%; height: clamp(320px, 55vh, 520px); border: var(--border-soft); border-radius: var(--radius-md); overflow: hidden; background: var(--ink-800); }
.google-place__map--disabled { pointer-events: none; opacity: .6; }
.google-place__map--picking { cursor: crosshair; }
</style>
