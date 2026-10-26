<script setup>
import { computed } from 'vue';
import { LABELS, formatDate } from '../api.js';
import GroupAvatar from './GroupAvatar.vue';
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
      <GroupAvatar :src="group.imageUrl" :name="group.name || group.hostName" :size="44" />
      <div class="group-card__title">
        <h3>{{ group.name || `${group.hostName}'s group` }}</h3>
        <p v-if="group.name" class="group-card__meta">Hosted by {{ group.hostName }}</p>
      </div>
      <span class="tag group-card__capacity">{{ group.remainingCapacity }} {{ group.remainingCapacity === 1 ? 'spot' : 'spots' }} left</span>
    </header>
    <div class="group-card__concert">
      <p class="group-card__artist">{{ group.artist }}<span v-if="group.tourName">, {{ group.tourName }}</span></p>
      <p class="group-card__meta">{{ formatDate(group.eventDate) }} · {{ LABELS.section[group.section] }}</p>
    </div>
    <p v-if="group.canJoinQueue && group.remainingCapacity === 0" class="group-card__meta">All available spots are held right now. You can join the waiting queue.</p>
    <p v-if="group.queueLength" class="group-card__meta">{{ group.queueLength }} {{ group.queueLength === 1 ? 'request' : 'requests' }} in the arrival-order queue.</p>
    <dl class="group-card__facts">
      <div>
        <dt>Group size</dt>
        <dd>{{ group.memberCount ?? 1 }} {{ (group.memberCount ?? 1) === 1 ? 'member' : 'members' }}</dd>
      </div>
      <div>
        <dt>Spending</dt>
        <dd>{{ LABELS.spendBand[group.spendBand] }}</dd>
      </div>
      <div class="group-card__arrival">
        <dt>Getting there</dt>
        <dd>{{ LABELS.arrival[group.arrivalPlan] }}</dd>
      </div>
    </dl>
    <div v-if="group.compatibility != null || group.reasons?.length" class="group-card__fit">
      <p v-if="group.compatibility != null"><strong>{{ group.compatibility>=0.75?'Strong fit':group.compatibility>=0.5?'Potential fit':'Explore this group' }}</strong><span v-if="group.confidence==='limited'">, based on limited preference information</span></p>
      <ul v-if="group.reasons?.length" class="group-card__reasons"><li v-for="r in group.reasons" :key="r.concept">{{ r.label }}</li></ul>
    </div>
    <ul class="group-tags" aria-label="Things they want to do"><template v-for="(name, id) in LABELS.plans" :key="id"><li v-if="group.plans?.[id]">{{ name }}</li></template></ul>
    <ul class="group-tags group-card__vibe" aria-label="Their vibe"><template v-for="(name, id) in LABELS.vibe" :key="id"><li v-if="group.vibe?.[id]">{{ name }} {{ group.vibe[id] }}/4</li></template></ul>
    <p v-if="group.notes" class="group-notes">{{ group.notes }}</p>
    <footer v-if="$slots.default" class="group-card__actions"><slot /></footer>
  </article>
</template>

<style scoped>
.group-card { display: flex; flex-direction: column; gap: var(--space-4); min-width: 0; overflow-wrap: anywhere; font-size: var(--step--1); line-height: 1.5; }
.group-card :where(p, h3, ul, dl, dd) { margin: 0; }
.group-card__head { display: flex; flex-wrap: wrap; align-items: flex-start; gap: var(--space-2); justify-content: space-between; min-width: 0; }
.group-card__title { display: grid; gap: 2px; flex: 1 1 10rem; min-width: 0; }
.group-card__head h3 { min-width: 0; font-size: var(--step-1); line-height: 1.3; }
.group-card__capacity { white-space: normal; max-width: 100%; background: var(--accent-glow); color: var(--accent-400); }
.group-card__concert { display: grid; gap: var(--space-1); }
.group-card__artist { font-weight: 600; color: var(--text-100); }
.group-card__meta { color: var(--text-300); }
.group-card__facts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-3) var(--space-4); padding-block: var(--space-3); border-block: var(--border-hairline); }
.group-card__facts > div { min-width: 0; display: grid; gap: var(--space-1); align-content: start; }
.group-card__facts dt { color: var(--text-300); font-size: var(--step--2); }
.group-card__arrival { grid-column: 1 / -1; }
.group-card__fit { display: grid; gap: var(--space-2); padding: var(--space-3); border-radius: var(--radius-sm); background: var(--ink-750); }
.group-card__reasons { display: grid; gap: var(--space-1); padding-left: var(--space-4); color: var(--text-300); }
.group-card .group-tags { gap: var(--space-2); }
.group-card .group-tags:empty { display: none; }
.group-card .group-tags li { padding: var(--space-1) var(--space-2); border-radius: var(--radius-sm); background: var(--ink-700); font-size: var(--step--1); }
.group-card .group-card__vibe li { background: transparent; border: var(--border-hairline); }
.group-card .group-notes { color: var(--text-300); }
.group-card__actions { display: grid; justify-items: start; gap: var(--space-3); min-width: 0; margin-top: auto; padding-top: var(--space-4); border-top: var(--border-hairline); }
.group-card__actions :deep(> *) { min-width: 0; max-width: 100%; }
.group-card__actions :deep(.btn) { justify-self: start; white-space: normal; }
.group-card__actions :deep(details) { width: 100%; }
.group-card__actions :deep(summary) { color: var(--text-300); font-size: var(--step--1); }
</style>
