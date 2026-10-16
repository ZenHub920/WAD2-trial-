<script setup>
import { ref } from 'vue';
import { api } from '../api.js';
import FeedbackForm from './FeedbackForm.vue';

// ============================================================
// PROPS AND EVENTS
// ============================================================
//
// The parent provides a proposal object returned by SQLite.
//
// After an action, the component emits 'updated' so the
// parent can reload the current proposal state.

const props = defineProps({
  proposal: {
    type: Object,
    required: true
  }
});

const emit = defineEmits(['updated']);

const busy = ref(false);
const error = ref('');
const explanation = ref(null);

// ============================================================
// ACCEPT / DECLINE PROPOSAL
// ============================================================

async function respond(action) {

  // Prevent duplicate submissions from repeated clicks.
  if (busy.value) return;

  busy.value = true;
  error.value = '';

  try {

    if (action === 'accept') {

      await api.acceptProposal(props.proposal.id);

    } else {

      await api.declineProposal(props.proposal.id);

    }

    // Parent reloads current operational state from SQLite.
    emit('updated');

  } catch (err) {

    error.value = err.message;

  } finally {

    busy.value = false;

  }
}

// ============================================================
// HISTORICAL MATCH EXPLANATION
// ============================================================
//
// Uses saved score_breakdown_json.
// Does not recalculate scores from current profiles.

async function explain() {

  error.value = '';

  try {

    const response =
      await api.proposalExplanation(props.proposal.id);

    explanation.value = response.explanation;

  } catch (err) {

    error.value = err.message;

  }
}
</script>

<template>
  <article class="proposal card">

    <h3>
      {{ proposal.artist }}
      —
      {{ proposal.hostName }}'s group
    </h3>

    <!-- Hosts can see which seeker received an offer. -->
    <p v-if="proposal.role === 'host'">
      Seeker: {{ proposal.seekerName }}
    </p>

    <p>
      Section: {{ proposal.section }}
    </p>

    <p>
      Status:
      <strong>{{ proposal.status }}</strong>
    </p>

    <!-- Pending offers have a 48-hour response deadline. -->
    <p v-if="proposal.status === 'proposed'">
      Reply before
      {{ new Date(proposal.expiresAt).toLocaleString() }}
    </p>

    <!-- Only the seeker can accept or decline. -->
    <div
      v-if="
        proposal.status === 'proposed'
        && proposal.role !== 'host'
      "
      class="actions"
    >

      <button
        class="btn btn--primary"
        :disabled="busy"
        @click="respond('accept')"
      >
        Accept
      </button>

      <button
        class="btn btn--ghost"
        :disabled="busy"
        @click="respond('decline')"
      >
        Decline
      </button>

    </div>

    <!-- Attendance feedback is available after the concert.
         The backend still verifies eligibility independently. -->
    <FeedbackForm
      v-if="
        proposal.status === 'confirmed'
        && new Date(proposal.eventDate + 'T23:59:59+08:00')
          < new Date()
      "
      :round-id="proposal.roundId"
      :rated-user-id="
        proposal.role === 'host'
          ? proposal.seekerUserId
          : proposal.hostUserId
      "
    />

    <!-- Historical explanation -->
    <button
      class="btn btn--ghost"
      @click="explain"
    >
      Why this match?
    </button>

    <div
      v-if="explanation"
      class="details"
    >

      <p>
        Seeker compatibility:
        {{ explanation.seekerScore?.toFixed(2) ?? 'N/A' }}
      </p>

      <p>
        Group compatibility:
        {{ explanation.partyScore?.toFixed(2) ?? 'N/A' }}
      </p>

      <pre v-if="explanation.breakdown">{{
        JSON.stringify(explanation.breakdown, null, 2)
      }}</pre>

      <p v-else>
        No historical breakdown is stored for this round.
      </p>

    </div>

    <p
      v-if="error"
      role="alert"
    >
      {{ error }}
    </p>

  </article>
</template>

<style scoped>
.proposal {
  padding: 1rem;
  margin-block: 1rem;
}

.actions {
  display: flex;
  gap: 0.75rem;
  margin-block: 0.75rem;
}

.details pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>