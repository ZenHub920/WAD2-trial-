<script setup>
import { computed } from 'vue';
import { LABELS, formatDate } from '../api.js';
const props = defineProps({ group: { type: Object, required: true } });

const fit = computed(() => {
  const c = props.group.compatibility;
  if (c == null) return null;
  return c >= 0.75 ? { label: 'Great fit', cls: 'tag--mint' } : c >= 0.5 ? { label: 'Good fit', cls: 'tag--accent' } : null;
});
const members = computed(() => props.group.memberCount ?? 1);
const activities = computed(() => Object.entries(LABELS.plans).filter(([id]) => props.group.plans?.[id]).map(([, name]) => name));
const vibes = computed(() => Object.entries(LABELS.vibe).filter(([id]) => props.group.vibe?.[id]).map(([id, name]) => `${name} ${props.group.vibe[id]}/4`));
const hasMore = computed(() => props.group.notes || props.group.reasons?.length || vibes.value.length);
</script>

<template>
  <article class="card group-card">
    <header class="group-card__head">
      <h3>{{ group.hostName }}'s group</h3>
      <span v-if="fit" class="tag" :class="fit.cls">{{ fit.label }}</span>
    </header>
    <p class="group-card__places">
      <strong>{{ group.remainingCapacity }} {{ group.remainingCapacity === 1 ? 'place' : 'places' }} left</strong>
      · {{ members }} {{ members === 1 ? 'person' : 'people' }} going
    </p>
    <p class="group-card__facts">
      {{ LABELS.section[group.section] }} · {{ LABELS.arrival[group.arrivalPlan] }} · {{ LABELS.spendBand[group.spendBand] }} budget
    </p>
    <ul v-if="activities.length" class="group-tags" aria-label="Plans">
      <li v-for="name in activities" :key="name" class="tag">{{ name }}</li>
    </ul>

    <details v-if="hasMore" class="group-card__more">
      <summary>More about this group</summary>
      <p v-if="group.notes" class="group-notes">“{{ group.notes }}”</p>
      <template v-if="group.reasons?.length">
        <p class="group-card__label">Why it might suit you</p>
        <ul><li v-for="r in group.reasons" :key="r.concept">{{ r.label }}</li></ul>
      </template>
      <p v-if="group.confidence === 'limited'" class="group-muted">Based on limited information.</p>
      <template v-if="vibes.length">
        <p class="group-card__label">Concert vibe</p>
        <ul class="group-tags"><li v-for="v in vibes" :key="v">{{ v }}</li></ul>
      </template>
      <p class="group-muted">{{ group.artist }}, {{ formatDate(group.eventDate) }}</p>
    </details>

    <div class="group-card__actions"><slot /></div>
  </article>
</template>

<style scoped>
.group-card { display: flex; flex-direction: column; min-width: 0; overflow-wrap: anywhere; }
.group-card__head { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); justify-content: space-between; min-width: 0; }
.group-card__head h3 { flex: 1 1 150px; min-width: 0; }
.group-card__places { color: var(--text-100); }
.group-card__facts { color: var(--text-300); font-size: var(--step--1); }
.group-card__more { font-size: var(--step--1); display: grid; gap: var(--space-2); }
.group-card__more summary { color: var(--accent-400); }
.group-card__more ul:not(.group-tags) { padding-left: var(--space-5); }
.group-card__label { font-weight: 700; color: var(--text-200); margin-top: var(--space-2); }
.group-card__actions { margin-top: auto; padding-top: var(--space-2); display: grid; gap: var(--space-2); justify-items: start; }
.group-card__actions :deep(.btn) { white-space: normal; }
</style>
