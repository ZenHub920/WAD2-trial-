<script setup>
import { computed } from 'vue';

const props = defineProps({ profile: { type: Object, default: null } });
const priorities = computed(() => (props.profile?.representativeWants ?? []).slice(0, 3));
const coverage = computed(() => props.profile?.coverage);
</script>

<template>
  <section v-if="coverage" class="group-priorities" aria-label="Shared group preferences">
    <div class="group-priorities__heading"><strong>Shared preferences</strong><span>{{ coverage.answered }} of {{ coverage.total }} profiles represented</span></div>
    <ul v-if="priorities.length" class="group-priorities__list"><li v-for="priority in priorities" :key="priority.key">{{ priority.label }}</li></ul>
    <p v-else>No shared preference yet. A preference appears when more than half of all members choose it.</p>
    <p v-if="!coverage.complete" class="group-priorities__pending">Still forming — some members haven't saved their preferences.</p>
    <p v-else-if="priorities.length">Chosen by a majority of the group. Individual answers stay private.</p>
  </section>
</template>

<style scoped>
.group-priorities {
  display: grid;
  gap: .6rem;
  min-width: 0;
  padding: .85rem 0;
  border-block: var(--border-hairline);
  font-size: var(--step--1);
}
.group-priorities__heading {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: .35rem .8rem;
}
.group-priorities__heading strong { color: var(--text-200); font-weight: 600; }
.group-priorities__heading span, .group-priorities p { color: var(--text-300); font-size: var(--step--2); }
.group-priorities p, .group-priorities ul { margin: 0; }
.group-priorities__list { display: flex; flex-wrap: wrap; gap: .4rem; padding: 0; list-style: none; }
.group-priorities__list li { padding: .3rem .55rem; border: 1px solid var(--panel-edge); border-radius: 4px; background: var(--accent-glow); color: var(--text-200); }
.group-priorities .group-priorities__pending { color: var(--text-200); }
</style>
