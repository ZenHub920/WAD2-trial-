<script setup>
import { ref } from 'vue';
import { api, LABELS } from '../api.js';
import FeedbackForm from './FeedbackForm.vue';

const props = defineProps({ proposal: { type: Object, required: true } });

const emit = defineEmits(['updated']);

const busy = ref(false);
const error = ref('');
const explanation = ref(null);

async function respond(action) {
  if (busy.value) return;

  busy.value = true;
  error.value = '';

  try {
    if (action === 'accept') await api.acceptProposal(props.proposal.id);
    else await api.declineProposal(props.proposal.id);
    emit('updated');
  } catch (err) {
    error.value = err.message;
  } finally {
    busy.value = false;
  }
}

// Explanations use saved scores, not the user's current profile.
async function explain() {
  error.value = '';
  try {
    const response = await api.proposalExplanation(props.proposal.id);
    explanation.value = response.explanation;
  } catch (err) {
    error.value = err.message;
  }
}
</script>

<template>
  <article class="proposal card">
    <h3>{{ proposal.artist }}, {{ proposal.hostName }}'s group</h3>
    <p v-if="proposal.role === 'host'">Seeker: {{ proposal.seekerName }}</p>
    <p>Section: {{ LABELS.section[proposal.section] ?? proposal.section }}</p>
    <p>Status: <strong>{{ proposal.status }}</strong></p>
    <p v-if="proposal.status === 'proposed'">
      Reply before {{ new Date(proposal.expiresAt).toLocaleString() }}
    </p>
    <div v-if="proposal.status === 'proposed' && proposal.role !== 'host'" class="actions">
      <button class="btn btn--primary" :disabled="busy" @click="respond('accept')">Accept</button>
      <button class="btn btn--ghost" :disabled="busy" @click="respond('decline')">Decline</button>
    </div>
    <FeedbackForm
      v-if="proposal.status === 'confirmed' && new Date(proposal.eventDate + 'T23:59:59+08:00') < new Date()"
      :round-id="proposal.roundId"
      :rated-user-id="proposal.role === 'host' ? proposal.seekerUserId : proposal.hostUserId"
    />
    <button class="btn btn--ghost" @click="explain">Why this match?</button>
    <div v-if="explanation" class="details">
      <p>Seeker compatibility: {{ explanation.seekerScore?.toFixed(2) ?? 'N/A' }}</p>
      <p>Group compatibility: {{ explanation.partyScore?.toFixed(2) ?? 'N/A' }}</p>
    </div>
    <p v-if="error" role="alert">{{ error }}</p>
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

</style>