<script setup>
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, LABELS, SECTION_OPTIONS, ARRIVAL_OPTIONS } from '../api.js';
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
import '../assets/groups.css';

const route = useRoute(), router = useRouter();
const concerts = ref([]), groups = ref([]), saved = ref([]), seeker = ref(null);
const concertId = ref(typeof route.query.concertId === 'string' ? route.query.concertId : '');
const concertsLoading = ref(true), loading = ref(false), busy = ref(false);
const setupOpen = ref(false), error = ref(''), message = ref('');
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
const persistedMode = computed(() => seeker.value?.joining_mode ?? seeker.value?.joiningMode ?? 'algorithm');
const currentGroup = computed(() => memberships.value.find(group => group.concertId === concertId.value));
const ownRequests = computed(() => joins.value.filter(request => request.userId === currentUser.value?.id && request.concertId === concertId.value));
const pendingDirect = computed(() => ownRequests.value.filter(request => request.status === 'pending' && !request.matchingRoundId));
const pendingLegacy = computed(() => ownRequests.value.filter(request => request.status === 'pending' && request.matchingRoundId));
const activeProposals = computed(() => proposals.value.filter(proposal => proposal.status === 'proposed'));
const modeIsActive = computed(() => Boolean(seeker.value && persistedMode.value === displayedMode.value));
const pendingLimit = computed(() => seeker.value?.maxPendingDirectApplications ?? 1);
const canApply = computed(() => !busy.value && !loading.value && displayedMode.value === 'direct' && seeker.value?.status === 'open' && persistedMode.value === 'direct' && !currentGroup.value && !activeProposals.value.length && !pendingLegacy.value.length && pendingDirect.value.length < pendingLimit.value);
const canPrefer = computed(() => seeker.value?.status === 'open' && !currentGroup.value && !activeProposals.value.length);
const modeLabels = { direct: 'Browse and choose', algorithm: 'Match me with a group' };
const modeOptions = [
  { mode: 'direct', kicker: 'Pick yourself', title: 'Browse and choose', description: 'Look through the groups going to this show and ask to join the one you like.', action: 'Browse groups' },
  { mode: 'algorithm', kicker: 'Let us help', title: 'Match me with a group', description: 'Tell us which groups you like and we’ll pair you with one that likes you back.', action: 'Find my match' },
];
const originLabels = { direct: 'The host said yes to your request', algorithm: 'You were matched with this group', host: 'You’re the host', friend: 'A friend invited you' };
const joinStatus = { pending: 'Waiting for the host', accepted: 'You’re in', rejected: 'Not this time', declined: 'Not this time', withdrawn: 'You cancelled this', expired: 'Timed out', superseded: 'Closed', cancelled: 'Ended' };
let generation = 0, alive = true, filterTimer, loadedContext = '', loadedDataContext = '';
const context = () => `${currentUser.value?.id ?? ''}:${concertId.value}`;
const isCurrent = key => alive && key === context();
const pendingFor = id => ownRequests.value.some(request => request.partyId === id && request.status === 'pending');
const declinedFor = id => ownRequests.value.some(request => request.partyId === id && ['rejected', 'declined'].includes(request.status));
const canQueueFor = group => group.canJoinQueue ?? group.remainingCapacity > 0;

function failureMessage(err) {
  const explanations = {
    open_seeker_request_required: 'Tell us a bit about your plans for this show first.',
    direct_joining_mode_required: 'Switch to “Browse and choose” before asking to join a group.',
    pending_application_limit_reached: 'You’ve already asked one group. Cancel that request if you’d rather try another.',
    withdraw_pending_applications_first: 'Cancel your open request before switching how you join.',
    active_seat_claim_exists: 'Finish up with your current request, match or group before switching how you join.',
    active_matching_proposal_exists: 'Say yes or no to your match first.',
    active_proposal_exists: 'Say yes or no to your match first.',
    already_in_concert_group: 'You already have a group for this show. You can find it at the top of the page.',
    already_group_member: 'You’re already in this group.',
    previously_declined: 'This group passed earlier, so try a different one.',
    save_discovery_preferences_first: 'We need your preferences to find you a match. Save them above first, or browse groups yourself instead.',
    join_request_already_exists: 'You’ve already asked to join this group.',
    group_changed_withdraw_and_resubmit: 'This group changed after you asked. Cancel your request, take another look and ask again.',
    preferences_changed_withdraw_and_resubmit: 'Your preferences changed after you asked. Cancel and ask again so the host sees your latest answers.',
    group_unavailable: 'This group just filled up. Have a look at the others.',
    request_waiting_in_queue: 'Someone else is ahead in line. Refresh and try again in a moment.',
  };
  return explanations[err.message] ?? (err.status === 401 ? 'You’ve been signed out. Sign in again to carry on.' : err.status === 409 ? 'That clashes with a request, match or group you already have. Check below and try again.' : 'Something went wrong. Please try again.');
}

async function load() {
  const current = ++generation, key = context(), id = concertId.value;
  const listingKey = `${key}:${offset.value}:${JSON.stringify(filters)}`;
  if (loadedDataContext !== key) {
    groups.value = []; saved.value = []; seeker.value = null;
    joins.value = []; memberships.value = []; proposals.value = []; total.value = 0;
    matching.value = { optedIn: false, state: 'idle', request: null, proposal: null };
    comparisonSession.value = ''; loadedDataContext = key;
  }
  error.value = '';
  if (!id || !currentUser.value || !sessionReady.value) { loading.value = false; return; }
  loading.value = true;
  try {
    const [listing, preferences, request, applications, state, attendance, offers] = await Promise.all([
      api.discoverGroups(id, { offset: offset.value, q: filters.query, section: filters.section, arrival: filters.arrival, spendBand: filters.spendBand, minCapacity: filters.minCapacity, activity: filters.activity, vibe: filters.vibe, preferredOnly: filters.preferredOnly, sort: filters.sort }),
      api.groupPreferences(id), api.seekerRequest(id),
      api.groupJoinRequests({ scope: 'own', concertId: id }), api.groupMatching(id), api.currentGroupMemberships(), api.myProposals(),
    ]);
    if (!isCurrent(key) || current !== generation) return;
    groups.value = listing.groups; total.value = listing.total; saved.value = preferences.preferences;
    comparisonSession.value = listingKey;
    seeker.value = request.request; joins.value = applications.requests;
    matching.value = state.matching; memberships.value = attendance.groups ?? attendance.memberships ?? [];
    proposals.value = offers.proposals.filter(proposal => proposal.concertId === id && proposal.role === 'seeker');
    if (loadedContext !== key) {
      displayedMode.value = ['direct', 'algorithm'].includes(route.query.mode) ? route.query.mode : seeker.value ? persistedMode.value : 'direct';
      loadedContext = key;
    }
  } catch (err) {
    if (isCurrent(key) && current === generation) {
      if (comparisonSession.value !== listingKey) { groups.value = []; comparisonSession.value = listingKey; }
      error.value = err.status === 401 ? 'Sign in to see the groups going to this show.' : 'We couldn’t load the groups. Please try again.';
    }
  } finally { if (isCurrent(key) && current === generation) loading.value = false; }
}
watch(concertId, id => {
  setupOpen.value = false; applicationFor.value = ''; applicationNote.value = ''; offset.value = 0; message.value = '';
  clearTimeout(filterTimer); router.replace({ query: { ...route.query, concertId: id || undefined } }); load();
});
watch(() => Object.values(filters), () => {
  generation++; loading.value = true; applicationFor.value = ''; applicationNote.value = '';
  clearTimeout(filterTimer); filterTimer = setTimeout(() => { offset.value = 0; load(); }, 250);
});
watch(() => route.query.concertId, id => { const next = typeof id === 'string' ? id : ''; if (next !== concertId.value) concertId.value = next; });
watch(() => route.query.mode, mode => { if (['direct', 'algorithm'].includes(mode)) { displayedMode.value = mode; applicationFor.value = ''; } });
watch([() => currentUser.value?.id, sessionReady, preferencesReady], () => { message.value = ''; applicationFor.value = ''; loadedContext = ''; load(); });
onMounted(async () => {
  try {
    const response = await api.concerts(); if (!alive) return; concerts.value = response.concerts;
    if (!concertId.value && concerts.value.length) concertId.value = concerts.value[0].id; else await load();
  } catch { if (alive) error.value = 'We couldn’t load concerts. Please try again.'; }
  finally { if (alive) concertsLoading.value = false; }
});
onUnmounted(() => { alive = false; generation++; clearTimeout(filterTimer); });
async function act(operation, success) {
  if (busy.value) return false;
  const key = context(); busy.value = true; error.value = ''; message.value = '';
  try {
    await operation();
    if (!isCurrent(key)) return false;
    await load();
    if (!isCurrent(key)) return false;
    message.value = typeof success === 'function' ? success() : success;
    return true;
  }
  catch (err) { if (isCurrent(key)) { await load(); if (isCurrent(key)) error.value = failureMessage(err); } return false; }
  finally { busy.value = false; }
}
async function enroll(reopen = false) { await act(() => reopen ? api.reopenSeekerRequest(concertId.value) : api.createRequest(concertId.value, { ...form, joining_mode: displayedMode.value }), 'You’re all set. Now choose how you’d like to find your group.'); }
async function activateMode() { const target = displayedMode.value; await act(() => api.setJoiningMode(concertId.value, target), target === 'direct' ? 'Great, browse the groups below and ask to join one.' : 'Great, mark the groups you like and join the match list.'); }
async function join(id, note = applicationNote.value.trim()) {
  let application;
  return act(async () => {
    application = (await api.requestGroupJoin(id, { note })).request;
    applicationFor.value = ''; applicationNote.value = '';
  }, () => application?.seatReserved
    ? 'Request sent. We’re saving you a spot while the host decides.'
    : `Request sent. You’re ${application?.queuePosition ? `number ${application.queuePosition} ` : ''}in line, and we’ll save you a spot if one opens up.`);
}
async function preference(id, remove) { await act(() => remove ? api.removeGroupPreference(id) : api.preferGroup(id), remove ? 'Removed from the groups you like.' : 'Added to the groups you like.'); }
async function joinPool() { await act(() => api.findMyGroup(concertId.value, crypto.randomUUID()), 'You’re on the match list. Your match will show up here once it’s ready.'); }
async function leavePool() { await act(() => api.leaveGroupMatching(concertId.value), 'You’re off the match list. We’ve kept your liked groups in case you come back.'); }
function dateLabel(value) { if (!value) return ''; const date = new Date(typeof value === 'number' ? value : value.includes('T') ? value : `${value.replace(' ', 'T')}Z`); return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('en-SG'); }
</script>

<template>
  <div class="container groups-page">
    <header class="groups-hero">
      <p class="groups-hero__eyebrow mono">Groups</p>
      <h1>Find your people for the show</h1>
      <p class="groups-hero__lede">Join a group of fans going to the same concert, so you can meet up, grab food and head in together. Joining a group doesn’t include a ticket.</p>
    </header>

    <GroupPreferencesGate summary @saved="load">
    <template #before><GroupNavigation /></template>

    <div class="groups-concert-picker">
      <label>Which concert are you going to?
        <select v-model="concertId" :disabled="busy">
          <option value="">Pick a concert</option>
          <option v-for="concert in concerts" :key="concert.id" :value="concert.id">{{ concert.artist }}, {{ concert.event_date }}</option>
        </select>
      </label>
    </div>

    <p v-if="error" class="group-error" role="alert">{{ error }} <button type="button" class="btn btn--ghost" :disabled="busy || loading" @click="load">Try again</button></p>
    <p v-if="message" class="group-success" role="status">{{ message }}</p>
    <p v-if="concertsLoading" class="loading-state" role="status"><LoadingSpinner />Loading concerts…</p>
    <p v-if="busy" class="loading-state" role="status"><LoadingSpinner />Saving…</p>
    <p v-if="loading" class="loading-state" role="status"><LoadingSpinner />Finding groups…</p>

    <template v-if="concertId && currentUser">
      <!-- Already sorted: this person has a group for the show. -->
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
        <div class="group-actions">
          <RouterLink :to="`/groups/${encodeURIComponent(currentGroup.partyId ?? currentGroup.id)}/members`" class="btn btn--primary">See your group</RouterLink>
          <RouterLink :to="{path:'/meetups',query:{partyId:currentGroup.partyId ?? currentGroup.id}}" class="btn btn--ghost">Plan where to meet</RouterLink>
        </div>
      </section>

      <!-- First visit for this concert: a few quick questions. -->
      <section v-else-if="!seeker" class="card group-panel">
        <div class="group-setup__heading">
          <div>
            <h2>First, tell us your plans</h2>
            <p class="group-muted">A few quick answers help hosts know you’ll get along.</p>
          </div>
          <button type="button" class="btn btn--primary" :disabled="busy" :aria-expanded="setupOpen" @click="setupOpen = !setupOpen">{{ setupOpen ? 'Not now' : 'Get started' }}</button>
        </div>
        <form v-if="setupOpen" class="group-panel" @submit.prevent="enroll()"><fieldset :disabled="busy" class="group-fieldset">
          <div class="group-controls">
            <label>Where do you want to be?<select v-model="form.section_pref"><option v-for="(name, id) in SECTION_OPTIONS" :key="id" :value="id">{{ name }}</option></select></label>
            <label>How much do you want to spend?<select v-model.number="form.spend_band_max"><option v-for="n in 4" :key="n" :value="n">{{ LABELS.spendBand[n] }}</option></select></label>
            <label>When do you want to get there?<select v-model="form.arrival_pref"><option v-for="(name, id) in ARRIVAL_OPTIONS" :key="id" :value="id">{{ name }}</option></select></label>
          </div>
          <details><summary>Anything you’d like to do together? (optional)</summary><fieldset><legend>Things to do</legend><label v-for="(name, id) in LABELS.plans" :key="id" class="group-check"><input v-model="form.plans_wanted[id]" type="checkbox">{{ name }}</label></fieldset></details>
          <button class="btn btn--primary">Save my answers</button>
        </fieldset></form>
      </section>

      <section v-else-if="seeker.status === 'withdrawn'" class="card group-panel">
        <h2>You stepped away from this show</h2>
        <p class="group-muted">Changed your mind? Pick up where you left off.</p>
        <button type="button" class="btn btn--primary" :disabled="busy" @click="enroll(true)">I’m looking again</button>
      </section>

      <!-- Two ways in. -->
      <section class="group-panel group-panel--bare" aria-labelledby="joining-mode-heading">
        <h2 id="joining-mode-heading">How do you want to find a group?</h2>
        <div class="joining-modes" role="group" aria-label="Ways to find a group">
          <article v-for="option in modeOptions" :key="option.mode" class="joining-mode" :class="{ 'joining-mode--selected': displayedMode === option.mode }">
            <p class="group-kicker mono">{{ option.kicker }}</p>
            <h3>{{ option.title }}</h3>
            <p>{{ option.description }}</p>
            <button type="button" class="btn" :class="displayedMode === option.mode ? 'btn--primary' : 'btn--ghost'" :aria-pressed="displayedMode === option.mode" :disabled="busy" @click="displayedMode = option.mode; applicationFor = ''">{{ option.action }}</button>
          </article>
        </div>
        <p v-if="seeker" class="group-muted">You’re currently using: <strong>{{ modeLabels[persistedMode] }}</strong></p>
        <button v-if="seeker?.status === 'open' && !currentGroup && !modeIsActive" type="button" class="btn btn--primary" :disabled="busy" @click="activateMode">{{ displayedMode === 'direct' ? 'Switch to browsing' : 'Switch to matching' }}</button>
        <p v-if="!modeIsActive && (seeker?.status === 'open' || pendingDirect.length || activeProposals.length || pendingLegacy.length)" class="group-muted">Just looking? That’s fine. Nothing changes until you switch, and open requests stay as they are.</p>
        <p v-if="pendingDirect.length" class="group-status" role="status">
          {{ pendingDirect[0].seatReserved ? 'We’re saving you a spot.' : `You’re number ${pendingDirect[0].queuePosition ?? '?'} in line.` }}
          The host has until {{ dateLabel(pendingDirect[0].expiresAt) }} to reply.
        </p>
        <details class="group-howto">
          <summary>How does this work?</summary>
          <ul v-if="displayedMode === 'direct'">
            <li>You can ask one group at a time per concert.</li>
            <li>Requests are answered in the order they arrive. If there’s room, we save you a spot while the host decides.</li>
            <li>If the host doesn’t reply within 48 hours, your request times out and you can try another group.</li>
          </ul>
          <ul v-else>
            <li>Mark the groups you like, then join the match list.</li>
            <li>We pair people and groups so both sides get a fit they like. You might be matched with a group you didn’t mark.</li>
            <li>When your match is ready, you and the host both say yes before it’s confirmed.</li>
            <li>Matches that aren’t answered within 48 hours time out.</li>
          </ul>
        </details>
      </section>

      <section v-if="displayedMode === 'algorithm' && seeker && !currentGroup" class="card group-panel automatic-matching" aria-labelledby="automatic-matching-heading">
        <h2 id="automatic-matching-heading">Your match</h2>
        <p v-if="activeProposals.length">You’ve got a match! Have a look below and say yes or no.</p>
        <p v-else-if="pendingLegacy.length">You have an earlier match waiting for the host. You can check on it or cancel it under Your requests.</p>
        <p v-else-if="matching.optedIn || matching.state === 'queued'" role="status">You’re on the match list. Keep marking groups you like, and check back soon.</p>
        <p v-else>You’re not on the match list yet.</p>
        <div class="group-actions">
          <button v-if="!matching.optedIn && !activeProposals.length && !pendingLegacy.length && modeIsActive && seeker.status === 'open'" type="button" class="btn btn--primary" :disabled="busy" @click="joinPool">Join the match list</button>
          <button type="button" class="btn btn--ghost" :disabled="busy" @click="load">Check for updates</button>
          <button v-if="matching.optedIn" type="button" class="btn btn--danger-ghost" :disabled="busy || activeProposals.length > 0 || pendingLegacy.length > 0" @click="leavePool">Leave the match list</button>
          <RouterLink :to="`/concerts/${encodeURIComponent(concertId)}#my-result-title`">Past matches</RouterLink>
        </div>
        <p v-if="activeProposals.length" class="group-muted">Answer your match before leaving the list or switching to browsing.</p>
      </section>
      <section v-if="activeProposals.length" aria-label="Your match"><MatchProposalCard v-for="proposal in activeProposals" :key="proposal.id" :proposal="proposal" @updated="load" /></section>

      <!-- Browsing. -->
      <section class="card group-panel">
        <h2>Narrow it down</h2>
        <fieldset :disabled="busy" class="group-fieldset"><GroupFilters :filters="filters" preferences /></fieldset>
      </section>

      <div class="results-heading">
        <p>{{ total }} {{ total === 1 ? 'group' : 'groups' }} going<span v-if="displayedMode === 'direct' && pendingDirect.length"> · you’ve asked {{ pendingDirect.length }} of {{ pendingLimit }}</span></p>
        <div v-if="displayedMode === 'direct'" class="results-layout" role="group" aria-label="How to show groups">
          <button type="button" class="btn" :class="directLayout === 'compare' ? 'btn--primary' : 'btn--ghost'" :aria-pressed="directLayout === 'compare'" :disabled="busy" @click="directLayout = 'compare'; applicationFor = ''">Side by side</button>
          <button type="button" class="btn" :class="directLayout === 'list' ? 'btn--primary' : 'btn--ghost'" :aria-pressed="directLayout === 'list'" :disabled="busy" @click="directLayout = 'list'">See all</button>
        </div>
      </div>

      <GroupComparisonDeck v-if="displayedMode === 'direct'" v-show="directLayout === 'compare' && groups.length" :groups="groups" :session-key="comparisonSession" :disabled="busy || loading || directLayout !== 'compare'" :can-apply="canApply" :apply-group="group => join(group.id, '')" />

      <div v-if="displayedMode !== 'direct' || directLayout === 'list'" class="group-grid">
        <GroupListingCard v-for="group in groups" :key="group.id" :group="group">
          <template v-if="displayedMode === 'direct'">
            <button type="button" class="btn btn--ghost" :disabled="busy || !canApply || pendingFor(group.id) || declinedFor(group.id) || !canQueueFor(group) || group.status === 'cancelled'" @click="applicationFor = applicationFor === group.id ? '' : group.id; applicationNote = ''">{{ pendingFor(group.id) ? 'Request sent' : declinedFor(group.id) ? 'Not this time' : !canQueueFor(group) ? 'Group is full' : group.remainingCapacity < 1 ? 'Join the waitlist' : 'Ask to join' }}</button>
            <form v-if="applicationFor === group.id" class="application-form" @submit.prevent="join(group.id)">
              <label>Say hi to the host (optional)<textarea v-model="applicationNote" maxlength="500" rows="3" :disabled="busy" placeholder="e.g. First time seeing them live, keen to grab dinner before!" /></label>
              <small class="group-muted">{{ applicationNote.length }}/500 · The host will see your profile and your answers.</small>
              <div class="group-actions">
                <button class="btn btn--primary" :disabled="busy || !canApply || !canQueueFor(group)">Send request</button>
                <button type="button" class="btn btn--ghost" :disabled="busy" @click="applicationFor = ''">Cancel</button>
              </div>
            </form>
          </template>
          <template v-else>
            <button type="button" class="btn" :class="group.preferred ? 'btn--danger-ghost' : 'btn--ghost'" :disabled="busy || (!group.preferred && (!canPrefer || group.automaticPlacementAvailable === false))" @click="preference(group.id, group.preferred)">{{ group.preferred ? 'Unlike' : 'I like this group' }}</button>
            <p v-if="group.automaticPlacementAvailable === false" class="group-muted">This group isn’t taking matches right now.</p>
          </template>
        </GroupListingCard>
      </div>
      <p v-if="!groups.length" class="group-empty">No groups match that yet. Try loosening the filters, or start your own group.</p>

      <!-- A page button exists only when that page does. Disabling them instead
           left two dead controls on every result set that fits on one page. -->
      <nav class="group-actions group-pagination" aria-label="Group results pages">
        <button v-if="hasPreviousPage" type="button" class="btn btn--ghost" :disabled="loading || busy" @click="offset = Math.max(0, offset - PAGE_SIZE); load()">Previous</button>
        <span>{{ total }} {{ total === 1 ? 'group' : 'groups' }}</span>
        <button v-if="hasNextPage" type="button" class="btn btn--ghost" :disabled="loading || busy" @click="offset += PAGE_SIZE; load()">Next</button>
      </nav>

      <section v-if="ownRequests.length" class="card group-panel" aria-labelledby="applications-heading">
        <h2 id="applications-heading">Your requests</h2>
        <article v-for="application in ownRequests.filter(request => request.status === 'pending')" :key="application.id" class="application-row">
          <div>
            <h3>{{ application.hostName }}’s group</h3>
            <p>{{ application.artist }} · {{ joinStatus[application.status] }}</p>
            <p><strong>{{ application.seatReserved ? 'We’re saving you a spot' : `You’re number ${application.queuePosition ?? '?'} in line` }}</strong></p>
            <p class="group-muted">Sent {{ dateLabel(application.createdAt) }} · times out {{ dateLabel(application.expiresAt) }}</p>
            <p class="group-muted">{{ application.canHostRespond ? 'You’re up next for the host.' : 'The host is replying to earlier requests first.' }}</p>
            <p v-if="application.applicationNote" class="group-quote">“{{ application.applicationNote }}”</p>
          </div>
          <div class="group-actions">
            <button type="button" class="btn btn--ghost" :disabled="busy" @click="load">Check for updates</button>
            <button type="button" class="btn btn--danger-ghost" :disabled="busy" @click="act(() => api.withdrawGroupJoin(application.id), 'Request cancelled. Your spot has gone to the next person in line.')">Cancel request</button>
          </div>
        </article>
        <details v-if="ownRequests.some(request => request.status !== 'pending')">
          <summary>Past requests</summary>
          <article v-for="application in ownRequests.filter(request => request.status !== 'pending')" :key="application.id" class="application-row">
            <div>
              <h3>{{ application.hostName }}’s group</h3>
              <p>{{ application.artist }} · {{ application.resolutionReason === 'migrated_to_mutual_proposal' ? 'Turned into a match' : application.resolutionReason === 'group_full' ? 'Filled up before your turn' : joinStatus[application.status] ?? 'Updated' }}</p>
              <p class="group-muted">Sent {{ dateLabel(application.createdAt) }}</p>
            </div>
            <RouterLink v-if="application.status === 'accepted' && currentGroup?.partyId === application.partyId" :to="`/groups/${encodeURIComponent(application.partyId)}/members`">See your group</RouterLink>
          </article>
        </details>
      </section>

      <details v-if="saved.length && displayedMode === 'algorithm'" class="card group-panel">
        <summary>Groups you like ({{ saved.length }})</summary>
        <div v-for="preferenceGroup in saved" :key="preferenceGroup.partyId" class="application-row">
          <span>{{ preferenceGroup.hostName }} · {{ LABELS.section[preferenceGroup.section] ?? preferenceGroup.section }} · {{ preferenceGroup.status === 'open' ? 'Open' : preferenceGroup.status === 'cancelled' ? 'No longer running' : 'Not taking people right now' }}</span>
          <button type="button" class="btn btn--danger-ghost" :disabled="busy" @click="preference(preferenceGroup.partyId, true)">Unlike</button>
        </div>
      </details>
    </template>
    <p v-else-if="!concertsLoading && !concerts.length" class="group-empty">No concerts yet. Check back soon!</p>
    </GroupPreferencesGate>
  </div>
</template>

<style scoped>
.groups-hero { display: grid; gap: var(--space-3); margin-bottom: var(--space-2); }
.groups-hero h1 { font-size: var(--step-5); line-height: 1.05; max-width: 20ch; }
.groups-hero__eyebrow, .group-kicker { font-size: var(--step--2); letter-spacing: 0.1em; text-transform: uppercase; color: var(--accent-400); }
.groups-hero__lede { max-width: 60ch; color: var(--text-300); font-size: var(--step-0); line-height: 1.6; }
.groups-concert-picker { max-width: 560px; width: 100%; }
.groups-concert-picker label { font-size: var(--step-0); font-weight: 600; color: var(--text-100); }
.current-group-identity { display: flex; align-items: center; gap: var(--space-3); }
.current-group-identity > div { min-width: 0; display: grid; gap: var(--space-1); }
.group-panel--highlight { border-color: var(--accent-400); background: linear-gradient(160deg, var(--accent-glow), transparent 60%), var(--ink-800); }
.group-panel--bare { padding: 0; }
.group-setup__heading { display: flex; justify-content: space-between; align-items: center; gap: var(--space-4); flex-wrap: wrap; }
.group-setup__heading > div { display: grid; gap: var(--space-1); max-width: 60ch; }
.joining-modes { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-4); }
.joining-mode { display: grid; align-content: start; justify-items: start; gap: var(--space-2); padding: var(--space-5); border: var(--border-soft); border-radius: var(--radius-lg, var(--radius-md)); background: var(--ink-800); transition: border-color var(--dur-base) var(--ease-out), transform var(--dur-base) var(--ease-out); }
.joining-mode:hover { transform: translateY(-2px); }
.joining-mode--selected { border-color: var(--accent-400); box-shadow: 0 0 0 1px var(--accent-400) inset; }
.joining-mode h3 { font-family: var(--font-display); font-size: var(--step-2); margin: 0; }
.joining-mode p { margin: 0; color: var(--text-300); }
.joining-mode .btn { margin-top: var(--space-3); }
.group-status { padding: var(--space-3) var(--space-4); border-radius: var(--radius-sm); background: var(--ink-750); }
.group-howto ul { display: grid; gap: var(--space-2); padding-left: var(--space-5); color: var(--text-300); max-width: 70ch; }
.group-fieldset { padding: 0; margin: 0; border: 0; min-width: 0; display: grid; gap: var(--space-4); }
.application-form { display: grid; gap: var(--space-3); width: 100%; }
.application-row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-3); padding-block: var(--space-4); border-bottom: var(--border-hairline); }
.application-row h3 { font-size: var(--step-0); }
.application-row > div { flex: 1 1 16rem; min-width: 0; overflow-wrap: anywhere; display: grid; gap: var(--space-1); }
.group-quote { font-style: italic; color: var(--text-300); }
.group-empty { padding: var(--space-6); text-align: center; color: var(--text-300); border: 1px dashed var(--ink-500); border-radius: var(--radius-md); }
.group-pagination { justify-content: space-between; padding-top: var(--space-3); }
.group-pagination > span { color: var(--text-300); font-size: var(--step--1); }
.automatic-matching { border-color: var(--accent-400); }
.automatic-matching > p { max-width: 75ch; line-height: 1.6; }
.results-heading { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: var(--space-3); }
.results-heading p { color: var(--text-100); font-weight: 600; }
.results-layout { display: inline-flex; flex-wrap: wrap; gap: var(--space-2); }
@media (prefers-reduced-motion: reduce) { .joining-mode, .joining-mode:hover { transition: none; transform: none; } }
@media (max-width: 600px) { .joining-modes { grid-template-columns: minmax(0, 1fr); } .groups-hero h1 { font-size: var(--step-4); } }
@media (max-width: 480px) { .joining-modes .btn { width: 100%; } .group-pagination .btn { flex: 0 1 auto; } }
</style>
