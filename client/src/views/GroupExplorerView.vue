<script setup>
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, LABELS, SECTION_OPTIONS, ARRIVAL_OPTIONS } from '../api.js';
import { useMeetupSummaries } from '../composables/useMeetupSummaries.js';
import { useConcertEligibility } from '../composables/useConcertEligibility.js';
import { concertParticipationEligibility } from '../../../shared/concertEligibility.mjs';
import { meetupDestination, meetupActionForScope } from '../utils/meetupSummaries.js';
import { currentUser, sessionReady } from '../auth.js';
import GroupFilters from '../components/GroupFilters.vue';
import GroupListingCard from '../components/GroupListingCard.vue';
import GroupComparisonDeck from '../components/GroupComparisonDeck.vue';
import GroupPreferencesGate from '../components/GroupPreferencesGate.vue';
import GroupAvatar from '../components/GroupAvatar.vue';
import { preferencesReady } from '../groupPreferences.js';
import MatchProposalCard from '../components/MatchProposalCard.vue';
import LoadingSpinner from '../components/LoadingSpinner.vue';
import GroupNavigation from '../components/GroupNavigation.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import '../assets/groups.css';

const route = useRoute(), router = useRouter();
const { plans: meetupPlans } = useMeetupSummaries();
const meetupLink = scope => meetupDestination(meetupPlans.value, scope);
const meetupLabel = scope => meetupActionForScope(meetupPlans.value, scope);
const concerts = ref([]), groups = ref([]), saved = ref([]), seeker = ref(null);
const concertId = ref(typeof route.query.concertId === 'string' ? route.query.concertId : '');
const concertsLoading = ref(true), loading = ref(false), busy = ref(false);
const concertError = ref('');
const error = ref(''), message = ref(''), refreshWarning = ref('');
const failureCode = ref('');
const matchAttemptKey = ref(''), searchResult = ref(null);
const discovery = ref(null), methodChange = ref(null), confirmError = ref('');
const sourceLabels = { memberships: 'Your group membership', offers: 'Your matching offers', matching: 'Matching status', request: 'Your joining method', joins: 'Your group requests', groups: 'Available groups', saved: 'Saved group priorities' };
const reads = reactive(Object.fromEntries(Object.keys(sourceLabels).map(name => [name, { loading: false, loaded: false, error: '', sequence: 0 }])));
const proposalSourceRevision = reactive({ matching: 0, offers: 0 });
let proposalReadSequence = 0;
const offset = ref(0), total = ref(0), joins = ref([]), memberships = ref([]), proposals = ref([]);
const matching = ref({ optedIn: false, state: 'idle', request: null, proposal: null });
const displayedMode = ref('direct'), applicationFor = ref(''), applicationNote = ref('');
/** One screen of results; the server pages in the same size. */
const PAGE_SIZE = 20;
const hasPreviousPage = computed(() => offset.value > 0);
const hasNextPage = computed(() => offset.value + PAGE_SIZE < total.value);
const directLayout = ref('compare'), comparisonSession = ref('');
const filters = reactive({ query: '', section: '', minCapacity: 0, spendBand: '', arrival: '', activity: '', vibe: '', sort: 'compatibility', preferredOnly: false });
const form = reactive({ section_pref: 'standing_pen', spend_band_max: 3, arrival_pref: 'doors', plans_wanted: {} });
// Plan answers are remembered per viewer so switching concert is one click, not a re-fill.
const planKey = () => `encore:group-plan:${currentUser.value?.id ?? ''}`;
const rememberedPlan = ref(null), editingPlan = ref(false);
function readRememberedPlan() {
  try { const raw = localStorage.getItem(planKey()); rememberedPlan.value = raw ? JSON.parse(raw) : null; } catch { rememberedPlan.value = null; }
  if (rememberedPlan.value) Object.assign(form, { ...rememberedPlan.value, plans_wanted: { ...(rememberedPlan.value.plans_wanted ?? {}) } });
  editingPlan.value = !rememberedPlan.value;
}
function rememberPlan() {
  const value = { section_pref: form.section_pref, spend_band_max: form.spend_band_max, arrival_pref: form.arrival_pref, plans_wanted: { ...form.plans_wanted } };
  try { localStorage.setItem(planKey(), JSON.stringify(value)); } catch { /* convenience only */ }
  rememberedPlan.value = value;
}
const planSummary = computed(() => rememberedPlan.value ? [SECTION_OPTIONS[rememberedPlan.value.section_pref], LABELS.spendBand[rememberedPlan.value.spend_band_max], ARRIVAL_OPTIONS[rememberedPlan.value.arrival_pref]].filter(Boolean).join(' · ') : '');
// Concert picker: upcoming shows only, with venue/time so repeated names are distinguishable.
const pickerConcerts = computed(() => concerts.value.filter(concert => concertParticipationEligibility(concert).eligible || concert.id === concertId.value));
const concertOptionLabel = concert => {
  const date = concert.event_date ? new Date(`${concert.event_date}T00:00:00`).toLocaleDateString('en-SG', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : '';
  const time = concert.event_time ? ` ${concert.event_time.slice(0, 5)}` : '';
  const count = concert.open_parties === null || concert.open_parties === undefined ? null : Number(concert.open_parties);
  const clash = concerts.value.some(other => other.id !== concert.id && other.artist === concert.artist && other.event_date === concert.event_date);
  const name = clash && concert.tour_name ? `${concert.artist} — ${concert.tour_name}` : concert.artist;
  return `${name} · ${date}${time}${concert.venue ? ` · ${concert.venue}` : ''}${Number.isInteger(count) && count >= 0 ? ` · ${count} open ${count === 1 ? 'group' : 'groups'} overall` : ''}`;
};
const hasActiveFilters = computed(() => Boolean(filters.query || filters.section || filters.minCapacity || filters.spendBand || filters.arrival || filters.activity || filters.vibe || filters.preferredOnly));
const requestGroupName = request => request.groupName || `${request.hostName}’s group`;
// Join confirmation: nothing is sent until the person reviews and confirms.
const confirmingGroup = ref(null), confirmNote = ref(''), confirmOpener = ref(null);
let confirmResolve = null;
const groupDisplayName = group => group?.name || (group?.hostName ? `${group.hostName}’s group` : 'this group');
function confirmJoin(group) {
  if (!canApply.value) return Promise.resolve(false);
  confirmOpener.value = document.activeElement;
  confirmingGroup.value = group; confirmNote.value = ''; confirmError.value = '';
  return new Promise(resolve => { confirmResolve = resolve; });
}
async function settleConfirm(send) {
  if (send && busy.value) return;
  const group = confirmingGroup.value, resolve = confirmResolve, key = context();
  if (send && group) {
    if (!canApply.value || !canQueueFor(group)) { confirmError.value = 'This request cannot be sent now. Check your joining method, current requests and the group’s availability.'; return; }
    confirmError.value = '';
    const saved = await join(group.id, confirmNote.value.trim());
    if (!isCurrent(key) || confirmingGroup.value !== group) return;
    if (!saved) { confirmError.value = error.value || 'The request was not sent. Review the details and try again.'; return; }
  }
  // Release the comparison deck's pending state before the dialog restores
  // focus, so a cancelled review returns to an enabled request button.
  confirmResolve = null;
  resolve?.(send && group ? true : 'cancelled');
  confirmingGroup.value = null;
  // The request is tracked (and can be cancelled) in My groups, so go there.
  if (send && group && isCurrent(key)) void router.push({ path: '/groups/connect', query: { sent: '1' }, hash: '#my-requests-heading' });
}
const persistedMode = computed(() => seeker.value?.joining_mode ?? seeker.value?.joiningMode ?? 'algorithm');
const currentGroup = computed(() => memberships.value.find(group => group.concertId === concertId.value));
const ownRequests = computed(() => joins.value.filter(request => request.userId === currentUser.value?.id && request.concertId === concertId.value));
const pendingDirect = computed(() => ownRequests.value.filter(request => request.status === 'pending' && !request.matchingRoundId));
const pendingLegacy = computed(() => ownRequests.value.filter(request => request.status === 'pending' && request.matchingRoundId));
// A failed read retains its cache, not authority over a newer successful read.
// The full inbox remains in proposals; only the latest source supplies current
// offers/membership here, so a fresh empty state also retires stale confirmations.
const automaticProposals = computed(() => {
  const source = proposalSourceRevision.matching > proposalSourceRevision.offers
    ? matching.value.proposal ? [matching.value.proposal] : [] : proposals.value;
  return source.filter(proposal => ['proposed', 'confirmed'].includes(proposal.status));
});
const activeProposals = computed(() => automaticProposals.value.filter(proposal => proposal.status === 'proposed'));
/** Offers you declined that are still kept out of matching, so you can change your mind. */
const declinedOffers = computed(() => {
  // Declining the same group more than once leaves several old offers, but it is
  // one group to bring back: list each group once, using its latest offer.
  const byGroup = new Map();
  for (const proposal of proposals.value) {
    if (proposal.status !== 'declined' || proposal.declinedBy === 'host' || !proposal.pairExcluded) continue;
    const seen = byGroup.get(proposal.partyId);
    if (!seen || Number(proposal.expiresAt ?? 0) > Number(seen.expiresAt ?? 0)) byGroup.set(proposal.partyId, proposal);
  }
  return [...byGroup.values()];
});
const offerGroupName = proposal => proposal.groupName || (proposal.hostName ? `${proposal.hostName}’s group` : 'This group');
async function bringBack(proposal) {
  await act(() => api.undoDeclineProposal(proposal.id),
    `${offerGroupName(proposal)} can be matched with you again. Press Find a match when you’re ready.`);
}
const currentOffer = computed(() => activeProposals.value[0] ?? automaticProposals.value.find(proposal => proposal.status === 'confirmed') ?? null);
const confirmedGroupId = computed(() => currentGroup.value?.partyId ?? currentGroup.value?.id
  ?? (currentOffer.value?.status === 'confirmed' ? currentOffer.value.partyId : null));
const membershipConfirmed = computed(() => Boolean(confirmedGroupId.value)
  || (matching.value.state === 'accepted' && proposalSourceRevision.matching > proposalSourceRevision.offers));
const enrollmentSummary = computed(() => {
  if (membershipConfirmed.value) return 'Your group membership is confirmed.';
  if (currentOffer.value?.status === 'proposed') return 'Your automatic matching offer is awaiting both approvals.';
  if (reads.request.error || !reads.request.loaded) return 'Your active joining method could not be checked yet.';
  if (!seeker.value) return 'Save your plans to activate a joining method.';
  if (seeker.value.status === 'withdrawn') return 'You are not currently looking for a group.';
  if (matching.value.optedIn) return 'Active method: Automatic matching — you are on the match list.';
  if (persistedMode.value === 'algorithm') return 'Saved method: Automatic matching. You are not currently on the match list.';
  return 'Active method: Browse and choose.';
});
const modeIsActive = computed(() => Boolean(seeker.value && persistedMode.value === displayedMode.value));
const selectedConcert = computed(() => concerts.value.find(concert => concert.id === concertId.value));
const { canCoordinate, isFinished, canCreateGroup, canPlanMeetup, refreshEligibility } = useConcertEligibility(() => selectedConcert.value);
const pendingLimit = computed(() => seeker.value?.maxPendingDirectApplications ?? 1);
const coreReady = computed(() => ['memberships', 'matching', 'request', 'joins'].every(name => reads[name].loaded && !reads[name].loading && !reads[name].error));
const canApply = computed(() => coreReady.value && canCoordinate.value && !busy.value && !loading.value && displayedMode.value === 'direct' && seeker.value?.status === 'open' && persistedMode.value === 'direct' && !confirmedGroupId.value && !activeProposals.value.length && !pendingLegacy.value.length && pendingDirect.value.length < pendingLimit.value);
const modeOptions = [
  { mode: 'direct', kicker: 'Pick yourself', title: 'Browse and choose', description: 'Compare groups and review a request before sending it.', action: 'Browse groups' },
  { mode: 'algorithm', kicker: 'Let us help', title: 'Automatic matching', description: 'Join the list explicitly, then find a match. Any offer needs your approval and the host’s approval.', action: 'View automatic matching' },
];
const modeAction = option => displayedMode.value === option.mode ? 'Selected' : option.action;
function chooseMode(mode) {
  if (!['direct', 'algorithm'].includes(mode)) return;
  displayedMode.value = mode;
  applicationFor.value = ''; void settleConfirm(false);
  loadedContext = context();
  void router.push({ query: { ...route.query, mode } }).catch(() => {});
  // Picking Browse and choose switches to it; nobody needs a second "activate"
  // step. (Automatic matching still has its own Join button, because joining
  // the list lets other people's rounds send you offers.)
  if (mode === 'direct' && seeker.value?.status === 'open' && persistedMode.value !== 'direct' && canSwitchMode.value) void activateDirect();
}
async function activateDirect() {
  const key = context();
  await act(async () => {
    const result = await api.setJoiningMode(concertId.value, 'direct');
    if (!isCurrent(key)) return;
    if (result.request) seeker.value = result.request;
    if (result.matching) applyMatching(result.matching);
    searchResult.value = null; rememberAttempt('');
    if (result.request) matching.value = { ...matching.value, optedIn: false, state: 'idle' };
  }, 'Browse and choose is now how you find a group. You’ve left the automatic match list.');
}
const lastAttempt = computed(() => matching.value.latestAttempt ?? searchResult.value?.attempt ?? null);
const noMatchFound = computed(() => lastAttempt.value?.status === 'waiting' || (!lastAttempt.value && searchResult.value?.status === 'waiting'));
const emptyMessage = computed(() => {
  if (reads.groups.error || !reads.groups.loaded) return null;
  if (membershipConfirmed.value) return { title: 'You already have a group', detail: 'Open your group or My groups to message everyone or plan your meetup.', action: 'group' };
  if (currentOffer.value?.status === 'proposed') return { title: currentOffer.value.seekerApproved ? 'Waiting for host approval' : 'You have a group offer', detail: currentOffer.value.seekerApproved ? 'Your approval is saved. The host still needs to approve before membership is confirmed.' : 'Review your current offer. An empty discovery list does not mean your offer has disappeared.', action: 'offer' };
  if (pendingDirect.value.length || pendingLegacy.value.length) return { title: 'Your request is awaiting a decision', detail: 'Track its actual status and any expiry in My groups.', action: 'request' };
  if (discovery.value?.state === 'participation_unavailable') return { title: 'New group joining is unavailable', detail: 'This concert is not open for new participation. Existing groups, offers and conversations remain available.' };
  if (seeker.value?.status === 'withdrawn') return { title: 'You paused your group search', detail: 'Resume your search above to see groups using your saved joining method.', action: 'resume' };
  if (seeker.value && seeker.value.status !== 'open') return { title: 'Your search request is not open', detail: 'Check your current group, offers or past matches before starting another search.', action: 'status' };
  if (!seeker.value && reads.request.loaded && !reads.request.error) return { title: 'Save your concert plans to continue', detail: 'Complete the plans form above before choosing how to find a group.', action: 'plans' };
  if (!coreReady.value) {
    const failed = ['memberships', 'matching', 'request', 'joins'].some(name => reads[name].error);
    return failed ? { title: 'Your current group status could not be checked', detail: 'Use the retry controls above to check your group, offers and requests.' }
      : { title: 'Checking your current group status', detail: 'Your group, offers and requests are being checked.' };
  }
  if (matching.value.optedIn && noMatchFound.value) return { title: 'No suitable group is available.', detail: 'You remain enrolled in automatic matching. You can explore groups without changing your active method.' };
  if (hasActiveFilters.value || discovery.value?.state === 'filters_empty') return { title: 'No groups match your filters', detail: 'Adjust your filters to explore other eligible groups.', action: 'filters' };
  return { title: 'No suitable groups found', simple: true };
});
function clearFilters() { Object.assign(filters, { query: '', section: '', minCapacity: 0, spendBand: '', arrival: '', activity: '', vibe: '', preferredOnly: false }); }
function reviewOffer() { chooseMode('algorithm'); void nextTick(() => document.getElementById('automatic-offers')?.scrollIntoView?.({ block: 'start', behavior: 'instant' })); }
/** Which of the four matching steps are finished: green when done, red when not. */
const matchingStepsDone = computed(() => {
  const offer = Boolean(currentOffer.value), confirmed = Boolean(confirmedGroupId.value);
  return [matching.value.preferencesComplete === true, confirmed || offer || matching.value.optedIn === true, confirmed || offer, confirmed];
});
const stepClass = index => matchingStepsDone.value[index] ? 'matching-progress__step--done' : 'matching-progress__step--todo';
const matchingProgress = computed(() => {
  const offer = currentOffer.value, queued = matching.value.optedIn === true && matching.value.state === 'queued';
  const preferences = matching.value.preferencesComplete;
  if (membershipConfirmed.value) return { phase: 4, title: 'Group membership confirmed', detail: 'Open your group, meet everyone in the chat and plan your meetup together.' };
  if (offer?.status === 'proposed') {
    if (offer.canHostRespond === false || offer.queueStatus === 'waiting') return { phase: 4, title: 'Your offer is waiting in the group queue', detail: 'Earlier requests are reviewed first. Approval opens when your offer reaches the front and a spot is held; you can still decline.' };
    if (offer.seekerApproved) return { phase: 4, title: 'Waiting for the host’s approval', detail: 'Your approval is saved. You join only when the host also approves; the offer deadline still applies.' };
    return { phase: 4, title: 'Review your group offer', detail: offer.hostApproved ? 'The host has approved. Review the group and accept or decline; accepting now confirms your membership.' : 'Accept or decline the offer below. Both you and the host must approve before you become a member.' };
  }
  if (pendingLegacy.value.length) return { phase: 4, title: 'Your earlier match needs attention', detail: 'Check My groups for the host’s response, queue position and deadline.' };
  if (!reads.matching.loaded || reads.matching.error) return { phase: 2, title: 'Matching status is unavailable', detail: 'Retry matching status below. Your existing group, offers and requests are shown independently when available.' };
  if (!canCoordinate.value) return { phase: 2, title: 'Matching is closed for this concert', detail: 'Existing groups, offers and conversations remain available. New enrollment is closed.' };
  if (preferences === false) return { phase: 1, title: 'Set up your matching preferences', detail: 'Save your private answers in Profile so automatic matching can compare your preferences with the whole group.' };
  if (pendingDirect.value.length) return { phase: 2, title: 'Resolve your current group request first', detail: 'Track or cancel the request in My groups before switching to automatic matching.' };
  if (queued && matchAttemptKey.value) return { phase: 3, title: 'Check your last search', detail: 'A previous search response was not confirmed. Recover the same attempt safely, or wait a moment; this page refreshes on its own and does not start another round.' };
  if (queued) return noMatchFound.value
    ? { phase: 3, title: 'No suitable group is available.', detail: 'Your place on the match list is kept. Try Find a match again later, or switch to Browse and choose to pick a group yourself.' }
    : { phase: 3, title: 'Ready to find a match', detail: 'You’re on the match list. Press Find a match when you’re ready; we’ll look for the group that suits you best.' };
  return { phase: 2, title: 'Join automatic matching when you’re ready', detail: 'Join the match list, then press Find a match and we’ll suggest a group that suits you.' };
});
const originLabels = { direct: 'The host said yes to your request', algorithm: 'You were matched with this group', host: 'You’re the host', friend: 'A friend invited you' };
let generation = 0, contextGeneration = 0, alive = true, filterTimer, loadedContext = '', loadedDataContext = '';
const context = () => `${currentUser.value?.id ?? ''}:${concertId.value}:${contextGeneration}`;
const isCurrent = key => alive && key === context();
const pendingFor = id => ownRequests.value.some(request => request.partyId === id && request.status === 'pending');
const declinedFor = id => ownRequests.value.some(request => request.partyId === id && ['rejected', 'declined'].includes(request.status));
const canQueueFor = group => group.canJoinQueue ?? group.remainingCapacity > 0;

function failureMessage(err) {
  const explanations = {
    concert_finished: 'This concert has finished. New matching is closed; your requests, group and conversations remain available.',
    concert_date_unavailable: 'This concert needs a valid date before new matching can start.',
    open_seeker_request_required: 'Tell us a bit about your plans for this show first.',
    direct_joining_mode_required: 'Switch to “Browse and choose” before asking to join a group.',
    pending_application_limit_reached: 'You’ve already asked one group. Cancel that request if you’d rather try another.',
    withdraw_pending_applications_first: 'Cancel your open request before switching how you join.',
    active_seat_claim_exists: 'Finish up with your current request, match or group before switching how you join.',
    active_matching_proposal_exists: 'Resolve your current match before switching methods or asking another group.',
    active_proposal_exists: 'Resolve your current match before switching methods or asking another group.',
    already_in_concert_group: 'You already have a group for this show. You can find it at the top of the page.',
    already_group_member: 'You’re already in this group.',
    previously_declined: 'This group passed earlier, so try a different one.',
    save_discovery_preferences_first: 'Save your private preferences in Profile to find a match, or browse and choose a group yourself.',
    join_request_already_exists: 'You’ve already asked to join this group.',
    group_changed_withdraw_and_resubmit: 'This group changed after you asked. Cancel your request, take another look and ask again.',
    preferences_changed_withdraw_and_resubmit: 'Your preferences changed after you asked. Cancel and ask again so the host sees your latest answers.',
    group_unavailable: 'This group no longer has an eligible spot. Check the latest groups below.',
    request_waiting_in_queue: 'An earlier request needs an answer first. Refresh the queue before replying.',
    join_matching_pool_first: 'Join the match list before finding a match.',
    rate_limit_exceeded: 'You’ve tried matching several times. Wait a minute before finding a match again.',
  };
  return explanations[err.message] ?? (err.status === 401 ? 'You’ve been signed out. Sign in again to carry on.' : err.status === 409 ? 'That clashes with a request, match or group you already have. Check below and try again.' : 'Something went wrong. Please try again.');
}

const attemptStorageKey = () => `encore:matching-attempt:${encodeURIComponent(currentUser.value?.id ?? '')}:${encodeURIComponent(concertId.value)}`;
function rememberAttempt(value) {
  matchAttemptKey.value = value;
  try { if (value) sessionStorage.setItem(attemptStorageKey(), value); else sessionStorage.removeItem(attemptStorageKey()); } catch { /* Server receipts still protect retries in this tab. */ }
}
function restoreAttempt() {
  try {
    const value = sessionStorage.getItem(attemptStorageKey());
    matchAttemptKey.value = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value ?? '') ? value : '';
  } catch { matchAttemptKey.value = ''; }
}
function applyMatching(state) {
  if (!state) return;
  matching.value = state;
  proposalSourceRevision.matching = ++proposalReadSequence;
  const attempt = state.latestAttempt;
  if (attempt?.id === matchAttemptKey.value && attempt.completed === true) rememberAttempt('');
}
function clearContext(key) {
  groups.value = []; saved.value = []; seeker.value = null; discovery.value = null;
  joins.value = []; memberships.value = []; proposals.value = []; total.value = 0;
  matching.value = { optedIn: false, state: 'idle', request: null, proposal: null };
  proposalSourceRevision.matching = proposalSourceRevision.offers = 0; proposalReadSequence = 0;
  comparisonSession.value = ''; loadedDataContext = key; searchResult.value = null;
  methodChange.value = null; failureCode.value = '';
  for (const state of Object.values(reads)) Object.assign(state, { sequence: state.sequence + 1, loading: false, loaded: false, error: '' });
  restoreAttempt();
}
async function load(section) {
  const key = context(), id = concertId.value;
  if (loadedDataContext !== key) clearContext(key);
  if (!id || !currentUser.value || !sessionReady.value) { loading.value = false; return false; }
  const listingKey = `${key}:${offset.value}:${JSON.stringify(filters)}`;
  const tasks = {
    memberships: { get: () => api.currentGroupMemberships(), apply: data => { memberships.value = data.groups ?? data.memberships ?? []; } },
    offers: { get: () => api.myProposals(), apply: data => {
      proposals.value = data.proposals.filter(proposal => proposal.concertId === id && proposal.role === 'seeker');
      proposalSourceRevision.offers = ++proposalReadSequence;
    } },
    matching: { get: () => api.groupMatching(id), apply: data => applyMatching(data.matching) },
    request: { get: () => api.seekerRequest(id), apply: data => {
      seeker.value = data.request;
      if (loadedContext !== key) {
        displayedMode.value = ['direct', 'algorithm'].includes(route.query.mode) ? route.query.mode : seeker.value ? persistedMode.value : 'direct';
        loadedContext = key;
      }
    } },
    joins: { get: () => api.groupJoinRequests({ scope: 'own', concertId: id }), apply: data => { joins.value = data.requests; } },
    groups: { get: () => api.discoverGroups(id, { offset: offset.value, q: filters.query, section: filters.section, arrival: filters.arrival, spendBand: filters.spendBand, minCapacity: filters.minCapacity, activity: filters.activity, vibe: filters.vibe, preferredOnly: filters.preferredOnly, sort: filters.sort }), apply: data => {
      groups.value = data.groups; total.value = data.total; discovery.value = data.discovery ?? null; comparisonSession.value = listingKey;
    } },
    saved: { get: () => api.groupPreferences(id), apply: data => { saved.value = data.preferences; } },
  };
  const names = typeof section === 'string' && tasks[section] ? [section] : Object.keys(tasks);
  const results = await Promise.allSettled(names.map(async name => {
    const state = reads[name], sequence = ++state.sequence;
    state.loading = true; state.error = '';
    if (name === 'groups') loading.value = true;
    try {
      const data = await tasks[name].get();
      if (!isCurrent(key) || sequence !== state.sequence) return;
      tasks[name].apply(data); state.loaded = true;
    } catch (err) {
      if (!isCurrent(key) || sequence !== state.sequence) return;
      if (name === 'groups' && comparisonSession.value !== listingKey) {
        groups.value = []; total.value = 0; discovery.value = null; state.loaded = false;
        comparisonSession.value = listingKey;
      }
      state.error = err.status === 401 ? 'Sign in again to reload this section.' : 'This section could not be refreshed. Previously saved information is kept.';
      throw err;
    } finally {
      if (isCurrent(key) && sequence === state.sequence) { state.loading = false; if (name === 'groups') loading.value = false; }
    }
  }));
  if (!isCurrent(key)) return false;
  await focusNotificationContext();
  return results.every(result => result.status === 'fulfilled');
}
watch(concertId, id => {
  contextGeneration++;
  busy.value = false;
  void settleConfirm(false);
  applicationFor.value = ''; applicationNote.value = ''; offset.value = 0; message.value = '';
  clearTimeout(filterTimer); router.replace({ query: { ...route.query, concertId: id || undefined } }); load();
});
watch(() => Object.values(filters), () => {
  reads.groups.sequence++; loading.value = true; applicationFor.value = ''; applicationNote.value = '';
  clearTimeout(filterTimer); filterTimer = setTimeout(() => { offset.value = 0; load('groups'); }, 250);
});
watch(() => route.query.concertId, id => { const next = typeof id === 'string' ? id : ''; if (next !== concertId.value) concertId.value = next; });
watch(() => route.query.mode, mode => { if (['direct', 'algorithm'].includes(mode)) { displayedMode.value = mode; applicationFor.value = ''; } });
watch(() => currentUser.value?.id, (id, previous) => {
  contextGeneration++;
  busy.value = false; void settleConfirm(false); readRememberedPlan();
  if (previous && id !== previous) try {
    const prefix = `encore:matching-attempt:${encodeURIComponent(previous)}:`;
    for (const name of Object.keys(sessionStorage)) if (name.startsWith(prefix)) sessionStorage.removeItem(name);
  } catch { /* Storage may be unavailable. */ }
}, { immediate: true });
watch([() => currentUser.value?.id, sessionReady, preferencesReady], () => { message.value = ''; applicationFor.value = ''; loadedContext = ''; load(); });
async function loadConcerts() {
  concertsLoading.value = true; concertError.value = '';
  try {
    const response = await api.concerts(); if (!alive) return; concerts.value = response.concerts;
    if (!concertId.value && concerts.value.length) concertId.value = (concerts.value.find(concert => concertParticipationEligibility(concert).eligible) ?? concerts.value[0]).id;
  } catch { if (alive) concertError.value = 'The concert list could not be loaded. Your selected concert’s group, offers and requests are loaded separately.'; }
  finally { if (alive) concertsLoading.value = false; }
}
onMounted(() => { if (concertId.value) void load(); void loadConcerts(); });
/**
 * Keep offers, host replies and matching status current without a manual
 * "check for updates": refresh when the tab comes back into view and every
 * 30 seconds while it is visible. The group list itself is left alone, so a
 * page someone is reading does not reshuffle under them.
 */
const STATUS_SECTIONS = ['memberships', 'offers', 'matching', 'request', 'joins'];
function refreshStatus() {
  if (!alive || !concertId.value || busy.value || confirmingGroup.value || document.visibilityState !== 'visible') return;
  for (const section of STATUS_SECTIONS) void load(section);
}
const onVisible = () => { if (document.visibilityState === 'visible') refreshStatus(); };
const statusTimer = setInterval(refreshStatus, 30000);
document.addEventListener('visibilitychange', onVisible);
onUnmounted(() => { alive = false; generation++; clearTimeout(filterTimer); clearInterval(statusTimer); document.removeEventListener('visibilitychange', onVisible); void settleConfirm(false); });
async function act(operation, success) {
  if (busy.value) return false;
  const key = context(); busy.value = true; error.value = ''; failureCode.value = ''; message.value = ''; refreshWarning.value = '';
  try {
    await operation();
    if (!isCurrent(key)) return false;
    const refreshed = await load();
    if (!isCurrent(key)) return false;
    message.value = typeof success === 'function' ? success() : success;
    if (!refreshed) { error.value = ''; refreshWarning.value = 'Your change was saved. The latest group details could not be loaded. Refresh the details before making another choice.'; }
    return true;
  }
  catch (err) { if (isCurrent(key)) { refreshEligibility(); failureCode.value = err.message; error.value = failureMessage(err); } return false; }
  finally { if (isCurrent(key)) busy.value = false; }
}
async function enroll(reopen = false) { if (!reopen) rememberPlan(); await act(() => reopen ? api.reopenSeekerRequest(concertId.value) : api.createRequest(concertId.value, { ...form, joining_mode: 'direct' }), 'Your answers are saved. Browse groups, or explicitly join automatic matching.'); }
const canSwitchMode = computed(() => coreReady.value && canCoordinate.value && seeker.value?.status === 'open' && !confirmedGroupId.value
  && !pendingDirect.value.length && !pendingLegacy.value.length && !activeProposals.value.length);
function requestMethodChange(target) {
  if (busy.value || !canSwitchMode.value || !['direct', 'algorithm'].includes(target)) return;
  methodChange.value = { target, context: context() };
}
const methodTitle = computed(() => methodChange.value?.target === 'algorithm' ? 'Join automatic matching?' : 'Switch to Browse and choose?');
const methodBody = computed(() => methodChange.value?.target === 'algorithm'
  ? 'This changes your active joining method and adds you to automatic matching. Eligible enrolled seekers can receive offers when anyone starts a concert matching round. Joining does not start a search; both you and the host approve an offer.'
  : 'This leaves the automatic matching list and activates direct requests. Your history is kept. Viewing either pathway alone never changes your enrollment.');
async function activateMode() {
  const change = methodChange.value;
  if (!change || change.context !== context() || !canSwitchMode.value) { methodChange.value = null; return; }
  const target = change.target, key = context();
  const ok = await act(async () => {
    const result = target === 'algorithm' && persistedMode.value === 'algorithm'
      ? await api.findMyGroup(concertId.value, crypto.randomUUID()) : await api.setJoiningMode(concertId.value, target);
    if (!isCurrent(key)) return;
    if (result.request) seeker.value = result.request;
    if (result.matching) applyMatching(result.matching);
    searchResult.value = null; rememberAttempt('');
    const enrolled = result.request?.joining_mode === 'algorithm' && result.request?.status === 'open';
    if (result.request) matching.value = { ...matching.value, optedIn: enrolled, state: enrolled ? 'queued' : 'idle' };
  }, target === 'algorithm' ? 'You joined automatic matching. Press Find a match when you’re ready; joining alone does not run matching.' : 'Browse and choose is now your active method. You can review and send one direct request.');
  if (isCurrent(key) && ok) methodChange.value = null;
}
async function join(id, note = applicationNote.value.trim()) {
  const key = context(), showId = concertId.value, userId = currentUser.value?.id;
  const group = groups.value.find(item => item.id === id);
  let application, recovered = false;
  return act(async () => {
    try { application = (await api.requestGroupJoin(id, { note })).request; }
    catch (err) {
      if (!isCurrent(key) || (err.status && err.status < 500 && err.message !== 'join_request_already_exists')) throw err;
      try {
        const current = await api.groupJoinRequests({ scope: 'own', concertId: showId });
        if (!isCurrent(key)) return;
        application = current.requests.find(request => request.partyId === id && request.userId === userId && request.concertId === showId && ['pending', 'accepted'].includes(request.status));
        if (!application) throw err;
        joins.value = current.requests; recovered = true;
      } catch { throw err; }
    }
    if (!isCurrent(key)) return;
    if (application) joins.value = [...joins.value.filter(item => item.id !== application.id), {
      ...application, userId, concertId: showId, partyId: id, hostName: group?.hostName,
      artist: application.artist ?? selectedConcert.value?.artist, applicationNote: application.applicationNote ?? note,
    }];
    applicationFor.value = ''; applicationNote.value = '';
  }, () => recovered ? 'Your saved request was recovered. Review its current status in My groups.' : application?.seatReserved
    ? 'Request sent. A spot is held while the host reviews it. Check the expiry time below.'
    : `Request sent. You’re ${application?.queuePosition ? `number ${application.queuePosition} ` : ''}in line without a held spot. Check the expiry time below.`);
}
function joinPool() { requestMethodChange('algorithm'); }
async function findMatch() {
  if (busy.value || !coreReady.value || !canCoordinate.value || matching.value.preferencesComplete === false
    || !matching.value.optedIn || matching.value.state !== 'queued' || confirmedGroupId.value
    || activeProposals.value.length || pendingDirect.value.length || pendingLegacy.value.length) return;
  const key = context();
  // Retain an uncertain attempt until its response is acknowledged. Retrying
  // after a lost response must not create a second matching round.
  const wasRecovering = Boolean(matchAttemptKey.value);
  if (!matchAttemptKey.value) rememberAttempt(crypto.randomUUID());
  const attempt = matchAttemptKey.value;
  let uncertainFailure = false;
  const ok = await act(async () => {
    let result;
    try { result = await api.findGroupMatch(concertId.value, attempt); }
    catch (err) {
      uncertainFailure = wasRecovering || !err.status || err.status >= 500;
      if (!uncertainFailure && isCurrent(key)) rememberAttempt('');
      throw err;
    }
    if (!isCurrent(key)) return;
    if (result.matching) applyMatching(result.matching);
    searchResult.value = result.search ?? null;
    rememberAttempt('');
  }, '');
  if (!ok && isCurrent(key) && uncertainFailure) {
    error.value = 'We couldn’t confirm the search result. Retry finding a match to safely check the same attempt.';
  }
}
function leavePool() { requestMethodChange('direct'); }
const notificationContext = computed(() => {
  if (typeof route.query.proposalId === 'string' && reads.offers.loaded && reads.matching.loaded && !reads.offers.error && !reads.matching.error)
    return automaticProposals.value.some(offer => offer.id === route.query.proposalId && offer.status === 'proposed') ? '' : 'This offer is no longer awaiting a reply. Your current group, offers and matching status are shown here.';
  if (typeof route.query.requestId === 'string' && reads.joins.loaded && !reads.joins.error)
    return ownRequests.value.some(request => request.id === route.query.requestId) ? '' : 'This request is no longer available here. Review your current requests or group below.';
  return '';
});
let focusedContext = '';
async function focusNotificationContext() {
  const id = typeof route.query.proposalId === 'string' ? `matching-proposal-${route.query.proposalId}` : typeof route.query.requestId === 'string' ? `group-request-${route.query.requestId}` : '';
  const key = `${context()}:${id}`;
  if (!id || focusedContext === key) return;
  await nextTick();
  const element = document.getElementById(id);
  if (element) { focusedContext = key; element.focus({ preventScroll: true }); element.scrollIntoView?.({ block: 'center', behavior: 'instant' }); }
}
watch(() => [route.query.proposalId, route.query.requestId], focusNotificationContext);
function proposalUpdated(proposal) {
  if (proposal?.id && proposal.role === 'seeker' && proposal.concertId === concertId.value) {
    proposals.value = [proposal, ...proposals.value.filter(saved => saved.id !== proposal.id)];
    proposalSourceRevision.offers = ++proposalReadSequence;
    if (matching.value.proposal?.id === proposal.id) matching.value = { ...matching.value, proposal };
  }
  void load();
}
function dateLabel(value) { if (!value) return ''; const date = new Date(typeof value === 'number' ? value : value.includes('T') ? value : `${value.replace(' ', 'T')}Z`); return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('en-SG', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }); }
</script>

<template>
  <div class="container groups-page">
    <GroupNavigation class="groups-page__nav" />
    <header class="groups-hero">
      <p class="groups-hero__eyebrow mono">Groups</p>
      <h1>Find your people for the show</h1>
    </header>

    <GroupPreferencesGate summary @saved="load">

    <div class="discovery-context">
    <div class="groups-concert-picker">
      <label>Which concert are you going to?
        <select v-model="concertId" :disabled="busy">
          <option value="">Pick a concert</option>
          <option v-for="concert in pickerConcerts" :key="concert.id" :value="concert.id">{{ concertOptionLabel(concert) }}</option>
        </select>
      </label>
    </div>
    </div>

    <p v-if="error" class="group-error" role="alert">{{ error }} <RouterLink v-if="failureCode === 'save_discovery_preferences_first'" to="/profile">Set up preferences in Profile</RouterLink> <button type="button" class="btn btn--ghost" :disabled="busy || loading" @click="matchAttemptKey ? findMatch() : load()">{{ matchAttemptKey ? 'Retry finding a match' : 'Try again' }}</button></p>
    <p v-if="message" class="group-success" role="status">{{ message }}</p>
    <p v-if="notificationContext" class="group-status" role="status">{{ notificationContext }}</p>
    <p v-if="concertError" class="group-read-feedback" role="status">{{ concertError }} <button type="button" class="btn btn--ghost" :disabled="concertsLoading" @click="loadConcerts">Retry concert list</button></p>
    <div v-for="name in Object.keys(sourceLabels).filter(name => reads[name].error)" :key="name" class="group-read-feedback" role="status" :data-read-error="name">
      <strong>{{ sourceLabels[name] }} unavailable.</strong> {{ reads[name].error }}
      <button type="button" class="btn btn--ghost" :disabled="reads[name].loading" @click="load(name)">Retry {{ sourceLabels[name].toLowerCase() }}</button>
    </div>
    <p v-if="refreshWarning" class="group-error" role="alert">{{ refreshWarning }} <button type="button" class="btn btn--ghost" :disabled="loading || busy" @click="load">Refresh details</button></p>
    <p v-if="selectedConcert && !canCoordinate" class="group-status" role="status">{{ isFinished ? 'This concert has finished. New group matching is closed. Your existing group, requests and conversations remain available.' : 'A valid concert date is needed before new group matching can start.' }}</p>
    <p v-if="concertsLoading" class="loading-state" role="status"><LoadingSpinner />Loading concerts…</p>
    <p v-if="busy" class="loading-state" role="status"><LoadingSpinner />Saving…</p>
    <p v-if="loading" class="loading-state" role="status"><LoadingSpinner />Finding groups…</p>

    <template v-if="concertId && currentUser">
      <section v-if="currentGroup" class="card group-panel group-panel--highlight" aria-labelledby="current-group-heading">
        <p class="group-kicker mono">You’re going with</p>
        <div class="current-group-identity">
          <GroupAvatar :src="currentGroup.imageUrl ?? currentGroup.group?.imageUrl" :name="currentGroup.name || currentGroup.group?.name || currentGroup.artist" :size="52" />
          <div>
            <h2 id="current-group-heading">{{ currentGroup.name || currentGroup.group?.name || 'Your group' }}</h2>
            <p class="group-muted">{{ currentGroup.artist }} · Hosted by {{ currentGroup.host?.displayName ?? currentGroup.group?.hostName ?? 'your concert buddy' }}</p>
          </div>
        </div>
        <p class="group-muted">{{ originLabels[currentGroup.assignmentOrigin] ?? 'You’re in' }} · {{ currentGroup.remainingCapacity }} {{ currentGroup.remainingCapacity === 1 ? 'spot' : 'spots' }} still open. You can be in one group per concert.</p>
        <div class="current-group__actions">
          <RouterLink :to="`/groups/${encodeURIComponent(currentGroup.partyId ?? currentGroup.id)}/members`" class="btn btn--primary">See your group</RouterLink>
          <RouterLink :to="`/groups/${encodeURIComponent(currentGroup.partyId ?? currentGroup.id)}/channel`" class="btn btn--ghost">Group messages</RouterLink>
          <button v-if="canPlanMeetup || meetupPlans.some(plan => plan.scope?.partyId === (currentGroup.partyId ?? currentGroup.id))" type="button" class="btn btn--ghost" @click="router.push(meetupLink({ partyId: currentGroup.partyId ?? currentGroup.id }))">{{ meetupLabel({ partyId: currentGroup.partyId ?? currentGroup.id }) }}</button>
          <!-- Last in the row: this card already says they are in a group, so
               looking at the others is one more thing to do from here, not an
               announcement that needs its own panel. -->
          <RouterLink :to="{ path: '/groups', query: { ...(concertId ? { concertId } : {}), mode: 'direct' } }" class="btn btn--ghost">View other groups</RouterLink>
        </div>
      </section>

      <section v-else-if="!seeker && reads.request.loaded && !reads.request.error && !membershipConfirmed && !currentOffer && canCoordinate" id="group-search-setup" class="card group-panel next-step">
        <div class="group-setup__heading">
          <div>
            <p class="next-step__label">Next step</p>
            <h2>{{ rememberedPlan && !editingPlan ? 'Use your usual plans for this show?' : 'First, tell us your plans' }}</h2>
            <p class="group-muted">{{ rememberedPlan && !editingPlan ? 'These are the answers you gave last time.' : 'Answer these to see the groups going.' }} Hosts can see your answers when you ask to join.</p>
          </div>
        </div>
        <div v-if="rememberedPlan && !editingPlan" class="group-panel">
          <p><strong>{{ planSummary }}</strong></p>
          <div class="group-actions">
            <button type="button" class="btn btn--primary" :disabled="busy" @click="enroll()">Use these and see groups</button>
            <button type="button" class="btn btn--ghost" :disabled="busy" @click="editingPlan = true">Change answers</button>
          </div>
        </div>
        <form v-else class="group-panel" @submit.prevent="enroll()"><fieldset :disabled="busy" class="group-fieldset group-setup__form">
          <div class="group-controls group-setup__questions">
            <label>Where do you want to be?<select v-model="form.section_pref"><option v-for="(name, id) in SECTION_OPTIONS" :key="id" :value="id">{{ name }}</option></select></label>
            <label>How much do you want to spend?<select v-model.number="form.spend_band_max"><option v-for="n in 4" :key="n" :value="n">{{ LABELS.spendBand[n] }}</option></select></label>
            <label>When do you want to get there?<select v-model="form.arrival_pref"><option v-for="(name, id) in ARRIVAL_OPTIONS" :key="id" :value="id">{{ name }}</option></select></label>
          </div>
          <details><summary>Anything you’d like to do together? (optional)</summary><fieldset><legend>Things to do</legend><label v-for="(name, id) in LABELS.plans" :key="id" class="group-check"><input v-model="form.plans_wanted[id]" type="checkbox">{{ name }}</label></fieldset></details>
          <div class="group-setup__actions"><button class="btn btn--primary group-setup__save">Save my answers</button></div>
        </fieldset></form>
      </section>

      <section v-else-if="seeker?.status === 'withdrawn' && canCoordinate" id="resume-group-search" class="card group-panel next-step">
        <p class="next-step__label">Next step</p>
        <h2>You stepped away from this show</h2>
        <p class="group-muted">Changed your mind? Pick up where you left off.</p>
        <p class="group-muted">This resumes your saved {{ persistedMode === 'algorithm' ? 'automatic matching' : 'Browse and choose' }} method. It does not start a matching round.</p>
        <button type="button" class="btn btn--primary" :disabled="busy" @click="enroll(true)">{{ persistedMode === 'algorithm' ? 'Rejoin automatic matching' : 'I’m looking again' }}</button>
      </section>

      <template v-if="seeker || currentGroup || currentOffer || reads.matching.loaded || reads.request.error">
      <!-- For a member the chooser inside is hidden, and the panels after it
           are conditional too, so without this the card renders as an empty
           white box under their group. The heading is conditional as well, so
           the label has to follow it: a dangling aria-labelledby names nothing. -->
      <section
        v-if="!currentGroup || displayedMode === 'algorithm' || activeProposals.length || pendingDirect.length"
        class="card group-panel joining-section"
        :aria-labelledby="currentGroup ? undefined : 'joining-mode-heading'"
        :aria-label="currentGroup ? 'Your matching progress' : undefined"
      >
        <!-- Someone already in a group cannot change how they joined it, so
             the chooser is only a dead end for them. Their way to the other
             groups sits in the card above, beside the rest of their actions. -->
        <template v-if="!currentGroup">
        <h2 id="joining-mode-heading">How do you want to find a group?</h2>
        <p class="group-status" role="status">{{ enrollmentSummary }}</p>
        <div class="joining-modes" role="group" aria-label="Ways to find a group">
          <article v-for="option in modeOptions" :key="option.mode" class="joining-mode" :class="{ 'joining-mode--selected': displayedMode === option.mode }">
            <div class="joining-mode__eyebrow"><p class="group-kicker mono">{{ option.kicker }}</p><span v-if="seeker && persistedMode === option.mode" class="joining-mode__selected">Active</span></div>
            <h3>{{ option.title }}</h3>
            <p>{{ option.description }}</p>
            <button type="button" class="btn" :class="displayedMode === option.mode ? 'btn--primary' : 'btn--ghost'" :aria-pressed="displayedMode === option.mode" :disabled="busy" @click="chooseMode(option.mode)">{{ modeAction(option) }}</button>
            <RouterLink v-if="option.mode === 'algorithm' && matching.preferencesComplete === false" to="/profile">Set up preferences in Profile first</RouterLink>
          </article>
        </div>
        <p v-if="seeker && !modeIsActive && !canSwitchMode" class="group-status" role="status">{{ currentGroup ? 'You already have a group for this show, so the way you join can’t change.' : pendingDirect.length ? `To switch, first cancel your request to ${requestGroupName(pendingDirect[0])} in My groups.` : activeProposals.length || pendingLegacy.length ? 'Finish or cancel your current match before switching.' : 'You can’t switch methods for this show right now.' }}</p>
        <p v-if="pendingDirect.length" class="group-status" role="status">
          {{ pendingDirect[0].seatReserved ? 'We’re saving you a spot.' : pendingDirect[0].queuePosition ? `You’re number ${pendingDirect[0].queuePosition} in line.` : 'Your request is in the group’s queue.' }}
          <span v-if="dateLabel(pendingDirect[0].expiresAt)">Your request expires {{ dateLabel(pendingDirect[0].expiresAt) }}, even if you are still waiting.</span>
        </p>
        </template>

      <section v-if="displayedMode === 'algorithm'" class="card group-panel automatic-matching" aria-label="Automatic matching progress">
        <p class="group-kicker mono">Your next step</p>
        <h2 id="automatic-matching-heading">{{ matchingProgress.title }}</h2>
        <p role="status">{{ matchingProgress.detail }}</p>
        <ol class="matching-progress" aria-label="Matching stages">
          <li :class="stepClass(0)" :aria-current="matchingProgress.phase === 1 ? 'step' : undefined"><span>1 · Preferences</span><strong>{{ matching.preferencesComplete === true ? 'Saved' : matching.preferencesComplete === false ? 'Setup needed' : 'Check in Profile' }}</strong></li>
          <li :class="stepClass(1)" :aria-current="matchingProgress.phase === 2 ? 'step' : undefined"><span>2 · Match list</span><strong>{{ confirmedGroupId ? 'Completed' : currentOffer ? 'Offer received' : matching.optedIn ? 'Joined' : 'Not joined' }}</strong></li>
          <li :class="stepClass(2)" :aria-current="matchingProgress.phase === 3 ? 'step' : undefined"><span>3 · Matching</span><strong>{{ currentOffer || confirmedGroupId ? 'Match made' : matching.optedIn ? 'No offer yet' : 'Not started' }}</strong></li>
          <li :class="stepClass(3)" :aria-current="matchingProgress.phase === 4 ? 'step' : undefined"><span>4 · Both approvals</span><strong>{{ confirmedGroupId ? 'Membership confirmed' : currentOffer ? `${currentOffer.seekerApproved ? 'You approved' : 'Your reply needed'} · ${currentOffer.hostApproved ? 'Host approved' : 'Host reply needed'}` : 'After an offer' }}</strong></li>
        </ol>
        <div class="group-actions">
          <RouterLink v-if="matching.preferencesComplete === false && !currentOffer && !membershipConfirmed" to="/profile" class="btn btn--primary">Set up preferences in Profile</RouterLink>
          <a v-else-if="activeProposals.length" href="#automatic-offers" class="btn btn--primary">Review offer</a>
          <RouterLink v-else-if="confirmedGroupId" :to="`/groups/${encodeURIComponent(confirmedGroupId)}/members`" class="btn btn--primary">Open your group</RouterLink>
          <RouterLink v-else-if="membershipConfirmed" to="/groups/connect" class="btn btn--primary">Open My groups</RouterLink>
          <a v-else-if="pendingDirect.length || pendingLegacy.length" href="#applications-heading" class="btn btn--primary">Review your request</a>
          <button v-else-if="canCoordinate && !matching.optedIn && seeker?.status === 'open'" type="button" class="btn btn--primary" :disabled="busy || !canSwitchMode" @click="joinPool">Join automatic matching</button>
          <button v-else-if="matching.optedIn && matching.state === 'queued' && matchAttemptKey" type="button" class="btn btn--primary" :disabled="busy || !coreReady || !canCoordinate" @click="findMatch">Recover previous search</button>
          <button v-else-if="matching.optedIn && matching.state === 'queued' && noMatchFound" type="button" class="btn btn--primary" :disabled="busy" @click="chooseMode('direct')">Browse and choose groups</button>
          <button v-else-if="matching.optedIn && matching.state === 'queued'" type="button" class="btn btn--primary" :disabled="busy || !coreReady || !canCoordinate" @click="findMatch">Find a match</button>
          <button v-if="matching.optedIn && matching.state === 'queued' && noMatchFound && !matchAttemptKey && !membershipConfirmed && !activeProposals.length" type="button" class="btn btn--ghost" :disabled="busy || !coreReady || !canCoordinate" @click="findMatch">Find a match</button>
          <RouterLink v-if="confirmedGroupId" :to="`/groups/${encodeURIComponent(confirmedGroupId)}/channel`" class="btn btn--ghost">Group messages</RouterLink>
          <button v-if="confirmedGroupId && (canPlanMeetup || meetupPlans.some(plan => plan.scope?.partyId === confirmedGroupId))" type="button" class="btn btn--ghost" @click="router.push(meetupLink({ partyId: confirmedGroupId }))">{{ meetupLabel({ partyId: confirmedGroupId }) }}</button>
          <button v-if="matching.optedIn && !membershipConfirmed" type="button" class="btn btn--danger-ghost" :disabled="busy || !canSwitchMode" @click="leavePool">Leave the match list</button>
        </div>
        <p v-if="lastAttempt" class="group-muted matching-last-attempt" role="status">Latest matching attempt<span v-if="dateLabel(lastAttempt.attemptedAt)"> · {{ dateLabel(lastAttempt.attemptedAt) }}</span>: {{ lastAttempt.status === 'waiting' ? 'No suitable group was found.' : lastAttempt.status === 'proposed' ? 'An offer was received in that attempt. Current offers and membership are shown separately.' : lastAttempt.status === 'confirmed' ? 'Your membership was already confirmed.' : 'An earlier attempt is recorded; its original outcome is unavailable.' }}</p>
        <div v-if="declinedOffers.length && canCoordinate" class="declined-offers" aria-label="Offers you declined">
          <h3>Offers you declined</h3>
          <p class="group-muted">Changed your mind? Bring a group back and it can be offered to you again.</p>
          <ul>
            <li v-for="offer in declinedOffers" :key="offer.id">
              <span class="declined-offers__group">
                <GroupAvatar :src="offer.imageUrl" :name="offerGroupName(offer)" :size="40" />
                <span><strong>{{ offerGroupName(offer) }}</strong><small v-if="offer.hostName">Hosted by {{ offer.hostName }}</small></span>
              </span>
              <button type="button" class="btn btn--ghost" :disabled="busy" @click="bringBack(offer)">Bring back to matching</button>
            </li>
          </ul>
        </div>
        <details class="matching-explanation"><summary>How does automatic matching work?</summary><p>Joining the list makes you eligible. Find a match starts a round for everyone on the list at this concert, so other people can get offers too. Every offer still needs your approval and the host’s.</p></details>
        <p v-if="activeProposals.length" class="group-muted">You can view browsing, but answer your match before changing your active method or sending another request.</p>
        <p v-else-if="pendingLegacy.length" class="group-muted">Answer or cancel your earlier match in My groups before leaving the match list.</p>
      </section>
      <section v-if="activeProposals.length" id="automatic-offers" aria-label="Your match"><MatchProposalCard v-for="proposal in activeProposals" :id="`matching-proposal-${proposal.id}`" :key="proposal.id" tabindex="-1" :proposal="proposal" @updated="proposalUpdated" /></section>
      </section>

      <section v-if="pendingDirect.length || pendingLegacy.length" class="pending-request-summary" aria-label="Your pending requests">
        <h2>Your pending requests</h2><p v-for="request in [...pendingDirect, ...pendingLegacy]" :key="request.id"><strong>{{ requestGroupName(request) }}</strong> · Waiting for host decision. <a :href="`#group-request-${request.id}`">View request status</a></p>
      </section>

      <!-- Search, filters and the group list are for Browse and choose; automatic matching picks for you. -->
      <template v-if="displayedMode === 'direct'">
      <section class="card group-panel discovery-search" aria-labelledby="discovery-search-heading">
        <h2 id="discovery-search-heading">Narrow it down</h2>
        <p class="group-muted discovery-search__hint">Search by name, or use <strong>Filters</strong> for seating and arrival.</p>
        <fieldset :disabled="busy" class="group-fieldset"><GroupFilters :filters="filters" preferences /></fieldset>
      </section>

      <div id="matching-group-results" class="results-heading">
        <div class="results-heading__context"><h2><template v-if="reads.groups.loaded"><span class="key-figure">{{ total }}</span> {{ total === 1 ? 'group' : 'groups' }} in these results<span v-if="reads.groups.error"> · last loaded</span></template><template v-else>Group discovery</template></h2><p v-if="displayedMode === 'direct' && pendingDirect.length" class="results-heading__hint">You’ve asked {{ pendingDirect.length }} of {{ pendingLimit }}</p></div>
        <div v-if="displayedMode === 'direct'" class="results-layout" role="group" aria-label="How to show groups">
          <button type="button" class="btn" :class="directLayout === 'compare' ? 'btn--primary' : 'btn--ghost'" :aria-pressed="directLayout === 'compare'" :disabled="busy" @click="directLayout = 'compare'; applicationFor = ''">Side by side</button>
          <button type="button" class="btn" :class="directLayout === 'list' ? 'btn--primary' : 'btn--ghost'" :aria-pressed="directLayout === 'list'" :disabled="busy" @click="directLayout = 'list'">See all</button>
        </div>
      </div>

      <GroupComparisonDeck v-if="displayedMode === 'direct'" v-show="directLayout === 'compare' && groups.length" :groups="groups" :session-key="comparisonSession" :disabled="busy || loading || directLayout !== 'compare'" :can-apply="canApply" :apply-group="confirmJoin" />

      <div v-if="directLayout === 'list'" class="group-grid">
        <GroupListingCard v-for="group in groups" :key="group.id" :group="group" :data-group-id="group.id">
          <template v-if="displayedMode === 'direct'">
            <button type="button" class="btn btn--ghost" :disabled="busy || !canApply || pendingFor(group.id) || declinedFor(group.id) || !canQueueFor(group) || group.status === 'cancelled'" @click="confirmJoin(group)">{{ pendingFor(group.id) ? 'Request sent' : declinedFor(group.id) ? 'Not this time' : !canQueueFor(group) ? 'Group is full' : group.remainingCapacity < 1 ? 'Join the waitlist' : 'Ask to join' }}</button>
            <p v-if="pendingFor(group.id)" class="group-muted">Your application is saved. Track or cancel it in My groups.</p>
            <p v-else-if="declinedFor(group.id)" class="group-muted">This group already declined your request or offer for this concert.</p>
            <p v-else-if="!canQueueFor(group) || group.status === 'cancelled'" class="group-muted">This group is not accepting new requests.</p>
            <p v-else-if="!canApply" class="group-muted">{{ !canCoordinate ? 'New group joining is closed for this concert.' : currentGroup ? 'You already have a group for this concert.' : activeProposals.length || pendingLegacy.length ? 'Resolve your current match before applying.' : pendingDirect.length ? 'You can have one pending request. Cancel it in My groups before choosing another group.' : !modeIsActive ? 'Switch to browsing before sending a request.' : 'Finish your setup before sending a request.' }}</p>
          </template>
        </GroupListingCard>
      </div>
      <p v-if="!groups.length && !loading && emptyMessage?.simple" class="group-muted no-groups" role="status">{{ emptyMessage.title }}</p>
      <section v-else-if="!groups.length && !loading && emptyMessage" class="group-empty" aria-label="Group discovery status">
        <h3>{{ emptyMessage.title }}</h3><p>{{ emptyMessage.detail }}</p>
        <button v-if="emptyMessage.action === 'offer'" type="button" class="btn btn--primary" @click="reviewOffer">Review your offer</button>
        <a v-else-if="emptyMessage.action === 'request'" href="#applications-heading">View your requests</a>
        <button v-else-if="emptyMessage.action === 'filters'" type="button" class="btn btn--ghost" @click="clearFilters">Clear filters</button>
        <RouterLink v-else-if="emptyMessage.action === 'group'" :to="confirmedGroupId ? `/groups/${encodeURIComponent(confirmedGroupId)}/members` : '/groups/connect'">Open your group</RouterLink>
        <a v-else-if="emptyMessage.action === 'resume'" href="#resume-group-search">Resume your search</a>
        <a v-else-if="emptyMessage.action === 'plans'" href="#group-search-setup">Review your concert plans</a>
        <button v-else-if="emptyMessage.action === 'status'" type="button" class="btn btn--ghost" :disabled="busy" @click="load">Check my status</button>
      </section>

      <!-- A page button exists only when that page does. Disabling them instead
           left two dead controls on every result set that fits on one page. -->
      <nav v-if="hasPreviousPage || hasNextPage" class="group-actions group-pagination" aria-label="Group results pages">
        <button v-if="hasPreviousPage" type="button" class="btn btn--ghost" :disabled="loading || busy" @click="offset = Math.max(0, offset - PAGE_SIZE); load()">Previous</button>
        <span>{{ offset + 1 }}–{{ Math.min(offset + PAGE_SIZE, total) }} of {{ total }}</span>
        <button v-if="hasNextPage" type="button" class="btn btn--ghost" :disabled="loading || busy" @click="offset += PAGE_SIZE; load()">Next</button>
      </nav>
      </template>


      </template>
    </template>
    <p v-else-if="!concertsLoading && !concerts.length" class="group-empty">No concerts yet. Check back soon!</p>
    </GroupPreferencesGate>

    <ConfirmDialog :open="Boolean(confirmingGroup)" :title="`Ask to join ${groupDisplayName(confirmingGroup)}?`" confirm-label="Send request" cancel-label="Not yet" initial-focus="cancel" :return-focus-to="confirmOpener" :busy="busy" @confirm="settleConfirm(true)" @cancel="settleConfirm(false)">
      <template v-if="confirmingGroup">
        <p class="group-muted">{{ selectedConcert?.artist }} · Hosted by {{ confirmingGroup.hostName }}</p>
        <ul class="group-muted">
          <li>The host sees your public profile, your plans for this show and why you match.</li>
          <li>You can ask {{ pendingLimit === 1 ? 'one group' : `${pendingLimit} groups` }} at a time for this concert.</li>
          <li>Sending joins the group’s request queue. Track any held spot, expiry and valid cancellation in My groups.</li>
        </ul>
        <label class="request-note"><span>Say hi to the host <span class="request-note__optional">(optional)</span></span><textarea v-model="confirmNote" :disabled="busy" maxlength="500" rows="3" placeholder="e.g. First time seeing them live, keen to grab dinner before!" /></label>
        <p v-if="confirmError" class="group-error" role="alert">{{ confirmError }}</p>
      </template>
    </ConfirmDialog>
    <ConfirmDialog :open="Boolean(methodChange)" :title="methodTitle" :body="methodBody" :confirm-label="methodChange?.target === 'algorithm' ? 'Join automatic matching' : 'Switch active method'" cancel-label="Keep current method" initial-focus="cancel" :busy="busy" @confirm="activateMode" @cancel="methodChange = null" />
  </div>
</template>

<style scoped>
.pending-request-summary h2 { font-size:var(--step-0); }
.group-empty h3 { font-size:var(--step-0); }
.matching-explanation { font-size:var(--step--1); color:var(--text-300); }
.declined-offers { display:grid; gap:var(--space-2); padding-top:var(--space-4); border-top:1px solid var(--panel-edge); }
.declined-offers h3 { margin:0; font-size:var(--step-0); }
.declined-offers p { margin:0; font-size:var(--step--1); }
.declined-offers ul { display:grid; gap:var(--space-2); margin:0; padding:0; list-style:none; }
.declined-offers li { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:var(--space-2) var(--space-3); padding:var(--space-2) var(--space-3); border:var(--border-hairline); border-radius:var(--radius-sm); }
.declined-offers__group { display:flex; align-items:center; gap:var(--space-3); min-width:0; }
.declined-offers__group > span { display:grid; gap:2px; min-width:0; }
.declined-offers__group strong { overflow-wrap:anywhere; }
.declined-offers__group small { color:var(--text-300); font-size:var(--step--1); }
.join-confirm { position: fixed; inset: 0; z-index: 2000; display: grid; place-items: center; padding: 16px; background: rgb(20 12 40 / 0.45); }
.join-confirm__panel { width: min(520px, 100%); max-height: calc(100vh - 32px); overflow: auto; }
.join-confirm__panel ul { padding-left: 1.2rem; margin: 0; display: grid; gap: 0.35rem; }
.join-confirm__panel textarea { width: 100%; }

.groups-hero {
  display: grid;
  gap: var(--space-3);
  margin-bottom: var(--space-2);
}
.groups-hero h1 {
  font-size: var(--step-5);
  line-height: 1.05;
  max-width: 20ch;
}
.groups-hero__eyebrow, .group-kicker {
  font-size: var(--step--2);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--accent-400);
}
.groups-concert-picker {
  max-width: 560px;
  width: 100%;
}
.discovery-context {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-5);
  padding: var(--space-4) var(--space-5);
  border: 1px solid var(--panel-edge);
  border-radius: var(--radius-lg);
  background: var(--panel-bg);
  box-shadow: var(--panel-shadow);
}
.discovery-search {
  border-color: color-mix(in srgb, var(--accent-400) 32%, var(--panel-edge));
}
.discovery-search__hint {
  font-size: var(--step--1);
}
.groups-concert-picker label {
  font-size: var(--step-0);
  font-weight: 600;
  color: var(--text-100);
}
.current-group-identity {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}
.current-group-identity > div {
  min-width: 0;
  display: grid;
  gap: var(--space-1);
}
.group-panel--highlight {
  border-color: var(--accent-400);
  background: linear-gradient(160deg, var(--accent-glow), transparent 60%), var(--ink-800);
}
.group-panel--bare {
  padding: 0;
}
.group-setup__heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--space-4);
  flex-wrap: wrap;
}
.group-setup__heading > div {
  display: grid;
  gap: var(--space-1);
  max-width: 60ch;
}
.joining-modes {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-4);
}
.joining-mode {
  display: grid;
  align-content: start;
  justify-items: start;
  gap: var(--space-2);
  position: relative;
  padding: var(--space-5);
  border: var(--border-soft);
  border-radius: var(--radius-lg, var(--radius-md));
  background: var(--panel-bg);
  box-shadow: var(--panel-shadow);
  transition: border-color var(--dur-base) var(--ease-settle), box-shadow var(--dur-base) var(--ease-settle), transform var(--dur-base) var(--ease-settle);
}
.joining-mode:hover {
  transform: translateY(-2px);
  box-shadow: inset 0 1px 0 var(--panel-highlight), var(--shadow-md);
}
.joining-mode--selected {
  border-color: var(--accent-400);
  background: linear-gradient(120deg, var(--accent-glow), transparent 65%), var(--panel-bg);
  box-shadow: inset 3px 0 0 var(--accent-400), var(--panel-shadow);
}
.joining-mode__eyebrow {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  width: 100%;
}
.joining-mode__selected {
  flex-shrink: 0;
  white-space: nowrap;
  padding: .2rem .55rem;
  border: 1px solid color-mix(in srgb, var(--accent-400) 40%, transparent);
  border-radius: var(--radius-pill);
  color: var(--accent-400);
  font-size: var(--step--2);
  font-weight: 700;
}
.joining-mode h3 {
  font-family: var(--font-display);
  font-size: var(--step-2);
  margin: 0;
}
.joining-mode p {
  margin: 0;
  color: var(--text-300);
}
.joining-mode .btn {
  margin-top: var(--space-3);
}
.group-status {
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-sm);
  background: var(--ink-750);
}
.group-setup__form {
  grid-template-columns: minmax(0, 1fr);
}
.group-setup__questions {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-4);
  align-items: end;
}
.group-setup__questions select {
  width: 100%;
}
@media (max-width: 720px) {
  .group-setup__questions { grid-template-columns: minmax(0, 1fr); }
}
.group-setup__actions {
  grid-column: 1 / -1;
  display: flex;
  justify-content: flex-end;
  padding-top: var(--space-4);
  border-top: 1px solid var(--panel-edge);
}
.group-setup__save {
  flex: 0 0 auto;
  width: auto;
  min-width: 11rem;
  height: auto;
  padding: var(--space-3) var(--space-5);
  border-radius: 999px;
  align-self: center;
}
.group-fieldset {
  padding: 0;
  margin: 0;
  border: 0;
  min-width: 0;
  display: grid;
  gap: var(--space-4);
  /* One column: the global .groups-page fieldset rule spreads children into
     auto-fit columns (for checkbox lists), which stretched the Save button to
     the height of the questions beside it. */
  grid-template-columns: minmax(0, 1fr);
}
.group-fieldset > .btn {
  justify-self: start;
}
.application-form {
  display: grid;
  gap: var(--space-3);
  width: 100%;
  padding-top: var(--space-3);
  border-top: 1px solid var(--panel-edge);
  animation: discovery-reveal var(--dur-base) var(--ease-settle) both;
}
.application-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding-block: var(--space-4);
  border-bottom: var(--border-hairline);
}
.application-row h3 {
  font-size: var(--step-0);
}
.application-row > div {
  flex: 1 1 16rem;
  min-width: 0;
  overflow-wrap: anywhere;
  display: grid;
  gap: var(--space-1);
}
.group-quote {
  font-style: italic;
  color: var(--text-300);
}
.group-empty {
  padding: var(--space-6);
  text-align: center;
  color: var(--text-300);
  border: 1px dashed var(--ink-500);
  border-radius: var(--radius-md);
}
.group-pagination {
  justify-content: space-between;
  padding-top: var(--space-3);
}
.group-pagination > span {
  color: var(--text-300);
  font-size: var(--step--1);
}
.automatic-matching {
  border-color: var(--accent-400);
}
.automatic-matching > p {
  max-width: 75ch;
  line-height: 1.6;
}
.matching-progress {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--space-2);
  margin: var(--space-2) 0;
  padding: 0;
  list-style: none;
}
.matching-progress li {
  display: grid;
  align-content: start;
  gap: var(--space-2);
  min-width: 0;
  padding: var(--space-3);
  border: 1px solid var(--panel-edge);
  border-radius: var(--radius-sm);
  color: var(--text-300);
  font-size: var(--step--2);
}
.matching-progress li[aria-current="step"] {
  border-color: var(--accent-400);
  background: var(--accent-glow);
}
.matching-progress strong { color: var(--text-100); font-size: var(--step--1); }
/* Finished steps are green, unfinished ones red; the current step keeps a thicker edge. */
.matching-progress li.matching-progress__step--done {
  border-color: color-mix(in srgb, var(--signal-good) 55%, transparent);
  background: color-mix(in srgb, var(--signal-good) 10%, transparent);
}
.matching-progress li.matching-progress__step--done strong { color: var(--signal-good); }
.matching-progress li.matching-progress__step--todo {
  border-color: color-mix(in srgb, var(--signal-bad) 55%, transparent);
  background: color-mix(in srgb, var(--signal-bad) 8%, transparent);
}
.matching-progress li.matching-progress__step--todo strong { color: var(--signal-bad); }
.matching-progress li[aria-current="step"] { box-shadow: inset 0 0 0 1px currentColor; }
.matching-progress li.matching-progress__step--done[aria-current="step"] { color: var(--signal-good); }
.matching-progress li.matching-progress__step--todo[aria-current="step"] { color: var(--signal-bad); }
.matching-progress li[aria-current="step"] > span { color: var(--text-300); }
.matching-priority-feedback { color: var(--text-100); font-size: var(--step--1); padding: var(--space-3); border-left: 2px solid var(--accent-400); background: var(--accent-glow); }
.matching-priority-feedback span { display: block; margin-top: var(--space-2); color: var(--text-300); }
.results-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--space-3);
  padding: var(--space-4) 0;
  border-block: 1px solid var(--panel-edge);
}
.results-heading__context {
  display: grid;
  gap: var(--space-1);
}
.results-heading__hint {
  color: var(--text-300);
  font-size: var(--step--1);
}
.results-layout {
  display: inline-flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  padding: var(--space-1);
  border: 1px solid var(--panel-edge);
  border-radius: var(--radius-md);
  background: var(--ink-850);
  box-shadow: inset 0 1px 3px color-mix(in srgb, var(--text-100) 6%, transparent);
}
@keyframes discovery-reveal {
  from { opacity: 0; transform: translateY(-5px); }
  to { opacity: 1; transform: translateY(0); }
}
@media (prefers-reduced-motion: reduce) {
  .joining-mode, .joining-mode:hover {
    transition: none;
    transform: none;
  }
  .application-form { animation: none; }
}
@media (max-width: 600px) {
  .matching-progress { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .discovery-context {
    display: grid;
    gap: var(--space-3);
    padding: var(--space-4);
  }
  .joining-modes {
    grid-template-columns: minmax(0, 1fr);
  }
  .groups-hero h1 {
    font-size: var(--step-4);
  }
}
@media (max-width: 480px) {
  .joining-modes .btn {
    width: 100%;
  }
  .group-pagination .btn {
    flex: 0 1 auto;
  }
}
/* The note in the "Ask to join" dialog: a full-width field like the rest of the app. */
.request-note { display:grid; gap:var(--space-2); margin-top:var(--space-4); color:var(--text-200); font-size:var(--step--1); font-weight:600; }
.request-note__optional { color:var(--text-400); font-weight:400; }
.request-note textarea { width:100%; min-height:5.5rem; box-sizing:border-box; padding:var(--space-3); border:var(--border-soft); border-radius:var(--radius-md); background:var(--field-bg); color:var(--text-100); font:inherit; font-weight:400; line-height:1.5; resize:vertical; }
.request-note textarea:focus-visible { outline:2px solid var(--accent-400); outline-offset:1px; }
/* The plain line shown when no group suits the person. */
.no-groups { margin:0; padding:var(--space-4) 0; text-align:left; }
/* "You're going with" buttons: always a 2 × 2 grid of equal-width buttons
   (a single column only on very small phones). */
.current-group__actions { display: grid; grid-template-columns: repeat(2, minmax(0, 15rem)); gap: var(--space-2); max-width: 100%; }
@media (max-width: 560px) { .current-group__actions { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 360px) { .current-group__actions { grid-template-columns: 1fr; } }
.current-group__actions .btn { width: 100%; justify-content: center; text-align: center; white-space: normal; }
</style>
