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
const attempt = ref(null), pending = ref(false);
let submission = 0;
const requestId = () => globalThis.crypto?.randomUUID?.() ?? `plan_${Date.now()}_${Math.random().toString(36).slice(2)}`;
const replayAttempt = computed(() => ['uncertain', 'created'].includes(attempt.value?.outcome));
const submitting = computed(() => props.busy || pending.value);
const submitLabel = computed(() => {
  if (submitting.value) return attempt.value?.outcome === 'created' ? 'Opening created plan…'
    : replayAttempt.value ? 'Checking previous attempt…' : 'Creating planning board…';
  return attempt.value?.outcome === 'created' ? 'Open created plan'
    : replayAttempt.value ? 'Check previous attempt' : 'Create planning board';
});
const attemptNotice = computed(() => attempt.value?.outcome === 'created'
  ? 'Your planning board was created. Open it to continue; this will not create another board. Current field edits are not sent.'
  : replayAttempt.value
    ? 'The last request may have created a board. Check that attempt before creating another. The check uses your previous submission; current field edits are not sent.'
    : '');
const shiftedInput = (epoch, shift) => Number.isFinite(epoch) ? singaporeInputValue(epoch + shift) : '';
const validationError = computed(() => {
  if (!attempted.value && (!form.startsAt || !form.endsAt)) return '';
  return meetupErrorMessage(validateMeetupWindow(`${form.startsAt}+08:00`, `${form.endsAt}+08:00`, props.context.concert).error);
});

// Routine context refreshes must not overwrite an in-progress creation draft.
// The page keys this form by the authenticated meetup scope as well.
watch(() => props.context.concert?.id, () => {
  submission++; attempt.value = null; pending.value = false;
  attempted.value = false;
  Object.assign(form, { title: 'Meet before the concert',
    startsAt: singaporeInputValue(props.context.policy.defaultStartsAt),
    endsAt: singaporeInputValue(props.context.policy.defaultEndsAt) });
}, { immediate: true });

function submit() {
  attempted.value = true;
  if (submitting.value || !props.context.capabilities.canCreate || !props.context.policy.canSchedule) return;
  if (!replayAttempt.value) {
    if (validationError.value || !form.title.trim()) return;
    const payload = { title: form.title, ...(props.additionalPlan ? { createAnother: true } : {}),
      startsAt: new Date(parseSingaporeInput(form.startsAt)).toISOString(),
      endsAt: new Date(parseSingaporeInput(form.endsAt)).toISOString() };
    // Match the server's normalized fingerprint. Only a settled, definitely
    // rejected attempt may become a new intention when these details change.
    const fingerprint = JSON.stringify([payload.title.trim(), payload.startsAt, payload.endsAt, payload.createAnother === true]);
    if (!attempt.value || attempt.value.fingerprint !== fingerprint)
      attempt.value = { fingerprint, payload: { ...payload, creationRequestId: requestId() }, outcome: null };
  }
  const current = attempt.value, generation = ++submission;
  pending.value = true;
  emit('submit', { ...current.payload }, outcome => {
    if (generation !== submission || !pending.value) return;
    // A later failed retry cannot prove an earlier lost response created
    // nothing. Keep replaying that original identity until it is confirmed.
    if (outcome === 'created') current.outcome = 'created';
    else if (!['uncertain', 'created'].includes(current.outcome))
      current.outcome = outcome === 'rejected' ? 'rejected' : 'uncertain';
    pending.value = false;
  });
}
</script>

<template>
  <form class="card group-panel" :aria-busy="submitting" @submit.prevent="submit">
    <h2>{{ additionalPlan ? 'Create a separate meetup plan' : 'Create a meetup plan' }}</h2>
    <p v-if="additionalPlan" class="group-muted">This won’t change your existing plan.</p>
    <div class="meetup-concert-context">
      <strong>{{ context.concert?.artist }} · {{ context.concert?.event_date }}</strong>
      <span>{{ context.concert?.venue }}</span>
      <span v-if="context.policy.hasVerifiedStart">Verified concert start: {{ formatMeetupDateTime(context.policy.concertStartAt) }}</span>
      <p>{{ context.policy.message }}</p>
    </div>
    <label>Title<input v-model="form.title" maxlength="120" required /></label>
    <label>Earliest meeting time<input
      v-model="form.startsAt" type="datetime-local"
      :min="singaporeInputValue(context.policy.minimumStartsAt)"
      :max="shiftedInput(context.policy.maximumEndsAt, -1800000)"
      :aria-invalid="Boolean(validationError)" aria-describedby="meetup-creation-validation"
      step="1800" required /></label>
    <label>Latest meeting time<input
      v-model="form.endsAt" type="datetime-local"
      :min="shiftedInput(context.policy.minimumStartsAt, 1800000)"
      :max="singaporeInputValue(context.policy.maximumEndsAt)"
      :aria-invalid="Boolean(validationError)" aria-describedby="meetup-creation-validation"
      step="1800" required /></label>
    <p id="meetup-creation-validation" :class="{ 'group-error': validationError }" :role="validationError ? 'alert' : 'status'">{{ validationError || (!context.policy.canSchedule ? 'There is no future pre-concert window left for this concert.' : 'Singapore time, on the concert day or the day before. Everyone then marks when they’re free in this window.') }}</p>
    <p v-if="attemptNotice" id="meetup-creation-attempt" class="group-muted" role="status">{{ attemptNotice }}</p>
    <p v-if="error" class="group-error" role="alert">{{ error }}</p>
    <button type="submit" class="btn btn--primary" :formnovalidate="replayAttempt"
      :aria-describedby="attemptNotice ? 'meetup-creation-attempt' : undefined"
      :disabled="submitting || (!replayAttempt && Boolean(validationError)) || !context.policy.canSchedule || !context.capabilities.canCreate">{{ submitLabel }}</button>
  </form>
</template>

<style scoped>
.meetup-concert-context { display: grid; gap: .45rem; padding: 1rem; border-left: 2px solid var(--mint-400); background: var(--ink-850); }
.meetup-concert-context > span { color: var(--text-300); font-size: var(--step--1); }
</style>
