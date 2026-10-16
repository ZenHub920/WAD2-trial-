<script setup>
import { ref } from 'vue';
import { api } from '../api.js';

// ============================================================
// POST-CONCERT FEEDBACK
// ============================================================
//
// The parent provides:
// - The matching round ID
// - The user receiving feedback
//
// The server verifies:
// - The concert has ended
// - Both users were authorized confirmed participants
// - Feedback was not previously submitted

const props = defineProps({
  roundId: {
    type: String,
    required: true
  },

  ratedUserId: {
    type: String,
    required: true
  }
});

const showedUp = ref(true);
const rating = ref(4);
const comment = ref('');
const status = ref('');
const submitting = ref(false);

async function submit() {

  if (submitting.value) {
    return;
  }

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

    status.value = err.message;

  } finally {

    submitting.value = false;

  }
}
</script>

<template>
  <form @submit.prevent="submit">

    <h3>Post-concert feedback</h3>

    <label>
      <input
        v-model="showedUp"
        type="checkbox"
      />

      Attended the concert
    </label>

    <label>
      Communication rating

      <select v-model.number="rating">

        <option
          v-for="n in 5"
          :key="n"
          :value="n"
        >
          {{ n }}
        </option>

      </select>
    </label>

    <label>
      Comments

      <textarea
        v-model.trim="comment"
        maxlength="500"
      />
    </label>

    <button
      type="submit"
      class="btn btn--primary"
      :disabled="submitting"
    >
      Submit feedback
    </button>

    <p role="status">
      {{ status }}
    </p>

  </form>
</template>