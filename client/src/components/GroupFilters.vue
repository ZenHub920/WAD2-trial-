<script setup>
import { computed, ref } from 'vue';
import { LABELS, SECTION_OPTIONS, ARRIVAL_OPTIONS } from '../api.js';
const props = defineProps({ filters: { type: Object, required: true }, preferences: Boolean });
const defaults = { query: '', section: '', minCapacity: 0, spendBand: '', arrival: '', activity: '', vibe: '', preferredOnly: false };
const active = computed(() => [
  ['query', props.filters.query ? `Search: ${props.filters.query}` : ''],
  ['section', LABELS.section[props.filters.section]],
  ['minCapacity', Number(props.filters.minCapacity) > 0 ? `${props.filters.minCapacity}+ places` : ''],
  ['spendBand', LABELS.spendBand[props.filters.spendBand]],
  ['arrival', LABELS.arrival[props.filters.arrival]],
  ['activity', LABELS.plans[props.filters.activity]],
  ['vibe', LABELS.vibe[props.filters.vibe]],
  ['preferredOnly', props.preferences && props.filters.preferredOnly ? 'Preferred groups' : ''],
].filter(([, label]) => label));
const category = ref('section');
const categories = computed(() => [
  { key: 'section', label: 'Seating', options: SECTION_OPTIONS },
  { key: 'spendBand', label: 'Budget', options: LABELS.spendBand },
  { key: 'arrival', label: 'Arrival time', options: ARRIVAL_OPTIONS },
  { key: 'activity', label: 'Activity', options: LABELS.plans },
  { key: 'vibe', label: 'Concert vibe', options: LABELS.vibe },
  { key: 'minCapacity', label: 'Places needed' },
  ...(props.preferences ? [{ key: 'preferredOnly', label: 'Preferred groups', options: { all: 'All groups', preferred: 'My preferred groups only' } }] : []),
]);
const selected = computed(() => categories.value.find(item => item.key === category.value));
const filterValue = computed({
  get: () => category.value === 'preferredOnly' ? (props.filters.preferredOnly ? 'preferred' : 'all') : props.filters[category.value],
  set: value => { props.filters[category.value] = category.value === 'preferredOnly' ? value === 'preferred' : value; },
});
function clear() {
  Object.assign(props.filters, defaults);
}
</script>

<template>
  <div class="group-search" role="search" aria-label="Filter groups">
    <div class="group-search__bar">
      <label class="group-search__query">Search by artist, host or keyword
        <input v-model="filters.query" type="search" placeholder="Search artists, hosts or group notes">
      </label>
      <label class="group-search__sort">Sort by
        <select v-model="filters.sort"><option value="compatibility">Best compatibility</option><option value="capacity">Most places available</option><option value="host">Host name A–Z</option></select>
      </label>
    </div>
    <details class="group-search__more">
      <summary>Refine results<span v-if="active.length" class="group-search__count">{{ active.length }} active</span></summary>
      <div class="group-search__advanced">
        <label>Filter by
          <select v-model="category"><option v-for="item in categories" :key="item.key" :value="item.key">{{ item.label }}</option></select>
        </label>
        <label v-if="category === 'minCapacity'">Minimum places
          <input v-model.number="filters.minCapacity" type="number" min="0" step="1">
          <span class="group-search__hint">0 shows any group size</span>
        </label>
        <label v-else>{{ selected.label }}
          <select v-model="filterValue">
            <option v-if="category !== 'preferredOnly'" value="">Any {{ selected.label.toLowerCase() }}</option>
            <option v-for="(name, id) in selected.options" :key="id" :value="id">{{ name }}</option>
          </select>
        </label>
      </div>
    </details>
    <div v-if="active.length" class="group-search__active" aria-label="Active filters">
      <span class="group-search__hint">Filtering by</span>
      <button v-for="[key, label] in active" :key="key" type="button" class="group-search__chip" :aria-label="`Remove filter: ${label}`" @click="filters[key] = defaults[key]">{{ label }} <span aria-hidden="true">×</span></button>
      <button type="button" class="group-search__clear" @click="clear">Clear all filters</button>
    </div>
  </div>
</template>

<style scoped>
.group-search { display: grid; gap: var(--space-4); min-width: 0; }
.group-search__bar { display: flex; flex-wrap: wrap; gap: var(--space-4); align-items: start; }
.group-search label { display: grid; gap: var(--space-2); min-width: 0; }
.group-search__query { flex: 1 1 280px; }
.group-search__sort { flex: 0 1 220px; }
.group-search input, .group-search select { width: 100%; min-width: 0; }
.group-search__more { border-top: var(--border-hairline); padding-top: var(--space-3); }
.group-search__more summary { cursor: pointer; min-height: 32px; }
.group-search__count { margin-left: var(--space-2); color: var(--accent-400); font-size: var(--step--1); }
.group-search__hint { color: var(--text-300); font-size: var(--step--1); }
.group-search__advanced { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 180px), 1fr)); gap: var(--space-4); margin-block: var(--space-3); }
.group-search__active { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
.group-search__active { border-top: var(--border-hairline); padding-top: var(--space-3); }
.group-search__chip { display: inline-flex; gap: var(--space-2); align-items: center; max-width: 100%; }
.group-search__chip { border: var(--border-soft); border-radius: var(--radius-pill); padding: var(--space-2) var(--space-3); background: var(--ink-800); color: var(--text-200); cursor: pointer; font: inherit; font-size: var(--step--1); overflow-wrap: anywhere; }
.group-search__clear { color: var(--accent-400); text-decoration: underline; cursor: pointer; padding: var(--space-2); font: inherit; font-size: var(--step--1); }
@media (max-width: 520px) { .group-search__sort { flex: 1 1 100%; } }
</style>
