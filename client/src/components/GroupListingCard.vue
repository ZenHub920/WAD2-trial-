<script setup>
import { LABELS, formatDate } from '../api.js';
defineProps({ group: { type: Object, required: true } });
</script>

<template>
  <article class="card group-card">
    <h3>{{ group.hostName }}'s group</h3>
    <p>{{ group.artist }}<span v-if="group.tourName"> · {{ group.tourName }}</span></p>
    <p>{{ formatDate(group.eventDate) }} · {{ LABELS.section[group.section] }}</p>
    <p>{{group.memberCount??1}} current members · {{ group.remainingCapacity }} available / {{ group.capacity }} stranger places · {{ LABELS.spendBand[group.spendBand] }}</p>
    <p>{{ LABELS.arrival[group.arrivalPlan] }}</p>
    <p v-if="group.compatibility != null">{{ group.compatibility>=0.75?'Strong fit':group.compatibility>=0.5?'Potential fit':'Explore this group' }}<span v-if="group.confidence==='limited'"> · Limited preference information</span></p>
    <ul v-if="group.reasons?.length"><li v-for="r in group.reasons" :key="r.concept">{{ r.label }} · {{ r.support }}% support in the compared preferences</li></ul>
    <ul class="group-tags" aria-label="Group activities"><template v-for="(name, id) in LABELS.plans" :key="id"><li v-if="group.plans?.[id]">{{ name }}</li></template></ul>
    <ul class="group-tags" aria-label="Concert vibe"><template v-for="(name, id) in LABELS.vibe" :key="id"><li v-if="group.vibe?.[id]">{{ name }} {{ group.vibe[id] }}/4</li></template></ul>
    <p v-if="group.notes" class="group-notes">{{ group.notes }}</p>
    <slot />
  </article>
</template>
