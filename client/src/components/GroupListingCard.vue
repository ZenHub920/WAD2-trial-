<script setup>
import { LABELS, formatDate } from '../api.js';
defineProps({ group: { type: Object, required: true } });
</script>

<template>
  <article class="card group-card">
    <h3>{{ group.hostName }}'s group</h3>
    <p>{{ group.artist }}<span v-if="group.tourName"> · {{ group.tourName }}</span></p>
    <p>{{ formatDate(group.eventDate) }} · {{ LABELS.section[group.section] }}</p>
    <p>{{ group.remainingCapacity }} available / {{ group.capacity }} places · {{ LABELS.spendBand[group.spendBand] }}</p>
    <p>{{ LABELS.arrival[group.arrivalPlan] }}</p>
    <p v-if="group.compatibility != null">{{ Math.round(group.compatibility * 100) }}% compatibility</p>
    <ul class="group-tags" aria-label="Group activities"><template v-for="(name, id) in LABELS.plans" :key="id"><li v-if="group.plans?.[id]">{{ name }}</li></template></ul>
    <ul class="group-tags" aria-label="Concert vibe"><template v-for="(name, id) in LABELS.vibe" :key="id"><li v-if="group.vibe?.[id]">{{ name }} {{ group.vibe[id] }}/4</li></template></ul>
    <p v-if="group.notes" class="group-notes">{{ group.notes }}</p>
    <slot />
  </article>
</template>
