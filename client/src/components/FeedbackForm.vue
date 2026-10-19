<script setup>
import { ref } from 'vue';
import { api } from '../api.js';
import LoadingSpinner from './LoadingSpinner.vue';

const props = defineProps({
  roundId: { type: String, required: true },
  ratedUserId: { type: String, required: true },
});

const showedUp = ref(true);
const rating = ref(4);
const comment = ref('');
const status = ref('');
const submitting = ref(false);

async function submit() {
  if (submitting.value) return;
  submitting.value = true;
  status.value = '';

  try {
    await api.leaveFeedback({
      roundId: props.roundId,
      ratedUserId: props.ratedUserId,
      showedUp: showedUp.value,
      rating: rating.value,
      comment: comment.value
    });
    status.value = 'Feedback recorded.';
  } catch (err) {
    status.value = err.status === 409 ? 'Feedback is already recorded or is not available for this concert yet.' : 'Could not submit feedback. Please try again.';
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <form class="feedback-form" @submit.prevent="submit">
    <h3>Post-concert feedback</h3>
    <label class="feedback-form__check">
      <input v-model="showedUp" type="checkbox" :disabled="submitting" />
      Attended the concert
    </label>
    <label>
      Communication rating
      <select v-model.number="rating" :disabled="submitting">
        <option v-for="n in 5" :key="n" :value="n">{{ n }}</option>
      </select>
    </label>
    <label>
      Comments
      <textarea v-model.trim="comment" maxlength="500" :disabled="submitting" rows="3" />
    </label>
    <button type="submit" class="btn btn--primary" :disabled="submitting"><LoadingSpinner v-if="submitting" />Submit feedback</button>
    <p v-if="status" role="status">{{ status }}</p>
  </form>
</template>

<style scoped>
.feedback-form { display: grid; gap: var(--space-3); min-width: 0; padding-block: var(--space-4); border-top: var(--border-hairline); }
.feedback-form h3 { font-size: var(--step-1); }
.feedback-form label { display: grid; gap: var(--space-2); min-width: 0; }
.feedback-form .feedback-form__check { display: flex; align-items: center; gap: var(--space-2); }
.feedback-form textarea { box-sizing: border-box; width: 100%; min-width: 0; padding: var(--space-3); border: var(--border-soft); border-radius: var(--radius-sm); background: var(--ink-700); color: var(--text-100); }
.feedback-form > .btn { justify-self: start; white-space: normal; }
.feedback-form textarea { resize: vertical; }
</style>