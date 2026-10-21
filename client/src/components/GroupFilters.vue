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
// Filters stay out of the way until asked for.
const open = ref(false);
const uid = `group-search-${Math.random().toString(36).slice(2, 8)}`;
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
    <label :for="`${uid}-query`" class="sr-only">Search groups</label>
    <div class="group-search__field">
      <svg class="group-search__icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-4.2-4.2" /></svg>
      <input :id="`${uid}-query`" v-model="filters.query" type="search" placeholder="Search by group name, artist, host or keyword">
      <button type="button" class="group-search__toggle" :class="{ 'group-search__toggle--open': open }" :aria-expanded="open" :aria-controls="`${uid}-panel`" @click="open = !open">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5h18l-7 8.5V19l-4 2v-7.5z" /></svg>
        <span>Filters</span>
        <span v-if="active.length - (filters.query ? 1 : 0) > 0" class="group-search__count">{{ active.length - (filters.query ? 1 : 0) }}</span>
      </button>
    </div>
    <div v-show="open" :id="`${uid}-panel`" class="group-search__panel">
      <label>Sort by
        <select v-model="filters.sort"><option value="compatibility">Best compatibility</option><option value="capacity">Most places available</option><option value="host">Host name A–Z</option></select>
      </label>
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
    <div v-if="active.length" class="group-search__active" aria-label="Active filters">
      <span class="group-search__hint">Filtering by</span>
      <button v-for="[key, label] in active" :key="key" type="button" class="group-search__chip" :aria-label="`Remove filter: ${label}`" @click="filters[key] = defaults[key]">{{ label }} <span aria-hidden="true">×</span></button>
      <button type="button" class="group-search__clear" @click="clear">Clear all filters</button>
    </div>
  </div>
</template>

<style scoped>
.group-search { display: grid; gap: var(--space-3); min-width: 0; }
.group-search__field { position: relative; display: flex; align-items: center; min-width: 0; }
.group-search__icon { position: absolute; left: var(--space-3); width: 18px; height: 18px; fill: none; stroke: var(--text-400); stroke-width: 2; stroke-linecap: round; pointer-events: none; }
.group-search__field input { flex: 1; min-width: 0; min-height: 48px; padding-left: calc(var(--space-3) + 26px) !important; padding-right: 7.5rem !important; }
.group-search__toggle { position: absolute; right: 6px; display: inline-flex; align-items: center; gap: var(--space-2); height: 36px; padding: 0 var(--space-3); border: var(--border-soft); border-radius: var(--radius-sm); background: var(--ink-800); color: var(--text-200); font: inherit; font-size: var(--step--1); font-weight: 600; cursor: pointer; }
.group-search__toggle svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linejoin: round; }
.group-search__toggle:hover, .group-search__toggle--open { border-color: var(--accent-400); color: var(--accent-400); }
.group-search__count { display: inline-grid; place-items: center; min-width: 20px; height: 20px; padding-inline: 5px; border-radius: var(--radius-pill); background: var(--accent-500); color: #fff; font-size: var(--step--2); }
.group-search__panel { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 12rem), 1fr)); gap: var(--space-3); align-items: start; padding: var(--space-4); border: var(--border-soft); border-radius: var(--radius-md); background: var(--ink-850); }
.group-search__hint { color: var(--text-400); font-size: var(--step--2); }
.group-search__active { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
.group-search__chip { display: inline-flex; align-items: center; gap: var(--space-1); padding: var(--space-1) var(--space-3); border: 1px solid var(--accent-400); border-radius: var(--radius-pill); background: transparent; color: var(--accent-400); font: inherit; font-size: var(--step--1); cursor: pointer; }
.group-search__clear { border: 0; background: none; color: var(--rose-400); font: inherit; font-size: var(--step--1); text-decoration: underline; cursor: pointer; }
@media (max-width: 480px) {
  .group-search__toggle span:not(.group-search__count) { display: none; }
  .group-search__field input { padding-right: 4.5rem !important; }
}
</style>
