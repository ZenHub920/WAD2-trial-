<script setup>
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, LABELS } from '../api.js';
import { filterGroups } from '../groupFilters.js';
import GroupFilters from '../components/GroupFilters.vue';
import GroupListingCard from '../components/GroupListingCard.vue';
import PreferenceEditor from '../components/PreferenceEditor.vue';
import '../assets/groups.css';

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
async function load() {
  const current = ++generation;
  const id = concertId.value;
  groups.value = []; saved.value = []; seeker.value = null; error.value = '';
  if (!id) { loading.value = false; return; }
  loading.value = true;
  try {
    const [listing, preferences, request,custom,requests] = await Promise.all([api.discoverGroups(id,{offset:offset.value,q:filters.query,section:filters.section,arrival:filters.arrival,spendBand:filters.spendBand,minCapacity:filters.minCapacity,activity:filters.activity,vibe:filters.vibe,preferredOnly:filters.preferredOnly,sort:filters.sort}), api.groupPreferences(id), api.seekerRequest(id),api.discoveryPreferences(id),api.groupJoinRequests()]);
    if (alive && current === generation) { groups.value = listing.groups;total.value=listing.total; saved.value = preferences.preferences; seeker.value = request.request;answers.value=custom.preferences;joins.value=requests.requests; }
  } catch (e) { if (alive && current === generation) error.value = e.message; }
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
  } catch (e) { if (alive) error.value = e.message; }
});
onUnmounted(() => { alive = false; generation++;clearTimeout(filterTimer); });
async function saveAnswers(value){busy.value=true;try{await api.saveDiscoveryPreferences(concertId.value,value);await load();message.value='Preferences saved.';}catch(e){error.value=e.message;}finally{busy.value=false;}}
async function join(id){busy.value=true;try{await api.requestGroupJoin(id);await load();message.value='Request sent. Your place is confirmed when the host approves.';}catch(e){await load();error.value=e.message;}finally{busy.value=false;}}
async function withdrawJoin(id){busy.value=true;try{await api.respondGroupJoin(id,'withdraw');await load();}catch(e){error.value=e.message;}finally{busy.value=false;}}
async function enroll(reopen = false) {
  if (busy.value) return;
  busy.value = true; error.value = ''; message.value = '';
  const id = concertId.value;
  try {
    if (reopen) await api.reopenSeekerRequest(id);
    else await api.createRequest(id, form);
    if (alive && id === concertId.value) { await load(); message.value = 'Your request is open. Choose a group to join.'; }
  } catch (e) { if (alive && id === concertId.value) { await load(); error.value = e.message; } }
  finally { busy.value = false; }
}
async function preference(id, remove) {
  if (busy.value) return;
  busy.value = true; error.value = ''; message.value = '';
  const selected = concertId.value;
  try {
    if (remove) await api.removeGroupPreference(id); else await api.preferGroup(id);
    if (alive && selected === concertId.value) { await load(); message.value = remove ? 'Preference removed.' : 'Preference saved for the next matching round.'; }
  } catch (e) { if (alive && selected === concertId.value) { await load(); error.value = e.message; } }
  finally { busy.value = false; }
}
</script>

<template>
  <main class="container groups-page">
    <h1>Find a Group</h1>
    <nav class="group-actions"><RouterLink to="/kaki">Find a Kaki</RouterLink><RouterLink :to="{ path: '/groups/connect', query: { concertId } }">Connect Groups</RouterLink><RouterLink v-if="concertId" :to="`/concerts/${encodeURIComponent(concertId)}`">Concert &amp; proposals</RouterLink></nav>
    <label>Concert<select v-model="concertId" :disabled="busy"><option value="">Select a concert</option><option v-for="c in concerts" :key="c.id" :value="c.id">{{ c.artist }}, {{ c.event_date }}</option></select></label>
    <p v-if="error" class="group-error" role="alert">{{ error }} <button class="btn btn--ghost" :disabled="busy || loading" @click="load">Retry</button></p>
    <p v-if="message" class="group-success" role="status">{{ message }}</p>
    <p v-if="loading" role="status">Loading groups and your preferences…</p>
    <template v-else-if="concertId">
      <section v-if="!seeker" class="card group-panel">
        <h2>Your concert preferences</h2>
        <form class="group-panel" @submit.prevent="enroll()">
          <div class="group-controls">
            <label>Preferred seating<select v-model="form.section_pref"><option v-for="(name, id) in LABELS.section" :key="id" :value="id">{{ name }}</option></select></label>
            <label>Maximum spending<select v-model.number="form.spend_band_max"><option v-for="n in 4" :key="n" :value="n">{{ LABELS.spendBand[n] }}</option></select></label>
            <label>Arrival<select v-model="form.arrival_pref"><option v-for="(name, id) in LABELS.arrival" :key="id" :value="id">{{ name }}</option></select></label>
          </div>
          <fieldset><legend>Activities</legend><label v-for="(name, id) in LABELS.plans" :key="id" class="group-check"><input v-model="form.plans_wanted[id]" type="checkbox">{{ name }}</label></fieldset>
          <button class="btn btn--primary" :disabled="busy">{{ busy ? 'Saving…' : 'Start finding groups' }}</button>
        </form>
      </section>
      <section v-else class="card group-panel"><h2>Your request: {{ seeker.status }}</h2><p v-if="seeker.status === 'matched'">Review your proposal on the concert page.</p><button v-if="seeker.status === 'withdrawn'" class="btn btn--primary" :disabled="busy" @click="enroll(true)">Reopen request</button></section>
      <section class="card group-panel"><h2>Search groups</h2><GroupFilters :filters="filters" preferences /></section>
      <details v-if="answers" class="card group-panel"><summary>Your preferences</summary><PreferenceEditor :key="concertId" :initial="answers" :busy="busy" @save="saveAnswers"/></details>
      <p>{{ visible.length }} {{ visible.length === 1 ? 'group' : 'groups' }} on this page. <span v-if="!seeker">Create a request to see your matches.</span></p>
      <div class="group-grid"><GroupListingCard v-for="g in visible" :key="g.id" :group="g"><button class="btn btn--primary" :disabled="busy||!canPrefer||joins.some(j=>j.partyId===g.id&&j.status==='pending')" @click="join(g.id)">Request to join</button><details v-if="g.automaticPlacementAvailable"><summary>Matching preference</summary><button class="btn btn--ghost" :disabled="busy||(!g.preferred&&!canPrefer)" @click="preference(g.id,g.preferred)">{{g.preferred?'Remove preference':'Prefer for next round'}}</button></details></GroupListingCard></div>
      <nav class="group-actions"><button class="btn btn--ghost" :disabled="loading||busy||offset===0" @click="offset=Math.max(0,offset-20);load()">Previous 20</button><span>{{total}} results</span><button class="btn btn--ghost" :disabled="loading||busy||offset+20>=total" @click="offset+=20;load()">Next 20</button></nav>
      <section v-if="joins.length" class="card group-panel"><h2>Join requests</h2><p v-for="j in joins" :key="j.id">{{j.artist}}, {{j.status}} <button v-if="j.status==='pending'" class="btn btn--ghost" :disabled="busy" @click="withdrawJoin(j.id)">Withdraw request</button><RouterLink v-if="j.status==='accepted'" :to="`/groups/${j.partyId}/members`">Your group</RouterLink></p></section>
      <p v-if="!visible.length" class="group-muted">No eligible groups match these filters. Try another concert or adjust your filters.</p>
      <section class="card group-panel"><h2>Saved preferences</h2><p v-if="!saved.length">No saved preferences for this concert.</p><div v-for="p in saved" :key="p.partyId" class="group-actions"><span>{{ p.hostName }}, {{ LABELS.section[p.section] }}, {{ p.status }}</span><button class="btn btn--ghost" :disabled="busy" @click="preference(p.partyId, true)">Remove preference</button></div></section>
    </template>
    <p v-else-if="!concerts.length">No concerts are available yet.</p>
  </main>
</template>
