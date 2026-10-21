<script setup>
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, LABELS, SECTION_OPTIONS, ARRIVAL_OPTIONS } from '../api.js';
import { currentUser, sessionReady } from '../auth.js';
import GroupFilters from '../components/GroupFilters.vue';
import GroupListingCard from '../components/GroupListingCard.vue';
import GroupPreferencesGate from '../components/GroupPreferencesGate.vue';
import GroupAvatar from '../components/GroupAvatar.vue';
import { preferencesReady } from '../groupPreferences.js';
import MatchProposalCard from '../components/MatchProposalCard.vue';
import LoadingSpinner from '../components/LoadingSpinner.vue';
import GroupNavigation from '../components/GroupNavigation.vue';
import '../assets/groups.css';

const route = useRoute(), router = useRouter();
const concerts = ref([]), groups = ref([]), saved = ref([]), seeker = ref(null);
const concertId = ref(typeof route.query.concertId === 'string' ? route.query.concertId : '');
const concertsLoading = ref(true), loading = ref(false), busy = ref(false);
const setupOpen = ref(false), error = ref(''), message = ref('');
const offset = ref(0), total = ref(0), joins = ref([]), memberships = ref([]), proposals = ref([]);
const matching = ref({ optedIn: false, state: 'idle', request: null, proposal: null });
const displayedMode = ref('direct'), applicationFor = ref(''), applicationNote = ref('');
const filters = reactive({ query: '', section: '', minCapacity: 0, spendBand: '', arrival: '', activity: '', vibe: '', sort: 'compatibility', preferredOnly: false });
const form = reactive({ section_pref: 'standing_pen', spend_band_max: 3, arrival_pref: 'doors', plans_wanted: {} });
const persistedMode = computed(() => seeker.value?.joining_mode ?? seeker.value?.joiningMode ?? 'algorithm');
const currentGroup = computed(() => memberships.value.find(group => group.concertId === concertId.value));
const ownRequests = computed(() => joins.value.filter(request => request.userId === currentUser.value?.id && request.concertId === concertId.value));
const pendingDirect = computed(() => ownRequests.value.filter(request => request.status === 'pending' && !request.matchingRoundId));
const pendingLegacy = computed(() => ownRequests.value.filter(request => request.status === 'pending' && request.matchingRoundId));
const activeProposals = computed(() => proposals.value.filter(proposal => proposal.status === 'proposed'));
const modeIsActive = computed(() => Boolean(seeker.value && persistedMode.value === displayedMode.value));
const pendingLimit = computed(() => seeker.value?.maxPendingDirectApplications ?? 1);
const canApply = computed(() => seeker.value?.status === 'open' && persistedMode.value === 'direct' && !currentGroup.value && !activeProposals.value.length && !pendingLegacy.value.length && pendingDirect.value.length < pendingLimit.value);
const canPrefer = computed(() => seeker.value?.status === 'open' && !currentGroup.value && !activeProposals.value.length);
const modeLabels = { direct: 'Direct joining', algorithm: 'Automatic matching' };
const modeOptions = [
  { mode: 'direct', title: 'Already know what you’re looking for?', description: 'Browse groups and choose who to join.', action: 'Browse groups' },
  { mode: 'algorithm', title: 'Meet new concert friends.', description: 'Let us suggest a compatible group.', action: 'Find my group' },
];
const originLabels = { direct: 'Approved direct application', algorithm: 'Confirmed automatic match', host: 'You host this group', friend: 'Friend invitation' };
const joinStatus = { pending: 'Awaiting host approval', accepted: 'Approved', rejected: 'Declined', declined: 'Declined', withdrawn: 'Withdrawn', expired: 'Expired', superseded: 'Closed after joining another group', cancelled: 'Membership ended' };
let generation = 0, alive = true, filterTimer, loadedContext = '';
const context = () => `${currentUser.value?.id ?? ''}:${concertId.value}`;
const isCurrent = key => alive && key === context();
const pendingFor = id => ownRequests.value.some(request => request.partyId === id && request.status === 'pending');
const declinedFor = id => ownRequests.value.some(request => request.partyId === id && ['rejected', 'declined'].includes(request.status));

function failureMessage(err) {
  const explanations = {
    open_seeker_request_required: 'Set up or reopen your group request first.',
    direct_joining_mode_required: 'Activate direct joining before applying to a group.',
    pending_application_limit_reached: 'You already have a pending application for this concert. Withdraw it before choosing another group.',
    withdraw_pending_applications_first: 'Withdraw your pending applications before switching joining methods.',
    active_seat_claim_exists: 'Resolve your current automatic offer or membership before changing methods.',
    active_matching_proposal_exists: 'Accept or decline your current automatic proposal before changing modes or applying elsewhere.',
    active_proposal_exists: 'Accept or decline your current automatic proposal before changing modes or applying elsewhere.',
    already_in_concert_group: 'You already belong to or host a group for this concert. Open your current group below.',
    already_group_member: 'You are already a member of this group.',
    previously_declined: 'This seeker–group pairing was declined earlier. Choose another group.',
    save_discovery_preferences_first: 'Save your preferences below before applying.',
    join_request_already_exists: 'You already have an active application to this group.',
    group_changed_withdraw_and_resubmit: 'The group changed after you applied. Withdraw the request, review the group and apply again.',
    preferences_changed_withdraw_and_resubmit: 'Your preferences changed after you applied. Withdraw the request and apply again with your latest answers.',
    group_unavailable: 'This group no longer has an eligible place. Review the latest results.',
  };
  return explanations[err.message] ?? (err.status === 401 ? 'Your session ended. Sign in again to manage your requests.' : err.status === 409 ? 'This action conflicts with an application, proposal or current membership. Review their latest statuses below before trying again.' : 'Could not save this change. Please try again.');
}

async function load() {
  const current = ++generation, key = context(), id = concertId.value;
  groups.value = []; saved.value = []; seeker.value = null;
  joins.value = []; memberships.value = []; proposals.value = []; total.value = 0;
  matching.value = { optedIn: false, state: 'idle', request: null, proposal: null };
  error.value = '';
  if (!id || !currentUser.value || !sessionReady.value || !preferencesReady.value) { loading.value = false; return; }
  loading.value = true;
  try {
    const [listing, preferences, request, applications, state, attendance, offers] = await Promise.all([
      api.discoverGroups(id, { offset: offset.value, q: filters.query, section: filters.section, arrival: filters.arrival, spendBand: filters.spendBand, minCapacity: filters.minCapacity, activity: filters.activity, vibe: filters.vibe, preferredOnly: filters.preferredOnly, sort: filters.sort }),
      api.groupPreferences(id), api.seekerRequest(id),
      api.groupJoinRequests({ scope: 'own', concertId: id }), api.groupMatching(id), api.currentGroupMemberships(), api.myProposals(),
    ]);
    if (!isCurrent(key) || current !== generation) return;
    groups.value = listing.groups; total.value = listing.total; saved.value = preferences.preferences;
    seeker.value = request.request; joins.value = applications.requests;
    matching.value = state.matching; memberships.value = attendance.groups ?? attendance.memberships ?? [];
    proposals.value = offers.proposals.filter(proposal => proposal.concertId === id && proposal.role === 'seeker');
    if (loadedContext !== key) { displayedMode.value = seeker.value ? persistedMode.value : 'direct'; loadedContext = key; }
  } catch (err) {
    if (isCurrent(key) && current === generation) error.value = err.status === 401 ? 'Sign in to browse groups and manage your preferences.' : 'Could not load groups and your requests. Please try again.';
  } finally { if (isCurrent(key) && current === generation) loading.value = false; }
}
watch(concertId, id => {
  setupOpen.value = false; applicationFor.value = ''; applicationNote.value = ''; offset.value = 0; message.value = '';
  clearTimeout(filterTimer); router.replace({ query: { ...route.query, concertId: id || undefined } }); load();
});
watch(() => Object.values(filters), () => { clearTimeout(filterTimer); filterTimer = setTimeout(() => { offset.value = 0; load(); }, 250); });
watch(() => route.query.concertId, id => { const next = typeof id === 'string' ? id : ''; if (next !== concertId.value) concertId.value = next; });
watch([() => currentUser.value?.id, sessionReady, preferencesReady], () => { message.value = ''; applicationFor.value = ''; loadedContext = ''; load(); });
onMounted(async () => {
  try {
    const response = await api.concerts(); if (!alive) return; concerts.value = response.concerts;
    if (!concertId.value && concerts.value.length) concertId.value = concerts.value[0].id; else await load();
  } catch { if (alive) error.value = 'Could not load concerts. Please try again.'; }
  finally { if (alive) concertsLoading.value = false; }
});
onUnmounted(() => { alive = false; generation++; clearTimeout(filterTimer); });
async function act(operation, success) {
  if (busy.value) return;
  const key = context(); busy.value = true; error.value = ''; message.value = '';
  try { await operation(); if (isCurrent(key)) { await load(); message.value = success; } }
  catch (err) { if (isCurrent(key)) { await load(); error.value = failureMessage(err); } }
  finally { busy.value = false; }
}
async function enroll(reopen = false) { await act(() => reopen ? api.reopenSeekerRequest(concertId.value) : api.createRequest(concertId.value, { ...form, joining_mode: displayedMode.value }), 'Your group request is ready. Choose and activate the joining mode you want to use.'); }
async function activateMode() { const target = displayedMode.value; await act(() => api.setJoiningMode(concertId.value, target), target === 'direct' ? 'Direct joining is active. You may apply to one group at a time for this concert.' : 'Automatic matching is active. Your open request can enter the next matching round.'); }
async function join(id) { await act(async () => { await api.requestGroupJoin(id, { note: applicationNote.value.trim() }); applicationFor.value = ''; applicationNote.value = ''; }, 'Application sent. A place is confirmed when the host approves; pending applications do not reserve places.'); }
async function preference(id, remove) { await act(() => remove ? api.removeGroupPreference(id) : api.preferGroup(id), remove ? 'Removed from your automatic-matching shortlist.' : 'Saved as a preferred group for automatic matching.'); }
async function joinPool() { await act(() => api.findMyGroup(concertId.value, crypto.randomUUID()), 'You are waiting for an operator-run matching round. Review any proposal here when it arrives.'); }
async function leavePool() { await act(() => api.leaveGroupMatching(concertId.value), 'You left automatic matching. Your saved preferences and matching history are kept.'); }
function dateLabel(value) { if (!value) return ''; const date = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`); return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('en-SG'); }
</script>

<template>
  <div class="container groups-page">
    <header class="groups-page__header"><h1>Find a group</h1><p>Choose a group yourself or use automatic matching. Both use the same compatibility and available places. Group places do not include tickets.</p></header>
    <GroupPreferencesGate summary @saved="load">
    <template #before><GroupNavigation /></template>
    <div class="groups-concert-picker"><label>Choose your concert<select v-model="concertId" :disabled="busy"><option value="">Select a concert</option><option v-for="concert in concerts" :key="concert.id" :value="concert.id">{{ concert.artist }}, {{ concert.event_date }}</option></select></label></div>
    <p v-if="error" class="group-error" role="alert">{{ error }} <button type="button" class="btn btn--ghost" :disabled="busy || loading" @click="load">Refresh</button></p>
    <p v-if="message" class="group-success" role="status">{{ message }}</p>
    <p v-if="concertsLoading" class="loading-state" role="status"><LoadingSpinner />Loading concerts…</p>
    <p v-if="busy" class="loading-state" role="status"><LoadingSpinner />Updating your request…</p>
    <p v-if="loading" class="loading-state" role="status"><LoadingSpinner />Loading groups and your requests…</p>
    <template v-else-if="concertId && currentUser">
      <section v-if="currentGroup" class="card group-panel" aria-labelledby="current-group-heading">
        <div class="current-group-identity"><GroupAvatar :src="currentGroup.imageUrl ?? currentGroup.group?.imageUrl" :name="currentGroup.name || currentGroup.group?.name || currentGroup.artist" :size="52" /><div><h2 id="current-group-heading">{{ currentGroup.name || currentGroup.group?.name || 'Your confirmed group' }}</h2><p>{{ currentGroup.artist }} · Hosted by {{ currentGroup.host?.displayName ?? currentGroup.group?.hostName ?? 'your concert companion' }}</p></div></div>
        <p class="group-muted">{{ originLabels[currentGroup.assignmentOrigin] ?? 'Confirmed membership' }} · {{ currentGroup.remainingCapacity }} places remaining</p><p>You can belong to one attendance group for this concert.</p>
        <div class="group-actions"><RouterLink :to="`/groups/${encodeURIComponent(currentGroup.partyId ?? currentGroup.id)}/members`" class="btn btn--primary">View your group</RouterLink><RouterLink :to="{path:'/meetups',query:{partyId:currentGroup.partyId ?? currentGroup.id}}" class="btn btn--ghost">Plan meetup</RouterLink></div>
      </section>
      <section v-else-if="!seeker" class="card group-panel">
        <div class="group-setup__heading"><div><h2>Ready to find your group?</h2><p>Save a concert request to apply directly or enter automatic matching.</p></div><button type="button" class="btn btn--primary" :disabled="busy" :aria-expanded="setupOpen" @click="setupOpen = !setupOpen">{{ setupOpen ? 'Close setup' : 'Set up group request' }}</button></div>
        <form v-if="setupOpen" class="group-panel" @submit.prevent="enroll()"><fieldset :disabled="busy" class="group-fieldset">
          <div class="group-controls"><label>Preferred seating<select v-model="form.section_pref"><option v-for="(name, id) in SECTION_OPTIONS" :key="id" :value="id">{{ name }}</option></select></label><label>Maximum spending<select v-model.number="form.spend_band_max"><option v-for="n in 4" :key="n" :value="n">{{ LABELS.spendBand[n] }}</option></select></label><label>Arrival<select v-model="form.arrival_pref"><option v-for="(name, id) in ARRIVAL_OPTIONS" :key="id" :value="id">{{ name }}</option></select></label></div>
          <details><summary>Activities (optional)</summary><fieldset><legend>Activities</legend><label v-for="(name, id) in LABELS.plans" :key="id" class="group-check"><input v-model="form.plans_wanted[id]" type="checkbox">{{ name }}</label></fieldset></details><button class="btn btn--primary">Save group request</button>
        </fieldset></form>
      </section>
      <section v-else-if="seeker.status === 'withdrawn'" class="card group-panel"><h2>Your group request is closed</h2><p>Reopen it to use either joining mode.</p><button type="button" class="btn btn--primary" :disabled="busy" @click="enroll(true)">Reopen group request</button></section>

      <section class="card group-panel" aria-labelledby="joining-mode-heading">
        <h2 id="joining-mode-heading">How would you like to join?</h2><div class="joining-modes" role="group" aria-label="View a joining method"><article v-for="option in modeOptions" :key="option.mode" class="joining-mode" :class="{ 'joining-mode--selected': displayedMode === option.mode }"><h3>{{ option.title }}</h3><p>{{ option.description }}</p><button type="button" class="btn" :class="displayedMode === option.mode ? 'btn--primary' : 'btn--ghost'" :aria-pressed="displayedMode === option.mode" :disabled="busy" @click="displayedMode = option.mode; applicationFor = ''">{{ option.action }}</button></article></div>
        <p class="group-muted">Viewing another method keeps your applications and offers. Your active method changes only when you explicitly activate it.</p><p v-if="seeker">Active method: <strong>{{ modeLabels[persistedMode] }}</strong></p>
        <p v-if="displayedMode === 'direct'">Apply to one group at a time for this concert. The host approves or declines your application. Approval confirms your membership immediately. To choose another group while waiting, withdraw your pending application first.</p>
        <template v-else><p>Save groups you prefer, then wait for a Gale–Shapley matching round. Both your preferences and the groups' preferences affect the result. An offer reserves a place until both you and the host approve, either declines, or it expires.</p><p class="group-muted">Matching rounds are run by an operator. Non-preferred eligible groups can still be offered.</p></template>
        <button v-if="seeker?.status === 'open' && !currentGroup && !modeIsActive" type="button" class="btn btn--primary" :disabled="busy" @click="activateMode">{{ displayedMode === 'direct' ? 'Use direct joining' : 'Use automatic matching' }}</button>
        <p v-if="!modeIsActive && seeker?.status === 'open'" class="group-muted">Resolve pending applications or automatic offers before switching methods. Nothing is withdrawn automatically.</p>
      </section>
      <section v-if="displayedMode === 'algorithm' && seeker && !currentGroup" class="card group-panel automatic-matching" aria-labelledby="automatic-matching-heading">
        <h2 id="automatic-matching-heading">Automatic matching status</h2><p v-if="activeProposals.length">You have a reserved offer to review below. Both you and the host must approve to confirm the place. Either person can decline to release it.</p><p v-else-if="pendingLegacy.length">An earlier automatic request is awaiting host approval. Review or withdraw it under Your applications before changing methods.</p><p v-else-if="matching.optedIn || matching.state === 'queued'" role="status">You are in the matching pool, waiting for the next operator-run round. Save your preferred groups below; use Refresh status to check for an offer.</p><p v-else>You are not currently waiting for an automatic match.</p>
        <div class="group-actions"><button v-if="!matching.optedIn && !activeProposals.length && !pendingLegacy.length && modeIsActive && seeker.status === 'open'" type="button" class="btn btn--primary" :disabled="busy" @click="joinPool">Join matching pool</button><button type="button" class="btn btn--ghost" :disabled="busy" @click="load">Refresh status</button><button v-if="matching.optedIn" type="button" class="btn btn--danger-ghost" :disabled="busy || activeProposals.length > 0 || pendingLegacy.length > 0" @click="leavePool">Leave matching pool</button><RouterLink :to="`/concerts/${encodeURIComponent(concertId)}#my-result-title`">Concert &amp; proposal history</RouterLink></div><p v-if="activeProposals.length" class="group-muted">Respond to your offer before leaving the pool or switching to direct joining.</p>
      </section>
      <section v-if="activeProposals.length" aria-label="Your automatic matching offers"><MatchProposalCard v-for="proposal in activeProposals" :key="proposal.id" :proposal="proposal" @updated="load" /></section>
      <section class="card group-panel"><h2>Search groups</h2><fieldset :disabled="busy" class="group-fieldset"><GroupFilters :filters="filters" preferences /></fieldset></section>
      <p>{{ groups.length }} {{ groups.length === 1 ? 'group' : 'groups' }} on this page. <span v-if="displayedMode === 'direct'">{{ pendingDirect.length }} of {{ pendingLimit }} pending applications.</span></p>
      <div class="group-grid"><GroupListingCard v-for="group in groups" :key="group.id" :group="group">
        <template v-if="displayedMode === 'direct'"><button type="button" class="btn btn--ghost" :disabled="busy || !canApply || pendingFor(group.id) || declinedFor(group.id) || group.remainingCapacity < 1 || group.status === 'cancelled'" @click="applicationFor = applicationFor === group.id ? '' : group.id; applicationNote = ''">{{ pendingFor(group.id) ? 'Application pending' : declinedFor(group.id) ? 'Previously declined' : group.remainingCapacity < 1 ? 'Group full' : 'Request to join' }}</button>
          <form v-if="applicationFor === group.id" class="application-form" @submit.prevent="join(group.id)"><label>Message to the host (optional)<textarea v-model="applicationNote" maxlength="500" rows="3" :disabled="busy" /></label><small class="group-muted">{{ applicationNote.length }}/500 characters. The host will see your public profile and preferences.</small><div class="group-actions"><button class="btn btn--primary" :disabled="busy || !canApply">Send application</button><button type="button" class="btn btn--ghost" :disabled="busy" @click="applicationFor = ''">Cancel</button></div></form>
        </template>
        <template v-else><button type="button" class="btn" :class="group.preferred ? 'btn--danger-ghost' : 'btn--ghost'" :disabled="busy || (!group.preferred && (!canPrefer || group.automaticPlacementAvailable === false))" @click="preference(group.id, group.preferred)">{{ group.preferred ? 'Remove preference' : 'Prefer group' }}</button><p v-if="group.automaticPlacementAvailable === false" class="group-muted">This group is currently unavailable for automatic placement.</p></template>
      </GroupListingCard></div>
      <p v-if="!groups.length" class="group-muted">No eligible groups match these filters. Try another concert or adjust the filters. Your current applications, offers and membership remain listed here.</p>
      <nav class="group-actions group-pagination" aria-label="Group results pages"><button type="button" class="btn btn--ghost" :disabled="loading || busy || offset === 0" @click="offset = Math.max(0, offset - 20); load()">Previous</button><span>{{ total }} results</span><button type="button" class="btn btn--ghost" :disabled="loading || busy || offset + 20 >= total" @click="offset += 20; load()">Next</button></nav>
      <section v-if="ownRequests.length" class="card group-panel" aria-labelledby="applications-heading"><h2 id="applications-heading">Your applications</h2>
        <article v-for="application in ownRequests.filter(request => request.status === 'pending')" :key="application.id" class="application-row"><div><h3>{{ application.hostName }}'s group</h3><p>{{ application.artist }} · {{ joinStatus[application.status] }}</p><p class="group-muted">Applied {{ dateLabel(application.createdAt) }}{{ application.matchingRoundId ? ' · Earlier automatic host-approval request; a place is reserved.' : ' · A place is not reserved while pending.' }}</p><p v-if="application.applicationNote">{{ application.applicationNote }}</p></div><button type="button" class="btn btn--danger-ghost" :disabled="busy" @click="act(() => api.withdrawGroupJoin(application.id), 'Application withdrawn.')">Withdraw application</button></article>
        <details v-if="ownRequests.some(request => request.status !== 'pending')"><summary>Application history</summary><article v-for="application in ownRequests.filter(request => request.status !== 'pending')" :key="application.id" class="application-row"><div><h3>{{ application.hostName }}'s group</h3><p>{{ application.artist }} · {{ application.resolutionReason === 'migrated_to_mutual_proposal' ? 'Moved to automatic offer' : joinStatus[application.status] ?? 'Request updated' }}</p><p class="group-muted">Applied {{ dateLabel(application.createdAt) }}</p></div><RouterLink v-if="application.status === 'accepted' && currentGroup?.partyId === application.partyId" :to="`/groups/${encodeURIComponent(application.partyId)}/members`">View your group</RouterLink></article></details>
      </section>
      <details v-if="saved.length && displayedMode === 'algorithm'" class="card group-panel"><summary>Saved matching preferences ({{ saved.length }})</summary><div v-for="preferenceGroup in saved" :key="preferenceGroup.partyId" class="application-row"><span>{{ preferenceGroup.hostName }} · {{ LABELS.section[preferenceGroup.section] ?? preferenceGroup.section }} · {{ preferenceGroup.status === 'open' ? 'Group open' : preferenceGroup.status === 'cancelled' ? 'Group cancelled' : 'Currently unavailable' }}</span><button type="button" class="btn btn--danger-ghost" :disabled="busy" @click="preference(preferenceGroup.partyId, true)">Remove preference</button></div></details>
    </template>
    <p v-else-if="!concertsLoading && !concerts.length">No concerts are available yet.</p>
    </GroupPreferencesGate>
  </div>
</template>

<style scoped>
.groups-page__header { display: grid; gap: var(--space-3); }
.groups-page__header > p { max-width: 70ch; color: var(--text-300); line-height: 1.6; }
.groups-concert-picker { max-width: 560px; width: 100%; }
.current-group-identity { display: flex; align-items: center; gap: var(--space-3); }
.current-group-identity > div { min-width: 0; }
.group-setup__heading { display: flex; justify-content: space-between; align-items: start; gap: var(--space-4); flex-wrap: wrap; }
.group-setup__heading p { max-width: 60ch; }
.joining-modes { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-3); }
.joining-mode { display: grid; align-content: start; justify-items: start; gap: var(--space-3); padding: var(--space-4); border: var(--border-soft); border-radius: var(--radius-md); background: var(--ink-750); }
.joining-mode--selected { border-color: var(--accent-400); }
.joining-mode h3 { font-size: var(--step-0); margin: 0; }
.joining-mode p { margin: 0; color: var(--text-300); }
.group-fieldset { padding: 0; margin: 0; border: 0; min-width: 0; display: grid; gap: var(--space-4); }
.application-form { display: grid; gap: var(--space-3); width: 100%; }
.application-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-3); padding-block: var(--space-4); border-bottom: var(--border-hairline); }
.application-row h3 { font-size: var(--step-0); }
.application-row > div { flex: 1 1 16rem; min-width: 0; overflow-wrap: anywhere; }
.group-pagination { justify-content: space-between; padding-top: var(--space-3); }
.group-pagination > span { color: var(--text-300); font-size: var(--step--1); }
.automatic-matching { border-color: var(--accent-400); }
.automatic-matching > p { max-width: 75ch; line-height: 1.6; }
@media (max-width: 600px) { .joining-modes { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 480px) { .joining-modes .btn { width: 100%; } .group-pagination .btn { flex: 0 1 auto; } }
</style>
