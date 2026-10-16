<script setup>
import { LABELS } from '../api.js';
defineProps({ filters: { type: Object, required: true }, preferences: Boolean });
</script>

<template>
  <div class="group-controls" role="search" aria-label="Filter groups">
    <label>Search concert, artist, host or notes<input v-model="filters.query" type="search" placeholder="Search groups"></label>
    <label>Seating<select v-model="filters.section"><option value="">All sections</option><option v-for="(name, id) in LABELS.section" :key="id" :value="id">{{ name }}</option></select></label>
    <label>Minimum available places<input v-model.number="filters.minCapacity" type="number" min="0" step="1"></label>
    <label>Spending<select v-model="filters.spendBand"><option value="">Any budget</option><option v-for="n in 4" :key="n" :value="n">{{ LABELS.spendBand[n] }}</option></select></label>
    <label>Arrival<select v-model="filters.arrival"><option value="">Any arrival</option><option v-for="(name, id) in LABELS.arrival" :key="id" :value="id">{{ name }}</option></select></label>
    <label>Activity<select v-model="filters.activity"><option value="">Any activity</option><option v-for="(name, id) in LABELS.plans" :key="id" :value="id">{{ name }}</option></select></label>
    <label>Concert vibe<select v-model="filters.vibe"><option value="">Any vibe</option><option v-for="(name, id) in LABELS.vibe" :key="id" :value="id">{{ name }}</option></select></label>
    <label>Sort by<select v-model="filters.sort"><option value="compatibility">Compatibility</option><option value="capacity">Available places</option><option value="host">Host name</option></select></label>
    <label v-if="preferences" class="group-check"><input v-model="filters.preferredOnly" type="checkbox">Preferred groups only</label>
  </div>
</template>
