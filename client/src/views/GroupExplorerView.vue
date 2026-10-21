<script setup>
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, LABELS, SECTION_OPTIONS, ARRIVAL_OPTIONS } from '../api.js';
import { filterGroups } from '../groupFilters.js';
import GroupFilters from '../components/GroupFilters.vue';
import GroupListingCard from '../components/GroupListingCard.vue';
import GroupPreferencesGate from '../components/GroupPreferencesGate.vue';
import LoadingSpinner from '../components/LoadingSpinner.vue';
import GroupNavigation from '../components/GroupNavigation.vue';
import '../assets/groups.css';
const concertsLoading = ref(true);
const setupOpen = ref(false);
const savingPreferences = ref(false);
const matchingAction = ref('');
const matching = ref({ optedIn: false, state: 'idle', request: null });

const route = useRoute();
const router = useRouter();
const concerts = ref([]), groups = ref([]), saved = ref([]), seeker = ref(null);
const concertId = ref(typeof route.query.concertId === 'string' ? route.query.concertId : '');
const loading = ref(false), busy = ref(false), error = ref(''), message = ref('');
const offset=ref(0),total=ref(0),joins=ref([]);
let generation = 0, alive = true;
const filters = reactive({ query: '', section: '', minCapacity: 0, spendBand: '', arrival: '', activity: '', vibe: '', sort: 'compatibility', preferredOnly: false });
const form = reactive({ section_pref: 'standing_pen', spend_band_max: 3, arrival_pref: 'doors', plans_wanted: {} });
const visible = computed(() => filterGroups(groups.value, filters));
const canPrefer = computed(() => seeker.value?.status === 'open');
const pendingManualRequest = computed(() => joins.value.some(request => request.concertId === concertId.value && request.status === 'pending' && !request.matchingRoundId));
const pendingRequest = computed(() => joins.value.some(request => request.concertId === concertId.value && request.status === 'pending'));
const joinStatus = { pending: 'Awaiting host approval', accepted: 'Approved', rejected: 'Not approved', withdrawn: 'Withdrawn', expired: 'Expired — review the group before requesting again' };
async function load() {
  const current = ++generation;
  const id = concertId.value;
  groups.value = []; saved.value = []; seeker.value = null; error.value = '';
  matching.value = { optedIn: false, state: 'idle', request: null };
  if (!id) { loading.value = false; return; }
  loading.value = true;
  try {
    const [listing, preferences, request, requests, state] = await Promise.all([
      api.discoverGroups(id, { offset: offset.value, q: filters.query, section: filters.section, arrival: filters.arrival, spendBand: filters.spendBand, minCapacity: filters.minCapacity, activity: filters.activity, vibe: filters.vibe, preferredOnly: filters.preferredOnly, sort: filters.sort }),
      api.groupPreferences(id), api.seekerRequest(id), api.groupJoinRequests(), api.groupMatching(id),
    ]);
    if (alive && current === generation) {
      groups.value = listing.groups; total.value = listing.total; saved.value = preferences.preferences;
      seeker.value = request.request; joins.value = requests.requests;
      matching.value = state.matching;
    }
  } catch (e) { if (alive && current === generation) error.value = e.status === 401 ? 'Sign in to browse groups and manage your preferences.' : 'Could not load groups and preferences. Please try again.'; }
  finally { if (alive && current === generation) loading.value = false; }
}
watch(concertId, id => {
  setupOpen.value = false;
  offset.value=0;
  message.value = '';
  router.replace({ query: { ...route.query, concertId: id || undefined } });
  load();
});
let filterTimer;
watch(()=>Object.values(filters),()=>{clearTimeout(filterTimer);filterTimer=setTimeout(()=>{offset.value=0;load();},250);});
watch(() => route.query.concertId, id => {
  const next = typeof id === 'string' ? id : '';
  if (next !== concertId.value) concertId.value = next;
});
onMounted(async () => {
  try {
    concerts.value = (await api.concerts()).concerts;
    if (!alive) return;
    if (!concertId.value && concerts.value.length) concertId.value = concerts.value[0].id;
    else await load();
  } catch (e) { if (alive) error.value = 'Could not load concerts. Please try again.'; }
  finally { concertsLoading.value = false; }
});
onUnmounted(() => { alive = false; generation++;clearTimeout(filterTimer); });
async function join(id){busy.value=true;error.value='';try{await api.requestGroupJoin(id);await load();message.value='Request sent. Your group place is confirmed when the host approves.';}catch(e){await load();error.value=e.status===409?'This group or your preferences changed. Review the group and your open request before trying again.':'Could not send your join request. Please try again.';}finally{busy.value=false;}}
async function withdrawJoin(id){busy.value=true;error.value='';try{await api.respondGroupJoin(id,'withdraw');await load();message.value='Join request withdrawn.';}catch(e){error.value='Could not withdraw this request. Please try again.';}finally{busy.value=false;}}
async function findMyGroup() {
  if (busy.value) return;
  const id = concertId.value;
  const storageKey = `encore-managed-batch:${id}`;
  busy.value = true; matchingAction.value = 'find'; error.value = ''; message.value = '';
  try {
    let key = sessionStorage.getItem(storageKey);
    if (!key) { key = crypto.randomUUID(); sessionStorage.setItem(storageKey, key); }
    const result = await api.findMyGroup(id, key);
    sessionStorage.removeItem(storageKey);
    if (alive && id === concertId.value) {
      await load();
      message.value = result.matching.state === 'pending'
        ? 'Gale–Shapley found a group. Your request is waiting for the host to approve.'
        : result.matching.state === 'accepted'
          ? 'Your group place is confirmed.'
          : 'You are in the matching pool. No suitable place was available in this round.';
    }
  } catch (e) {
    const errors = {
      open_seeker_request_required: 'Set up or reopen your group request first.',
      withdraw_current_join_request_first: 'Withdraw your existing join request before using automatic matching.',
      active_matching_proposal_exists: 'Review your existing proposal before finding another group.',
      already_in_concert_group: 'You already belong to a group for this concert.',
      unsupported_matching_constraints: 'This matching pool includes linked requests or minimum group sizes that automatic matching cannot safely support.',
    };
    if (alive && id === concertId.value) error.value = errors[e.message] ?? 'Could not run group matching. Retry uses the same request key.';
  } finally { busy.value = false; matchingAction.value = ''; }
}
async function leaveMatching() {
  if (busy.value) return;
  const id = concertId.value;
  busy.value = true; matchingAction.value = 'leave'; error.value = ''; message.value = '';
  try {
    await api.leaveGroupMatching(id);
    sessionStorage.removeItem(`encore-managed-batch:${id}`);
    if (alive && id === concertId.value) {
      await load();
      message.value = 'Automatic matching stopped. Your pending algorithm-selected request, if any, was withdrawn.';
    }
  } catch {
    if (alive && id === concertId.value) error.value = 'Could not leave automatic matching. Please try again.';
  } finally { busy.value = false; matchingAction.value = ''; }
}
async function enroll(reopen = false) {
  if (busy.value) return;
  busy.value = true; error.value = ''; message.value = '';
  const id = concertId.value;
  try {
    if (reopen) await api.reopenSeekerRequest(id);
    else await api.createRequest(id, form);
    if (alive && id === concertId.value) { await load(); message.value = 'Your group request is ready. Use Find my group to join automatic matching, or choose a group manually.'; }
  } catch (e) { if (alive && id === concertId.value) { await load(); error.value = e.status === 409 ? 'You may already have a group or an active matching proposal for this concert. Check the concert page.' : 'Could not open your group-finding request. Please try again.'; } }
  finally { busy.value = false; }
}
async function preference(id, remove) {
  if (busy.value) return;
  busy.value = true; error.value = ''; message.value = '';
  const selected = concertId.value;
  try {
    if (remove) await api.removeGroupPreference(id); else await api.preferGroup(id);
    if (alive && selected === concertId.value) { await load(); message.value = remove ? 'Removed from your shortlist.' : 'Added to your shortlist for automatic matching.'; }
  } catch (e) { if (alive && selected === concertId.value) { await load(); error.value = 'Could not update this preference. Check that your group-finding request is open and try again.'; } }
  finally { busy.value = false; }
}
</script>

<template>
  <div class="container groups-page">
    <header class="groups-page__header">
      <h1>Groups</h1>
      <p>Find concert company, manage your groups or start one of your own. Group places do not include tickets.</p>
    </header>
    <GroupPreferencesGate summary @saved="load">
    <template #before><GroupNavigation /></template>
    <div class="groups-concert-picker">
      <label>Choose your concert<select v-model="concertId" :disabled="busy"><option value="">Select a concert</option><option v-for="c in concerts" :key="c.id" :value="c.id">{{ c.artist }}, {{ c.event_date }}</option></select></label>
    </div>
    <p v-if="error" class="group-error" role="alert">{{ error }} <button class="btn btn--ghost" :disabled="busy || loading" @click="load">Retry</button></p>
    <p v-if="message" class="group-success" role="status">{{ message }}</p>
    <p v-if="concertsLoading" class="loading-state" role="status"><LoadingSpinner />Loading concerts…</p>
    <p v-if="busy && !savingPreferences && !matchingAction" class="loading-state" role="status"><LoadingSpinner />Updating your group preferences and requests…</p>
    <p v-if="loading" class="loading-state" role="status"><LoadingSpinner />Loading groups and your preferences…</p>
    <template v-else-if="concertId">
      <section v-if="!seeker && matching.state !== 'accepted'" class="card group-panel">
        <div class="group-setup__heading">
          <div><h2>Ready to find your group?</h2><p>Save your concert preferences, then use automatic matching or choose a group yourself.</p></div>
          <button type="button" class="btn btn--primary" :aria-expanded="setupOpen" @click="setupOpen = !setupOpen">{{ setupOpen ? 'Close setup' : 'Set up group request' }}</button>
        </div>
        <form v-if="setupOpen" class="group-panel" @submit.prevent="enroll()">
          <div class="group-controls">
            <label>Preferred seating<select v-model="form.section_pref"><option v-for="(name, id) in SECTION_OPTIONS" :key="id" :value="id">{{ name }}</option></select></label>
            <label>Maximum spending<select v-model.number="form.spend_band_max"><option v-for="n in 4" :key="n" :value="n">{{ LABELS.spendBand[n] }}</option></select></label>
            <label>Arrival<select v-model="form.arrival_pref"><option v-for="(name, id) in ARRIVAL_OPTIONS" :key="id" :value="id">{{ name }}</option></select></label>
          </div>
          <details><summary>Activities (optional)</summary><fieldset><legend>Activities</legend><label v-for="(name, id) in LABELS.plans" :key="id" class="group-check"><input v-model="form.plans_wanted[id]" type="checkbox">{{ name }}</label></fieldset></details>
          <button class="btn btn--primary" :disabled="busy">{{ busy ? 'Saving…' : 'Save group request' }}</button>
        </form>
      </section>
      <section v-else class="card group-panel automatic-matching" aria-labelledby="automatic-matching-heading">
        <header class="automatic-matching__head">
          <h2 id="automatic-matching-heading">Find my group</h2>
          <span class="tag">Gale–Shapley matching</span>
        </header>
        <template v-if="matching.state === 'pending' && matching.request">
          <h3>{{ matching.request.hostName }}'s group</h3>
          <p>{{ matching.request.artist }} · {{ LABELS.section[matching.request.section] ?? matching.request.section }}</p>
          <p class="group-muted">A place is reserved while the host reviews your request. You have not joined the group yet.</p>
          <p class="group-muted">Response deadline: {{ new Date(matching.request.expiresAt).toLocaleString() }}</p>
          <div class="group-actions">
            <button type="button" class="btn btn--ghost" :disabled="busy" @click="load">Refresh status</button>
            <button type="button" class="btn btn--danger-ghost" :disabled="busy" @click="leaveMatching"><LoadingSpinner v-if="matchingAction === 'leave'" />Withdraw matched request</button>
          </div>
        </template>
        <template v-else-if="matching.state === 'accepted'">
          <h3>Your group place is confirmed</h3>
          <p>{{ matching.request ? 'The host approved your algorithm-selected request.' : 'You already belong to a group for this concert.' }}</p>
          <RouterLink :to="matching.request ? `/groups/${matching.request.partyId}/members` : '/groups/connect'" class="btn btn--primary">View your group</RouterLink>
        </template>
        <template v-else-if="seeker.status === 'withdrawn'">
          <p>Reopen your group request before finding a group.</p>
          <button class="btn btn--primary" :disabled="busy" @click="enroll(true)">Reopen group request</button>
        </template>
        <template v-else-if="seeker.status === 'matched'">
          <p>You already have a group assignment. Review its status on the concert page.</p>
          <RouterLink :to="`/concerts/${encodeURIComponent(concertId)}`" class="btn btn--ghost">Concert &amp; proposals</RouterLink>
        </template>
        <template v-else>
          <p>Compare your saved preferences with other participating concertgoers and published groups. The algorithm selects a group and sends your request to its host for approval.</p>
          <p v-if="matching.state === 'queued'" class="automatic-matching__state" role="status">You are in the matching pool. No suitable place was available yet. Retry after groups or availability change, or leave the pool at any time.</p>
          <p v-if="pendingManualRequest" class="group-muted">You have a manual join request awaiting approval. Withdraw it below before using automatic matching.</p>
          <div class="group-actions">
            <button type="button" class="btn btn--primary" :disabled="busy || pendingManualRequest" @click="findMyGroup">
              <LoadingSpinner v-if="matchingAction === 'find'" />{{ matchingAction === 'find' ? 'Matching…' : matching.optedIn ? 'Retry matching' : 'Find my group' }}
            </button>
            <button v-if="matching.optedIn" type="button" class="btn btn--danger-ghost" :disabled="busy" @click="leaveMatching"><LoadingSpinner v-if="matchingAction === 'leave'" />Leave matching pool</button>
          </div>
          <p class="group-muted automatic-matching__consent">Finding a group joins the matching pool and allows a request to be sent to the group selected for you. Only host approval confirms your place.</p>
        </template>
      </section>
      <section class="card group-panel"><h2>Search groups</h2><GroupFilters :filters="filters" preferences /></section>
      <p>{{ visible.length }} {{ visible.length === 1 ? 'group' : 'groups' }} on this page. <span v-if="!seeker">Open a group-finding request to request a group place.</span></p>
      <div class="group-grid"><GroupListingCard v-for="g in visible" :key="g.id" :group="g"><button class="btn btn--ghost" :disabled="busy || !canPrefer || pendingRequest" @click="join(g.id)">{{ joins.some(j=>j.partyId===g.id&&j.status==='pending') ? 'Awaiting host approval' : 'Choose this group manually' }}</button><details v-if="g.automaticPlacementAvailable"><summary>Automatic matching preference</summary><button class="btn" :class="g.preferred ? 'btn--danger-ghost' : 'btn--ghost'" :disabled="busy || (!g.preferred && (!canPrefer || pendingRequest))" @click="preference(g.id,g.preferred)">{{g.preferred?'Remove preference':'Prefer for automatic matching'}}</button></details></GroupListingCard></div>
      <nav class="group-actions group-pagination" aria-label="Group results pages"><button class="btn btn--ghost" :disabled="loading||busy||offset===0" @click="offset=Math.max(0,offset-20);load()">Previous</button><span>{{total}} results</span><button class="btn btn--ghost" :disabled="loading||busy||offset+20>=total" @click="offset+=20;load()">Next</button></nav>
      <section v-if="joins.length" class="card group-panel">
        <h2>Your join requests</h2>
        <article v-for="j in joins.filter(request => ['pending', 'accepted'].includes(request.status))" :key="j.id" class="group-actions"><span>{{j.artist}} — {{joinStatus[j.status] ?? 'Request updated'}}</span><button v-if="j.status==='pending'" class="btn btn--danger-ghost" :disabled="busy" @click="withdrawJoin(j.id)">Withdraw request</button><RouterLink v-if="j.status==='accepted'" :to="`/groups/${j.partyId}/members`">Manage your group</RouterLink></article>
        <details v-if="joins.some(request => !['pending', 'accepted'].includes(request.status))"><summary>Past requests</summary><p v-for="j in joins.filter(request => !['pending', 'accepted'].includes(request.status))" :key="j.id">{{ j.artist }} — {{ joinStatus[j.status] ?? 'Request updated' }}</p></details>
      </section>
      <p v-if="!visible.length && !pendingRequest && matching.state !== 'accepted'" class="group-muted">No eligible groups match these filters. Try another concert or adjust your filters.</p>
      <details v-if="saved.length" class="card group-panel"><summary>Saved matching-round preferences ({{ saved.length }})</summary><div v-for="p in saved" :key="p.partyId" class="group-actions"><span>{{ p.hostName }}, {{ LABELS.section[p.section] }} — {{ p.status === 'open' ? 'Group open' : p.status === 'cancelled' ? 'Group cancelled' : 'Group unavailable for new matches' }}</span><button class="btn btn--danger-ghost" :disabled="busy" @click="preference(p.partyId, true)">Remove preference</button></div></details>
    </template>
    <p v-else-if="!concertsLoading && !concerts.length">No concerts are available yet.</p>
    </GroupPreferencesGate>
  </div>
</template>

<style scoped>
.groups-page__header { display: grid; gap: var(--space-3); }
.groups-page__header > p { max-width: 70ch; color: var(--text-300); line-height: 1.6; }
.groups-page__header nav { margin-top: var(--space-1); font-size: var(--step--1); }
.groups-concert-picker { max-width: 560px; width: 100%; }
.group-pagination { justify-content: space-between; padding-top: var(--space-3); }
.group-pagination > span { color: var(--text-300); font-size: var(--step--1); }
.group-setup__heading { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: var(--space-4); }
.group-setup__heading > div { flex: 1 1 300px; display: grid; gap: var(--space-2); }
.group-setup__heading p { color: var(--text-300); max-width: 65ch; font-size: var(--step--1); }
.group-setup__heading .btn { flex: none; }
.automatic-matching { border-color: var(--accent-400); }
.automatic-matching__head { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: var(--space-3); }
.automatic-matching > p { max-width: 75ch; line-height: 1.6; }
.automatic-matching__state { padding: var(--space-3); background: var(--ink-700); border-radius: var(--radius-sm); }
.automatic-matching__consent { font-size: var(--step--1); }
@media (max-width: 480px) {
  .group-pagination .btn { flex: 0 1 auto; }
}
</style>
