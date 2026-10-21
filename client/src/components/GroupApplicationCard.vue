<script setup>
import { computed } from 'vue';
import { LABELS } from '../api.js';
defineEmits(['respond']);
const props = defineProps({ application: { type: Object, required: true }, busy: Boolean });
const canRespond = computed(() => props.application.canHostRespond !== false && props.application.queueStatus !== 'waiting');
const held = computed(() => props.application.seatReserved ?? props.application.queueStatus !== 'waiting');
const statuses = { pending: 'Awaiting your approval', accepted: 'Approved', rejected: 'Declined', declined: 'Declined', withdrawn: 'Withdrawn', expired: 'Expired', superseded: 'Applicant joined another group', cancelled: 'Membership ended' };
const publicVibe = computed(() => Object.entries(LABELS.vibe).filter(([axis]) => Number(props.application.seeker?.vibe?.[axis]) > 0));
const applicationDate = computed(() => {
  const value = props.application.createdAt;
  if (!value) return '';
  const date = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('en-SG');
});
const holdDeadline = computed(() => {
  const value = props.application.expiresAt;
  if (!value) return '';
  const date = new Date(typeof value === 'number' ? value : value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('en-SG');
});
const preferenceText = intent => props.application.preferences?.[intent]?.map(preference => preference.text).join(', ');
</script>

<template>
  <article class="application-card">
    <div class="application-card__heading"><h3>{{ application.seekerName }}</h3><span class="tag">{{ application.legacyAutomatic || application.matchingRoundId ? 'Earlier automatic request' : 'Direct application' }}</span></div>
    <p>{{ application.artist }} · {{ LABELS.section[application.section] ?? application.section }} · {{ application.resolutionReason === 'migrated_to_mutual_proposal' ? 'Moved to automatic offer' : application.resolutionReason === 'group_full' ? 'Group filled before this request' : statuses[application.status] ?? 'Request updated' }}</p>
    <p class="group-muted">Applied {{ applicationDate }} · {{ application.remainingCapacity }} additional places currently available</p>
    <template v-if="application.status === 'pending'">
      <p><strong>{{ canRespond ? 'Next to review' : `Waiting · position ${application.queuePosition ?? '—'}` }}</strong></p>
      <p v-if="held">One place is held for this applicant until {{ holdDeadline }}. Approval confirms the same held place.</p>
      <p v-else>No place is held yet. This request expires {{ holdDeadline }} even while waiting.</p>
      <p v-if="!canRespond" class="group-muted">An earlier request must be resolved first. Hosts review direct applications and automatic proposals in the same arrival order.</p>
    </template>
    <p v-if="application.resolutionReason === 'migrated_to_mutual_proposal'" class="group-muted">Review the replacement Automatic proposal card in this group's request queue. Both you and the companion must approve it when it reaches the front.</p>
    <p v-else-if="application.legacyAutomatic || application.matchingRoundId" class="group-muted">Created under the earlier automatic matching flow.</p>
    <p v-if="application.applicationNote" class="application-card__note">{{ application.applicationNote }}</p>
    <div v-if="application.compatibility != null || application.reasons?.length" class="application-card__compatibility"><p v-if="application.compatibility != null"><strong>{{ application.compatibility >= 0.75 ? 'Strong fit' : application.compatibility >= 0.5 ? 'Potential fit' : 'Explore this applicant' }}</strong></p><ul v-if="application.reasons?.length"><li v-for="reason in application.reasons.slice(0, 3)" :key="reason.concept ?? reason.label">{{ reason.label }}</li></ul></div>
    <details><summary>Public profile &amp; preferences</summary><div class="application-card__profile">
      <p v-if="application.seeker">{{ application.seeker.ageBand }} · {{ application.seeker.languages.join(', ') }}</p>
      <p v-if="application.seeker?.reliability != null">Reliability: {{ Math.round(application.seeker.reliability * 100) }}%</p>
      <ul v-if="publicVibe.length"><li v-for="[axis, label] in publicVibe" :key="axis">{{ label }} {{ application.seeker.vibe[axis] }}/4</li></ul>
      <p>Enjoys: {{ preferenceText('about') || 'No preferences specified' }}</p><p>Companion preferences: {{ preferenceText('wants') || 'Flexible' }}</p><p v-if="preferenceText('avoid')">Prefers to avoid: {{ preferenceText('avoid') }}</p>
    </div></details>
    <div v-if="application.status === 'pending'" class="group-actions"><button type="button" class="btn btn--success" :disabled="busy || !canRespond" @click="$emit('respond', 'accept')">Approve group place</button><button type="button" class="btn btn--danger-ghost" :disabled="busy || !canRespond" @click="$emit('respond', 'reject')">Decline request</button></div>
  </article>
</template>

<style scoped>
.application-card { display: grid; gap: var(--space-3); padding-block: var(--space-4); border-bottom: var(--border-hairline); overflow-wrap: anywhere; }
.application-card__heading { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: var(--space-3); }
.application-card h3 { margin: 0; font-size: var(--step-1); }
.application-card p { margin: 0; }
.application-card__profile { display: grid; gap: var(--space-2); padding-top: var(--space-3); }
.application-card__compatibility { padding: var(--space-3); border-radius: var(--radius-sm); background: var(--ink-750); }
.application-card__compatibility ul { margin-bottom: 0; }
.application-card__note { white-space: pre-wrap; }
</style>
