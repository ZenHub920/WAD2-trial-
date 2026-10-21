<script setup>
import { computed, ref } from 'vue';
import { LABELS } from '../api.js';
const props = defineProps({ filters: { type: Object, required: true }, preferences: Boolean });

// Search and sort cover most visits; the rest stays folded until asked for.
const open = ref(false);
const activeCount = computed(() => {
  const f = props.filters;
  return [f.section, f.minCapacity > 0, f.spendBand, f.arrival, f.activity, f.vibe, f.preferredOnly].filter(Boolean).length;
});
function clear() {
  Object.assign(props.filters, { section: '', minCapacity: 0, spendBand: '', arrival: '', activity: '', vibe: '', preferredOnly: false });
}
</script>

<template>
  <div class="gf" role="search" aria-label="Filter groups">
    <div class="gf__bar">
      <label class="gf__search">
        <span class="sr-only">Search groups</span>
        <input v-model="filters.query" type="search" placeholder="Search by host or notes">
      </label>
      <label class="gf__sort">
        <span class="sr-only">Sort by</span>
        <select v-model="filters.sort">
          <option value="compatibility">Best fit first</option>
          <option value="capacity">Most places left</option>
          <option value="host">Host name</option>
        </select>
      </label>
      <button type="button" class="btn btn--ghost" aria-controls="group-more-filters" :aria-expanded="open" @click="open = !open">
        {{ open ? 'Fewer filters' : 'More filters' }}<span v-if="activeCount" class="tag tag--accent">{{ activeCount }}</span>
      </button>
    </div>
    <div v-show="open" id="group-more-filters" class="group-controls">
      <label>Seating<select v-model="filters.section"><option value="">Any seating</option><option v-for="(name, id) in LABELS.section" :key="id" :value="id">{{ name }}</option></select></label>
      <label>Budget<select v-model="filters.spendBand"><option value="">Any budget</option><option v-for="n in 4" :key="n" :value="n">{{ LABELS.spendBand[n] }}</option></select></label>
      <label>Arrival<select v-model="filters.arrival"><option value="">Any time</option><option v-for="(name, id) in LABELS.arrival" :key="id" :value="id">{{ name }}</option></select></label>
      <label>Activity<select v-model="filters.activity"><option value="">Any activity</option><option v-for="(name, id) in LABELS.plans" :key="id" :value="id">{{ name }}</option></select></label>
      <label>Vibe<select v-model="filters.vibe"><option value="">Any vibe</option><option v-for="(name, id) in LABELS.vibe" :key="id" :value="id">{{ name }}</option></select></label>
      <label>At least this many places<input v-model.number="filters.minCapacity" type="number" min="0" step="1"></label>
      <label v-if="preferences" class="group-check"><input v-model="filters.preferredOnly" type="checkbox">Only groups I've marked</label>
      <button v-if="activeCount" type="button" class="btn btn--ghost gf__clear" @click="clear">Clear filters</button>
    </div>
  </div>
</template>

<style scoped>
.gf { display: grid; gap: var(--space-4); }
.gf__bar { display: flex; flex-wrap: wrap; gap: var(--space-3); align-items: center; }
.gf__search { flex: 1 1 220px; }
.gf__sort { flex: 0 1 190px; }
.gf__sort select { width: 100%; }
.gf__bar .btn { gap: var(--space-2); }
.gf__clear { align-self: end; justify-self: start; }
</style>
