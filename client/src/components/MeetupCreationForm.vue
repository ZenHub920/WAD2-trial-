<script setup>
import { computed, reactive, ref, watch } from 'vue';
import { parseSingaporeInput, singaporeInputValue, validateMeetupWindow } from '../../../shared/meetupDates.mjs';
import { meetupErrorMessage } from '../utils/meetupFeedback.js';
import { formatMeetupDateTime } from '../utils/meetupTime.js';

const props = defineProps({
  context: { type: Object, required: true },
  busy: { type: Boolean, default: false },
  error: { type: String, default: '' },
  additionalPlan: { type: Boolean, default: false },
});
const emit = defineEmits(['submit']);
const form = reactive({ title: 'Meet before the concert', startsAt: '', endsAt: '' });
const attempted = ref(false);
// A failed or retried submission keeps its identity even if the response is lost.
const creationRequestId = globalThis.crypto?.randomUUID?.() ?? `plan_${Date.now()}_${Math.random().toString(36).slice(2)}`;
const shiftedInput = (epoch, shift) => Number.isFinite(epoch) ? singaporeInputValue(epoch + shift) : '';
const validationError = computed(() => {
  if (!attempted.value && (!form.startsAt || !form.endsAt)) return '';
  return meetupErrorMessage(validateMeetupWindow(`${form.startsAt}+08:00`, `${form.endsAt}+08:00`, props.context.concert).error);
});

// Routine context refreshes must not overwrite an in-progress creation draft.
// The page keys this form by the authenticated meetup scope as well.
watch(() => props.context.concert?.id, () => {
  attempted.value = false;
  Object.assign(form, { title: 'Meet before the concert',
    startsAt: singaporeInputValue(props.context.policy.defaultStartsAt),
    endsAt: singaporeInputValue(props.context.policy.defaultEndsAt) });
}, { immediate: true });

function submit() {
  attempted.value = true;
  if (props.busy || !props.context.capabilities.canCreate || !props.context.policy.canSchedule || validationError.value) return;
  emit('submit', { title: form.title,
    creationRequestId, ...(props.additionalPlan ? { createAnother: true } : {}),
    startsAt: new Date(parseSingaporeInput(form.startsAt)).toISOString(),
    endsAt: new Date(parseSingaporeInput(form.endsAt)).toISOString() });
}
</script>

<template>
  <form class="card group-panel" @submit.prevent="submit">
    <h2>{{ additionalPlan ? 'Create a separate meetup plan' : 'Create a meetup plan' }}</h2>
    <p v-if="additionalPlan" class="group-muted">An active plan already exists. This creates a separate arrangement; it does not change or reopen the existing plan.</p>
    <div class="meetup-concert-context">
      <strong>{{ context.concert?.artist }} · {{ context.concert?.event_date }}</strong>
      <span>{{ context.concert?.venue }}</span>
      <span v-if="context.policy.hasVerifiedStart">Verified concert start: {{ formatMeetupDateTime(context.policy.concertStartAt) }}</span>
      <p>{{ context.policy.message }}</p>
    </div>
    <p class="group-muted">Choose a window in 30-minute steps. Companions can then paint when they are free.</p>
    <label>Title<input v-model="form.title" maxlength="120" required /></label>
    <label>First possible meeting time (Singapore time)<input
      v-model="form.startsAt" type="datetime-local"
      :min="singaporeInputValue(context.policy.minimumStartsAt)"
      :max="shiftedInput(context.policy.maximumEndsAt, -1800000)"
      :aria-invalid="Boolean(validationError)" aria-describedby="meetup-creation-validation"
      step="1800" required /></label>
    <label>End of availability window (Singapore time)<input
      v-model="form.endsAt" type="datetime-local"
      :min="shiftedInput(context.policy.minimumStartsAt, 1800000)"
      :max="singaporeInputValue(context.policy.maximumEndsAt)"
      :aria-invalid="Boolean(validationError)" aria-describedby="meetup-creation-validation"
      step="1800" required /></label>
    <p id="meetup-creation-validation" :class="{ 'group-error': validationError }" :role="validationError ? 'alert' : 'status'">{{ validationError || (!context.policy.canSchedule ? 'There is no future pre-concert window left for this concert.' : 'Times shown in Singapore time. Start and end must stay within the concert day or preceding travel day.') }}</p>
    <p v-if="error" class="group-error" role="alert">{{ error }}</p>
    <button class="btn btn--primary" :disabled="busy || Boolean(validationError) || !context.policy.canSchedule">Create planning board</button>
  </form>
</template>

<style scoped>
.meetup-concert-context { display: grid; gap: .45rem; padding: 1rem; border-left: 2px solid var(--mint-400); background: var(--ink-850); }
.meetup-concert-context > span { color: var(--text-300); font-size: var(--step--1); }
</style>
