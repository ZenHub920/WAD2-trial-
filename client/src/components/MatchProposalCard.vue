<script setup>
import { vibeChip } from '../vibe.js';
import { computed, ref, watch } from 'vue';
import { api, LABELS } from '../api.js';
import FeedbackForm from './FeedbackForm.vue';
import LoadingSpinner from './LoadingSpinner.vue';
import GroupAvatar from './GroupAvatar.vue';
import { useConcertEligibility } from '../composables/useConcertEligibility.js';

const props = defineProps({ proposal: { type: Object, required: true } });
const savedResponse = ref(null);
const currentProposal = computed(() => ({ ...props.proposal, ...(savedResponse.value?.id === props.proposal.id ? savedResponse.value.result : {}) }));
watch(() => props.proposal, () => { savedResponse.value = null; });
const { canCoordinate, isFinished, canPlanMeetup } = useConcertEligibility(() => currentProposal.value);
const canAccept = computed(() => !currentProposal.value.eventDate || canCoordinate.value);

const emit = defineEmits(['updated']);

const busy = ref(false);
const responding = ref('');
const explanationLoading = ref(false);
const error = ref('');
const explanation = ref(null);
const explanationOpen = ref(false);
const statuses = { confirmed: 'Spot confirmed', declined: 'Declined', expired: 'Expired', cancelled: 'Cancelled' };
const isHost = computed(() => currentProposal.value.role === 'host');
const myApproval = computed(() => isHost.value ? currentProposal.value.hostApproved : currentProposal.value.seekerApproved);
/**
 * The two people who must approve, each approved (green tick), pending
 * (yellow) or, once the offer was declined, declined (red cross).
 */
const approvers = computed(() => {
  const offer = currentProposal.value;
  const state = approved => approved ? 'approved' : offer.status === 'declined' ? 'declined' : 'pending';
  return [
    { key: 'host', name: isHost.value ? 'You · Host' : 'Group host', state: state(offer.hostApproved) },
    { key: 'seeker', name: isHost.value ? offer.seekerName : 'You · Companion', state: state(offer.seekerApproved) },
  ];
});
const readyToReview = computed(() => currentProposal.value.canHostRespond !== false && currentProposal.value.queueStatus !== 'waiting');
const held = computed(() => currentProposal.value.seatReserved ?? currentProposal.value.queueStatus !== 'waiting');
const groupName = computed(() => currentProposal.value.groupName || `${currentProposal.value.hostName}'s group`);
const statusLabel = computed(() => {
  if (currentProposal.value.resolutionReason === 'group_full') return 'Group filled before your turn';
  if (currentProposal.value.status !== 'proposed') return statuses[currentProposal.value.status] ?? 'Proposal updated';
  if (!readyToReview.value) return 'Waiting in queue';
  if (myApproval.value) return isHost.value ? 'Waiting for companion' : 'Waiting for host';
  return 'Ready for your reply';
});
const deadline = computed(() => {
  const date = new Date(currentProposal.value.expiresAt);
  return Number.isNaN(date.getTime()) ? 'Check the latest proposal' : date.toLocaleString('en-SG', {
    day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
  });
});
/** Reasons that are a concert vibe use that vibe's colour (tokens.css). */
const VIBE_OF_CONCEPT = { singalong: 'singalong', photography: 'photography', group_photos: 'photography', dancing: 'dancing',
  quiet: 'quiet', early_queue: 'queue_early', merch_run: 'merch' };
const matchReasons = computed(() => {
  const saved = explanation.value?.breakdown;
  const savedReasons = saved?.discovery?.reasons ?? currentProposal.value.reasons ?? [];
  const vibeOf = Object.fromEntries(savedReasons.filter(reason => reason.label).map(reason => [reason.label, VIBE_OF_CONCEPT[reason.concept] ?? null]));
  const reasons = savedReasons.map(reason => reason.label).filter(Boolean);
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
  return [...new Set([...reasons, ...supported.filter(([matches]) => matches).map(([, label]) => label)])].slice(0, 3)
    .map(label => ({ label, vibe: vibeOf[label] ?? null }));
});

async function respond(action) {
  if (busy.value) return;

  busy.value = true;
  responding.value = action;
  error.value = '';

  try {
    const id = currentProposal.value.id;
    const response = action === 'accept' ? await api.acceptProposal(id) : await api.declineProposal(id);
    if (id !== props.proposal.id) return;
    const result = response?.proposal;
    if (result?.status) savedResponse.value = { id, result };
    emit('updated', { ...currentProposal.value });
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
    const response = await api.proposalExplanation(currentProposal.value.id);
    explanation.value = response.explanation;
  } catch (err) {
    error.value = 'Could not load the saved match explanation. Please try again.';
  } finally {
    explanationLoading.value = false;
  }
}
</script>

<template>
  <article class="proposal card" :class="{ 'proposal--confirmed': currentProposal.status === 'confirmed' }">
    <header class="proposal__head">
      <GroupAvatar :src="currentProposal.imageUrl" :name="groupName" :size="48" />
      <div class="proposal__identity">
        <p class="proposal__eyebrow">{{ isHost ? 'Automatic match for your group' : 'Your automatic group match' }}</p>
        <h3>{{ groupName }}</h3>
        <p class="proposal__meta">{{ isHost ? `Proposed companion: ${currentProposal.seekerName}` : `Hosted by ${currentProposal.hostName}` }}</p>
      </div>
      <span class="tag proposal__status" :class="{ 'tag--mint': currentProposal.status === 'confirmed', 'tag--accent': currentProposal.status === 'proposed' && readyToReview }">{{ statusLabel }}</span>
    </header>

    <div class="proposal__concert">
      <strong>{{ currentProposal.artist }}</strong>
      <span>{{ LABELS.section[currentProposal.section] ?? currentProposal.section }}</span>
    </div>

    <div v-if="matchReasons.length" class="proposal__fit">
      <p class="proposal__label">Why you were matched</p>
      <ul aria-label="Saved match reasons"><li v-for="reason in matchReasons" :key="reason.label" v-bind="vibeChip(reason.vibe, reason.label)" :class="{ 'proposal__reason--vibe': reason.vibe }">{{ reason.label }}</li></ul>
      <p v-if="currentProposal.confidence === 'limited'" class="proposal__meta">Based on limited preference information.</p>
    </div>

    <div v-if="['proposed', 'declined'].includes(currentProposal.status)" class="proposal__approvals">
      <ul aria-label="Match approval progress">
        <li v-for="person in approvers" :key="person.key" :class="`is-${person.state}`">
          <span class="proposal__check" aria-hidden="true">{{ person.state === 'approved' ? '✓' : person.state === 'declined' ? '✕' : '…' }}</span>
          <span><strong>{{ person.name }}</strong><small>{{ person.state === 'approved' ? 'Approved' : person.state === 'declined' ? 'Declined' : 'Awaiting approval' }}</small></span>
        </li>
      </ul>
    </div>

    <template v-if="currentProposal.status === 'proposed'">
      <div class="proposal__reservation">
        <div>
          <span class="proposal__label">{{ isHost ? 'Group spot' : 'Your group spot' }}</span>
          <strong>{{ held ? 'One spot held' : 'Waiting for a spot' }}</strong>
          <span class="proposal__meta">Queue position {{ currentProposal.queuePosition ?? '—' }}{{ readyToReview ? ' · Next to review' : '' }}</span>
        </div>
        <div>
          <span class="proposal__label">Reply before</span>
          <strong>{{ deadline }}</strong>
          <span class="proposal__meta">48-hour window, including queue time</span>
        </div>
      </div>


      <p v-if="!readyToReview" class="proposal__note">Earlier direct or automatic requests must be resolved first. {{ isHost ? 'Review requests in arrival order.' : 'You can still decline while waiting.' }}</p>
      <p v-else-if="myApproval" class="proposal__note" role="status">Your approval is saved. {{ isHost ? 'The companion still needs to accept.' : 'The host still needs to approve.' }} The spot stays held until the deadline.</p>

      <div class="actions">
        <button v-if="!myApproval" type="button" class="btn btn--primary" :disabled="busy || !readyToReview || !canAccept" @click="respond('accept')"><LoadingSpinner v-if="busy && responding === 'accept'" />{{ isHost ? 'Approve companion' : 'Accept group offer' }}</button>
        <button type="button" class="btn btn--danger-ghost" :disabled="busy || (isHost && !readyToReview)" @click="respond('decline')"><LoadingSpinner v-if="busy && responding === 'decline'" />Decline proposal</button>
      </div>
      <p v-if="isFinished" class="proposal__note">This concert has finished. New membership approvals are closed; your proposal remains available here.</p>
    </template>
    <template v-else-if="currentProposal.status === 'confirmed'">
      <p class="proposal__note" role="status">{{ isHost ? `${currentProposal.seekerName} is now a member of your group.` : 'Your group membership is confirmed. Meet everyone in the group chat and plan your meetup together.' }}</p>
      <div v-if="currentProposal.partyId" class="actions" aria-label="Confirmed group actions">
        <RouterLink :to="`/groups/${encodeURIComponent(currentProposal.partyId)}/members`" class="btn btn--primary">Open your group</RouterLink>
        <RouterLink :to="`/groups/${encodeURIComponent(currentProposal.partyId)}/channel`" class="btn btn--ghost">Group messages</RouterLink>
        <RouterLink v-if="canPlanMeetup" :to="{ path: '/meetups', query: { partyId: currentProposal.partyId, from: 'groups' } }" class="btn btn--ghost">Plan meetup</RouterLink>
      </div>
    </template>

    <div class="proposal__explanation">
      <button type="button" class="proposal__why" :disabled="busy || explanationLoading" :aria-expanded="explanationOpen" @click="explain"><LoadingSpinner v-if="explanationLoading" />{{ explanationOpen ? 'Hide match reasons' : 'Why this group match?' }}<span aria-hidden="true">{{ explanationOpen ? '−' : '+' }}</span></button>
      <div v-if="explanationOpen && explanation" class="proposal__reasons">
        <p v-if="!matchReasons.length">No detailed match reasons were saved for this proposal.</p>
        <p>These reasons come from the preferences saved when this match was made. Matching considers both sides' preferences and group capacity.</p>
      </div>
    </div>
    <FeedbackForm
      v-if="currentProposal.status === 'confirmed' && isFinished"
      :round-id="currentProposal.roundId"
      :rated-user-id="currentProposal.role === 'host' ? currentProposal.seekerUserId : currentProposal.hostUserId"
    />
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
.proposal :where(p, h3, ol, ul) {
  margin: 0;
}
.proposal--confirmed {
  border-color: color-mix(in oklab, var(--mint-400) 45%, var(--ink-600));
}
.proposal__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-3);
}
.proposal__identity {
  display: grid;
  gap: var(--space-1);
  flex: 1 1 12rem;
  min-width: 0;
}
.proposal__eyebrow {
  color: var(--accent-400);
  font-size: var(--step--2);
  font-weight: 700;
}
.proposal h3 {
  font-size: var(--step-1);
  line-height: 1.3;
}
.proposal__meta, .proposal__note {
  color: var(--text-300);
  font-size: var(--step--1);
}
.proposal__status {
  white-space: normal;
}
.proposal__concert {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2) var(--space-4);
  padding-bottom: var(--space-4);
  border-bottom: var(--border-hairline);
  font-size: var(--step--1);
}
.proposal__concert span {
  color: var(--text-300);
}
.proposal__fit {
  display: grid;
  gap: var(--space-2);
}
.proposal__fit ul {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  padding: 0;
  list-style: none;
}
.proposal__fit li {
  padding: var(--space-1) var(--space-2);
  background: var(--accent-glow);
  border-radius: var(--radius-sm);
  color: var(--text-200);
  font-size: var(--step--1);
}
/* A concert-vibe reason takes that vibe's colour, as on the public profile. */
.proposal__fit li.proposal__reason--vibe {
  border: 1px solid color-mix(in oklab, var(--vibe-colour) 40%, transparent);
  background: color-mix(in oklab, var(--vibe-colour) 14%, transparent);
  color: var(--text-100);
}
.proposal__reservation {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-4);
  padding: var(--space-4);
  border-radius: var(--radius-md);
  background: var(--ink-750);
}
.proposal__reservation > div {
  display: grid;
  align-content: start;
  gap: var(--space-1);
  min-width: 0;
}
.proposal__reservation strong {
  font-size: var(--step--1);
  color: var(--text-100);
}
.proposal__label {
  color: var(--text-300);
  font-size: var(--step--2);
}
.proposal__approvals {
  display: grid;
  gap: var(--space-3);
}
.proposal__approvals ul {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-3);
  padding: 0;
  list-style: none;
}
.proposal__approvals li {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  min-width: 0;
}
.proposal__check {
  display: grid;
  place-items: center;
  flex: none;
  width: 1.6rem;
  height: 1.6rem;
  border: var(--border-hairline);
  border-radius: 50%;
  font-size: var(--step--2);
  color: var(--text-300);
}
/* Approved green, pending amber, declined red. */
.is-approved .proposal__check {
  background: color-mix(in srgb, var(--signal-good) 14%, transparent);
  border-color: var(--signal-good);
  color: var(--signal-good);
  font-weight: 700;
}
.is-pending .proposal__check {
  background: color-mix(in srgb, var(--amber-400) 16%, transparent);
  border-color: var(--amber-400);
  color: var(--amber-400);
  font-weight: 700;
}
.is-declined .proposal__check {
  background: color-mix(in srgb, var(--signal-bad) 14%, transparent);
  border-color: var(--signal-bad);
  color: var(--signal-bad);
  font-weight: 700;
}
.proposal__approvals strong {
  display: block;
  font-size: var(--step--1);
  color: var(--text-200);
}
.proposal__approvals small {
  display: block;
  font-size: var(--step--2);
  color: var(--text-300);
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
}
.proposal .btn {
  white-space: normal;
}
.proposal__explanation {
  border-top: var(--border-hairline);
  padding-top: var(--space-3);
}
.proposal__why {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  padding: var(--space-1) 0;
  border: 0;
  background: transparent;
  color: var(--accent-400);
  text-align: left;
  cursor: pointer;
  font: inherit;
  font-size: var(--step--1);
  font-weight: 700;
}
.proposal__why > span {
  margin-left: auto;
}
.proposal__why:focus-visible {
  outline: 2px solid var(--accent-400);
  outline-offset: 4px;
  border-radius: var(--radius-sm);
}
.proposal__why:disabled {
  opacity: .6;
  cursor: wait;
}
.proposal__reasons {
  display: grid;
  gap: var(--space-3);
  margin-top: var(--space-3);
  font-size: var(--step--1);
}
.proposal__reasons ul {
  display: grid;
  gap: var(--space-2);
  padding-left: var(--space-4);
  color: var(--text-200);
}
.proposal__reasons p {
  color: var(--text-300);
}
.proposal__footnote {
  font-size: var(--step--2);
  color: var(--text-300);
}
.proposal__error {
  color: var(--rose-400);
  font-size: var(--step--1);
}
@media (max-width: 420px) {
  .proposal {
    padding: var(--space-4);
  }
  .proposal__reservation {
    grid-template-columns: 1fr;
  }
  .proposal__status {
    margin-left: 0;
  }
  .actions .btn {
    width: 100%;
  }
}
</style>
