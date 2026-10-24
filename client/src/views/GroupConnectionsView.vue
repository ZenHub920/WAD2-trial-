<script setup>
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, LABELS, SECTION_OPTIONS, ARRIVAL_OPTIONS } from '../api.js';
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
import BackLink from '../components/BackLink.vue';
import GroupPreferencesGate from '../components/GroupPreferencesGate.vue';
import { preferencesReady } from '../groupPreferences.js';
import '../assets/groups.css';
import { currentUser } from '../auth.js';

const route = useRoute(), router = useRouter();
const hosted = ref([]), candidates = ref([]), connections = ref([]), joins = ref([]);
const attendance = ref([]);
const automaticOffers = ref([]);
const groupsLoading = ref(true), loading = ref(false), busy = ref(false);
const error = ref(''), message = ref('');
const offset = ref(0), total = ref(0);
/** One screen of candidates; the server pages in the same size. */
const PAGE_SIZE = 20;
const hasPreviousPage = computed(() => offset.value > 0);
const hasNextPage = computed(() => offset.value + PAGE_SIZE < total.value);
const allConcerts = ref([]), hostConcertId = ref('');
const selectedConcert = computed(() => allConcerts.value.find(concert => concert.id === hostConcertId.value));
const hostForm = reactive({ name: '', capacity: 2, section: 'standing_pen', spend_band: 2, arrival_plan: 'doors', plans: {}, notes: '' });
const hostImage = ref(null);
// Highlight missing fields only after the first attempt to create.
const attempted = ref(false);
const capacityValid = computed(() => Number.isInteger(hostForm.capacity) && hostForm.capacity >= 1);
const fieldState = filled => ({ 'field-ok': filled, 'field-error': attempted.value && !filled });
const groupTitle = g => g.name || g.group?.name || g.artist;
const filters = reactive({ query: '', section: '', minCapacity: 0, spendBand: '', arrival: '', activity: '', vibe: '', sort: 'compatibility' });
const mode = computed(() => ['create', 'connections'].includes(route.query.view) ? route.query.view : 'dashboard');
const concertId = computed(() => typeof route.query.concertId === 'string' ? route.query.concertId : '');
const activeGroups = computed(() => hosted.value.filter(g => g.status !== 'cancelled'));
const cancelledGroups = computed(() => hosted.value.filter(g => g.status === 'cancelled'));
const joinedGroups = computed(() => attendance.value.filter(g => !hosted.value.some(owned => owned.id === g.id)));
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
let generation = 0, refreshGeneration = 0, alive = true, filterTimer;

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
  const current = ++generation, group = sourceGroup.value;
  candidates.value = []; total.value = 0;
  if (mode.value !== 'connections' || !group || !canConnect.value) { loading.value = false; return; }
  loading.value = true;
  try {
    const result = await api.connectionCandidates(group.concertId, group.id, {
      offset: offset.value, q: filters.query, section: filters.section, arrival: filters.arrival,
      spendBand: filters.spendBand, minCapacity: filters.minCapacity, activity: filters.activity, vibe: filters.vibe, sort: filters.sort,
    });
    if (alive && current === generation) { candidates.value = result.groups; total.value = result.total; }
  } catch (e) {
    if (alive && current === generation) error.value = 'Could not load groups to connect with. Please try again.';
  } finally {
    if (alive && current === generation) loading.value = false;
  }
}

async function refresh() {
  const current = ++refreshGeneration, userId = currentUser.value?.id;
  if (!userId) return;
  const [groups, inbox, requests, memberships, offers] = await Promise.all([api.hostedGroups(), api.groupConnections(), api.hostedGroupJoinRequests(), api.currentGroupMemberships(), api.myProposals()]);
  if (!alive || current !== refreshGeneration || currentUser.value?.id !== userId) return;
  const owned = await Promise.all(groups.groups.map(async group => {
    if (group.status === 'cancelled' || group.settings) return group;
    const membership = await api.groupMembership(group.id);
    return { ...group, settings: membership.group.settings };
  }));
  if (!alive || current !== refreshGeneration || currentUser.value?.id !== userId) return;
  hosted.value = owned;
  attendance.value = memberships.groups ?? memberships.memberships ?? [];
  connections.value = inbox.connections;
  joins.value = requests.requests.filter(j => j.hostId === currentUser.value?.id);
  automaticOffers.value = offers.proposals.filter(proposal => proposal.role === 'host' && proposal.status === 'proposed');
  await loadCandidates();
}

watch(() => [route.query.view, route.query.groupId], () => {
  message.value = ''; offset.value = 0; confirming.value = null;
  loadCandidates();
});
watch(() => Object.values(filters), () => {
  clearTimeout(filterTimer);
  filterTimer = setTimeout(() => { offset.value = 0; loadCandidates(); }, 250);
});
watch(() => currentUser.value?.id, () => {
  refreshGeneration++; generation++;
  hosted.value = []; attendance.value = []; connections.value = []; joins.value = []; automaticOffers.value = []; candidates.value = []; error.value = ''; message.value = '';
  if (currentUser.value) retry();
});
watch(concertId, id => {
  if (allConcerts.value.some(c => c.id === id)) hostConcertId.value = id;
});

onMounted(async () => {
  try {
    const result = await api.concerts();
    if (!alive) return;
    allConcerts.value = result.concerts;
    hostConcertId.value = allConcerts.value.some(c => c.id === concertId.value) ? concertId.value : allConcerts.value[0]?.id || '';
    await refresh();
  } catch (e) {
    if (alive) error.value = e.status === 401 ? 'Sign in to create groups and manage connections.' : 'Could not load your groups. Please try again.';
  } finally { if (alive) groupsLoading.value = false; }
});
onUnmounted(() => { alive = false; generation++; clearTimeout(filterTimer); });

async function act(operation) {
  if (busy.value) return;
  const userId = currentUser.value?.id;
  busy.value = true; error.value = ''; message.value = '';
  try { await operation(); if (alive && currentUser.value?.id === userId) { await refresh(); message.value = 'Group updated.'; } }
  catch (e) {
    if (alive && currentUser.value?.id === userId) {
      try { await refresh(); } catch {}
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
      })[e.message] ?? (e.status === 409 ? 'This group or request has changed. Review the latest information before trying again.' : 'Could not update the group. Please try again.');
    }
  } finally { busy.value = false; }
}
async function retry() {
  groupsLoading.value = true; error.value = '';
  try { await refresh(); }
  catch (e) { if (alive) error.value = 'Could not load your groups. Please try again.'; }
  finally { if (alive) groupsLoading.value = false; }
}
async function host() {
  attempted.value = true;
  if (!hostForm.name.trim() || !capacityValid.value) {
    error.value = 'Fill in the highlighted fields to create your group.';
    message.value = '';
    return;
  }
  await act(async () => {
    const result = await api.createParty(hostConcertId.value, { ...hostForm, name: hostForm.name.trim() });
    if (!alive) return;
    await api.configureGroup(result.party.id, { expectedFriends: 0 });
    // The group exists by now; a picture that fails to upload can be added
    // again from Manage group, so it does not block finishing creation.
    if (hostImage.value) await api.setGroupImage(result.party.id, hostImage.value).catch(() => {});
    await router.push(`/groups/${encodeURIComponent(result.party.id)}/members`);
  });
}
</script>

<template>
  <div class="container groups-page">
    <BackLink v-if="mode !== 'dashboard'" :fallback="viewLink()" fallback-label="Back to My groups" />
    <header class="page-heading">
      <div>
        <h1>{{ pageTitle }}</h1>
        <p v-if="mode === 'dashboard'">Groups you own and groups you have joined, with requests and next steps in one place.</p>
        <p v-else-if="mode === 'create'">Start with a draft, then invite friends and publish when your group is ready.</p>
        <p v-else>Meet another group at the same concert. Connecting groups does not merge their members.</p>
      </div>
      <RouterLink v-if="mode === 'dashboard' && preferencesReady" :to="viewLink('create')" class="btn btn--primary">Create a group</RouterLink>
    </header>
    <GroupPreferencesGate :summary="mode === 'dashboard'" @saved="retry">
    <template #before><GroupNavigation /></template>
    <p v-if="error" class="group-error" role="alert">{{ error }} <button class="btn btn--ghost" :disabled="busy || groupsLoading" @click="retry">Retry</button></p>
    <p v-if="message" class="group-success" role="status">{{ message }}</p>
    <p v-if="busy && !confirming" class="loading-state" role="status"><LoadingSpinner />Updating your groups and connections…</p>
    <p v-if="groupsLoading" class="loading-state" role="status"><LoadingSpinner />Loading your groups…</p>

    <template v-if="mode === 'create'">
      <form class="card group-panel create-form" novalidate @submit.prevent="host">
        <section class="form-section">
          <h2>Name your group</h2>
          <div class="form-grid">
            <label class="form-wide">Group name<input v-model="hostForm.name" type="text" maxlength="60" required placeholder="e.g. Front Row Crew" :disabled="busy || groupsLoading" :class="fieldState(Boolean(hostForm.name.trim()))" :aria-invalid="attempted && !hostForm.name.trim()"><span v-if="attempted && !hostForm.name.trim()" class="field-message">Enter a name for your group.</span><span v-else class="field-hint">This is what other people see. Up to 60 characters.</span></label>
            <div class="form-wide group-picture-field">
              <span>Group picture <span class="field-hint">(optional)</span></span>
              <AvatarPicker :src="hostImage" :name="hostForm.name" :busy="busy || groupsLoading" :size="72" @select="image => hostImage = image" @remove="hostImage = null">
                <template #preview><GroupAvatar :src="hostImage" :name="hostForm.name" :size="72" /></template>
              </AvatarPicker>
            </div>
          </div>
        </section>
        <section class="form-section">
          <h2>Concert and group preferences</h2>
          <p class="group-muted">Your group stays private as a draft until you publish it from Manage group. You can invite friends there first. Your saved preferences are added to the group automatically.</p>
          <div class="form-grid">
            <label class="form-wide">Concert<select v-model="hostConcertId" required :disabled="busy || groupsLoading"><option v-for="c in allConcerts" :key="c.id" :value="c.id">{{ c.artist }}, {{ c.event_date }}</option></select></label>
            <div v-if="selectedConcert" class="form-wide venue-layout">
              <div class="venue-layout__heading">
                <div><span class="group-muted">Venue</span><strong>{{ selectedConcert.venue }}</strong></div>
                <a v-if="selectedConcert.seatmap_url" :href="selectedConcert.seatmap_url" target="_blank" rel="noopener noreferrer">View concert seating plan ↗</a>
                <a v-else-if="selectedConcert.official_url" :href="selectedConcert.official_url" target="_blank" rel="noopener noreferrer">Check seating on Ticketmaster ↗</a>
              </div>
              <p v-if="!selectedConcert.seatmap_url" class="group-muted">{{ selectedConcert.source === 'ticketmaster' ? 'Ticketmaster has not provided a seating plan for this concert.' : 'A seating plan is not available for this concert.' }}</p>
            </div>
            <label>Group size<input v-model.number="hostForm.capacity" type="number" min="1" step="1" required :disabled="busy || groupsLoading" :class="fieldState(capacityValid)" :aria-invalid="attempted && !capacityValid"><span v-if="attempted && !capacityValid" class="field-message">Enter a number, 1 or more.</span><span v-else class="field-hint">New companion places, excluding you and invited friends.</span></label>
            <label>Seating preference<select v-model="hostForm.section" :disabled="busy || groupsLoading"><option v-for="(name, id) in SECTION_OPTIONS" :key="id" :value="id">{{ name }}</option></select><span class="field-hint">General categories, not confirmed venue sections.</span></label>
            <label>Spending budget<select v-model.number="hostForm.spend_band" :disabled="busy || groupsLoading"><option v-for="n in 4" :key="n" :value="n">{{ LABELS.spendBand[n] }}</option></select></label>
            <label>Arrival<select v-model="hostForm.arrival_plan" :disabled="busy || groupsLoading"><option v-for="(name, id) in ARRIVAL_OPTIONS" :key="id" :value="id">{{ name }}</option></select></label>
          </div>
        </section>
        <section class="form-section">
          <h2>Optional extras</h2>
          <label>Group notes (visible after publishing)<textarea v-model="hostForm.notes" maxlength="2000" rows="3" :disabled="busy || groupsLoading"></textarea></label>
          <fieldset><legend>Group activities</legend><label v-for="(name, id) in LABELS.plans" :key="id" class="group-check"><input v-model="hostForm.plans[id]" type="checkbox" :disabled="busy || groupsLoading">{{ name }}</label></fieldset>
        </section>
        <p v-if="!groupsLoading && !allConcerts.length" class="group-muted">No concerts are available to create a group for yet.</p>
        <div class="group-actions"><button class="btn btn--primary" :disabled="busy || groupsLoading || !hostConcertId">{{ busy ? 'Creating…' : 'Create draft group' }}</button><RouterLink :to="viewLink()" class="btn btn--ghost">Back to My groups</RouterLink></div>
      </form>
    </template>

    <template v-else-if="!groupsLoading">
      <template v-if="mode === 'dashboard' || !sourceGroup">
        <p v-if="mode === 'connections'" class="group-muted" role="status">{{ route.query.groupId ? 'This group is unavailable, cancelled, or not owned by you. Choose an active group below.' : 'Choose the group you want to connect with other groups.' }}</p>
        <section class="owned-section" aria-labelledby="owned-heading">
          <div class="section-heading"><h2 id="owned-heading">{{ mode === 'connections' ? 'Choose one of your groups' : 'Groups you own' }}</h2><span class="group-muted">{{ activeGroups.length }} active</span></div>
          <div v-if="activeGroups.length" class="owned-grid">
            <article v-for="g in activeGroups" :key="g.id" class="card group-panel owned-card">
              <div class="owned-card__top">
                <GroupAvatar :src="g.imageUrl" :name="groupTitle(g)" :size="52" />
                <div class="owned-card__title"><h3>{{ groupTitle(g) }}</h3><p v-if="g.name" class="group-muted">{{ g.artist }}</p></div>
                <span class="group-state" :class="{ 'group-state--published': g.settings?.published }">{{ g.settings?.published ? 'Published' : 'Draft' }}</span>
              </div>
              <p class="group-muted">{{ g.eventDate }} · {{ sectionName(g.section) }}</p>
              <p>{{ g.memberCount }} {{ g.memberCount === 1 ? 'member' : 'members' }} · {{ g.remainingCapacity }} places remaining</p>
              <p class="group-muted">{{ g.settings?.published ? (g.settings.connect_open ? 'Open to meeting other groups.' : 'Group connections are off. Change this in Manage group.') : 'Invite friends, then publish from Manage group.' }}</p>
              <div class="owned-card__actions">
                <RouterLink :to="mode === 'connections' ? viewLink('connections', g) : `/groups/${encodeURIComponent(g.id)}/members`" class="btn btn--primary">{{ mode === 'connections' ? 'Connect this group' : 'Manage group' }}</RouterLink>
              </div>
            </article>
          </div>
          <div v-else class="card group-panel empty-state"><h3>You do not own an active group yet</h3><p>Create a draft for your next concert, then invite friends or publish it for new companions.</p><RouterLink :to="viewLink('create')" class="btn btn--primary">Create your first group</RouterLink></div>
        </section>
      </template>

      <template v-if="mode === 'dashboard'">
        <section v-if="joinedGroups.length" class="owned-section" aria-labelledby="joined-heading">
          <div class="section-heading"><h2 id="joined-heading">Groups I joined</h2><span class="group-muted">{{ joinedGroups.length }} active</span></div>
          <div v-if="joinedGroups.length" class="owned-grid">
            <article v-for="g in joinedGroups" :key="g.id" class="card group-panel owned-card">
              <div class="owned-card__top"><GroupAvatar :src="g.imageUrl ?? g.group?.imageUrl" :name="groupTitle(g)" :size="52" /><div class="owned-card__title"><h3>{{ groupTitle(g) }}</h3><p v-if="g.name || g.group?.name" class="group-muted">{{ g.artist }}</p></div></div>
              <p class="group-muted">{{ membershipSource[g.assignmentOrigin ?? g.source] ?? 'Active group member' }}</p>
              <p>{{ g.host?.displayName }}'s group · {{ g.remainingCapacity }} places remaining</p>
              <div class="owned-card__actions">
                <RouterLink :to="`/groups/${encodeURIComponent(g.id)}/members`" class="btn btn--primary">View group</RouterLink>
              </div>
            </article>
          </div>
        </section>
        <section v-if="admissionQueues.length || historicalJoins.length" id="join-requests" class="card group-panel" aria-labelledby="requests-heading">
          <div class="section-heading"><h2 id="requests-heading">Join requests</h2><span class="group-muted">{{ incomingCount }} in your queues</span></div>
          <p class="group-muted">Each group has one arrival-order queue for direct applications and automatic proposals. Review the first request only. Later requests may be waiting without a held place; every request expires 48 hours after it was created.</p>
          <p v-if="!admissionQueues.length" class="group-muted">No pending requests to join your groups.</p>
          <section v-for="queue in admissionQueues" :key="queue.partyId" class="admission-queue">
            <div class="section-heading"><h3>{{ queue.name }}</h3><span class="group-muted">{{ queue.entries.filter(entry => entry.record.seatReserved).length }} places held · {{ queue.entries.length }} requests</span></div>
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
          <div class="group-actions"><RouterLink :to="`/groups/${encodeURIComponent(sourceId)}/members`" class="btn btn--ghost">Manage group</RouterLink><RouterLink :to="{ path: '/meetups', query: { partyId: sourceId } }" class="btn btn--ghost">Plan group meetup</RouterLink></div>
        </section>
        <template v-if="canConnect">
          <section class="card group-panel"><h2>Find another group</h2><GroupFilters :filters="filters" /></section>
          <p v-if="loading" class="loading-state" role="status"><LoadingSpinner />Loading groups…</p>
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

      <section v-if="sourceGroup || (mode === 'dashboard' && (incoming.length || outgoing.length || accepted.length))" class="card group-panel connections">
        <h2>{{ mode === 'dashboard' ? 'Group connections and invitations' : 'This group’s connections' }}</h2>
        <div v-if="incoming.length" class="invites">
          <h3 class="invites__title">Received <span class="invites__count tabular">{{ incoming.length }}</span></h3>
          <article v-for="c in incoming" :key="c.id" class="invite"><p class="invite__who">{{ describe(c) }}</p><div class="invite__actions"><button type="button" class="btn btn--success" :disabled="busy" :aria-label="`Accept the invitation from ${otherParty(c).hostName}`" @click="act(() => api.respondToGroup(c.id, 'accept'))">Accept</button><button type="button" class="btn btn--danger-ghost" :disabled="busy" :aria-label="`Decline the invitation from ${otherParty(c).hostName}`" @click="confirming = { kind: 'decline', connection: c }">Decline</button></div></article>
        </div>
        <div v-if="outgoing.length" class="invites">
          <h3 class="invites__title">Sent <span class="invites__count tabular">{{ outgoing.length }}</span></h3>
          <article v-for="c in outgoing" :key="c.id" class="invite"><p class="invite__who">{{ describe(c) }}</p><button type="button" class="btn btn--danger-ghost" :disabled="busy" :aria-label="`Cancel your invitation to ${otherParty(c).hostName}`" @click="confirming = { kind: 'cancel', connection: c }">Withdraw pending invitation</button></article>
        </div>
        <div class="connected">
          <h3 class="invites__title">Connected</h3>
          <p v-if="!accepted.length" class="group-muted">No connected groups yet. Publish your group and invite another group to connect.</p>
          <article v-for="c in accepted" :key="c.id" class="connection"><p class="invite__who">{{ describe(c) }}</p><p v-if="c.partyA.notes" class="group-notes"><strong>{{ c.partyA.hostName }}:</strong> {{ c.partyA.notes }}</p><p v-if="c.partyB.notes" class="group-notes"><strong>{{ c.partyB.hostName }}:</strong> {{ c.partyB.notes }}</p><div class="connection__foot"><span class="connection__since">Connected {{ whenConnected(c.respondedAt) }}</span><RouterLink class="btn btn--primary" :to="`/groups/connections/${encodeURIComponent(c.id)}/channel`">Open shared chat</RouterLink><RouterLink class="btn btn--ghost" :to="{ path: '/meetups', query: { connectionId: c.id } }">Plan meetup</RouterLink></div></article>
        </div>
      </section>
    </template>
    </GroupPreferencesGate>

    <ConfirmDialog :open="Boolean(confirming)" :title="confirmCopy.title" :body="confirmCopy.body" :confirm-label="confirmCopy.label" cancel-label="Keep it" danger :busy="busy" @confirm="runConfirmed" @cancel="confirming = null" />
  </div>
</template>

<style scoped>
.page-heading, .section-heading, .owned-card__top { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); flex-wrap: wrap; }
.page-heading > div { display: grid; gap: var(--space-2); }
.page-heading p { color: var(--text-300); max-width: 68ch; }
.owned-section, .form-section, .history-list { display: grid; gap: var(--space-4); min-width: 0; }
.owned-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 22rem), 1fr)); gap: var(--space-4); }
.owned-card { grid-template-rows: auto auto auto 1fr auto; }
.owned-card__top { align-items: center; flex-wrap: nowrap; }
.owned-card__title { display: grid; flex: 1 1 auto; gap: 2px; min-width: 0; }
.owned-card__title p { font-size: var(--step--1); }
/* One full-width action; meetups and connections live inside Manage group. */
.owned-card__actions { align-self: end; display: grid; }
.owned-card__actions .btn { width: 100%; justify-content: center; text-align: center; }
.group-picture-field { display: grid; gap: var(--space-2); font-size: var(--step--1); }
.create-form { max-width: 54rem; width: 100%; box-sizing: border-box; }
.form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-4); align-items: end; }
.form-wide { grid-column: 1 / -1; }
.form-section + .form-section { padding-top: var(--space-5); border-top: var(--border-hairline); }
.field-hint { color: var(--text-300); font-size: var(--step--2); font-weight: 400; }
.venue-layout { display: grid; gap: var(--space-2); padding: var(--space-3) var(--space-4); border: var(--border-soft); border-radius: var(--radius-md); }
.venue-layout__heading { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: var(--space-3); }
.venue-layout__heading > div { display: grid; gap: var(--space-1); }
.venue-layout p, .venue-layout a, .venue-layout span { font-size: var(--step--1); }
.empty-state { justify-items: start; }
.history-list { margin-top: var(--space-4); }
.admission-queue { display: grid; gap: var(--space-3); padding-top: var(--space-4); border-top: var(--border-hairline); }
.join-request, .cancelled-group { display: grid; gap: var(--space-2); }
.connections { display: grid; gap: var(--space-5); }
.invites, .connected { display: grid; gap: var(--space-3); }
.invites__title { display: flex; align-items: center; gap: var(--space-2); padding-bottom: var(--space-2); border-bottom: var(--border-hairline); color: var(--text-300); font-size: var(--step--2); font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
.invites__count { display: grid; place-items: center; min-width: 20px; height: 20px; padding-inline: 6px; border-radius: var(--radius-pill); background: var(--accent-500); color: #fff; font-size: var(--step--2); letter-spacing: 0; }
.invite, .connection { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: var(--space-3); padding: var(--space-4); border: var(--border-hairline); border-radius: var(--radius-md); background: var(--ink-850); }
.connection { display: grid; justify-items: start; }
.invite__who { min-width: 0; color: var(--text-200); font-size: var(--step--1); }
.invite__actions { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.connection__foot { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-3); width: 100%; margin-top: var(--space-2); }
.connection__since { margin-right: auto; color: var(--text-400); font-size: var(--step--2); }
@media (max-width: 600px) {
  .page-heading { align-items: flex-start; }
  .form-grid { grid-template-columns: minmax(0, 1fr); }
  .invite { align-items: flex-start; flex-direction: column; }
  .invite__actions { width: 100%; }
  .invite__actions .btn { flex: 1; }
}
</style>
