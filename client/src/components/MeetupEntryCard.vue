<script setup>
import { computed } from 'vue';
import { useScopedMeetupSummary } from '../composables/useMeetupSummaries.js';
import { meetupRouteForBoard, meetupRouteForScope } from '../utils/meetupNavigation.js';
import { meetupPresentation, meetupSelectedDetails } from '../utils/meetupSummaries.js';

const props = defineProps({ scope: { type: Object, required: true }, label: { type: String, default: 'Meetup planner for this conversation' } });
const { plan, context, scope, scopedPlans, statusLoading, statusError, refresh } = useScopedMeetupSummary(() => props.scope);
const presentation = computed(() => plan.value ? meetupPresentation(plan.value) : null);
</script>

<template>
  <section class="meetup-entry" :class="`meetup-entry--${plan?.status ?? 'empty'}`" :aria-label="label" :aria-busy="statusLoading">
    <svg class="meetup-entry__icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4M17 3v4M3 11h18M8 15h3M8 18h6"/></svg>
    <div class="meetup-entry__copy" aria-live="polite">
      <template v-if="plan"><span class="meetup-entry__status">{{ presentation.label }}</span><strong>{{ plan.title }}</strong><p>{{ meetupSelectedDetails(plan) || presentation.detail }}</p><p v-if="plan.status === 'proposed' && meetupSelectedDetails(plan)">{{ presentation.detail }}</p></template>
      <template v-else-if="statusLoading"><strong>Meetup planning</strong><p>Checking this conversation’s plans…</p></template>
      <template v-else-if="statusError"><strong>Meetup status unavailable</strong><p>{{ statusError }}</p></template>
      <template v-else-if="context?.capabilities.canCreate"><strong>Bring everyone together</strong><p>Find a shared time and place before the concert.</p></template>
      <template v-else><strong>Planning has not started</strong><p>Your group host can create a plan. You can then share your availability.</p></template>
    </div>
    <div class="meetup-entry__actions">
      <RouterLink v-if="plan" class="btn btn--ghost" :to="meetupRouteForBoard(plan, { stage: presentation.stage })">{{ presentation.action }}</RouterLink>
      <button v-else-if="statusError" type="button" class="btn btn--ghost" @click="refresh">Retry meetup status</button>
      <RouterLink v-else-if="!statusLoading && context?.capabilities.canCreate" class="btn btn--ghost" :to="meetupRouteForScope(scope)">Create meetup plan</RouterLink>
      <RouterLink v-if="plan" class="meetup-entry__more" :to="meetupRouteForScope(scope)">{{ scopedPlans.length > 1 ? `${scopedPlans.length} plans for this conversation` : 'Plans & options' }}</RouterLink>
    </div>
  </section>
</template>

<style scoped>
.meetup-entry { display:flex; align-items:center; flex-wrap:wrap; flex-shrink:0; gap:.75rem; margin-block:.6rem; padding:.85rem 1rem; border:var(--border-soft); border-left:2px solid var(--accent-400); border-radius:var(--radius-md); background:var(--ink-850); box-shadow:inset 0 1px 0 var(--panel-highlight); min-width:0; }
.meetup-entry__icon { width:23px; height:23px; stroke:var(--accent-400); stroke-width:1.5; stroke-linecap:round; flex:none; }
.meetup-entry__copy { flex:1 1 12rem; min-width:0; }
.meetup-entry__copy strong { display:block; font-size:var(--step--1); color:var(--text-100); overflow-wrap:anywhere; }
.meetup-entry__copy p { margin:.2rem 0 0; color:var(--text-300); font-size:var(--step--1); overflow-wrap:anywhere; line-height:1.5; }
.meetup-entry__status { display:block; color:var(--accent-400); font-size:.8rem; letter-spacing:.03em; font-weight:600; margin-bottom:.15rem; }
.meetup-entry--confirmed { border-left-color:var(--mint-400); }
.meetup-entry--confirmed .meetup-entry__status { color:var(--mint-400); }
.meetup-entry--cancelled { border-left-color:var(--text-400); }
.meetup-entry--cancelled .meetup-entry__status { color:var(--text-300); }
.meetup-entry__actions { display:grid; justify-items:end; gap:.4rem; }
.meetup-entry__actions .btn { min-height:2.75rem; font-size:var(--step--1); }
.meetup-entry__more { display:inline-flex; align-items:center; min-height:2.75rem; font-size:var(--step--1); color:var(--text-300); text-underline-offset:3px; }
@media(max-width:480px) { .meetup-entry { gap:.6rem; padding:.75rem; } .meetup-entry__copy { flex-basis:calc(100% - 38px); } .meetup-entry__actions { width:100%; justify-items:start; padding-left:2rem; } }
</style>
