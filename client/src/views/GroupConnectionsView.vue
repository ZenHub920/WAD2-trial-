<script setup>
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, LABELS, SECTION_OPTIONS, ARRIVAL_OPTIONS } from '../api.js';
import { useMeetupSummaries } from '../composables/useMeetupSummaries.js';
import { meetupDestination, meetupActionForScope, meetupNeedsAttention, isMeetupHistorical, meetupsForScope } from '../utils/meetupSummaries.js';
import { concertGroupCreationEligibility, concertParticipationEligibility } from '../../../shared/concertEligibility.mjs';
import { meetupDatePolicy } from '../../../shared/meetupDates.mjs';
import GroupNavigation from '../components/GroupNavigation.vue';
import LoadingSpinner from '../components/LoadingSpinner.vue';
import GroupAvatar from '../components/GroupAvatar.vue';
import AvatarPicker from '../components/AvatarPicker.vue';
import GroupPreferencesGate from '../components/GroupPreferencesGate.vue';
import BackArrow from '../components/BackArrow.vue';
import '../assets/groups.css';
import { currentUser } from '../auth.js';

const route = useRoute(), router = useRouter();
const { plans: meetupPlans } = useMeetupSummaries();
const meetupAttentionCount = computed(() => meetupPlans.value.filter(meetupNeedsAttention).length);
const upcomingMeetupCount = computed(() => meetupPlans.value.filter(plan => plan.status === 'confirmed' && !isMeetupHistorical(plan)).length);
const meetupLink = scope => meetupDestination(meetupPlans.value, scope, { from: 'groups' });
const meetupLabel = scope => meetupActionForScope(meetupPlans.value, scope);
const hasMeetup = scope => meetupsForScope(meetupPlans.value, scope).length > 0;
const hosted = ref([]), joins = ref([]);
const attendance = ref([]), myRequests = ref([]);
const automaticOffers = ref([]);
const groupReads = reactive({});
const busy = ref(false);
const error = ref(''), message = ref(''), refreshWarning = ref('');
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
const mode = computed(() => route.query.view === 'create' ? 'create' : 'dashboard');
const concertId = computed(() => typeof route.query.concertId === 'string' ? route.query.concertId : '');
const groupEligibility = group => concertParticipationEligibility({ event_date: group.eventDate, event_timezone: group.eventTimezone }, concertNow.value);
const canOpenMeetup = (group, scope) => hasMeetup(scope) || meetupDatePolicy({ event_date: group.eventDate, event_time: group.eventTime, event_timezone: group.eventTimezone }, concertNow.value).canSchedule;
const activeGroups = computed(() => hosted.value.filter(g => g.status !== 'cancelled' && groupEligibility(g).eligible));
const joinedGroups = computed(() => attendance.value.filter(g => !hosted.value.some(owned => owned.id === g.id)));
const upcomingJoinedGroups = computed(() => joinedGroups.value.filter(g => groupEligibility(g).eligible));
const historicalGroups = computed(() => [
  ...hosted.value.filter(g => g.status !== 'cancelled' && !groupEligibility(g).eligible).map(g => ({ ...g, owned: true })),
  ...joinedGroups.value.filter(g => !groupEligibility(g).eligible).map(g => ({ ...g, owned: false })),
]);
const historicalTitle = computed(() => historicalGroups.value.some(group => groupEligibility(group).reason === 'concert_date_unavailable') ? 'Past concerts & undated groups' : 'Past concert groups');
const membershipSource = { friend: 'Joined through a friend invitation', join: 'Joined through an approved request', proposal: 'Joined through matching', direct: 'Joined through an approved direct application', algorithm: 'Joined through a confirmed automatic match' };
const pendingJoins = computed(() => joins.value.filter(j => j.status === 'pending'));
const pageTitle = computed(() => mode.value === 'create' ? 'Create a group' : 'My groups');
const sectionName = key => LABELS.section[key] ?? key;
let sessionGeneration = 0, operationGeneration = 0, viewGeneration = 0, alive = true, concertClock;
const groupSourceKeys = ['owned', 'joined', 'myRequests', 'applications', 'offers'];
const sources = {
  concerts: { label: 'concerts', load: () => api.concerts(), apply: result => {
    allConcerts.value = result.concerts; concertNow.value = Date.now(); selectConcert(concertId.value);
  } },
  owned: { label: 'owned groups', load: async context => {
    const result = await api.hostedGroups();
    if (!contextIsCurrent(context.session, context.user)) return [];
    const details = await Promise.allSettled(result.groups.map(async group => {
      if (group.status === 'cancelled' || group.settings) return group;
      const membership = await api.groupMembership(group.id);
      return { ...group, settings: membership.group.settings };
    }));
    return { groups: details.map((item, index) => item.status === 'fulfilled' ? item.value : result.groups[index]),
      failed: details.flatMap((item, index) => item.status === 'rejected' ? [result.groups[index].id] : []) };
  }, apply: result => {
    hosted.value = result.groups ?? result;
    for (const id of Object.keys(groupReads)) delete groupReads[id];
    for (const id of result.failed ?? []) groupReads[id] = { loading: false, error: 'Setup details could not be loaded.' };
  } },
  joined: { label: 'joined groups', load: () => api.currentGroupMemberships(), apply: result => { attendance.value = result.groups ?? result.memberships ?? []; } },
  myRequests: { label: 'your join requests', load: () => api.groupJoinRequests({ scope: 'own' }), apply: result => { myRequests.value = result.requests.filter(r => r.userId === currentUser.value?.id && r.status === 'pending'); } },
  applications: { label: 'applications', load: () => api.hostedGroupJoinRequests(), apply: result => { joins.value = result.requests.filter(j => j.hostId === currentUser.value?.id); } },
  offers: { label: 'automatic offers', load: () => api.myProposals(), apply: result => { automaticOffers.value = result.proposals.filter(proposal => proposal.role === 'host' && proposal.status === 'proposed'); } },
};
const reads = reactive(Object.fromEntries(Object.keys(sources).map(key => [key, { loading: false, loaded: false, error: '', sequence: 0 }])));
const groupsLoading = computed(() => groupSourceKeys.every(key => !reads[key].loaded && !reads[key].error) && groupSourceKeys.some(key => reads[key].loading));
const creationDisabled = computed(() => busy.value || reads.concerts.loading || Boolean(uncertainCreation.value));
const contextIsCurrent = (session, user) => alive && session === sessionGeneration && user === currentUser.value?.id;

/** Join-request notifications open the group's own page, where hosts review requests. */
watch(() => route.fullPath, () => {
  const { groupId, requestId, proposalId } = route.query;
  if (typeof groupId === 'string' && (typeof requestId === 'string' || typeof proposalId === 'string'))
    void router.replace({ path: `/groups/${encodeURIComponent(groupId)}/members`, hash: '#join-requests' });
}, { immediate: true });

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

const groupApplications = id => pendingJoins.value.filter(record => record.partyId === id).length;
const groupOffers = id => automaticOffers.value.filter(record => record.partyId === id).length;
const readyForHost = record => record.canHostRespond !== false && record.queueStatus !== 'waiting';
const groupAttention = id => pendingJoins.value.filter(record => record.partyId === id && readyForHost(record)).length
  + automaticOffers.value.filter(record => record.partyId === id && !record.hostApproved && readyForHost(record)).length;
const queueStatusKnown = computed(() => reads.applications.loaded && !reads.applications.error && reads.offers.loaded && !reads.offers.error);

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
async function retryOwnedGroup(groupId) {
  const state = groupReads[groupId];
  if (!state || state.loading || !hosted.value.some(group => group.id === groupId)) return;
  const session = sessionGeneration, user = currentUser.value?.id, sequence = reads.owned.sequence;
  state.loading = true;
  try {
    const result = await api.groupMembership(groupId);
    if (!contextIsCurrent(session, user) || sequence !== reads.owned.sequence) return;
    hosted.value = hosted.value.map(group => group.id === groupId ? { ...group, settings: result.group.settings } : group);
    delete groupReads[groupId];
  } catch {
    if (contextIsCurrent(session, user) && sequence === reads.owned.sequence) state.error = 'Setup details could not be loaded.';
  } finally { if (contextIsCurrent(session, user) && sequence === reads.owned.sequence && groupReads[groupId]) state.loading = false; }
}

watch(() => [route.query.view, route.query.groupId, route.query.concertId], () => {
  viewGeneration++;
  message.value = '';
});
watch(() => currentUser.value?.id, () => {
  sessionGeneration++; operationGeneration++;
  for (const id of Object.keys(groupReads)) delete groupReads[id];
  hosted.value = []; attendance.value = []; myRequests.value = []; joins.value = []; automaticOffers.value = []; error.value = ''; message.value = ''; refreshWarning.value = '';
  createdDraftId.value = ''; createdDraftNote.value = ''; uncertainCreation.value = null; busy.value = false;
  hostForm.name = ''; hostForm.notes = ''; hostImage.value = null; attempted.value = false;
  allConcerts.value = []; hostConcertId.value = ''; concertNotice.value = '';
  for (const state of Object.values(reads)) { state.sequence++; state.loading = false; state.loaded = false; state.error = ''; }
  if (currentUser.value) { void loadSource('concerts'); void refresh(); }
});
watch(concertId, id => {
  if (allConcerts.value.length) { concertNow.value = Date.now(); selectConcert(id); }
});

onMounted(() => {
  // Arriving straight after asking to join a group from Find a group.
  if (route.query.sent === '1') message.value = 'Request sent. The host will review it; you can track or cancel it below.';
  concertClock = setInterval(() => { concertNow.value = Date.now(); }, 60000);
  void loadSource('concerts'); void refresh();
});
onUnmounted(() => { alive = false; sessionGeneration++; clearInterval(concertClock); });

async function act(operation, { view } = {}) {
  if (busy.value) return;
  const userId = currentUser.value?.id, session = sessionGeneration, operationId = ++operationGeneration;
  if (!userId) return;
  busy.value = true; error.value = ''; message.value = ''; refreshWarning.value = '';
  try {
    const result = await operation();
    if (contextIsCurrent(session, userId)) {
      if (view === undefined || view === viewGeneration) message.value = result?.feedback ?? 'Group updated.';
      if (!await refresh({ force: true }) && contextIsCurrent(session, userId))
        if (view === undefined || view === viewGeneration) refreshWarning.value = 'The update was saved, but the latest group details could not be loaded. Retry the refresh before making another change.';
    }
  }
  catch (e) {
    if (contextIsCurrent(session, userId)) {
      await refresh({ force: true });
      if (!contextIsCurrent(session, userId)) return;
      if (view !== undefined && view !== viewGeneration) return;
      error.value = ({
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
/** Requests sent from Find a group are tracked and cancelled here. */
function requestDate(value) {
  if (!value) return '';
  const date = new Date(typeof value === 'number' ? value : value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('en-SG', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}
async function cancelRequest(request) {
  await act(async () => {
    await api.withdrawGroupJoin(request.id);
    return { feedback: 'Request cancelled. Any held spot is released to the next person.' };
  });
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
    createdDraftNote.value = 'Your group was created. Open it to invite friends.';
    const warnings = [];
    try { await api.configureGroup(result.party.id, { expectedFriends: 0 }); }
    catch { warnings.push('its settings still need to be saved in Manage group'); }
    if (!contextIsCurrent(session, userId)) return;
    if (submission.image) {
      try { await api.setGroupImage(result.party.id, submission.image); }
      catch { warnings.push('its picture could not be saved; add a picture in Manage group'); }
    }
    if (!contextIsCurrent(session, userId)) return;
    if (warnings.length) createdDraftNote.value = `Your group was created, but ${warnings.join(' and ')}.`;
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
      ? 'You may already belong to another group for this concert. Review Groups you joined in My groups before trying to create another group. Your answers are kept.'
      : 'No created group was found. Your answers are kept; try Create group again.';
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
      <div :class="{ 'page-heading__title--back': mode === 'create' }">
        <BackArrow v-if="mode === 'create'" :to="viewLink()" label="Back to My groups" />
        <h1>{{ pageTitle }}</h1>
      </div>
      <div v-if="mode === 'dashboard'" class="group-actions"><RouterLink :to="viewLink('create')" class="btn btn--primary">+ Create group</RouterLink><RouterLink to="/meetups" class="btn btn--ghost">My meetups</RouterLink></div>
    </header>
    <GroupPreferencesGate :summary="mode === 'dashboard'" @saved="retry">
    <p v-if="error" class="group-error" role="alert">{{ error }} <button class="btn btn--ghost" :disabled="busy || groupsLoading" @click="retry">Retry</button></p>
    <p v-if="message" class="group-success" role="status">{{ message }}</p>
    <p v-if="refreshWarning" class="group-muted" role="status">{{ refreshWarning }} <button type="button" class="btn btn--ghost" :disabled="busy || groupsLoading" @click="retry">Retry refresh</button></p>
    <p v-if="busy" class="loading-state" role="status"><LoadingSpinner />Updating your groups…</p>
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
            <div class="form-wide group-picture-field">
              <span>Group picture <span class="field-hint">(optional)</span></span>
              <AvatarPicker :src="hostImage" :name="hostForm.name" :busy="creationDisabled" :size="72" @select="image => hostImage = image" @remove="hostImage = null">
                <template #preview><GroupAvatar :src="hostImage" :name="hostForm.name" :size="72" /></template>
              </AvatarPicker>
            </div>
            <label class="form-wide">Group name<input v-model="hostForm.name" type="text" maxlength="60" required placeholder="e.g. Front Row Crew" :disabled="creationDisabled" :class="fieldState(Boolean(hostForm.name.trim()))" :aria-invalid="attempted && !hostForm.name.trim()"><span v-if="attempted && !hostForm.name.trim()" class="field-message">Enter a name for your group.</span><span v-else class="field-hint">This is what other people see. Up to 60 characters.</span></label>
          </div>
        </section>
        <section class="form-section">
          <h2>Concert and group preferences</h2>
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
          <label>Group notes (visible to people looking for a group)<textarea v-model="hostForm.notes" maxlength="2000" rows="3" :disabled="creationDisabled"></textarea></label>
          <fieldset><legend>Group activities</legend><label v-for="(name, id) in LABELS.plans" :key="id" class="group-check"><input v-model="hostForm.plans[id]" type="checkbox" :disabled="creationDisabled">{{ name }}</label></fieldset>
        </section>
        <div class="group-actions"><button class="btn btn--primary" :disabled="creationDisabled || !selectedConcertEligible">{{ busy ? 'Creating…' : 'Create group' }}</button><RouterLink :to="viewLink()" class="btn btn--ghost">Back to My groups</RouterLink></div>
        </template>
        <template v-else><h2>Your group is ready to open</h2><p role="status">{{ createdDraftNote }}</p><div class="group-actions"><button type="button" class="btn btn--primary" :disabled="busy" @click="host">Open created group</button><RouterLink :to="viewLink()" class="btn btn--ghost">Back to My groups</RouterLink></div></template>
      </form>
    </template>

    <template v-else-if="!groupsLoading">
      <nav v-if="mode === 'dashboard' && (myRequests.length || historicalGroups.length || meetupAttentionCount || upcomingMeetupCount)" class="workspace-overview" aria-label="Group workspace sections">
        <a v-if="myRequests.length" href="#my-requests-heading" class="workspace-overview__attention"><span class="workspace-overview__value">{{ myRequests.length }}</span><span>Waiting to join<small>Requests you’ve sent</small></span></a>
        <a v-if="historicalGroups.length" href="#historical-groups"><span class="workspace-overview__value">{{ historicalGroups.length }}</span><span>{{ historicalTitle }}<small>Conversations and group history</small></span></a>
        <RouterLink v-if="meetupAttentionCount || upcomingMeetupCount" to="/meetups" :class="{ 'workspace-overview__attention': meetupAttentionCount }"><span class="workspace-overview__value">{{ meetupAttentionCount || upcomingMeetupCount }}</span><span>Meetup plans<small>{{ meetupAttentionCount ? `${meetupAttentionCount} need your attention` : `${upcomingMeetupCount} upcoming confirmed` }}</small></span></RouterLink>
      </nav>
      <template v-if="mode === 'dashboard'">
        <section v-if="mode === 'dashboard' && myRequests.length" class="owned-section" aria-labelledby="my-requests-heading">
          <div class="section-heading"><h2 id="my-requests-heading">Groups you’ve asked to join</h2><span class="group-muted">{{ myRequests.length }} waiting for a host</span></div>
          <article v-for="r in myRequests" :key="r.id" class="card group-panel">
            <div class="request-card__top"><GroupAvatar :src="r.imageUrl" :name="r.groupName || r.hostName" :size="52" /><h3>{{ r.groupName || `${r.hostName}’s group` }}</h3></div>
            <p class="group-muted">{{ r.artist }} · Hosted by {{ r.hostName }} · <strong>Waiting for the host</strong></p>
            <p class="group-muted">{{ r.seatReserved ? 'A spot is held for you until the host replies.' : `No spot held yet — you’re number ${r.queuePosition ?? '?'} in line.` }}</p>
            <p v-if="requestDate(r.expiresAt)" class="group-muted">Sent {{ requestDate(r.createdAt) }} · expires {{ requestDate(r.expiresAt) }}</p>
            <div class="group-actions"><button type="button" class="btn btn--danger-ghost" :disabled="busy" @click="cancelRequest(r)">Cancel request</button></div>
          </article>
        </section>
        <details open class="owned-section group-dropdown" aria-labelledby="owned-heading">
          <summary class="section-heading"><h2 id="owned-heading">Groups you own</h2><span class="group-dropdown__chevron" aria-hidden="true"></span></summary>
          <div v-if="activeGroups.length" class="owned-grid">
            <article v-for="g in activeGroups" :key="g.id" class="card group-panel owned-card">
              <div class="owned-card__top">
                <GroupAvatar :src="g.imageUrl" :name="groupTitle(g)" :size="52" />
                <div class="owned-card__title"><h3>{{ groupTitle(g) }}</h3></div>
                <span class="group-state" :class="{ 'group-state--published': g.settings?.published }">{{ groupReads[g.id] ? 'Setup unavailable' : g.settings?.published ? 'Listed' : 'Setting up' }}</span>
              </div>
              <p class="owned-card__concert group-muted"><span v-if="g.name">{{ g.artist }}</span><span>{{ g.eventDate }} · {{ sectionName(g.section) }}</span></p>
              <p>{{ g.memberCount }} {{ g.memberCount === 1 ? 'member' : 'members' }} · {{ g.remainingCapacity }} places remaining</p>
              <div class="owned-card__status"><p class="group-muted">You host this group. {{ groupReads[g.id] ? 'Publication settings could not be checked.' : g.settings?.published ? 'People looking for a group can find and join it.' : 'Finish its setup in Manage group.' }}</p>
              <p v-if="groupReads[g.id]" class="group-read-feedback" role="status">{{ groupReads[g.id].error }} <button type="button" class="btn btn--ghost" :disabled="groupReads[g.id].loading || busy" @click="retryOwnedGroup(g.id)">Retry {{ groupTitle(g) }} setup</button></p>
              <p v-if="queueStatusKnown && (groupApplications(g.id) || groupOffers(g.id))" class="group-attention">{{ groupApplications(g.id) }} pending {{ groupApplications(g.id) === 1 ? 'application' : 'applications' }} · {{ groupOffers(g.id) }} automatic {{ groupOffers(g.id) === 1 ? 'offer' : 'offers' }}. {{ groupAttention(g.id) ? 'A request is ready for your review.' : 'Waiting for an earlier request or the companion’s approval.' }}</p>
              <p v-else-if="reads.applications.error || reads.offers.error" class="group-muted">Request status could not be fully checked. Retry the affected request section above.</p></div>
              <div class="owned-card__actions">
                <RouterLink v-if="mode === 'dashboard' && queueStatusKnown && groupAttention(g.id)" class="btn btn--primary" :to="`/groups/${encodeURIComponent(g.id)}/members#join-requests`">Review requests</RouterLink>
                <RouterLink v-if="mode === 'dashboard'" :to="`/groups/${encodeURIComponent(g.id)}/channel`" class="btn" :class="g.settings?.published && !groupAttention(g.id) ? 'btn--primary' : 'btn--ghost'">Open group chat</RouterLink>
                <RouterLink :to="`/groups/${encodeURIComponent(g.id)}/members`" class="btn" :class="!g.settings?.published ? 'btn--primary' : 'btn--ghost'">Manage group</RouterLink>
                <button v-if="canOpenMeetup(g, { partyId: g.id })" type="button" class="btn btn--ghost" @click="router.push(meetupLink({ partyId: g.id }))">{{ meetupLabel({ partyId: g.id }) }}</button>
              </div>
            </article>
          </div>
          <p v-else-if="reads.owned.loaded" class="group-muted section-empty">No groups owned</p>
        </details>
      </template>

      <template v-if="mode === 'dashboard'">
        <details open class="owned-section group-dropdown" aria-labelledby="joined-heading">
          <summary class="section-heading"><h2 id="joined-heading">Groups you joined</h2><span class="group-dropdown__chevron" aria-hidden="true"></span></summary>
          <p v-if="!upcomingJoinedGroups.length && reads.joined.loaded" class="group-muted section-empty">No groups joined</p>
          <div v-else-if="upcomingJoinedGroups.length" class="owned-grid">
            <article v-for="g in upcomingJoinedGroups" :key="g.id" class="card group-panel owned-card owned-card--joined">
              <div class="owned-card__top"><GroupAvatar :src="g.imageUrl ?? g.group?.imageUrl" :name="groupTitle(g)" :size="52" /><div class="owned-card__title"><h3>{{ groupTitle(g) }}</h3><p v-if="g.name || g.group?.name" class="group-muted">{{ g.artist }}</p></div></div>
              <p class="owned-card__concert group-muted">{{ g.eventDate }}<span v-if="g.host?.displayName">{{ g.host.displayName }}'s group</span></p>
              <p class="group-muted">You’re a confirmed member. {{ membershipSource[g.assignmentOrigin ?? g.source] ?? 'Active group member' }}</p>
              <div class="owned-card__actions">
                <button v-if="hasMeetup({ partyId: g.partyId ?? g.id }) && canOpenMeetup(g, { partyId: g.partyId ?? g.id })" type="button" class="btn btn--primary" @click="router.push(meetupLink({ partyId: g.partyId ?? g.id }))">{{ meetupLabel({ partyId: g.partyId ?? g.id }) }}</button>
                <RouterLink :to="`/groups/${encodeURIComponent(g.id)}/channel`" class="btn btn--primary">Group messages</RouterLink>
                <RouterLink :to="`/groups/${encodeURIComponent(g.id)}/members`" class="btn btn--ghost">View group</RouterLink>
                <button v-if="!hasMeetup({ partyId: g.partyId ?? g.id }) && canOpenMeetup(g, { partyId: g.partyId ?? g.id })" type="button" class="btn btn--ghost" @click="router.push(meetupLink({ partyId: g.partyId ?? g.id }))">{{ meetupLabel({ partyId: g.partyId ?? g.id }) }}</button>
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
      </template>

    </template>
    </GroupPreferencesGate>
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
/* A sent request shows the group's picture beside its name. */
.request-card__top { display:flex; align-items:center; gap:var(--space-3); min-width:0; }
.request-card__top h3 { margin:0; min-width:0; overflow-wrap:anywhere; }
/* A quiet line when a section has no groups. */
.section-empty { margin:0; padding:var(--space-2) 0 var(--space-3); }
#owned-heading { scroll-margin-top:calc(var(--header-height) + var(--space-4)); }
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
/* The back arrow sits beside the Create a group title. */
.page-heading__title--back { display:flex !important; align-items:center; gap:var(--space-3); }
/* Create group and My meetups stay side by side next to the title. */
.page-heading > .group-actions {
  display: flex;
  flex: none;
  flex-wrap: nowrap;
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
.owned-card__status { display:grid; gap:var(--space-2); }
.group-attention { color:var(--text-200); border-left:2px solid var(--amber-400); padding-left:var(--space-3); }
.group-context-target { scroll-margin-top:calc(var(--header-height) + var(--space-4)); border-radius:var(--radius-sm); }
.group-context-target:focus { outline:2px solid var(--accent-400); outline-offset:4px; }
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
/* Picture, button and hint on one centred row, the hint on a single line. */
.group-picture-field :deep(.picker) {
  gap: var(--space-4);
}
.group-picture-field :deep(.picker__actions) {
  grid-auto-flow: column;
  align-items: center;
  gap: var(--space-3);
}
.group-picture-field :deep(.picker__hint) {
  max-width: none;
}
.group-picture-field :deep(.picker__error) {
  grid-column: 1 / -1;
}
@media (max-width: 620px) {
  .group-picture-field :deep(.picker__actions) {
    grid-auto-flow: row;
  }
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
.join-request, .cancelled-group, .historical-group {
  display: grid;
  gap: var(--space-2);
}
.historical-group + .historical-group { padding-top:var(--space-4); border-top:var(--border-hairline); }
.historical-group h3 { min-width:0; overflow-wrap:anywhere; }
.group-read-feedback { padding:var(--space-3); border-left:2px solid var(--amber-400); background:var(--panel-bg); }
#historical-groups { scroll-margin-top:calc(var(--header-height) + var(--space-4)); }
@media (max-width: 600px) {
  .page-heading {
    align-items: flex-start;
  }
  .form-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
@media(prefers-reduced-motion:reduce) { .workspace-overview a { transition:none; } .workspace-overview a:hover,.workspace-overview a:active { transform:none; } }
</style>
