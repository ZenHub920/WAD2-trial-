<script setup>
import { computed, ref } from 'vue';
import { api, LABELS } from '../api.js';
import FeedbackForm from './FeedbackForm.vue';
import LoadingSpinner from './LoadingSpinner.vue';
import GroupAvatar from './GroupAvatar.vue';

const props = defineProps({ proposal: { type: Object, required: true } });

const emit = defineEmits(['updated']);

const busy = ref(false);
const responding = ref('');
const explanationLoading = ref(false);
const error = ref('');
const explanation = ref(null);
const explanationOpen = ref(false);
const statuses = { confirmed: 'Place confirmed', declined: 'Declined', expired: 'Expired', cancelled: 'Cancelled' };
const isHost = computed(() => props.proposal.role === 'host');
const myApproval = computed(() => isHost.value ? props.proposal.hostApproved : props.proposal.seekerApproved);
const readyToReview = computed(() => props.proposal.canHostRespond !== false && props.proposal.queueStatus !== 'waiting');
const held = computed(() => props.proposal.seatReserved ?? props.proposal.queueStatus !== 'waiting');
const groupName = computed(() => props.proposal.groupName || `${props.proposal.hostName}'s group`);
const statusLabel = computed(() => {
  if (props.proposal.resolutionReason === 'group_full') return 'Group filled before your turn';
  if (props.proposal.status !== 'proposed') return statuses[props.proposal.status] ?? 'Proposal updated';
  if (!readyToReview.value) return 'Waiting in queue';
  if (myApproval.value) return isHost.value ? 'Waiting for companion' : 'Waiting for host';
  return 'Ready for your reply';
});
const deadline = computed(() => {
  const date = new Date(props.proposal.expiresAt);
  return Number.isNaN(date.getTime()) ? 'Check the latest proposal' : date.toLocaleString('en-SG', {
    day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
  });
});
const matchReasons = computed(() => {
  const saved = explanation.value?.breakdown;
  const reasons = (saved?.discovery?.reasons ?? props.proposal.reasons ?? []).map(reason => reason.label).filter(Boolean);
  const components = saved?.components ?? {};
  // Fall back only to positive evidence recorded with this matching round.
  const supported = [
    [components.vibe >= 0.8, 'Similar concert energy'],
    [components.section === 1, 'Same preferred section'],
    [components.arrival === 1, 'Matching arrival plans'],
    [components.plans >= 0.75, 'Shared plans around the concert'],
    [components.language === 1, 'A language in common'],
    [components.budgetFit === 1, 'Matching budget preferences'],
  ];
  return [...new Set([...reasons, ...supported.filter(([matches]) => matches).map(([, label]) => label)])].slice(0, 3);
});

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
    error.value = err.status === 409 ? 'This proposal is not ready for a reply, changed or expired. Refresh the queue before replying.' : 'Could not update this proposal. Please try again.';
  } finally {
    busy.value = false;
    responding.value = '';
  }
}

// Explanations use saved scores, not the user's current profile.
async function explain() {
  explanationOpen.value = !explanationOpen.value;
  if (!explanationOpen.value || explanation.value) return;
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
  <article class="proposal card" :class="{ 'proposal--confirmed': proposal.status === 'confirmed' }">
    <header class="proposal__head">
      <GroupAvatar :src="proposal.imageUrl" :name="groupName" :size="48" />
      <div class="proposal__identity">
        <p class="proposal__eyebrow">{{ isHost ? 'Automatic match for your group' : 'Your automatic group match' }}</p>
        <h3>{{ groupName }}</h3>
        <p class="proposal__meta">{{ isHost ? `Proposed companion: ${proposal.seekerName}` : `Hosted by ${proposal.hostName}` }}</p>
      </div>
      <span class="tag proposal__status" :class="{ 'tag--mint': proposal.status === 'confirmed', 'tag--accent': proposal.status === 'proposed' && readyToReview }">{{ statusLabel }}</span>
    </header>

    <div class="proposal__concert">
      <strong>{{ proposal.artist }}</strong>
      <span>{{ LABELS.section[proposal.section] ?? proposal.section }}</span>
    </div>

    <div v-if="matchReasons.length" class="proposal__fit">
      <p class="proposal__label">Why you were matched</p>
      <ul aria-label="Saved match reasons"><li v-for="reason in matchReasons" :key="reason">{{ reason }}</li></ul>
      <p v-if="proposal.confidence === 'limited'" class="proposal__meta">Based on limited preference information.</p>
    </div>

    <template v-if="proposal.status === 'proposed'">
      <div class="proposal__reservation">
        <div>
          <span class="proposal__label">{{ isHost ? 'Group place' : 'Your place' }}</span>
          <strong>{{ held ? 'One place held' : 'Waiting for a place' }}</strong>
          <span class="proposal__meta">Queue position {{ proposal.queuePosition ?? '—' }}{{ readyToReview ? ' · Next to review' : '' }}</span>
        </div>
        <div>
          <span class="proposal__label">Reply before</span>
          <strong>{{ deadline }}</strong>
          <span class="proposal__meta">48-hour window, including queue time</span>
        </div>
      </div>

      <div class="proposal__approvals">
        <p class="proposal__label">Both approvals confirm the group place. Either person can approve first.</p>
        <ul aria-label="Match approval progress">
          <li :class="{ 'is-approved': proposal.hostApproved }"><span class="proposal__check" aria-hidden="true">{{ proposal.hostApproved ? '✓' : '·' }}</span><span><strong>{{ isHost ? 'You · Host' : 'Group host' }}</strong><small>{{ proposal.hostApproved ? 'Approved' : 'Awaiting approval' }}</small></span></li>
          <li :class="{ 'is-approved': proposal.seekerApproved }"><span class="proposal__check" aria-hidden="true">{{ proposal.seekerApproved ? '✓' : '·' }}</span><span><strong>{{ isHost ? proposal.seekerName : 'You · Companion' }}</strong><small>{{ proposal.seekerApproved ? 'Approved' : 'Awaiting approval' }}</small></span></li>
        </ul>
      </div>

      <p v-if="!readyToReview" class="proposal__note">Earlier direct or automatic requests must be resolved first. {{ isHost ? 'Review requests in arrival order.' : 'You can still decline while waiting.' }}</p>
      <p v-else-if="myApproval" class="proposal__note" role="status">Your approval is saved. {{ isHost ? 'The companion still needs to accept.' : 'The host still needs to approve.' }} The place stays held until the deadline.</p>
      <p v-else class="proposal__note">{{ isHost ? 'Approve this companion to join your group.' : 'Like the sound of this group? Accept your offer.' }} {{ (isHost ? proposal.seekerApproved : proposal.hostApproved) ? 'Their approval is already saved; yours will confirm the place.' : 'Their approval is also needed to confirm the place.' }}</p>

      <div class="actions">
        <button v-if="!myApproval" type="button" class="btn btn--primary" :disabled="busy || !readyToReview" @click="respond('accept')"><LoadingSpinner v-if="busy && responding === 'accept'" />{{ isHost ? 'Approve companion' : 'Accept group offer' }}</button>
        <button type="button" class="btn btn--danger-ghost" :disabled="busy || (isHost && !readyToReview)" @click="respond('decline')"><LoadingSpinner v-if="busy && responding === 'decline'" />Decline proposal</button>
      </div>
    </template>
    <p v-else-if="proposal.status === 'confirmed'" class="proposal__note">{{ isHost ? `${proposal.seekerName} is now a member of your group.` : 'Your group place is confirmed. You can find the group under My groups.' }}</p>

    <div class="proposal__explanation">
      <button type="button" class="proposal__why" :disabled="busy || explanationLoading" :aria-expanded="explanationOpen" @click="explain"><LoadingSpinner v-if="explanationLoading" />{{ explanationOpen ? 'Hide match reasons' : 'Why this group match?' }}<span aria-hidden="true">{{ explanationOpen ? '−' : '+' }}</span></button>
      <div v-if="explanationOpen && explanation" class="proposal__reasons">
        <p v-if="!matchReasons.length">No detailed match reasons were saved for this proposal.</p>
        <p>These reasons come from the preferences saved when this match was made. Matching considers both sides' preferences and group capacity.</p>
      </div>
    </div>
    <FeedbackForm
      v-if="proposal.status === 'confirmed' && new Date(proposal.eventDate + 'T23:59:59+08:00') < new Date()"
      :round-id="proposal.roundId"
      :rated-user-id="proposal.role === 'host' ? proposal.seekerUserId : proposal.hostUserId"
    />
    <p class="proposal__footnote">A group place does not include a concert ticket.</p>
    <p v-if="error" class="proposal__error" role="alert">{{ error }}</p>
  </article>
</template>

<style scoped>
.proposal {
  display: grid;
  gap: var(--space-4);
  min-width: 0;
  overflow-wrap: anywhere;
  padding: var(--space-5);
  margin-block: var(--space-4);
}
.proposal :where(p, h3, ol, ul) { margin: 0; }
.proposal--confirmed { border-color: color-mix(in oklab, var(--mint-400) 45%, var(--ink-600)); }
.proposal__head { display: flex; flex-wrap: wrap; align-items: flex-start; gap: var(--space-3); }
.proposal__identity { display: grid; gap: var(--space-1); flex: 1 1 12rem; min-width: 0; }
.proposal__eyebrow { color: var(--accent-400); font-size: var(--step--2); font-weight: 700; }
.proposal h3 { font-size: var(--step-1); line-height: 1.3; }
.proposal__meta, .proposal__note { color: var(--text-300); font-size: var(--step--1); }
.proposal__status { white-space: normal; }
.proposal__concert { display: flex; flex-wrap: wrap; gap: var(--space-2) var(--space-4); padding-bottom: var(--space-4); border-bottom: var(--border-hairline); font-size: var(--step--1); }
.proposal__concert span { color: var(--text-300); }
.proposal__fit { display: grid; gap: var(--space-2); }
.proposal__fit ul { display: flex; flex-wrap: wrap; gap: var(--space-2); padding: 0; list-style: none; }
.proposal__fit li { padding: var(--space-1) var(--space-2); background: var(--accent-glow); border-radius: var(--radius-sm); color: var(--text-200); font-size: var(--step--1); }
.proposal__reservation { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-4); padding: var(--space-4); border-radius: var(--radius-md); background: var(--ink-750); }
.proposal__reservation > div { display: grid; align-content: start; gap: var(--space-1); min-width: 0; }
.proposal__reservation strong { font-size: var(--step--1); color: var(--text-100); }
.proposal__label { color: var(--text-300); font-size: var(--step--2); }
.proposal__approvals { display: grid; gap: var(--space-3); }
.proposal__approvals ul { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-3); padding: 0; list-style: none; }
.proposal__approvals li { display: flex; align-items: flex-start; gap: var(--space-2); min-width: 0; }
.proposal__check { display: grid; place-items: center; flex: none; width: 1.6rem; height: 1.6rem; border: var(--border-hairline); border-radius: 50%; font-size: var(--step--2); color: var(--text-300); }
.is-approved .proposal__check { background: var(--accent-glow); border-color: var(--accent-400); color: var(--accent-400); }
.proposal__approvals strong { display: block; font-size: var(--step--1); color: var(--text-200); }
.proposal__approvals small { display: block; font-size: var(--step--2); color: var(--text-300); }
.actions { display: flex; flex-wrap: wrap; gap: var(--space-3); }
.proposal .btn { white-space: normal; }
.proposal__explanation { border-top: var(--border-hairline); padding-top: var(--space-3); }
.proposal__why { display: flex; align-items: center; gap: var(--space-2); width: 100%; padding: var(--space-1) 0; border: 0; background: transparent; color: var(--accent-400); text-align: left; cursor: pointer; font: inherit; font-size: var(--step--1); font-weight: 700; }
.proposal__why > span { margin-left: auto; }
.proposal__why:focus-visible { outline: 2px solid var(--accent-400); outline-offset: 4px; border-radius: var(--radius-sm); }
.proposal__why:disabled { opacity: .6; cursor: wait; }
.proposal__reasons { display: grid; gap: var(--space-3); margin-top: var(--space-3); font-size: var(--step--1); }
.proposal__reasons ul { display: grid; gap: var(--space-2); padding-left: var(--space-4); color: var(--text-200); }
.proposal__reasons p { color: var(--text-300); }
.proposal__footnote { font-size: var(--step--2); color: var(--text-300); }
.proposal__error { color: var(--rose-400); font-size: var(--step--1); }
@media (max-width: 420px) {
  .proposal { padding: var(--space-4); }
  .proposal__reservation { grid-template-columns: 1fr; }
  .proposal__status { margin-left: 0; }
  .actions .btn { width: 100%; }
}
</style>
