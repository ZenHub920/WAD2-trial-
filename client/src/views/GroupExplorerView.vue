<script setup>
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, LABELS, formatShortDate } from '../api.js';
import { filterGroups } from '../groupFilters.js';
import GroupFilters from '../components/GroupFilters.vue';
import GroupListingCard from '../components/GroupListingCard.vue';
import PreferenceEditor from '../components/PreferenceEditor.vue';
import LoadingSpinner from '../components/LoadingSpinner.vue';
import '../assets/groups.css';
const concertsLoading = ref(true);
const savingPreferences = ref(false);

const route = useRoute();
const router = useRouter();
const concerts = ref([]), groups = ref([]), saved = ref([]), seeker = ref(null);
const concertId = ref(typeof route.query.concertId === 'string' ? route.query.concertId : '');
const loading = ref(false), busy = ref(false), error = ref(''), message = ref('');
const answers=ref(null),offset=ref(0),total=ref(0),joins=ref([]);
let generation = 0, alive = true;
const filters = reactive({ query: '', section: '', minCapacity: 0, spendBand: '', arrival: '', activity: '', vibe: '', sort: 'compatibility', preferredOnly: false });
const form = reactive({ section_pref: 'ga_standing', spend_band_max: 3, arrival_pref: 'mid', plans_wanted: {} });
const visible = computed(() => filterGroups(groups.value, filters));
const canPrefer = computed(() => seeker.value?.status === 'open');
const isPending = id => joins.value.some(j => j.partyId === id && j.status === 'pending');
const hasAccepted = computed(() => joins.value.some(j => j.status === 'accepted'));
// 1 = tell us about you, 2 = ask to join, 3 = a host has said yes.
const step = computed(() => !seeker.value || seeker.value.status === 'withdrawn' ? 1 : hasAccepted.value ? 3 : 2);
const steps = ['Tell us about you', 'Ask to join a group', 'Host says yes'];
const selectedConcert = computed(() => concerts.value.find(c => c.id === concertId.value));
const requestStatus = { open: 'Open for group matching', matched: 'Assigned through group matching', withdrawn: 'Withdrawn' };
const joinStatus = { pending: 'Waiting for host', accepted: 'Accepted', rejected: 'Not accepted', withdrawn: 'Cancelled', expired: 'Expired' };
const joinTag = { pending: 'tag--accent', accepted: 'tag--mint' };
async function load() {
  const current = ++generation;
  const id = concertId.value;
  groups.value = []; saved.value = []; seeker.value = null; error.value = '';
  if (!id) { loading.value = false; return; }
  loading.value = true;
  try {
    const [listing, preferences, request,custom,requests] = await Promise.all([api.discoverGroups(id,{offset:offset.value,q:filters.query,section:filters.section,arrival:filters.arrival,spendBand:filters.spendBand,minCapacity:filters.minCapacity,activity:filters.activity,vibe:filters.vibe,preferredOnly:filters.preferredOnly,sort:filters.sort}), api.groupPreferences(id), api.seekerRequest(id),api.discoveryPreferences(id),api.groupJoinRequests()]);
    if (alive && current === generation) { groups.value = listing.groups;total.value=listing.total; saved.value = preferences.preferences; seeker.value = request.request;answers.value=custom.preferences;joins.value=requests.requests; }
  } catch (e) { if (alive && current === generation) error.value = e.status === 401 ? 'Sign in to browse groups and manage your preferences.' : 'Could not load groups and preferences. Please try again.'; }
  finally { if (alive && current === generation) loading.value = false; }
}
watch(concertId, id => {
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
async function saveAnswers(value){busy.value=true;savingPreferences.value=true;error.value='';try{await api.saveDiscoveryPreferences(concertId.value,value);await load();message.value='Preferences saved.';}catch(e){error.value='Could not save your preferences. Please try again.';}finally{busy.value=false;savingPreferences.value=false;}}
async function join(id){busy.value=true;error.value='';try{await api.requestGroupJoin(id);await load();message.value='Request sent! The host will review it, and their answer appears under “Your requests”.';}catch(e){await load();error.value=e.status===409?'This group or your preferences changed. Review the group and your open request before trying again.':'Could not send your join request. Please try again.';}finally{busy.value=false;}}
async function withdrawJoin(id){busy.value=true;error.value='';try{await api.respondGroupJoin(id,'withdraw');await load();message.value='Request cancelled.';}catch(e){error.value='Could not withdraw this request. Please try again.';}finally{busy.value=false;}}
async function enroll(reopen = false) {
  if (busy.value) return;
  busy.value = true; error.value = ''; message.value = '';
  const id = concertId.value;
  try {
    if (reopen) await api.reopenSeekerRequest(id);
    else await api.createRequest(id, form);
    if (alive && id === concertId.value) { await load(); message.value = 'You’re all set. Now pick a group below and ask to join.'; }
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
    <header class="gx-head">
      <div>
        <h1>Join a group</h1>
        <p class="group-muted">Go to a concert with a small group of fans. You bring your own ticket.</p>
      </div>
      <RouterLink :to="{ path: '/groups/connect', query: { concertId } }" class="btn btn--ghost">Start your own group</RouterLink>
    </header>

    <label class="gx-concert">
      <span>Which concert?</span>
      <select v-model="concertId" :disabled="busy"><option value="">Choose a concert</option><option v-for="c in concerts" :key="c.id" :value="c.id">{{ c.artist }} · {{ formatShortDate(c.event_date) }}</option></select>
    </label>

    <div aria-live="polite">
      <p v-if="message" class="gx-note gx-note--ok" role="status">{{ message }}</p>
      <p v-if="error" class="gx-note gx-note--err" role="alert">{{ error }} <button class="btn btn--ghost" :disabled="busy || loading" @click="load">Try again</button></p>
    </div>

    <p v-if="concertsLoading || loading" class="loading-state" role="status"><LoadingSpinner />Loading groups…</p>

    <template v-else-if="concertId">
      <ol class="gx-steps" aria-label="Progress">
        <li v-for="(label, i) in steps" :key="label" :class="{ done: step > i + 1, current: step === i + 1 }" :aria-current="step === i + 1 ? 'step' : undefined">
          <span class="gx-steps__n" aria-hidden="true">{{ step > i + 1 ? '✓' : i + 1 }}</span>{{ label }}
        </li>
      </ol>

      <!-- Step 1 stays on screen only until the user has an open request. -->
      <section v-if="!seeker" class="card group-panel gx-setup">
        <h2>First, a few quick questions</h2>
        <p class="group-muted">This helps hosts know what you're after. It takes about 30 seconds.</p>
        <form class="group-panel gx-form" @submit.prevent="enroll()">
          <div class="group-controls">
            <label>Where do you want to be?<select v-model="form.section_pref"><option v-for="(name, id) in LABELS.section" :key="id" :value="id">{{ name }}</option></select></label>
            <label>When will you arrive?<select v-model="form.arrival_pref"><option v-for="(name, id) in LABELS.arrival" :key="id" :value="id">{{ name }}</option></select></label>
            <label>Your budget for the night<select v-model.number="form.spend_band_max"><option v-for="n in 4" :key="n" :value="n">{{ LABELS.spendBand[n] }}</option></select></label>
          </div>
          <fieldset class="gx-chips"><legend>Anything you'd like to do together? <span class="group-muted">(optional)</span></legend>
            <label v-for="(name, id) in LABELS.plans" :key="id" class="gx-chip"><input v-model="form.plans_wanted[id]" type="checkbox"><span>{{ name }}</span></label>
          </fieldset>
          <button class="btn btn--primary" :disabled="busy">{{ busy ? 'Saving…' : 'Continue to groups' }}</button>
        </form>
      </section>
      <section v-else-if="seeker.status === 'withdrawn'" class="card group-panel">
        <h2>You stopped looking for a group for this concert</h2>
        <button class="btn btn--primary" :disabled="busy" @click="enroll(true)">Start looking again</button>
      </section>
      <section v-else-if="seeker.status === 'matched'" class="card group-panel gx-note--ok">
        <h2>You've been matched with a group</h2>
        <p>Accept or decline the offer on the concert page.</p>
        <RouterLink :to="`/concerts/${encodeURIComponent(concertId)}`" class="btn btn--primary">See my match offer</RouterLink>
      </section>

      <!-- What the user is waiting on comes before browsing. -->
      <section v-if="joins.length" class="card group-panel">
        <h2>Your requests</h2>
        <ul class="gx-requests">
          <li v-for="j in joins" :key="j.id">
            <span>{{ j.artist }}</span>
            <span class="tag" :class="joinTag[j.status]">{{ joinStatus[j.status] ?? 'Updated' }}</span>
            <RouterLink v-if="j.status === 'accepted'" :to="`/groups/${j.partyId}/members`" class="btn btn--primary">Open your group</RouterLink>
            <button v-if="j.status === 'pending'" class="btn btn--ghost" :disabled="busy" @click="withdrawJoin(j.id)">Cancel request</button>
          </li>
        </ul>
      </section>

      <section class="gx-browse" aria-labelledby="gx-browse-title">
        <h2 id="gx-browse-title">Groups going to {{ selectedConcert?.artist ?? 'this concert' }} <span class="group-muted">({{ total }})</span></h2>
        <GroupFilters :filters="filters" preferences />
        <p v-if="!seeker" class="gx-hint">Answer the questions above to start asking to join.</p>
        <div v-if="visible.length" class="group-grid">
          <GroupListingCard v-for="g in visible" :key="g.id" :group="g">
            <button v-if="isPending(g.id)" class="btn btn--ghost" disabled>Request sent ✓</button>
            <button v-else class="btn btn--primary" :disabled="busy || !canPrefer" @click="join(g.id)">Ask to join</button>
            <button v-if="g.automaticPlacementAvailable && (g.preferred || canPrefer)" type="button" class="gx-link" :disabled="busy" @click="preference(g.id, g.preferred)">
              {{ g.preferred ? '★ On your shortlist (remove)' : '☆ Add to shortlist for automatic matching' }}
            </button>
          </GroupListingCard>
        </div>
        <div v-else class="gx-empty">
          <p>No groups match. Try fewer filters, or start your own group.</p>
          <RouterLink :to="{ path: '/groups/connect', query: { concertId } }" class="btn btn--ghost">Start your own group</RouterLink>
        </div>
        <nav v-if="total > 20" class="group-actions gx-pages" aria-label="Pages"><button class="btn btn--ghost" :disabled="loading||busy||offset===0" @click="offset=Math.max(0,offset-20);load()">← Previous</button><span>{{ offset + 1 }}–{{ Math.min(offset + 20, total) }} of {{ total }}</span><button class="btn btn--ghost" :disabled="loading||busy||offset+20>=total" @click="offset+=20;load()">Next →</button></nav>
      </section>

      <!-- Optional extras stay folded until wanted. -->
      <details v-if="answers" class="card group-panel">
        <summary><strong>Get better suggestions</strong> <span class="group-muted">· optional</span></summary>
        <PreferenceEditor :key="concertId" :initial="answers" :busy="busy" :saving="savingPreferences" @save="saveAnswers"/>
      </details>
      <details v-if="saved.length" class="card group-panel">
        <summary><strong>Your shortlist</strong> <span class="group-muted">· {{ saved.length }}</span></summary>
        <p class="group-muted">If a matching round runs, we'll try to place you in one of these. This doesn't reserve a place.</p>
        <div v-for="p in saved" :key="p.partyId" class="group-actions"><span>{{ p.hostName }}'s group, {{ LABELS.section[p.section] }}<template v-if="p.status !== 'open'"> · {{ p.status === 'cancelled' ? 'cancelled' : 'no longer taking people' }}</template></span><button class="btn btn--ghost" :disabled="busy" @click="preference(p.partyId, true)">Remove</button></div>
      </details>
    </template>
    <p v-else-if="!concertsLoading && !concerts.length">No concerts are available yet.</p>
  </div>
</template>

<style scoped>
.gx-head { display: flex; flex-wrap: wrap; gap: var(--space-4); justify-content: space-between; align-items: flex-end; }
.gx-head p { margin-top: var(--space-2); }
.gx-concert { max-width: 420px; font-weight: 700; color: var(--text-100); }
.gx-note { padding: var(--space-3) var(--space-4); border-radius: var(--radius-md, 12px); }
.gx-note--ok { background: color-mix(in oklab, var(--mint-400) 10%, transparent); color: var(--mint-500); }
.gx-note--err { background: color-mix(in oklab, var(--rose-400) 8%, transparent); color: var(--rose-500); }
.gx-steps { list-style: none; padding: 0; display: flex; flex-wrap: wrap; gap: var(--space-2) var(--space-5); font-size: var(--step--1); color: var(--text-400); }
.gx-steps li { display: flex; align-items: center; gap: var(--space-2); }
.gx-steps__n { display: inline-grid; place-items: center; width: 1.6rem; height: 1.6rem; border-radius: 50%; border: 1.5px solid currentColor; font-weight: 700; }
.gx-steps .current { color: var(--accent-500); font-weight: 700; }
.gx-steps .current .gx-steps__n { background: var(--accent-500); border-color: var(--accent-500); color: #fff; }
.gx-steps .done { color: var(--mint-500); }
.gx-setup { border-color: var(--accent-400); }
.gx-form { padding: 0; }
.groups-page .gx-chips { display: flex; flex-wrap: wrap; gap: var(--space-2); border: 0; padding: 0; }
.gx-chips legend { margin-bottom: var(--space-2); font-size: var(--step--1); }
.groups-page .gx-chip { display: inline-flex; position: relative; cursor: pointer; }
.gx-chip input { position: absolute; opacity: 0; pointer-events: none; }
.gx-chip span { padding: var(--space-2) var(--space-4); border: var(--border-soft); border-radius: var(--radius-pill); background: var(--ink-800); transition: background var(--dur-fast) var(--ease-out); }
.gx-chip input:checked + span { background: var(--accent-500); border-color: var(--accent-500); color: #fff; }
.gx-chip input:focus-visible + span { outline: 2px solid var(--accent-400); outline-offset: 2px; }
.gx-requests { list-style: none; padding: 0; display: grid; gap: var(--space-3); }
.gx-requests li { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3); }
.gx-requests li > span:first-child { font-weight: 700; color: var(--text-100); }
.gx-browse { display: grid; gap: var(--space-4); }
.gx-hint { padding: var(--space-3) var(--space-4); border-radius: var(--radius-md, 12px); background: var(--ink-700); color: var(--text-300); font-size: var(--step--1); }
.gx-empty { display: grid; gap: var(--space-3); justify-items: start; padding: var(--space-6); border: 1px dashed var(--ink-500); border-radius: var(--radius-lg); color: var(--text-300); }
.gx-pages { justify-content: center; }
.gx-link { background: none; border: 0; padding: 0; color: var(--accent-400); font-size: var(--step--1); cursor: pointer; text-align: left; }
.gx-link:hover:not(:disabled) { text-decoration: underline; }
.gx-link:disabled { opacity: 0.5; cursor: default; }
</style>
