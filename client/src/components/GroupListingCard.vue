<script setup>
import { LABELS, formatDate } from '../api.js';
defineProps({ group: { type: Object, required: true } });
</script>

<template>
  <article class="card group-card">
    <header class="group-card__head"><h3>{{ group.hostName }}'s group</h3><span class="tag">{{ group.remainingCapacity }} {{ group.remainingCapacity === 1 ? 'group place' : 'group places' }} available</span></header>
    <p>{{ group.artist }}<span v-if="group.tourName">, {{ group.tourName }}</span></p>
    <p>{{ formatDate(group.eventDate) }}, {{ LABELS.section[group.section] }}</p>
    <p>{{ group.memberCount ?? 1 }} {{ (group.memberCount ?? 1) === 1 ? 'member' : 'members' }} · {{ LABELS.spendBand[group.spendBand] }}</p>
    <p>{{ LABELS.arrival[group.arrivalPlan] }}</p>
    <p v-if="group.compatibility != null">{{ group.compatibility>=0.75?'Strong fit':group.compatibility>=0.5?'Potential fit':'Explore this group' }}<span v-if="group.confidence==='limited'">, limited preference information</span></p>
    <ul v-if="group.reasons?.length"><li v-for="r in group.reasons" :key="r.concept">{{ r.label }}</li></ul>
    <ul class="group-tags" aria-label="Group activities"><template v-for="(name, id) in LABELS.plans" :key="id"><li v-if="group.plans?.[id]">{{ name }}</li></template></ul>
    <ul class="group-tags" aria-label="Concert vibe"><template v-for="(name, id) in LABELS.vibe" :key="id"><li v-if="group.vibe?.[id]">{{ name }} {{ group.vibe[id] }}/4</li></template></ul>
    <p v-if="group.notes" class="group-notes">{{ group.notes }}</p>
    <slot />
  </article>
</template>

<style scoped>
.group-card { display: flex; flex-direction: column; min-width: 0; overflow-wrap: anywhere; }
.group-card__head { display: flex; flex-wrap: wrap; align-items: flex-start; gap: var(--space-2); justify-content: space-between; min-width: 0; }
.group-card__head h3 { flex: 1 1 150px; min-width: 0; }
.group-card__head .tag { white-space: normal; }
.group-card :deep(> .btn) { margin-top: auto; align-self: flex-start; white-space: normal; }
.group-card ul:not(.group-tags) { padding-left: var(--space-5); }
</style>
