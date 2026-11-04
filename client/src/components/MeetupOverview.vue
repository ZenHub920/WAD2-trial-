<script setup>
import { computed } from 'vue';
import { isMeetupHistorical, meetupNeedsAttention, meetupPresentation, meetupSelectedDetails } from '../utils/meetupSummaries.js';
import { meetupRouteForBoard } from '../utils/meetupNavigation.js';

const props = defineProps({ plans: { type: Array, default: () => [] }, scoped: Boolean, from: { type: String, default: '' } });
const sections = computed(() => [
  { id: 'attention', title: 'Needs your attention', hint: 'Share your times or review a proposal.', plans: props.plans.filter(meetupNeedsAttention) },
  { id: 'active', title: 'Upcoming & in progress', hint: 'Keep track of the plans you are making together.', plans: props.plans.filter(plan => !isMeetupHistorical(plan) && !meetupNeedsAttention(plan)) },
  { id: 'history', title: 'Past & cancelled', hint: 'Previous plans remain available for reference.', plans: props.plans.filter(plan => isMeetupHistorical(plan)) },
].filter(section => section.plans.length));
</script>

<template>
  <section v-for="section in sections" :key="section.id" class="meetup-overview-section" :aria-labelledby="`meetup-overview-${section.id}`">
    <header class="meetup-overview-heading"><div><h2 :id="`meetup-overview-${section.id}`">{{ section.title }}</h2><p>{{ section.hint }}</p></div><span>{{ section.plans.length }}</span></header>
    <div class="meetup-overview-list">
      <article v-for="plan in section.plans" :key="plan.id" class="card meetup-overview-plan" :class="`meetup-overview-plan--${plan.status}`">
        <div class="meetup-overview-plan__main"><span class="meetup-overview-plan__status">{{ meetupPresentation(plan).label }}</span><h3>{{ plan.title }}</h3><p class="meetup-overview-plan__concert">{{ plan.concert?.artist ?? 'Concert meetup' }}<span v-if="plan.concert?.event_date"> · {{ plan.concert.event_date }}</span></p><p>{{ plan.scopeLabel }}</p><p v-if="meetupSelectedDetails(plan)" class="meetup-overview-plan__selection">{{ meetupSelectedDetails(plan) }}</p><p>{{ meetupPresentation(plan).detail }}</p></div>
        <RouterLink class="btn" :class="meetupNeedsAttention(plan) ? 'btn--primary' : 'btn--ghost'" :to="meetupRouteForBoard(plan, { from: from || (scoped ? 'conversation' : 'overview'), stage: meetupPresentation(plan).stage })">{{ meetupPresentation(plan).action }}</RouterLink>
      </article>
    </div>
  </section>
</template>

<style scoped>
.meetup-overview-section { display:grid; gap:1rem; }
.meetup-overview-heading { display:flex; align-items:center; justify-content:space-between; gap:1rem; }
.meetup-overview-heading h2 { font-size:var(--step-1); margin:0 0 .3rem; }
.meetup-overview-heading p, .meetup-overview-plan p { font-size:var(--step--1); color:var(--text-300); margin:.3rem 0 0; line-height:1.6; }
.meetup-overview-heading > span { display:grid; place-items:center; min-width:1.9rem; min-height:1.9rem; border:var(--border-soft); border-radius:var(--radius-sm); font-size:var(--step--1); }
.meetup-overview-list { display:grid; gap:.75rem; }
.meetup-overview-plan { display:flex; gap:1rem; align-items:center; justify-content:space-between; padding:1.1rem 1.25rem; border-left:2px solid var(--accent-400); }
.meetup-overview-plan__main { min-width:0; overflow-wrap:anywhere; }
.meetup-overview-plan h3 { font-size:var(--step-0); margin:.3rem 0; }
.meetup-overview-plan .meetup-overview-plan__concert, .meetup-overview-plan .meetup-overview-plan__selection { color:var(--text-100); }
.meetup-overview-plan__status { color:var(--accent-400); font-size:.8rem; font-weight:600; }
.meetup-overview-plan--confirmed { border-left-color:var(--mint-400); }
.meetup-overview-plan--confirmed .meetup-overview-plan__status { color:var(--mint-400); }
.meetup-overview-plan--cancelled { border-left-color:var(--text-400); }
.meetup-overview-plan--cancelled .meetup-overview-plan__status { color:var(--text-300); }
.meetup-overview-plan > .btn { flex-shrink:0; }
@media(max-width:620px) { .meetup-overview-plan { align-items:start; flex-direction:column; padding:1rem; } .meetup-overview-plan > .btn { align-self:start; } }
</style>
