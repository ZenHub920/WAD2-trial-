<script setup>
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, LABELS, SECTION_OPTIONS, ARRIVAL_OPTIONS } from '../api.js';
import { useMeetupSummaries } from '../composables/useMeetupSummaries.js';
import { meetupDestination, meetupActionForScope, meetupNeedsAttention, isMeetupHistorical, meetupsForScope } from '../utils/meetupSummaries.js';
import { concertGroupCreationEligibility, concertParticipationEligibility } from '../../../shared/concertEligibility.mjs';
import { meetupDatePolicy } from '../../../shared/meetupDates.mjs';
import { filterGroups } from '../groupFilters.js';
import GroupFilters from '../components/GroupFilters.vue';
import GroupListingCard from '../components/GroupListingCard.vue';
import GroupApplicationCard from '../components/GroupApplicationCard.vue';
import MatchProposalCard from '../components/MatchProposalCard.vue';
import GroupNavigation from '../components/GroupNavigation.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
import LoadingSpinner from '../components/LoadingSpinner.vue';
import GroupAvatar from '../components/GroupAvatar.vue';
import AvatarPicker from '../components/AvatarPicker.vue';
import GroupPreferencesGate from '../components/GroupPreferencesGate.vue';
import '../assets/groups.css';
import { currentUser } from '../auth.js';

const route = useRoute(), router = useRouter();
const { plans: meetupPlans } = useMeetupSummaries();
const meetupAttentionCount = computed(() => meetupPlans.value.filter(meetupNeedsAttention).length);
const upcomingMeetupCount = computed(() => meetupPlans.value.filter(plan => plan.status === 'confirmed' && !isMeetupHistorical(plan)).length);
const meetupLink = scope => meetupDestination(meetupPlans.value, scope, { from: 'groups' });
const meetupLabel = scope => meetupActionForScope(meetupPlans.value, scope);
const hasMeetup = scope => meetupsForScope(meetupPlans.value, scope).length > 0;
const hosted = ref([]), candidates = ref([]), connections = ref([]), joins = ref([]);
const attendance = ref([]), myRequests = ref([]);
const automaticOffers = ref([]);
const loading = ref(false), busy = ref(false), candidateError = ref('');
const error = ref(''), message = ref(''), refreshWarning = ref('');
const offset = ref(0), total = ref(0);
/** One screen of candidates; the server pages in the same size. */
const PAGE_SIZE = 20;
const hasPreviousPage = computed(() => offset.value > 0);
const hasNextPage = computed(() => offset.value + PAGE_SIZE < total.value);
const allConcerts = ref([]), hostConcertId = ref('');
const concertNow = ref(Date.now()), concertNotice = ref('');
const eligibleConcerts = computed(() => allConcerts.value.filter(concert => concertGroupCreationEligibility(concert, concertNow.value).eligible));
const selectedConcert = computed(() => allConcerts.value.find(concert => concert.id === hostConcertId.value));
const selectedConcertEligible = computed(() => Boolean(selectedConcert.value && concertGroupCreationEligibility(selectedConcert.value, concertNow.value).eligible));
const hostForm = reactive({ name: '', capacity: 2, section: 'standing_pen', spend_band: 2, arrival_plan: 'doors', plans: {}, notes: '' });
const hostImage = ref(null);
const createdDraftId = ref(''), createdDraftNote = ref('');
const uncertainCreation = ref(null);
// Highlight missing fields only after the first attempt to create.
const attempted = ref(false);
const capacityValid = computed(() => Number.isInteger(hostForm.capacity) && hostForm.capacity >= 1);
const fieldState = filled => ({ 'field-ok': filled, 'field-error': attempted.value && !filled });
const groupTitle = g => g.name || g.group?.name || g.artist;
const filters = reactive({ query: '', section: '', minCapacity: 0, spendBand: '', arrival: '', activity: '', vibe: '', sort: 'compatibility' });
const mode = computed(() => ['create', 'connections'].includes(route.query.view) ? route.query.view : 'dashboard');
const concertId = computed(() => typeof route.query.concertId === 'string' ? route.query.concertId : '');
const groupEligibility = group => concertParticipationEligibility({ event_date: group.eventDate, event_timezone: group.eventTimezone }, concertNow.value);
const connectionEligible = connection => groupEligibility(connection.partyA).eligible && groupEligibility(connection.partyB).eligible;
const canOpenMeetup = (group, scope) => hasMeetup(scope) || meetupDatePolicy({ event_date: group.eventDate, event_time: group.eventTime, event_timezone: group.eventTimezone }, concertNow.value).canSchedule;
const activeGroups = computed(() => hosted.value.filter(g => g.status !== 'cancelled' && groupEligibility(g).eligible));
const cancelledGroups = computed(() => hosted.value.filter(g => g.status === 'cancelled'));
const joinedGroups = computed(() => attendance.value.filter(g => !hosted.value.some(owned => owned.id === g.id)));
const upcomingJoinedGroups = computed(() => joinedGroups.value.filter(g => groupEligibility(g).eligible));
const historicalGroups = computed(() => [
  ...hosted.value.filter(g => g.status !== 'cancelled' && !groupEligibility(g).eligible).map(g => ({ ...g, owned: true })),
  ...joinedGroups.value.filter(g => !groupEligibility(g).eligible).map(g => ({ ...g, owned: false })),
]);
const historicalTitle = computed(() => historicalGroups.value.some(group => groupEligibility(group).reason === 'concert_date_unavailable') ? 'Past concerts & undated groups' : 'Past concert groups');
const membershipSource = { friend: 'Joined through a friend invitation', join: 'Joined through an approved request', proposal: 'Joined through matching', direct: 'Joined through an approved direct application', algorithm: 'Joined through a confirmed automatic match' };
const sourceGroup = computed(() => activeGroups.value.find(g => g.id === route.query.groupId) ?? null);
const sourceId = computed(() => sourceGroup.value?.id ?? '');
const visible = computed(() => filterGroups(candidates.value, filters));
const pendingJoins = computed(() => joins.value.filter(j => j.status === 'pending'));
const historicalJoins = computed(() => joins.value.filter(j => j.status !== 'pending'));
const admissionQueues = computed(() => {
  const entries = [
    ...pendingJoins.value.map(record => ({ kind: 'direct', key: `direct:${record.id}`, record })),
    ...automaticOffers.value.map(record => ({ kind: 'algorithm', key: `algorithm:${record.id}`, record })),
  ].sort((a, b) => (a.record.queueOrder ?? Number.MAX_SAFE_INTEGER) - (b.record.queueOrder ?? Number.MAX_SAFE_INTEGER)
    || String(a.record.createdAt ?? '').localeCompare(String(b.record.createdAt ?? '')) || a.key.localeCompare(b.key));
  const queues = new Map();
  for (const entry of entries) {
    const partyId = entry.record.partyId;
    if (!queues.has(partyId)) {
      const group = hosted.value.find(owned => owned.id === partyId);
      queues.set(partyId, { partyId, name: group ? groupTitle(group) : `${entry.record.hostName}'s group`, artist: entry.record.artist, entries: [] });
    }
    queues.get(partyId).entries.push(entry);
  }
  return [...queues.values()];
});
const incomingCount = computed(() => pendingJoins.value.length + automaticOffers.value.length);
const shownConnections = computed(() => mode.value === 'connections'
  ? connections.value.filter(c => c.partyA.id === sourceId.value || c.partyB.id === sourceId.value)
  : connections.value);
const incoming = computed(() => shownConnections.value.filter(c => c.incoming && c.status === 'pending'));
const outgoing = computed(() => shownConnections.value.filter(c => !c.incoming && c.status === 'pending'));
const accepted = computed(() => shownConnections.value.filter(c => c.status === 'accepted'));
const canConnect = computed(() => Boolean(sourceGroup.value?.settings?.published && sourceGroup.value.settings.connect_open));
const pageTitle = computed(() => mode.value === 'create' ? 'Create a group' : mode.value === 'connections' ? 'Connect groups' : 'My groups');
const sectionName = key => LABELS.section[key] ?? key;
const describe = c => `${c.partyA.name || c.partyA.hostName} (${sectionName(c.partyA.section)}) ↔ ${c.partyB.name || c.partyB.hostName} (${sectionName(c.partyB.section)}), ${c.partyA.artist}`;
let generation = 0, sessionGeneration = 0, operationGeneration = 0, alive = true, filterTimer, concertClock;
const groupSourceKeys = ['owned', 'joined', 'myRequests', 'connections', 'applications', 'offers'];
const sources = {
  concerts: { label: 'concerts', load: () => api.concerts(), apply: result => {
    allConcerts.value = result.concerts; concertNow.value = Date.now(); selectConcert(concertId.value);
  } },
  owned: { label: 'owned groups', load: async context => {
    const result = await api.hostedGroups();
    if (!contextIsCurrent(context.session, context.user)) return [];
    return Promise.all(result.groups.map(async group => {
      if (group.status === 'cancelled' || group.settings) return group;
      const membership = await api.groupMembership(group.id);
      return { ...group, settings: membership.group.settings };
    }));
  }, apply: result => { hosted.value = result; } },
  joined: { label: 'joined groups', load: () => api.currentGroupMemberships(), apply: result => { attendance.value = result.groups ?? result.memberships ?? []; } },
  myRequests: { label: 'your join requests', load: () => api.groupJoinRequests({ scope: 'own' }), apply: result => { myRequests.value = result.requests.filter(r => r.userId === currentUser.value?.id && r.status === 'pending'); } },
  connections: { label: 'invitations', load: () => api.groupConnections(), apply: result => { connections.value = result.connections; } },
  applications: { label: 'applications', load: () => api.hostedGroupJoinRequests(), apply: result => { joins.value = result.requests.filter(j => j.hostId === currentUser.value?.id); } },
  offers: { label: 'automatic offers', load: () => api.myProposals(), apply: result => { automaticOffers.value = result.proposals.filter(proposal => proposal.role === 'host' && proposal.status === 'proposed'); } },
};
const reads = reactive(Object.fromEntries(Object.keys(sources).map(key => [key, { loading: false, loaded: false, error: '', sequence: 0 }])));
const groupsLoading = computed(() => groupSourceKeys.every(key => !reads[key].loaded && !reads[key].error) && groupSourceKeys.some(key => reads[key].loading));
const creationDisabled = computed(() => busy.value || reads.concerts.loading || Boolean(uncertainCreation.value));
const contextIsCurrent = (session, user) => alive && session === sessionGeneration && user === currentUser.value?.id;

function unavailableConcertMessage(concert) {
  const reason = concert && concertGroupCreationEligibility(concert, concertNow.value).reason;
  return reason === 'concert_started' ? 'This concert has already started. Choose another upcoming concert.'
    : reason === 'concert_day_ended' ? 'This concert has already finished. Choose another upcoming concert.'
      : 'This concert is unavailable for a new group. Choose an upcoming concert.';
}
function selectConcert(id) {
  concertNotice.value = '';
  const requested = allConcerts.value.find(concert => concert.id === id);
  if (id && (!requested || !concertGroupCreationEligibility(requested, concertNow.value).eligible)) {
    hostConcertId.value = ''; concertNotice.value = unavailableConcertMessage(requested);
  } else hostConcertId.value = id || eligibleConcerts.value[0]?.id || '';
}
watch(hostConcertId, id => { if (id && selectedConcertEligible.value) concertNotice.value = ''; });
watch(eligibleConcerts, () => {
  if (hostConcertId.value && !selectedConcertEligible.value) {
    concertNotice.value = unavailableConcertMessage(selectedConcert.value); hostConcertId.value = '';
  }
});

function viewLink(view, group) {
  return { path: '/groups/connect', query: { concertId: group?.concertId || concertId.value || undefined, view: view || undefined, groupId: group?.id } };
}

/** SQLite writes UTC timestamps without a zone marker. */
function whenConnected(value) {
  if (!value) return '';
  const date = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' });
}

function otherParty(connection) {
  const { partyA, partyB, initiatorPartyId, incoming } = connection;
  const initiator = partyA.id === initiatorPartyId ? partyA : partyB;
  const receiver = initiator === partyA ? partyB : partyA;
  return incoming ? initiator : receiver;
}

const confirming = ref(null);
const confirmCopy = computed(() => {
  const state = confirming.value;
  if (!state) return { title: '', body: '', label: 'Confirm' };
  const host = otherParty(state.connection).hostName;
  return state.kind === 'decline'
    ? { title: 'Decline this invitation?', body: `${host}'s group will not be connected to yours, and the invitation leaves your list.`, label: 'Decline' }
    : { title: 'Cancel this invitation?', body: `Your invitation to ${host}'s group will be withdrawn. You can invite them again later.`, label: 'Cancel invitation' };
});

async function runConfirmed() {
  const state = confirming.value;
  if (!state) return;
  confirming.value = null;
  await act(() => state.kind === 'decline'
    ? api.respondToGroup(state.connection.id, 'decline')
    : api.cancelGroupInvite(state.connection.id));
}

async function loadCandidates() {
  const current = ++generation, group = sourceGroup.value, user = currentUser.value?.id;
  candidates.value = []; total.value = 0;
  candidateError.value = '';
  if (mode.value !== 'connections' || !group || !canConnect.value) { loading.value = false; return; }
  loading.value = true;
  try {
    const result = await api.connectionCandidates(group.concertId, group.id, {
      offset: offset.value, q: filters.query, section: filters.section, arrival: filters.arrival,
      spendBand: filters.spendBand, minCapacity: filters.minCapacity, activity: filters.activity, vibe: filters.vibe, sort: filters.sort,
    });
    if (alive && current === generation && currentUser.value?.id === user) { candidates.value = result.groups; total.value = result.total; }
  } catch (e) {
    if (alive && current === generation && currentUser.value?.id === user) candidateError.value = 'Could not load groups to connect with. Please try again.';
  } finally {
    if (alive && current === generation) loading.value = false;
  }
}

async function loadSource(key, { force = false } = {}) {
  const state = reads[key], source = sources[key];
  if (!currentUser.value?.id || (state.loading && !force)) return false;
  const sequence = ++state.sequence, session = sessionGeneration, user = currentUser.value.id;
  state.loading = true; state.error = '';
  try {
    const result = await source.load({ session, user });
    if (!contextIsCurrent(session, user) || sequence !== state.sequence) return false;
    source.apply(result); state.loaded = true;
    return true;
  } catch (e) {
    if (contextIsCurrent(session, user) && sequence === state.sequence)
      state.error = e.status === 401 ? `Sign in again to load ${source.label}.` : `Could not load ${source.label}.`;
    return false;
  } finally {
    if (contextIsCurrent(session, user) && sequence === state.sequence) state.loading = false;
  }
}
async function refresh({ onlyFailed = false, force = false } = {}) {
  const failed = groupSourceKeys.filter(key => reads[key].error);
  const keys = onlyFailed && failed.length ? failed : groupSourceKeys;
  return (await Promise.all(keys.map(key => loadSource(key, { force })))).every(Boolean);
}
watch(() => [sourceGroup.value, canConnect.value, mode.value], () => { void loadCandidates(); });

watch(() => [route.query.view, route.query.groupId], () => {
  message.value = ''; offset.value = 0; confirming.value = null;
});
watch(() => Object.values(filters), () => {
  clearTimeout(filterTimer);
  filterTimer = setTimeout(() => { offset.value = 0; loadCandidates(); }, 250);
});
watch(() => currentUser.value?.id, () => {
  sessionGeneration++; operationGeneration++; generation++;
  hosted.value = []; attendance.value = []; myRequests.value = []; connections.value = []; joins.value = []; automaticOffers.value = []; candidates.value = []; error.value = ''; message.value = ''; refreshWarning.value = '';
  createdDraftId.value = ''; createdDraftNote.value = ''; uncertainCreation.value = null; busy.value = false; candidateError.value = '';
  hostForm.name = ''; hostForm.notes = ''; hostImage.value = null; attempted.value = false;
  allConcerts.value = []; hostConcertId.value = ''; concertNotice.value = '';
  for (const state of Object.values(reads)) { state.sequence++; state.loading = false; state.loaded = false; state.error = ''; }
  if (currentUser.value) { void loadSource('concerts'); void refresh(); }
});
watch(concertId, id => {
  if (allConcerts.value.length) { concertNow.value = Date.now(); selectConcert(id); }
});

onMounted(() => {
  concertClock = setInterval(() => { concertNow.value = Date.now(); }, 60000);
  void loadSource('concerts'); void refresh();
});
onUnmounted(() => { alive = false; sessionGeneration++; generation++; clearTimeout(filterTimer); clearInterval(concertClock); });

async function act(operation) {
  if (busy.value) return;
  const userId = currentUser.value?.id, session = sessionGeneration, operationId = ++operationGeneration;
  if (!userId) return;
  busy.value = true; error.value = ''; message.value = ''; refreshWarning.value = '';
  try {
    const result = await operation();
    if (contextIsCurrent(session, userId)) {
      message.value = result?.feedback ?? 'Group updated.';
      if (!await refresh({ force: true }) && contextIsCurrent(session, userId))
        refreshWarning.value = 'The update was saved, but the latest group details could not be loaded. Retry the refresh before making another change.';
    }
  }
  catch (e) {
    if (contextIsCurrent(session, userId)) {
      await refresh({ force: true });
      if (!contextIsCurrent(session, userId)) return;
      error.value = ({
        group_not_open_to_connections: 'Both groups must be published and open to meeting other groups. Update your group settings first.',
        group_changed_withdraw_and_resubmit: 'The group changed after this application. Ask the applicant to review it, withdraw and apply again.',
        preferences_changed_withdraw_and_resubmit: 'The applicant changed their preferences. They must withdraw and apply again with their latest answers.',
        group_unavailable: 'There is no eligible place available now. Review the updated capacity and group settings.',
        seat_capacity_exceeded: 'The final place was reserved by another action. Review the updated capacity.',
        active_seat_claim_exists: 'The applicant already has another offer or confirmed place for this concert.',
        active_matching_proposal_exists: 'The applicant already has an automatic matching offer to resolve.',
        already_in_concert_group: 'The applicant has already joined another group for this concert.',
        joining_mode_changed: 'The applicant changed joining methods. This application can no longer be approved.',
        request_not_pending: 'This application was already resolved or expired. The inbox has been refreshed.',
        queue_head_required: 'An earlier request must be resolved first. The queue has been refreshed.',
        request_waiting_in_queue: 'An earlier request must be resolved first. The queue has been refreshed.',
        concert_no_longer_upcoming: 'This concert has already started or finished. Choose another upcoming concert.',
        concert_date_unavailable: 'This concert does not have a valid date. Choose another upcoming concert.',
        concert_not_found: 'This concert is no longer available. Choose another upcoming concert.',
      })[e.message] ?? (e.status === 409 ? 'This group or request has changed. Review the latest information before trying again.' : 'Could not update the group. Please try again.');
    }
  } finally { if (contextIsCurrent(session, userId) && operationId === operationGeneration) busy.value = false; }
}
async function retry() {
  const session = sessionGeneration, user = currentUser.value?.id;
  error.value = '';
  if (await refresh({ onlyFailed: true }) && contextIsCurrent(session, user)) refreshWarning.value = '';
}
async function retrySource(key) {
  const session = sessionGeneration, user = currentUser.value?.id;
  if (await loadSource(key) && contextIsCurrent(session, user) && !groupSourceKeys.some(source => reads[source].error)) refreshWarning.value = '';
}
async function host() {
  if (busy.value) return;
  const userId = currentUser.value?.id, session = sessionGeneration;
  if (!userId) return;
  if (createdDraftId.value) {
    await act(() => openCreatedDraft()); return;
  }
  if (uncertainCreation.value) {
    await act(() => reconcileCreation(uncertainCreation.value)); return;
  }
  attempted.value = true;
  concertNow.value = Date.now();
  if (!selectedConcertEligible.value) {
    error.value = selectedConcert.value ? unavailableConcertMessage(selectedConcert.value) : 'Choose an upcoming concert before creating your group.';
    message.value = ''; return;
  }
  if (!hostForm.name.trim() || !capacityValid.value) {
    error.value = 'Fill in the highlighted fields to create your group.';
    message.value = '';
    return;
  }
  const submission = { concertId: hostConcertId.value, path: route.fullPath,
    form: { ...hostForm, plans: { ...hostForm.plans }, name: hostForm.name.trim() }, image: hostImage.value, userId, session };
  await act(async () => {
    let result;
    try { result = await api.createParty(submission.concertId, submission.form); }
    catch (e) {
      if (!contextIsCurrent(session, userId)) return;
      // A lost response and the one-host-per-concert constraint are resolved
      // against authoritative records before allowing another creation attempt.
      if (!e.status || e.status >= 500 || e.status === 409 && ['could_not_create_party', 'already_in_concert_group'].includes(e.message)) {
        submission.conflict = e.status === 409;
        uncertainCreation.value = submission;
        return reconcileCreation(submission);
      }
      throw e;
    }
    if (!contextIsCurrent(session, userId)) return;
    createdDraftId.value = result.party.id;
    createdDraftNote.value = 'Your draft group was created. Open it to continue setup.';
    const warnings = [];
    try { await api.configureGroup(result.party.id, { expectedFriends: 0 }); }
    catch { warnings.push('its settings still need to be saved in Manage group'); }
    if (!contextIsCurrent(session, userId)) return;
    if (submission.image) {
      try { await api.setGroupImage(result.party.id, submission.image); }
      catch { warnings.push('its picture could not be saved; add a picture in Manage group'); }
    }
    if (!contextIsCurrent(session, userId)) return;
    if (warnings.length) createdDraftNote.value = `Your draft group was created, but ${warnings.join(' and ')}.`;
    // Keep partial setup warnings visible instead of losing them on navigation.
    else if (route.fullPath === submission.path && mode.value === 'create') await openCreatedDraft();
  });
}
async function reconcileCreation(submission) {
  const outcome = { feedback: '' };
  if (!submission || !contextIsCurrent(submission.session, submission.userId)) return outcome;
  let result;
  try { result = await api.hostedGroups(); }
  catch {
    if (contextIsCurrent(submission.session, submission.userId))
      createdDraftNote.value = 'The creation response was interrupted and your groups could not be checked. Check group creation before trying to create another group.';
    return outcome;
  }
  if (!contextIsCurrent(submission.session, submission.userId)) return outcome;
  const existing = result.groups.filter(group => group.concertId === submission.concertId && group.status !== 'cancelled');
  if (existing.length === 1) {
    createdDraftId.value = existing[0].id; uncertainCreation.value = null;
    createdDraftNote.value = 'A group you own for this concert was found. Open it to review its settings and picture; no second group was created.';
  } else if (!existing.length) {
    uncertainCreation.value = null; createdDraftNote.value = '';
    error.value = submission.conflict
      ? 'You may already belong to another group for this concert. Review Groups I joined in My groups before trying to create another group. Your answers are kept.'
      : 'No created group was found. Your answers are kept; try Create draft group again.';
  } else {
    createdDraftNote.value = 'Your group records need to be reviewed in My groups before another group can be created.';
  }
  return outcome;
}
async function openCreatedDraft() {
  const session = sessionGeneration, user = currentUser.value?.id, id = createdDraftId.value;
  if (!id || !user) return;
  const explainFailure = () => {
    if (!contextIsCurrent(session, user)) return;
    const note = 'The page could not open; try Open created group again.';
    if (!createdDraftNote.value.includes(note)) createdDraftNote.value = `${createdDraftNote.value || 'Your group exists.'} ${note}`;
  };
  try {
    const failure = await router.push(`/groups/${encodeURIComponent(id)}/members`);
    if (failure) explainFailure();
  } catch { explainFailure(); }
}
</script>

<template>
  <div class="container groups-page">
    <GroupNavigation class="groups-page__nav" />
    <header class="page-heading">
      <div>
        <h1>{{ pageTitle }}</h1>
        <p v-if="mode === 'dashboard'">Groups you own and groups you have joined, with requests and next steps in one place.</p>
        <p v-else-if="mode === 'create'">Start with a draft, then invite friends and publish when your group is ready.</p>
        <p v-else>Meet another group at the same concert. Connecting groups does not merge their members.</p>
      </div>
      <div v-if="mode === 'dashboard'" class="group-actions"><RouterLink to="/meetups" class="btn btn--ghost">My meetups</RouterLink></div>
    </header>
    <GroupPreferencesGate :summary="mode === 'dashboard'" @saved="retry">
    <p v-if="error" class="group-error" role="alert">{{ error }} <button class="btn btn--ghost" :disabled="busy || groupsLoading" @click="retry">Retry</button></p>
    <p v-if="message" class="group-success" role="status">{{ message }}</p>
    <p v-if="refreshWarning" class="group-muted" role="status">{{ refreshWarning }} <button type="button" class="btn btn--ghost" :disabled="busy || groupsLoading" @click="retry">Retry refresh</button></p>
    <p v-if="busy && !confirming" class="loading-state" role="status"><LoadingSpinner />Updating your groups and connections…</p>
    <p v-if="groupsLoading" class="loading-state" role="status"><LoadingSpinner />Loading your groups…</p>
    <template v-for="(state, key) in reads" :key="key">
      <p v-if="state.error" class="group-read-feedback group-muted" role="status">{{ state.error }} {{ state.loaded ? 'Showing the last loaded details.' : 'Other group sections are still available.' }} <button type="button" class="btn btn--ghost" :disabled="state.loading || busy" @click="retrySource(key)">Retry {{ sources[key].label }}</button></p>
      <p v-else-if="state.loading && !groupsLoading" class="group-muted" role="status">Loading {{ sources[key].label }}…</p>
    </template>

    <template v-if="mode === 'create'">
      <form class="card group-panel create-form" novalidate @submit.prevent="host">
        <template v-if="!createdDraftId">
        <p v-if="uncertainCreation" class="group-read-feedback" role="status">{{ createdDraftNote }} <button type="button" class="btn btn--primary" :disabled="busy" @click="host">Check group creation</button></p>
        <section class="form-section">
          <h2>Name your group</h2>
          <div class="form-grid">
            <label class="form-wide">Group name<input v-model="hostForm.name" type="text" maxlength="60" required placeholder="e.g. Front Row Crew" :disabled="creationDisabled" :class="fieldState(Boolean(hostForm.name.trim()))" :aria-invalid="attempted && !hostForm.name.trim()"><span v-if="attempted && !hostForm.name.trim()" class="field-message">Enter a name for your group.</span><span v-else class="field-hint">This is what other people see. Up to 60 characters.</span></label>
            <div class="form-wide group-picture-field">
              <span>Group picture <span class="field-hint">(optional)</span></span>
              <AvatarPicker :src="hostImage" :name="hostForm.name" :busy="creationDisabled" :size="72" @select="image => hostImage = image" @remove="hostImage = null">
                <template #preview><GroupAvatar :src="hostImage" :name="hostForm.name" :size="72" /></template>
              </AvatarPicker>
            </div>
          </div>
        </section>
        <section class="form-section">
          <h2>Concert and group preferences</h2>
          <p class="group-muted">Your group stays private as a draft until you publish it from Manage group. You can invite friends there first. Your saved preferences are added to the group automatically.</p>
          <div class="form-grid">
            <label class="form-wide">Concert<select v-model="hostConcertId" required :disabled="creationDisabled || !eligibleConcerts.length" :aria-describedby="concertNotice ? 'creation-concert-notice' : reads.concerts.loaded && !eligibleConcerts.length ? 'creation-concert-empty' : undefined"><option value="" disabled>{{ reads.concerts.loading ? 'Loading concerts…' : reads.concerts.error ? 'Concert options unavailable' : eligibleConcerts.length ? 'Choose an upcoming concert' : 'No upcoming concerts available' }}</option><option v-for="c in eligibleConcerts" :key="c.id" :value="c.id">{{ c.artist }}, {{ c.event_date }}</option></select></label>
            <p v-if="concertNotice" id="creation-concert-notice" class="form-wide group-muted" role="status">{{ concertNotice }}</p>
            <p v-if="reads.concerts.loaded && !reads.concerts.error && !eligibleConcerts.length" id="creation-concert-empty" class="form-wide group-muted" role="status">No upcoming concerts are available for a new group. Your existing groups are still available in My groups.</p>
            <div v-if="selectedConcert" class="form-wide venue-layout">
              <div class="venue-layout__heading">
                <div><span class="group-muted">Venue</span><strong>{{ selectedConcert.venue }}</strong></div>
                <a v-if="selectedConcert.seatmap_url" :href="selectedConcert.seatmap_url" target="_blank" rel="noopener noreferrer">View concert seating plan ↗</a>
                <a v-else-if="selectedConcert.official_url" :href="selectedConcert.official_url" target="_blank" rel="noopener noreferrer">Check seating on Ticketmaster ↗</a>
              </div>
              <p v-if="!selectedConcert.seatmap_url" class="group-muted">{{ selectedConcert.source === 'ticketmaster' ? 'Ticketmaster has not provided a seating plan for this concert.' : 'A seating plan is not available for this concert.' }}</p>
            </div>
            <label>Group size<input v-model.number="hostForm.capacity" type="number" min="1" step="1" required :disabled="creationDisabled" :class="fieldState(capacityValid)" :aria-invalid="attempted && !capacityValid"><span v-if="attempted && !capacityValid" class="field-message">Enter a number, 1 or more.</span><span v-else class="field-hint">New companion places, excluding you and invited friends.</span></label>
            <label>Seating preference<select v-model="hostForm.section" :disabled="creationDisabled"><option v-for="(name, id) in SECTION_OPTIONS" :key="id" :value="id">{{ name }}</option></select><span class="field-hint">General categories, not confirmed venue sections.</span></label>
            <label>Spending budget<select v-model.number="hostForm.spend_band" :disabled="creationDisabled"><option v-for="n in 4" :key="n" :value="n">{{ LABELS.spendBand[n] }}</option></select></label>
            <label>Arrival<select v-model="hostForm.arrival_plan" :disabled="creationDisabled"><option v-for="(name, id) in ARRIVAL_OPTIONS" :key="id" :value="id">{{ name }}</option></select></label>
          </div>
        </section>
        <section class="form-section">
          <h2>Optional extras</h2>
          <label>Group notes (visible after publishing)<textarea v-model="hostForm.notes" maxlength="2000" rows="3" :disabled="creationDisabled"></textarea></label>
          <fieldset><legend>Group activities</legend><label v-for="(name, id) in LABELS.plans" :key="id" class="group-check"><input v-model="hostForm.plans[id]" type="checkbox" :disabled="creationDisabled">{{ name }}</label></fieldset>
        </section>
        <div class="group-actions"><button class="btn btn--primary" :disabled="creationDisabled || !selectedConcertEligible">{{ busy ? 'Creating…' : 'Create draft group' }}</button><RouterLink :to="viewLink()" class="btn btn--ghost">Back to My groups</RouterLink></div>
        </template>
        <template v-else><h2>Your group is ready to open</h2><p role="status">{{ createdDraftNote }}</p><div class="group-actions"><button type="button" class="btn btn--primary" :disabled="busy" @click="host">Open created group</button><RouterLink :to="viewLink()" class="btn btn--ghost">Back to My groups</RouterLink></div></template>
      </form>
    </template>

    <template v-else-if="!groupsLoading">
      <nav v-if="mode === 'dashboard'" class="workspace-overview" aria-label="Group workspace sections">
        <a href="#owned-heading"><span class="workspace-overview__value">{{ activeGroups.length + upcomingJoinedGroups.length }}</span><span>Upcoming &amp; ongoing groups<small>Chat, plan and manage</small></span></a>
        <a v-if="myRequests.length" href="#my-requests-heading" class="workspace-overview__attention"><span class="workspace-overview__value">{{ myRequests.length }}</span><span>Waiting to join<small>Requests you’ve sent</small></span></a>
        <a v-if="historicalGroups.length" href="#historical-groups"><span class="workspace-overview__value">{{ historicalGroups.length }}</span><span>{{ historicalTitle }}<small>Conversations and group history</small></span></a>
        <a v-if="admissionQueues.length || historicalJoins.length" href="#join-requests" :class="{'workspace-overview__attention':incomingCount}"><span class="workspace-overview__value">{{ incomingCount }}</span><span>Requests &amp; offers<small>{{ incomingCount ? 'Review in arrival order' : 'View past requests' }}</small></span></a>
        <a v-if="incoming.length || outgoing.length || accepted.length" href="#group-connections"><span class="workspace-overview__value">{{ accepted.length }}</span><span>Group connections<small>{{ incoming.length ? `${incoming.length} invitations need a reply` : 'Invitations and shared chats' }}</small></span></a>
        <RouterLink v-if="meetupAttentionCount || upcomingMeetupCount" to="/meetups" :class="{ 'workspace-overview__attention': meetupAttentionCount }"><span class="workspace-overview__value">{{ meetupAttentionCount || upcomingMeetupCount }}</span><span>Meetup plans<small>{{ meetupAttentionCount ? `${meetupAttentionCount} need your attention` : `${upcomingMeetupCount} upcoming confirmed` }}</small></span></RouterLink>
      </nav>
      <template v-if="mode === 'dashboard' || !sourceGroup">
        <p v-if="mode === 'connections'" class="group-muted" role="status">{{ route.query.groupId ? 'This group is historical, unavailable, cancelled, or not owned by you. Choose an upcoming or ongoing group below. Existing conversations remain in My groups.' : 'Choose an upcoming or ongoing group to connect with other groups.' }}</p>
        <section v-if="mode === 'dashboard' && myRequests.length" class="owned-section" aria-labelledby="my-requests-heading">
          <div class="section-heading"><h2 id="my-requests-heading">Groups you’ve asked to join</h2><span class="group-muted">{{ myRequests.length }} waiting for a host</span></div>
          <article v-for="r in myRequests" :key="r.id" class="card group-panel">
            <h3>{{ r.groupName || `${r.hostName}’s group` }}</h3>
            <p class="group-muted">{{ r.artist }} · Hosted by {{ r.hostName }} · <strong>Waiting for the host</strong></p>
            <p class="group-muted">{{ r.seatReserved ? 'A spot is held for you until the host replies.' : `No spot held yet — you’re number ${r.queuePosition ?? '?'} in line.` }}</p>
            <div class="group-actions"><RouterLink class="btn btn--ghost" :to="{ path: '/groups', query: { concertId: r.concertId } }">View or cancel request</RouterLink></div>
          </article>
        </section>
        <details open class="owned-section group-dropdown" aria-labelledby="owned-heading">
          <summary class="section-heading"><h2 id="owned-heading">{{ mode === 'connections' ? 'Choose one of your groups' : 'Groups you own' }}</h2><span v-if="reads.owned.loaded" class="group-muted">{{ activeGroups.length }} upcoming or ongoing</span><span class="group-dropdown__chevron" aria-hidden="true"></span></summary>
          <div v-if="activeGroups.length" class="owned-grid">
            <article v-for="g in activeGroups" :key="g.id" class="card group-panel owned-card">
              <div class="owned-card__top">
                <GroupAvatar :src="g.imageUrl" :name="groupTitle(g)" :size="52" />
                <div class="owned-card__title"><h3>{{ groupTitle(g) }}</h3></div>
                <span class="group-state" :class="{ 'group-state--published': g.settings?.published }">{{ g.settings?.published ? 'Published' : 'Draft' }}</span>
              </div>
              <p class="owned-card__concert group-muted"><span v-if="g.name">{{ g.artist }}</span><span>{{ g.eventDate }} · {{ sectionName(g.section) }}</span></p>
              <p>{{ g.memberCount }} {{ g.memberCount === 1 ? 'member' : 'members' }} · {{ g.remainingCapacity }} places remaining</p>
              <p class="group-muted">{{ g.settings?.published ? (g.settings.connect_open ? 'Open to meeting other groups.' : 'Group connections are off. Change this in Manage group.') : 'Invite friends, then publish from Manage group.' }}</p>
              <div class="owned-card__actions">
                <RouterLink v-if="mode === 'dashboard'" :to="`/groups/${encodeURIComponent(g.id)}/channel`" class="btn" :class="g.settings?.published ? 'btn--primary' : 'btn--ghost'">Open group chat</RouterLink>
                <RouterLink :to="mode === 'connections' ? viewLink('connections', g) : `/groups/${encodeURIComponent(g.id)}/members`" class="btn" :class="mode === 'connections' || !g.settings?.published ? 'btn--primary' : 'btn--ghost'">{{ mode === 'connections' ? 'Connect this group' : 'Manage group' }}</RouterLink>
                <button v-if="canOpenMeetup(g, { partyId: g.id })" type="button" class="btn btn--ghost" @click="router.push(meetupLink({ partyId: g.id }))">{{ meetupLabel({ partyId: g.id }) }}</button>
              </div>
            </article>
          </div>
          <div v-else-if="reads.owned.loaded" class="card group-panel empty-state"><h3>No upcoming groups you own</h3><p>{{ historicalGroups.some(g => g.owned) ? 'Your previous groups and conversations are available below. Create a draft for your next concert when you are ready.' : 'Create a draft for your next concert, then invite friends or publish it for new companions.' }}</p><RouterLink :to="viewLink('create')" class="btn btn--primary">Create a group</RouterLink></div>
        </details>
      </template>

      <template v-if="mode === 'dashboard'">
        <details v-if="upcomingJoinedGroups.length" open class="owned-section group-dropdown" aria-labelledby="joined-heading">
          <summary class="section-heading"><h2 id="joined-heading">Groups I joined</h2><span class="group-muted">{{ upcomingJoinedGroups.length }} upcoming or ongoing</span><span class="group-dropdown__chevron" aria-hidden="true"></span></summary>
          <div class="owned-grid">
            <article v-for="g in upcomingJoinedGroups" :key="g.id" class="card group-panel owned-card owned-card--joined">
              <div class="owned-card__top"><GroupAvatar :src="g.imageUrl ?? g.group?.imageUrl" :name="groupTitle(g)" :size="52" /><div class="owned-card__title"><h3>{{ groupTitle(g) }}</h3><p v-if="g.name || g.group?.name" class="group-muted">{{ g.artist }}</p></div></div>
              <p class="owned-card__concert group-muted">{{ g.eventDate }}<span v-if="g.host?.displayName">{{ g.host.displayName }}'s group</span></p>
              <p class="group-muted">{{ membershipSource[g.assignmentOrigin ?? g.source] ?? 'Active group member' }}</p>
              <div class="owned-card__actions">
                <RouterLink :to="`/groups/${encodeURIComponent(g.id)}/channel`" class="btn btn--primary">Group messages</RouterLink>
                <RouterLink :to="`/groups/${encodeURIComponent(g.id)}/members`" class="btn btn--ghost">View group</RouterLink>
                <button v-if="canOpenMeetup(g, { partyId: g.partyId ?? g.id })" type="button" class="btn btn--ghost" @click="router.push(meetupLink({ partyId: g.partyId ?? g.id }))">{{ meetupLabel({ partyId: g.partyId ?? g.id }) }}</button>
              </div>
            </article>
          </div>
        </details>
        <details v-if="historicalGroups.length" id="historical-groups" class="card group-panel history"><summary>{{ historicalTitle }} ({{ historicalGroups.length }})</summary><div class="history-list">
          <article v-for="g in historicalGroups" :key="g.id" class="historical-group">
            <div class="section-heading"><h3>{{ groupTitle(g) }}</h3><span class="group-state">{{ groupEligibility(g).reason === 'concert_finished' ? 'Past concert' : 'Date unavailable' }}</span></div>
            <p class="group-muted">{{ g.artist }} · {{ g.eventDate || 'Concert date unavailable' }} · {{ g.owned ? 'Group you own' : membershipSource[g.assignmentOrigin ?? g.source] ?? 'Group member' }}</p>
            <p class="group-muted">{{ groupEligibility(g).reason === 'concert_finished' ? 'This concert day has ended. Your group and conversation remain available.' : 'A valid concert date is needed before starting new coordination. Your existing group remains available.' }}</p>
            <div class="group-actions"><RouterLink :to="`/groups/${encodeURIComponent(g.id)}/channel`" class="btn btn--primary">Open group chat</RouterLink><RouterLink :to="`/groups/${encodeURIComponent(g.id)}/members`" class="btn btn--ghost">{{ g.owned ? 'Manage group' : 'View group' }}</RouterLink><button v-if="hasMeetup({ partyId: g.partyId ?? g.id })" type="button" class="btn btn--ghost" @click="router.push(meetupLink({ partyId: g.partyId ?? g.id }))">View meetup history</button></div>
          </article>
        </div></details>
        <section v-if="admissionQueues.length || historicalJoins.length" id="join-requests" class="card group-panel requests-panel" aria-labelledby="requests-heading">
          <p class="workspace-eyebrow">Host review</p>
          <div class="section-heading"><h2 id="requests-heading">Join requests</h2><span class="group-muted">{{ incomingCount }} in your queues</span></div>
          <p class="group-muted">Each group has one arrival-order queue for direct applications and automatic proposals. Review the first request only. Later requests may be waiting without a held place; every request expires 48 hours after it was created.</p>
          <p v-if="!admissionQueues.length" class="group-muted">No pending requests to join your groups.</p>
          <section v-for="queue in admissionQueues" :key="queue.partyId" class="admission-queue">
            <div class="section-heading"><h3>{{ queue.name }}</h3><span class="queue-summary">{{ queue.entries.filter(entry => entry.record.seatReserved).length }} places held · {{ queue.entries.length }} requests</span></div>
            <p class="group-muted">{{ queue.artist }} · A held request can be approved when it reaches the front, even when no additional places remain.</p>
            <template v-for="entry in queue.entries" :key="entry.key"><GroupApplicationCard v-if="entry.kind === 'direct'" :application="entry.record" :busy="busy" @respond="action => act(() => api.respondGroupJoin(entry.record.id, action))" /><MatchProposalCard v-else :proposal="entry.record" @updated="retry" /></template>
          </section>
          <details v-if="historicalJoins.length" class="history"><summary>Past join requests ({{ historicalJoins.length }})</summary><div class="history-list">
            <GroupApplicationCard v-for="j in historicalJoins" :key="j.id" :application="j" :busy="busy" />
          </div></details>
        </section>
        <details v-if="cancelledGroups.length" class="card group-panel history"><summary>Cancelled groups ({{ cancelledGroups.length }})</summary><div class="history-list"><article v-for="g in cancelledGroups" :key="g.id" class="cancelled-group"><h3>{{ groupTitle(g) }} <span class="group-state">Cancelled</span></h3><p class="group-muted">{{ g.eventDate }} · {{ sectionName(g.section) }}</p><RouterLink :to="`/groups/${encodeURIComponent(g.id)}/members`">View group history</RouterLink></article></div></details>
      </template>

      <template v-if="mode === 'connections' && sourceGroup">
        <section class="card group-panel selected-group">
          <div class="owned-card__top"><GroupAvatar :src="sourceGroup.imageUrl" :name="groupTitle(sourceGroup)" :size="52" /><div class="owned-card__title"><h2>{{ groupTitle(sourceGroup) }}</h2><p v-if="sourceGroup.name" class="group-muted">{{ sourceGroup.artist }}</p></div><span class="group-state" :class="{ 'group-state--published': sourceGroup.settings?.published }">{{ sourceGroup.settings?.published ? 'Published' : 'Draft' }}</span></div>
          <p>{{ sourceGroup.eventDate }} · {{ sectionName(sourceGroup.section) }} · {{ sourceGroup.memberCount }} {{ sourceGroup.memberCount === 1 ? 'member' : 'members' }}</p>
          <p v-if="!canConnect" class="group-muted">Publish this group and enable “Open to meeting other groups” in Manage group before sending invitations.</p>
          <p v-else class="group-muted">Open to meeting other groups at this concert.</p>
          <div class="group-actions"><RouterLink :to="`/groups/${encodeURIComponent(sourceId)}/members`" class="btn btn--ghost">Manage group</RouterLink><button v-if="canOpenMeetup(sourceGroup, { partyId: sourceId })" type="button" class="btn btn--ghost" @click="router.push(meetupLink({ partyId: sourceId }))">{{ meetupLabel({ partyId: sourceId }) }}</button></div>
        </section>
        <template v-if="canConnect">
          <section class="card group-panel"><h2>Find another group</h2><GroupFilters :filters="filters" /></section>
          <p v-if="loading" class="loading-state" role="status"><LoadingSpinner />Loading groups…</p>
          <p v-else-if="candidateError" class="group-read-feedback" role="status">{{ candidateError }} <button type="button" class="btn btn--ghost" :disabled="busy" @click="loadCandidates">Retry connection groups</button></p>
          <div v-else-if="visible.length" class="group-grid"><GroupListingCard v-for="g in visible" :key="g.id" :group="g"><p v-if="g.invitation">Invitation: {{ g.invitation.status === 'pending' ? 'Awaiting a response' : g.invitation.status === 'accepted' ? 'Groups connected' : 'Declined' }}</p><button v-else class="btn btn--primary" :disabled="busy" @click="act(() => api.inviteGroup(sourceId, g.id))">Invite group to connect</button></GroupListingCard></div>
          <div v-else class="card group-panel empty-state"><h3>No groups match right now</h3><p>Try different filters. Only published groups open to connections at this concert appear here.</p></div>
          <!-- A page button exists only when that page does. -->
          <nav class="group-actions" aria-label="Connection candidates pages">
            <button v-if="hasPreviousPage" class="btn btn--ghost" :disabled="busy || loading" @click="offset = Math.max(0, offset - PAGE_SIZE); loadCandidates()">Previous {{ PAGE_SIZE }}</button>
            <span>{{ total }} results</span>
            <button v-if="hasNextPage" class="btn btn--ghost" :disabled="busy || loading" @click="offset += PAGE_SIZE; loadCandidates()">Next {{ PAGE_SIZE }}</button>
          </nav>
        </template>
      </template>

      <section v-if="sourceGroup || (mode === 'dashboard' && (incoming.length || outgoing.length || accepted.length))" id="group-connections" class="card group-panel connections">
        <p class="workspace-eyebrow">Meet beyond your group</p>
        <h2>{{ mode === 'dashboard' ? 'Group connections and invitations' : 'This group’s connections' }}</h2>
        <div v-if="incoming.length" class="invites">
          <h3 class="invites__title">Received <span class="invites__count tabular">{{ incoming.length }}</span></h3>
          <article v-for="c in incoming" :key="c.id" class="invite invite--received"><div class="invite__context"><span class="connection-state connection-state--attention">{{ connectionEligible(c) ? 'Needs your reply' : 'New connections unavailable' }}</span><p class="invite__who">{{ describe(c) }}</p><p v-if="!connectionEligible(c)" :id="`connection-eligibility-${c.id}`" class="group-muted">This concert is unavailable for new connections. You can decline the invitation; existing conversations remain available.</p></div><div class="invite__actions"><button type="button" class="btn btn--success" :disabled="busy || !connectionEligible(c)" :aria-describedby="!connectionEligible(c) ? `connection-eligibility-${c.id}` : undefined" :aria-label="`Accept the invitation from ${otherParty(c).hostName}`" @click="act(() => api.respondToGroup(c.id, 'accept'))">Accept</button><button type="button" class="btn btn--danger-ghost" :disabled="busy" :aria-label="`Decline the invitation from ${otherParty(c).hostName}`" @click="confirming = { kind: 'decline', connection: c }">Decline</button></div></article>
        </div>
        <div v-if="outgoing.length" class="invites">
          <h3 class="invites__title">Sent <span class="invites__count tabular">{{ outgoing.length }}</span></h3>
          <article v-for="c in outgoing" :key="c.id" class="invite"><div class="invite__context"><span class="connection-state">Waiting for the other host</span><p class="invite__who">{{ describe(c) }}</p></div><button type="button" class="btn btn--danger-ghost" :disabled="busy" :aria-label="`Cancel your invitation to ${otherParty(c).hostName}`" @click="confirming = { kind: 'cancel', connection: c }">Withdraw pending invitation</button></article>
        </div>
        <div class="connected">
          <h3 class="invites__title">Connected</h3>
          <p v-if="!accepted.length" class="group-muted">No connected groups yet. Publish your group and invite another group to connect.</p>
          <article v-for="c in accepted" :key="c.id" class="connection"><span class="connection-state connection-state--accepted">Groups connected</span><p class="invite__who">{{ describe(c) }}</p><details v-if="c.partyA.notes || c.partyB.notes" class="connection-notes"><summary>Host notes</summary><p v-if="c.partyA.notes" class="group-notes"><strong>{{ c.partyA.hostName }}:</strong> {{ c.partyA.notes }}</p><p v-if="c.partyB.notes" class="group-notes"><strong>{{ c.partyB.hostName }}:</strong> {{ c.partyB.notes }}</p></details><div class="connection__foot"><span class="connection__since">Connected {{ whenConnected(c.respondedAt) }}</span><RouterLink class="btn btn--primary" :to="`/groups/connections/${encodeURIComponent(c.id)}/channel`">Open shared chat</RouterLink><button v-if="canOpenMeetup(c.partyA, { connectionId: c.id })" type="button" class="btn btn--ghost" @click="router.push(meetupLink({ connectionId: c.id }))">{{ groupEligibility(c.partyA).eligible ? meetupLabel({ connectionId: c.id }) : 'View meetup history' }}</button></div></article>
        </div>
      </section>
    </template>
    </GroupPreferencesGate>

    <ConfirmDialog :open="Boolean(confirming)" :title="confirmCopy.title" :body="confirmCopy.body" :confirm-label="confirmCopy.label" cancel-label="Keep it" danger :busy="busy" @confirm="runConfirmed" @cancel="confirming = null" />
  </div>
</template>

<style scoped>
.group-dropdown > summary { display:flex; align-items:center; cursor:pointer; list-style:none; }
.group-dropdown > summary::-webkit-details-marker { display:none; }
.group-dropdown > summary .group-muted { margin-left:auto; }
.group-dropdown__chevron { flex:none; width:32px; height:32px; margin-left:var(--space-3); border:var(--border-hairline); border-radius:50%; display:grid; place-items:center; transition:background .2s; }
.group-dropdown__chevron::before { content:''; width:8px; height:8px; border-right:2px solid var(--text-300); border-bottom:2px solid var(--text-300); transform:translateY(-2px) rotate(45deg); transition:transform .2s; }
.group-dropdown:not([open]) .group-dropdown__chevron::before { transform:translateX(-2px) rotate(-45deg); }
.group-dropdown > summary:hover .group-dropdown__chevron { background:color-mix(in srgb,var(--accent-400) 15%,transparent); }
.workspace-eyebrow { margin:0; color:var(--accent-400); font:600 .68rem var(--font-mono); letter-spacing:.08em; text-transform:uppercase; }
.workspace-overview { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,15rem),1fr)); gap:var(--space-3); }
.workspace-overview a { display:flex; align-items:center; gap:var(--space-4); padding:var(--space-4) var(--space-5); border:1px solid var(--panel-edge); border-radius:var(--radius-md); background:var(--panel-bg); box-shadow:var(--panel-shadow); color:var(--text-100); text-decoration:none; transition:border-color var(--dur-fast),transform var(--dur-fast) var(--ease-settle); }
.workspace-overview a:hover { border-color:var(--accent-400); transform:translateY(-1px); }
.workspace-overview a:active { transform:translateY(1px); }
.workspace-overview__value { flex:none; color:var(--accent-400); font:650 var(--step-2) var(--font-mono); }
.workspace-overview a > span:last-child { min-width:0; font-size:var(--step--1); font-weight:650; }
.workspace-overview small { display:block; margin-top:var(--space-1); color:var(--text-400); font-size:var(--step--2); font-weight:400; }
.workspace-overview a.workspace-overview__attention { border-left:3px solid var(--amber-400); }
.requests-panel { border-left:3px solid var(--amber-400); scroll-margin-top:calc(var(--header-height) + var(--space-4)); }
.queue-summary { padding:var(--space-1) var(--space-2); border:var(--border-hairline); border-radius:var(--radius-sm); background:var(--ink-900); color:var(--text-300); font-size:var(--step--2); }
#owned-heading,#group-connections { scroll-margin-top:calc(var(--header-height) + var(--space-4)); }
.page-heading, .section-heading, .owned-card__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  flex-wrap: wrap;
}
.page-heading > div {
  display: grid;
  gap: var(--space-2);
}
.page-heading p {
  color: var(--text-300);
  max-width: 68ch;
}
.owned-section, .form-section, .history-list {
  display: grid;
  gap: var(--space-4);
  min-width: 0;
}
.owned-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 22rem), 1fr));
  gap: var(--space-4);
}
.owned-card {
  display:flex;
  flex-direction:column;
  border-top:2px solid color-mix(in srgb,var(--accent-400) 40%,var(--panel-edge));
  background:var(--panel-bg);
  box-shadow:var(--panel-shadow);
}
.owned-card__top {
  display:grid;
  grid-template-columns:auto minmax(0,1fr) auto;
  align-items:start;
}
.owned-card__title {
  display: grid;
  flex: 1 1 auto;
  gap: 2px;
  min-width: 0;
}
.owned-card__title p {
  font-size: var(--step--1);
}
.owned-card__concert { display:grid; align-content:start; gap:.2rem; }
/* Shared tracks align variable-length titles and metadata without fixed heights. */
@supports(grid-template-rows:subgrid) {
  .owned-card { display:grid; grid-template-rows:subgrid; grid-row:span 5; align-content:stretch; }
  .owned-card--joined { grid-row:span 4; }
}
/* Keep group management and planning actions clear on narrow cards. */
.owned-card__actions {
  margin-top:auto;
  align-self:stretch;
  display: grid;
  grid-auto-rows:minmax(2.75rem,auto);
  gap: var(--space-2);
}
.owned-card__actions .btn {
  width: 100%;
  min-height:2.75rem;
  height:100%;
  padding-inline:.6rem;
  line-height:1.35;
  text-wrap:balance;
  justify-content: center;
  text-align: center;
}
.owned-card__actions:has(> :nth-child(3)) { grid-template-columns:repeat(2,minmax(0,1fr)); }
.owned-card__actions:has(> :nth-child(3)) > :first-child { grid-column:1/-1; }
@media (max-width:620px) {
  .owned-card__actions:has(> :nth-child(3)) { grid-template-columns:minmax(0,1fr); }
  .owned-card__top { grid-template-columns:auto minmax(0,1fr); }
  .owned-card__top > .group-state { grid-column:2; justify-self:start; }
}
.group-picture-field {
  display: grid;
  gap: var(--space-2);
  font-size: var(--step--1);
}
.create-form {
  max-width: 54rem;
  width: 100%;
  box-sizing: border-box;
}
.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-4);
  align-items: end;
}
.form-wide {
  grid-column: 1 / -1;
}
.form-section + .form-section {
  padding-top: var(--space-5);
  border-top: var(--border-hairline);
}
.field-hint {
  color: var(--text-300);
  font-size: var(--step--2);
  font-weight: 400;
}
.venue-layout {
  display: grid;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-4);
  border: var(--border-soft);
  border-radius: var(--radius-md);
}
.venue-layout__heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--space-3);
}
.venue-layout__heading > div {
  display: grid;
  gap: var(--space-1);
}
.venue-layout p, .venue-layout a, .venue-layout span {
  font-size: var(--step--1);
}
.empty-state {
  justify-items: start;
}
.history-list {
  margin-top: var(--space-4);
}
.admission-queue {
  display: grid;
  gap: var(--space-3);
  padding-top: var(--space-4);
  border-top: var(--border-hairline);
  min-width:0;
}
.join-request, .cancelled-group, .historical-group {
  display: grid;
  gap: var(--space-2);
}
.historical-group + .historical-group { padding-top:var(--space-4); border-top:var(--border-hairline); }
.historical-group h3 { min-width:0; overflow-wrap:anywhere; }
.group-read-feedback { padding:var(--space-3); border-left:2px solid var(--amber-400); background:var(--panel-bg); }
#historical-groups { scroll-margin-top:calc(var(--header-height) + var(--space-4)); }
.connections {
  display: grid;
  gap: var(--space-5);
}
.connections > .workspace-eyebrow { margin-bottom:calc(-1 * var(--space-4)); }
.invites, .connected {
  display: grid;
  gap: var(--space-3);
}
.invites__title {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding-bottom: var(--space-2);
  border-bottom: var(--border-hairline);
  color: var(--text-300);
  font-size: var(--step--2);
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.invites__count {
  display: grid;
  place-items: center;
  min-width: 20px;
  height: 20px;
  padding-inline: 6px;
  border-radius: var(--radius-pill);
  background: var(--accent-500);
  color: #fff;
  font-size: var(--step--2);
  letter-spacing: 0;
}
.invite, .connection {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--space-3);
  padding: var(--space-4);
  border: var(--border-hairline);
  border-radius: var(--radius-md);
  background: var(--ink-850);
  box-shadow:inset 0 1px 0 var(--panel-highlight);
}
.invite--received { border-left:3px solid var(--amber-400); }
.invite__context { display:grid; gap:var(--space-2); min-width:0; flex:1 1 20rem; }
.connection-state { width:fit-content; max-width:100%; padding:3px var(--space-2); border:var(--border-hairline); border-radius:var(--radius-pill); background:var(--ink-900); color:var(--text-300); font-size:var(--step--2); }
.connection-state--attention { color:var(--amber-400); border-color:color-mix(in srgb,var(--amber-400) 45%,var(--panel-edge)); }
.connection-state--accepted { color:var(--mint-400); border-color:color-mix(in srgb,var(--mint-400) 35%,var(--panel-edge)); }
.connection-notes { width:100%; padding:var(--space-3); border:var(--border-hairline); border-radius:var(--radius-sm); background:var(--ink-900); }
.connection-notes summary { cursor:pointer; color:var(--text-300); font-size:var(--step--1); }
.connection-notes[open] summary { margin-bottom:var(--space-3); }
.connection {
  display: grid;
  justify-items: start;
}
.invite__who {
  min-width: 0;
  color: var(--text-200);
  font-size: var(--step--1);
}
.invite__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
.connection__foot {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-3);
  width: 100%;
  margin-top: var(--space-2);
}
.connection__since {
  margin-right: auto;
  color: var(--text-400);
  font-size: var(--step--2);
}
@media (max-width: 600px) {
  .page-heading {
    align-items: flex-start;
  }
  .form-grid {
    grid-template-columns: minmax(0, 1fr);
  }
  .invite {
    align-items: flex-start;
    flex-direction: column;
  }
  .invite__actions {
    width: 100%;
  }
  .invite__actions .btn {
    flex: 1;
  }
}
@media(prefers-reduced-motion:reduce) { .workspace-overview a { transition:none; } .workspace-overview a:hover,.workspace-overview a:active { transform:none; } }
</style>
