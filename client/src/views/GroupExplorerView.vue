<script setup>
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, LABELS } from '../api.js';
import { filterGroups } from '../groupFilters.js';
import GroupFilters from '../components/GroupFilters.vue';
import GroupListingCard from '../components/GroupListingCard.vue';
import '../assets/groups.css';

const route = useRoute();
const router = useRouter();
const concerts = ref([]), groups = ref([]), saved = ref([]), seeker = ref(null);
const concertId = ref(typeof route.query.concertId === 'string' ? route.query.concertId : '');
const loading = ref(false), busy = ref(false), error = ref(''), message = ref('');
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
    const [listing, preferences, request] = await Promise.all([api.discoverGroups(id), api.groupPreferences(id), api.seekerRequest(id)]);
    if (alive && current === generation) { groups.value = listing.groups; saved.value = preferences.preferences; seeker.value = request.request; }
  } catch (e) { if (alive && current === generation) error.value = e.message; }
  finally { if (alive && current === generation) loading.value = false; }
}
watch(concertId, id => {
  message.value = '';
  router.replace({ query: { ...route.query, concertId: id || undefined } });
  load();
});
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
onUnmounted(() => { alive = false; generation++; });
async function enroll(reopen = false) {
  if (busy.value) return;
  busy.value = true; error.value = ''; message.value = '';
  const id = concertId.value;
  try {
    if (reopen) await api.reopenSeekerRequest(id);
    else await api.createRequest(id, form);
    if (alive && id === concertId.value) { await load(); message.value = 'Your seeker request is open. You can now prefer groups.'; }
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
    <p>Explore hosted concert groups and save your favourites. Preferences guide the next operator-run matching round; they do not reserve a place or confirm membership.</p>
    <nav class="group-actions"><RouterLink to="/kaki">Find a Kaki</RouterLink><RouterLink :to="{ path: '/groups/connect', query: { concertId } }">Connect Groups</RouterLink><RouterLink v-if="concertId" :to="`/concerts/${encodeURIComponent(concertId)}`">Concert &amp; proposals</RouterLink></nav>
    <label>Concert<select v-model="concertId" :disabled="busy"><option value="">Select a concert</option><option v-for="c in concerts" :key="c.id" :value="c.id">{{ c.artist }} · {{ c.event_date }}</option></select></label>
    <p v-if="error" class="group-error" role="alert">{{ error }} <button class="btn btn--ghost" :disabled="busy || loading" @click="load">Retry</button></p>
    <p v-if="message" class="group-success" role="status">{{ message }}</p>
    <p v-if="loading" role="status">Loading groups and your preferences…</p>
    <template v-else-if="concertId">
      <section v-if="!seeker" class="card group-panel">
        <h2>Create a seeker request</h2><p>Your request is separate from Find a Kaki enrollment.</p>
        <form class="group-panel" @submit.prevent="enroll()">
          <div class="group-controls">
            <label>Preferred seating<select v-model="form.section_pref"><option v-for="(name, id) in LABELS.section" :key="id" :value="id">{{ name }}</option></select></label>
            <label>Maximum spending<select v-model.number="form.spend_band_max"><option v-for="n in 4" :key="n" :value="n">{{ LABELS.spendBand[n] }}</option></select></label>
            <label>Arrival<select v-model="form.arrival_pref"><option v-for="(name, id) in LABELS.arrival" :key="id" :value="id">{{ name }}</option></select></label>
          </div>
          <fieldset><legend>Activities</legend><label v-for="(name, id) in LABELS.plans" :key="id" class="group-check"><input v-model="form.plans_wanted[id]" type="checkbox">{{ name }}</label></fieldset>
          <button class="btn btn--primary" :disabled="busy">{{ busy ? 'Saving…' : 'Create seeker request' }}</button>
        </form>
      </section>
      <section v-else class="card group-panel"><h2>Your request: {{ seeker.status }}</h2><p v-if="seeker.status === 'matched'">Review your proposal on the concert page. You can still remove saved preferences.</p><button v-if="seeker.status === 'withdrawn'" class="btn btn--primary" :disabled="busy" @click="enroll(true)">Reopen withdrawn request</button></section>
      <section class="card group-panel"><h2>Search groups</h2><GroupFilters :filters="filters" preferences /></section>
      <p>{{ visible.length }} eligible group(s). <span v-if="!seeker">Create a request to see compatibility and save preferences.</span></p>
      <div class="group-grid"><GroupListingCard v-for="g in visible" :key="g.id" :group="g"><button class="btn" :class="g.preferred ? 'btn--ghost' : 'btn--primary'" :disabled="busy || (!g.preferred && !canPrefer)" @click="preference(g.id, g.preferred)">{{ g.preferred ? 'Remove Preference' : 'Prefer Group' }}</button></GroupListingCard></div>
      <p v-if="!visible.length" class="group-muted">No eligible groups match these filters. Try another concert or adjust your filters.</p>
      <section class="card group-panel"><h2>Saved preferences</h2><p>You can remove preferences here even when a group fills, closes, or becomes ineligible.</p><p v-if="!saved.length">No saved preferences for this concert.</p><div v-for="p in saved" :key="p.partyId" class="group-actions"><span>{{ p.hostName }} · {{ LABELS.section[p.section] }} · {{ p.status }}</span><button class="btn btn--ghost" :disabled="busy" @click="preference(p.partyId, true)">Remove Preference</button></div></section>
    </template>
    <p v-else-if="!concerts.length">No concerts are available yet.</p>
  </main>
</template>
