<script setup>
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, LABELS } from '../api.js';
import { filterGroups } from '../groupFilters.js';
import GroupFilters from '../components/GroupFilters.vue';
import GroupListingCard from '../components/GroupListingCard.vue';
import '../assets/groups.css';
import { currentUser } from '../auth.js';

const route = useRoute(), router = useRouter();
const hosted = ref([]), candidates = ref([]), connections = ref([]);
const joins=ref([]);
const offset=ref(0),total=ref(0);let filterTimer;
const allConcerts = ref([]), hostConcertId = ref('');
const hostForm = reactive({ capacity: 2, section: 'ga_standing', spend_band: 2, arrival_plan: 'mid', plans: {}, notes: '' });
const concertId = ref(typeof route.query.concertId === 'string' ? route.query.concertId : '');
const sourceId = ref(''), loading = ref(false), busy = ref(false), error = ref(''), message = ref('');
let generation = 0, alive = true;
const filters = reactive({ query: '', section: '', minCapacity: 0, spendBand: '', arrival: '', activity: '', vibe: '', sort: 'compatibility' });
const concerts = computed(() => [...new Map(hosted.value.map(g => [g.concertId, { id: g.concertId, artist: g.artist, date: g.eventDate }])).values()]);
const sources = computed(() => hosted.value.filter(g => g.concertId === concertId.value && g.status !== 'cancelled'));
const visible = computed(() => filterGroups(candidates.value, filters));
const incoming = computed(() => connections.value.filter(c => c.incoming && c.status === 'pending'));
const outgoing = computed(() => connections.value.filter(c => !c.incoming && c.status === 'pending'));
const accepted = computed(() => connections.value.filter(c => c.status === 'accepted'));
const declined = computed(() => connections.value.filter(c => c.status === 'declined'));
const describe = c => `${c.partyA.hostName} (${c.partyA.section}) ↔ ${c.partyB.hostName} (${c.partyB.section}) · ${c.partyA.artist}`;
async function loadCandidates() {
  const current = ++generation, id = sourceId.value;
  candidates.value = []; error.value = '';
  if (!id) { loading.value = false; return; }
  loading.value = true;
  try {
    const result = await api.connectionCandidates(concertId.value, id,{offset:offset.value,q:filters.query,section:filters.section,arrival:filters.arrival,spendBand:filters.spendBand,minCapacity:filters.minCapacity,activity:filters.activity,vibe:filters.vibe,sort:filters.sort});
    if (alive && current === generation) {candidates.value = result.groups;total.value=result.total;}
  } catch (e) { if (alive && current === generation) error.value = e.message; }
  finally { if (alive && current === generation) loading.value = false; }
}
async function refresh() {
  const [groups, inbox,requests] = await Promise.all([api.hostedGroups(), api.groupConnections(),api.groupJoinRequests()]);
  if (!alive) return;
  hosted.value = groups.groups; connections.value = inbox.connections;
  joins.value=requests.requests.filter(j=>j.hostId===currentUser.value?.id);
  if (!concertId.value && concerts.value.length) concertId.value = concerts.value[0].id;
  if (!sources.value.some(g => g.id === sourceId.value)) sourceId.value = sources.value[0]?.id ?? '';
  else await loadCandidates();
}
watch(concertId, id => {
  message.value = '';
  router.replace({ query: { ...route.query, concertId: id || undefined } });
  sourceId.value = sources.value[0]?.id ?? '';
  if (!sourceId.value) loadCandidates();
});
watch(sourceId, ()=>{offset.value=0;loadCandidates();});
watch(()=>Object.values(filters),()=>{clearTimeout(filterTimer);filterTimer=setTimeout(()=>{offset.value=0;loadCandidates();},250);});
watch(() => route.query.concertId, id => {
  const next = typeof id === 'string' ? id : '';
  if (next !== concertId.value) concertId.value = next;
});
onMounted(async () => { try {
  const result = await api.concerts();
  if (!alive) return;
  allConcerts.value = result.concerts;
  hostConcertId.value = concertId.value || allConcerts.value[0]?.id || '';
  await refresh();
} catch (e) { if (alive) error.value = e.message; } });
onUnmounted(() => { alive = false; generation++;clearTimeout(filterTimer); });
async function act(operation) {
  if (busy.value) return;
  busy.value = true; error.value = ''; message.value = '';
  try { await operation(); await refresh(); if (alive) message.value = 'Invitation updated.'; }
  catch (e) { try { await refresh(); } catch {} if (alive) error.value = e.message; }
  finally { busy.value = false; }
}
async function retry() { try { await refresh(); } catch (e) { error.value = e.message; } }
async function host() {
  const id = hostConcertId.value;
  await act(async () => {
    const result = await api.createParty(id, hostForm);
    if (!alive) return;
    concertId.value = id;
    await refresh();
    sourceId.value = result.party.id;
    await api.configureGroup(result.party.id,{expectedFriends:0});
    await router.push(`/groups/${encodeURIComponent(result.party.id)}/members`);
  });
}
</script>

<template>
  <main class="container groups-page">
    <h1>Connect Groups</h1><p>Find another group going to the same concert and arrange to meet. Each group stays together.</p>
    <nav class="group-actions"><RouterLink to="/groups">Find a Group</RouterLink><RouterLink to="/kaki">Find a Kaki</RouterLink><RouterLink :to="concertId ? `/concerts/${encodeURIComponent(concertId)}` : '/concerts'">Host a group</RouterLink></nav>
    <p v-if="error" class="group-error" role="alert">{{ error }} <button class="btn btn--ghost" :disabled="busy" @click="retry">Retry</button></p>
    <p v-if="message" class="group-success" role="status">{{ message }}</p>
    <section v-if="hosted.length" class="card group-panel">
      <h2>Your group</h2>
      <div class="group-controls"><label>Concert<select v-model="concertId" :disabled="busy"><option value="">Choose concert</option><option v-for="c in concerts" :key="c.id" :value="c.id">{{ c.artist }} · {{ c.date }}</option></select></label><label>Hosted group<select v-model="sourceId" :disabled="busy"><option value="">Choose group</option><option v-for="g in sources" :key="g.id" :value="g.id">{{ g.hostName }} · {{ g.section }} · {{ g.id }}</option></select></label></div>
      <p v-if="!sources.length">No active hosted groups for this concert. Open the concert page to host one.</p>
    </section>
    <p v-else>Host a concert group to start sending invitations.</p>
    <RouterLink v-if="sourceId" :to="`/groups/${sourceId}/members`" class="btn btn--ghost">Manage members, friend links &amp; shared preferences</RouterLink>
    <RouterLink v-if="sourceId" :to="{path:'/meetups',query:{partyId:sourceId}}" class="btn btn--ghost">Plan your group meetup</RouterLink>
    <section v-if="joins.length" class="card group-panel"><h2>Seeker join requests</h2><article v-for="j in joins" :key="j.id"><p>{{j.seekerName}} · {{j.artist}} · {{j.status}}</p><p v-if="j.preferences">Enjoys: {{j.preferences.about.map(p=>p.text).join(", ") || "No preferences specified"}}. Companions: {{j.preferences.wants.map(p=>p.text).join(", ") || "Flexible"}}.</p><p v-if="j.seeker">{{j.seeker.ageBand}} - {{j.seeker.languages.join(", ")}}</p><div v-if="j.status==='pending'" class="group-actions"><button class="btn btn--primary" :disabled="busy" @click="act(()=>api.respondGroupJoin(j.id,'accept'))">Approve seeker</button><button class="btn btn--ghost" :disabled="busy" @click="act(()=>api.respondGroupJoin(j.id,'reject'))">Reject</button></div></article></section>
    <details class="card group-panel"><summary>Host a new group</summary>
      <form class="group-panel" @submit.prevent="host">
        <div class="group-controls">
          <label>Concert<select v-model="hostConcertId" required :disabled="busy"><option v-for="c in allConcerts" :key="c.id" :value="c.id">{{ c.artist }} · {{ c.event_date }}</option></select></label>
          <label>Available places<input v-model.number="hostForm.capacity" type="number" min="1" step="1" required :disabled="busy"></label>
          <label>Seating<select v-model="hostForm.section" :disabled="busy"><option v-for="(name, id) in LABELS.section" :key="id" :value="id">{{ name }}</option></select></label>
          <label>Spending<select v-model.number="hostForm.spend_band" :disabled="busy"><option v-for="n in 4" :key="n" :value="n">{{ LABELS.spendBand[n] }}</option></select></label>
          <label>Arrival<select v-model="hostForm.arrival_plan" :disabled="busy"><option v-for="(name, id) in LABELS.arrival" :key="id" :value="id">{{ name }}</option></select></label>
          <label>Published notes<input v-model="hostForm.notes" maxlength="2000" :disabled="busy"></label>
        </div>
        <fieldset><legend>Group activities</legend><label v-for="(name, id) in LABELS.plans" :key="id" class="group-check"><input v-model="hostForm.plans[id]" type="checkbox" :disabled="busy">{{ name }}</label></fieldset>
        <button class="btn btn--primary" :disabled="busy || !hostConcertId">Host group</button>
      </form>
    </details>
    <template v-if="sourceId">
      <section class="card group-panel"><h2>Discover groups</h2><GroupFilters :filters="filters" /></section>
      <p v-if="loading" role="status">Loading groups…</p>
      <div v-else class="group-grid"><GroupListingCard v-for="g in visible" :key="g.id" :group="g"><p v-if="g.invitation">Invitation: {{ g.invitation.status }}</p><button v-else class="btn btn--primary" :disabled="busy" @click="act(() => api.inviteGroup(sourceId, g.id))">Send Invitation</button></GroupListingCard></div>
      <p v-if="!loading && !visible.length">No other eligible groups match these filters.</p>
      <nav class="group-actions"><button class="btn btn--ghost" :disabled="busy||loading||offset===0" @click="offset=Math.max(0,offset-20);loadCandidates()">Previous 20</button><span>{{total}} results</span><button class="btn btn--ghost" :disabled="busy||loading||offset+20>=total" @click="offset+=20;loadCandidates()">Next 20</button></nav>
    </template>
    <section class="card group-panel"><h2>Incoming invitations</h2><p v-if="!incoming.length">No pending invitations.</p><article v-for="c in incoming" :key="c.id" class="group-panel"><p>{{ describe(c) }}</p><div class="group-actions"><button class="btn btn--primary" :disabled="busy" @click="act(() => api.respondToGroup(c.id, 'accept'))">Accept</button><button class="btn btn--ghost" :disabled="busy" @click="act(() => api.respondToGroup(c.id, 'decline'))">Decline</button></div></article></section>
    <section class="card group-panel"><h2>Outgoing invitations</h2><p v-if="!outgoing.length">No pending invitations.</p><p v-for="c in outgoing" :key="c.id">{{ describe(c) }} · Pending</p></section>
    <section class="card group-panel"><h2>Accepted connections</h2><p v-if="!accepted.length">No accepted connections yet.</p><article v-for="c in accepted" :key="c.id" class="group-panel"><p>{{ describe(c) }}</p><p class="group-notes">{{ c.partyA.notes }} {{ c.partyB.notes }}</p><p>Connected · {{ c.respondedAt }}</p></article></section>
    <section v-if="declined.length" class="card group-panel"><h2>Declined invitations</h2><p v-for="c in declined" :key="c.id">{{ describe(c) }} · Declined</p></section>
    <nav v-for="c in accepted" :key="`plan-${c.id}`"><RouterLink :to="{path:'/meetups',query:{connectionId:c.id}}">Plan meetup for {{describe(c)}}</RouterLink></nav>
  </main>
</template>
