<script setup>
import { computed, ref } from 'vue';
import { api, LABELS } from '../api.js';
import FeedbackForm from './FeedbackForm.vue';
import LoadingSpinner from './LoadingSpinner.vue';

const props = defineProps({ proposal: { type: Object, required: true } });

const emit = defineEmits(['updated']);

const busy = ref(false);
const responding = ref('');
const explanationLoading = ref(false);
const error = ref('');
const explanation = ref(null);
const statuses = { proposed: 'Awaiting both approvals', confirmed: 'Group place confirmed', declined: 'Declined', expired: 'Expired', cancelled: 'Cancelled' };
const isHost = computed(() => props.proposal.role === 'host');
const myApproval = computed(() => isHost.value ? props.proposal.hostApproved : props.proposal.seekerApproved);

async function respond(action) {
  if (busy.value) return;

  busy.value = true;
  responding.value = action;
  error.value = '';

  try {
    if (action === 'accept') await api.acceptProposal(props.proposal.id);
    else await api.declineProposal(props.proposal.id);
    emit('updated');
  } catch (err) {
    error.value = err.status === 409 ? 'This proposal has changed or expired. Refresh your proposals before replying.' : 'Could not update this proposal. Please try again.';
  } finally {
    busy.value = false;
    responding.value = '';
  }
}

// Explanations use saved scores, not the user's current profile.
async function explain() {
  if (explanationLoading.value) return;
  explanationLoading.value = true;
  error.value = '';
  try {
    const response = await api.proposalExplanation(props.proposal.id);
    explanation.value = response.explanation;
  } catch (err) {
    error.value = 'Could not load the saved match explanation. Please try again.';
  } finally {
    explanationLoading.value = false;
  }
}
</script>

<template>
  <article class="proposal card">
    <h3>{{ proposal.artist }}, {{ proposal.hostName }}'s group</h3>
    <p v-if="proposal.role === 'host'">Proposed companion: {{ proposal.seekerName }}</p>
    <p>Section: {{ LABELS.section[proposal.section] ?? proposal.section }}</p>
    <p>Status: <strong>{{ statuses[proposal.status] ?? 'Proposal updated' }}</strong></p>
    <p v-if="proposal.status === 'proposed'">Host: {{ proposal.hostApproved ? 'Approved' : 'Awaiting approval' }} · Companion: {{ proposal.seekerApproved ? 'Approved' : 'Awaiting approval' }}</p>
    <p v-if="proposal.status === 'proposed'">
      Both people must approve before {{ new Date(proposal.expiresAt).toLocaleString() }}. The place stays reserved while approval is pending. This offer is for a group place, not a ticket.
    </p>
    <p v-if="proposal.status === 'proposed' && myApproval" role="status">You approved this match. Waiting for {{ isHost ? 'the companion' : 'the host' }} to approve.</p>
    <div v-if="proposal.status === 'proposed'" class="actions">
      <button v-if="!myApproval" class="btn btn--success" :disabled="busy" @click="respond('accept')"><LoadingSpinner v-if="busy && responding === 'accept'" />{{ isHost ? 'Approve match' : 'Accept offer' }}</button>
      <button class="btn btn--danger-ghost" :disabled="busy" @click="respond('decline')"><LoadingSpinner v-if="busy && responding === 'decline'" />Decline proposal</button>
    </div>
    <FeedbackForm
      v-if="proposal.status === 'confirmed' && new Date(proposal.eventDate + 'T23:59:59+08:00') < new Date()"
      :round-id="proposal.roundId"
      :rated-user-id="proposal.role === 'host' ? proposal.seekerUserId : proposal.hostUserId"
    />
    <button class="btn btn--ghost" :disabled="busy || explanationLoading" @click="explain"><LoadingSpinner v-if="explanationLoading" />Why this group match?</button>
    <div v-if="explanation" class="details">
      <p>Companion compatibility score: {{ explanation.seekerScore?.toFixed(2) ?? 'Unavailable' }}</p>
      <p>Group compatibility score: {{ explanation.partyScore?.toFixed(2) ?? 'Unavailable' }}</p>
    </div>
    <p v-if="error" role="alert">{{ error }}</p>
  </article>
</template>

<style scoped>
.proposal {
  display: grid;
  gap: var(--space-3);
  min-width: 0;
  overflow-wrap: anywhere;
  padding: 1rem;
  margin-block: 1rem;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-block: 0.75rem;
}
.proposal h3 { font-size: var(--step-1); }
.proposal > .btn { justify-self: start; white-space: normal; }
.proposal .btn { white-space: normal; }

</style>
