<script setup>
import { computed } from 'vue';
import { useScopedMeetupSummary } from '../composables/useMeetupSummaries.js';
import { meetupRouteForBoard, meetupRouteForScope } from '../utils/meetupNavigation.js';
import { meetupPresentation, meetupSelectedDetails } from '../utils/meetupSummaries.js';
import { useConcertEligibility } from '../composables/useConcertEligibility.js';

const props = defineProps({ scope: { type: Object, required: true }, label: { type: String, default: 'Meetup planner for this conversation' }, from: { type: String, default: 'conversation' } });
const { plan, context, scope, scopedPlans, statusLoading, statusError, refresh } = useScopedMeetupSummary(() => props.scope);
const presentation = computed(() => plan.value ? meetupPresentation(plan.value) : null);
const { canPlanMeetup } = useConcertEligibility(() => context.value?.concert);
const planningClosed = computed(() => context.value?.policy?.canSchedule === false || Boolean(context.value?.concert) && !canPlanMeetup.value);
const canStart = computed(() => context.value?.capabilities.canCreate && !planningClosed.value);
const scopeRoute = computed(() => meetupRouteForScope(scope.value, { from: props.from === 'conversation' ? undefined : props.from }));
</script>

<template>
  <!-- One slim line above the chat: where the plan stands and the next step. -->
  <section class="meetup-entry" :class="`meetup-entry--${plan?.status ?? 'empty'}`" :aria-label="label" :aria-busy="statusLoading">
    <svg class="meetup-entry__icon" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4M17 3v4M3 11h18M8 15h3M8 18h6"/></svg>
    <p class="meetup-entry__copy" aria-live="polite">
      <template v-if="plan"><span class="meetup-entry__status">{{ presentation.label }}</span><strong>{{ plan.title }}</strong><span class="meetup-entry__detail">{{ plan.status === 'proposed' ? presentation.detail : meetupSelectedDetails(plan) || presentation.detail }}</span></template>
      <template v-else-if="statusLoading"><strong>Meetup</strong><span class="meetup-entry__detail">Checking…</span></template>
      <template v-else-if="statusError"><strong>Meetup status unavailable</strong></template>
      <template v-else-if="planningClosed"><strong>Pre-concert planning is closed</strong></template>
      <template v-else-if="canStart"><strong>No meetup yet</strong><span class="meetup-entry__detail">Find a time and place together.</span></template>
      <template v-else><strong>Planning has not started</strong><span class="meetup-entry__detail">The host can start a plan.</span></template>
    </p>
    <div class="meetup-entry__actions">
      <RouterLink v-if="plan && scopedPlans.length > 1" class="meetup-entry__more" :to="scopeRoute">{{ scopedPlans.length }} plans</RouterLink>
      <RouterLink v-if="plan" class="btn btn--primary" :to="meetupRouteForBoard(plan, { from, stage: presentation.stage })">{{ presentation.action }}</RouterLink>
      <button v-else-if="statusError" type="button" class="btn btn--ghost" @click="refresh">Retry meetup status</button>
      <RouterLink v-else-if="!statusLoading && canStart" class="btn btn--primary" :to="scopeRoute">Create meetup plan</RouterLink>
    </div>
  </section>
</template>

<style scoped>
.meetup-entry { display:flex; align-items:center; gap:.65rem; flex-shrink:0; min-width:0; margin-block:.4rem; padding:.45rem .5rem .45rem .85rem; border:var(--border-soft); border-left:3px solid var(--accent-400); border-radius:var(--radius-pill); background:var(--ink-850); }
.meetup-entry__icon { width:20px; height:20px; stroke:var(--accent-400); stroke-width:1.6; stroke-linecap:round; flex:none; }
.meetup-entry__copy { flex:1 1 auto; min-width:0; margin:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:var(--step--1); color:var(--text-300); }
.meetup-entry__copy strong { color:var(--text-100); }
.meetup-entry__status { margin-right:.5rem; color:var(--accent-400); font-weight:650; }
.meetup-entry__detail::before { content:' · '; }
.meetup-entry--confirmed { border-left-color:var(--mint-400); }
.meetup-entry--confirmed .meetup-entry__status { color:var(--mint-400); }
.meetup-entry--cancelled { border-left-color:var(--text-400); }
.meetup-entry--cancelled .meetup-entry__status { color:var(--text-300); }
.meetup-entry__actions { display:flex; align-items:center; gap:.5rem; flex:none; }
.meetup-entry__actions .btn { min-height:2.5rem; padding-inline:1rem; font-size:var(--step--1); white-space:nowrap; }
.meetup-entry__more { font-size:var(--step--1); color:var(--text-300); text-underline-offset:3px; white-space:nowrap; }
/* Narrow screens: the text gets the full line and the button sits beneath it. */
@media(max-width:520px) {
  .meetup-entry { flex-wrap:wrap; border-radius:var(--radius-md); }
  .meetup-entry__copy { flex-basis:calc(100% - 32px); white-space:normal; }
  .meetup-entry__actions { width:100%; justify-content:flex-end; }
}
</style>
