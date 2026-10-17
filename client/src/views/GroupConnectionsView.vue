<script setup>
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, LABELS } from '../api.js';
import { filterGroups } from '../groupFilters.js';
import GroupFilters from '../components/GroupFilters.vue';
import GroupListingCard from '../components/GroupListingCard.vue';
import ConfirmDialog from '../components/ConfirmDialog.vue';
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
// Sections are stored as keys (`lower_bowl`); nobody should be reading those.
const sectionName = key => LABELS.section[key] ?? key;
const describe = c => `${c.partyA.hostName} (${sectionName(c.partyA.section)}) ↔ ${c.partyB.hostName} (${sectionName(c.partyB.section)}), ${c.partyA.artist}`;

/** SQLite writes `datetime('now')` as UTC with no zone marker; read it as such. */
function whenConnected(value) {
  if (!value) return '';
  const date = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * The group on the far side of an invitation: whoever sent it when it is
 * incoming, whoever received it when it is outgoing. Used to name the other
 * host in the confirmation, so "cancel this?" says which one.
 */
function otherParty(connection) {
  const { partyA, partyB, initiatorPartyId, incoming } = connection;
  const initiator = partyA.id === initiatorPartyId ? partyA : partyB;
  const receiver = initiator === partyA ? partyB : partyA;
  return incoming ? initiator : receiver;
}

/* Declining and withdrawing both throw away something the other host is
 * waiting on, so neither happens on a single stray click. */
const confirming = ref(null); // { kind: 'decline' | 'cancel', connection }

const confirmCopy = computed(() => {
  const state = confirming.value;
  if (!state) return { title: '', body: '', label: 'Confirm' };
  const host = otherParty(state.connection).hostName;
  return state.kind === 'decline'
    ? {
      title: 'Decline this invitation?',
      body: `${host}'s group will not be connected to yours, and the invitation leaves your list.`,
      label: 'Decline',
    }
    : {
      title: 'Cancel this invitation?',
      body: `Your invitation to ${host}'s group will be withdrawn. You can invite them again later.`,
      label: 'Cancel invitation',
    };
});

async function runConfirmed() {
  const state = confirming.value;
  if (!state) return;
  confirming.value = null;
  await act(() => (state.kind === 'decline'
    ? api.respondToGroup(state.connection.id, 'decline')
    : api.cancelGroupInvite(state.connection.id)));
}
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
    <h1>Connect Groups</h1><p>Meet another group going to the same concert.</p>
    <nav class="group-actions"><RouterLink to="/groups">Find a Group</RouterLink><RouterLink to="/kaki">Find a Kaki</RouterLink><RouterLink :to="concertId ? `/concerts/${encodeURIComponent(concertId)}` : '/concerts'">Host a group</RouterLink></nav>
    <p v-if="error" class="group-error" role="alert">{{ error }} <button class="btn btn--ghost" :disabled="busy" @click="retry">Retry</button></p>
    <p v-if="message" class="group-success" role="status">{{ message }}</p>
    <section v-if="hosted.length" class="card group-panel">
      <h2>Your group</h2>
      <div class="group-controls"><label>Concert<select v-model="concertId" :disabled="busy"><option value="">Choose concert</option><option v-for="c in concerts" :key="c.id" :value="c.id">{{ c.artist }}, {{ c.date }}</option></select></label><label>Hosted group<select v-model="sourceId" :disabled="busy"><option value="">Choose group</option><option v-for="g in sources" :key="g.id" :value="g.id">{{ g.hostName }}, {{ sectionName(g.section) }}, {{ g.id }}</option></select></label></div>
      <p v-if="!sources.length">No active hosted groups for this concert. Open the concert page to host one.</p>
    </section>
    <p v-else>Host a concert group to start sending invitations.</p>
    <RouterLink v-if="sourceId" :to="`/groups/${sourceId}/members`" class="btn btn--ghost">Manage group</RouterLink>
    <RouterLink v-if="sourceId" :to="{path:'/meetups',query:{partyId:sourceId}}" class="btn btn--ghost">Plan your group meetup</RouterLink>
    <section v-if="joins.length" class="card group-panel"><h2>Join requests</h2><article v-for="j in joins" :key="j.id"><p>{{j.seekerName}}, {{j.artist}}, {{j.status}}</p><p v-if="j.preferences">Enjoys: {{j.preferences.about.map(p=>p.text).join(", ") || "No preferences specified"}}. Companions: {{j.preferences.wants.map(p=>p.text).join(", ") || "Flexible"}}.</p><p v-if="j.seeker">{{j.seeker.ageBand}}, {{j.seeker.languages.join(", ")}}</p><div v-if="j.status==='pending'" class="group-actions"><button class="btn btn--primary" :disabled="busy" @click="act(()=>api.respondGroupJoin(j.id,'accept'))">Approve</button><button class="btn btn--ghost" :disabled="busy" @click="act(()=>api.respondGroupJoin(j.id,'reject'))">Reject</button></div></article></section>
    <template v-if="sourceId">
      <section class="card group-panel"><h2>Discover groups</h2><GroupFilters :filters="filters" /></section>
      <p v-if="loading" role="status">Loading groups…</p>
      <div v-else class="group-grid"><GroupListingCard v-for="g in visible" :key="g.id" :group="g"><p v-if="g.invitation">Invitation: {{ g.invitation.status }}</p><button v-else class="btn btn--primary" :disabled="busy" @click="act(() => api.inviteGroup(sourceId, g.id))">Send Invitation</button></GroupListingCard></div>
      <p v-if="!loading && !visible.length">No other eligible groups match these filters.</p>
      <nav class="group-actions"><button class="btn btn--ghost" :disabled="busy||loading||offset===0" @click="offset=Math.max(0,offset-20);loadCandidates()">Previous 20</button><span>{{total}} results</span><button class="btn btn--ghost" :disabled="busy||loading||offset+20>=total" @click="offset+=20;loadCandidates()">Next 20</button></nav>
    </template>
    <!-- One feature, not three panels. What is live is always here; the two
         invitation lists appear only while something is actually waiting, so
         an empty inbox costs no space and reads as nothing to do. -->
    <section class="card group-panel connections">
      <header class="connections__head">
        <h2>Connections</h2>
      </header>

      <div v-if="incoming.length" class="invites">
        <h3 class="invites__title">Received <span class="invites__count tabular">{{ incoming.length }}</span></h3>
        <article v-for="c in incoming" :key="c.id" class="invite">
          <p class="invite__who">{{ describe(c) }}</p>
          <div class="invite__actions">
            <button
              type="button"
              class="mark mark--yes"
              :disabled="busy"
              :aria-label="`Accept the invitation from ${otherParty(c).hostName}`"
              @click="act(() => api.respondToGroup(c.id, 'accept'))"
            >✓</button>
            <button
              type="button"
              class="mark mark--no"
              :disabled="busy"
              :aria-label="`Decline the invitation from ${otherParty(c).hostName}`"
              @click="confirming = { kind: 'decline', connection: c }"
            >✕</button>
          </div>
        </article>
      </div>

      <div v-if="outgoing.length" class="invites">
        <h3 class="invites__title">Sent <span class="invites__count tabular">{{ outgoing.length }}</span></h3>
        <article v-for="c in outgoing" :key="c.id" class="invite">
          <p class="invite__who">{{ describe(c) }}</p>
          <!-- Reads "Pending" at rest and "Cancel" under the cursor: one
               control that states the status and offers the only action. -->
          <button
            type="button"
            class="pending"
            :disabled="busy"
            :aria-label="`Cancel your invitation to ${otherParty(c).hostName}`"
            @click="confirming = { kind: 'cancel', connection: c }"
          >
            <span class="pending__dot" aria-hidden="true" />
            <span class="pending__rest" aria-hidden="true">Pending</span>
            <span class="pending__hover" aria-hidden="true">Cancel</span>
          </button>
        </article>
      </div>

      <div class="connected">
        <h3 class="invites__title">Connected</h3>
        <p v-if="!accepted.length" class="connections__empty">
          No connections yet. Invite a group above, or create one of your own below.
        </p>
        <article v-for="c in accepted" :key="c.id" class="connection">
          <p class="invite__who">{{ describe(c) }}</p>
          <!-- Attributed, because run together the two groups' notes read as
               one voice contradicting itself. -->
          <p v-if="c.partyA.notes" class="group-notes"><strong>{{ c.partyA.hostName }}:</strong> {{ c.partyA.notes }}</p>
          <p v-if="c.partyB.notes" class="group-notes"><strong>{{ c.partyB.hostName }}:</strong> {{ c.partyB.notes }}</p>
          <div class="connection__foot">
            <span class="connection__since">Connected {{ whenConnected(c.respondedAt) }}</span>
            <RouterLink class="btn btn--ghost" :to="{ path: '/meetups', query: { connectionId: c.id } }">Plan meetup</RouterLink>
          </div>
        </article>

        <!-- Hosting sits here because a new group is what you connect FROM:
             with nothing of your own there is nothing to invite anybody to. -->
        <details class="create">
          <summary class="create__summary">Create</summary>
          <form class="group-panel" @submit.prevent="host">
            <div class="group-controls">
              <label>Concert<select v-model="hostConcertId" required :disabled="busy"><option v-for="c in allConcerts" :key="c.id" :value="c.id">{{ c.artist }}, {{ c.event_date }}</option></select></label>
              <label>Available places<input v-model.number="hostForm.capacity" type="number" min="1" step="1" required :disabled="busy"></label>
              <label>Seating<select v-model="hostForm.section" :disabled="busy"><option v-for="(name, id) in LABELS.section" :key="id" :value="id">{{ name }}</option></select></label>
              <label>Spending<select v-model.number="hostForm.spend_band" :disabled="busy"><option v-for="n in 4" :key="n" :value="n">{{ LABELS.spendBand[n] }}</option></select></label>
              <label>Arrival<select v-model="hostForm.arrival_plan" :disabled="busy"><option v-for="(name, id) in LABELS.arrival" :key="id" :value="id">{{ name }}</option></select></label>
              <label>Published notes<input v-model="hostForm.notes" maxlength="2000" :disabled="busy"></label>
            </div>
            <fieldset><legend>Group activities</legend><label v-for="(name, id) in LABELS.plans" :key="id" class="group-check"><input v-model="hostForm.plans[id]" type="checkbox" :disabled="busy">{{ name }}</label></fieldset>
            <button class="btn btn--primary" :disabled="busy || !hostConcertId">Create group</button>
          </form>
        </details>
      </div>
    </section>

    <ConfirmDialog
      :open="Boolean(confirming)"
      :title="confirmCopy.title"
      :body="confirmCopy.body"
      :confirm-label="confirmCopy.label"
      cancel-label="Keep it"
      danger
      :busy="busy"
      @confirm="runConfirmed"
      @cancel="confirming = null"
    />
  </main>
</template>

<style scoped>
.connections { display: grid; gap: var(--space-5); }
.connections__head h2 { font-size: var(--step-1); }
.connections__empty { color: var(--text-400); font-size: var(--step--1); }

.invites, .connected { display: grid; gap: var(--space-3); }

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
}

.connection { display: grid; justify-items: start; }
.invite__who { min-width: 0; color: var(--text-200); font-size: var(--step--1); }
.invite__actions { display: flex; flex: none; gap: var(--space-2); }

/* ---- Accept / decline ---------------------------------------------------- */

.mark {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border: var(--border-soft);
  border-radius: var(--radius-pill);
  background: var(--ink-800);
  font-size: var(--step-0);
  line-height: 1;
  transition:
    background var(--dur-fast) var(--ease-out),
    border-color var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out),
    transform var(--dur-fast) var(--ease-spring);
}

.mark:hover:not(:disabled) { transform: scale(1.08); }
.mark:disabled { opacity: 0.5; }
.mark--yes { color: var(--mint-400); }
.mark--yes:hover:not(:disabled) { background: var(--mint-400); border-color: var(--mint-400); color: #fff; }
.mark--no { color: var(--rose-400); }
.mark--no:hover:not(:disabled) { background: var(--rose-400); border-color: var(--rose-400); color: #fff; }

/* ---- Pending / cancel ---------------------------------------------------- */

.pending {
  position: relative;
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: var(--space-2);
  min-width: 7.5rem;
  padding: var(--space-2) var(--space-4);
  border: var(--border-soft);
  border-radius: var(--radius-pill);
  background: var(--ink-800);
  color: var(--text-300);
  font-size: var(--step--1);
  transition:
    background var(--dur-fast) var(--ease-out),
    border-color var(--dur-fast) var(--ease-out),
    color var(--dur-fast) var(--ease-out);
}

.pending__dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--amber-400);
  animation: pending-pulse 1.8s var(--ease-glide) infinite;
}

@keyframes pending-pulse { 50% { opacity: 0.25; } }

/* The label swaps on hover; the button's aria-label states the action outright,
   so the swap is decoration rather than the only way to know what it does. */
.pending__hover { position: absolute; left: 0; right: 0; opacity: 0; }
.pending__rest, .pending__hover { transition: opacity var(--dur-fast) var(--ease-out); }

.pending:hover:not(:disabled),
.pending:focus-visible {
  border-color: var(--rose-400);
  background: color-mix(in oklab, var(--rose-400) 10%, transparent);
  color: var(--rose-400);
}

.pending:hover:not(:disabled) .pending__rest,
.pending:focus-visible .pending__rest { opacity: 0; }
.pending:hover:not(:disabled) .pending__hover,
.pending:focus-visible .pending__hover { opacity: 1; }
.pending:hover:not(:disabled) .pending__dot { animation: none; background: var(--rose-400); }
.pending:disabled { opacity: 0.5; }

@media (prefers-reduced-motion: reduce) {
  .pending__dot { animation: none; }
  .mark:hover:not(:disabled) { transform: none; }
}

/* ---- Connected ----------------------------------------------------------- */

.connection__foot {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-3);
  width: 100%;
  margin-top: var(--space-2);
}

.connection__since { margin-right: auto; color: var(--text-400); font-size: var(--step--2); }

/* ---- Create -------------------------------------------------------------- */

.create {
  margin-top: var(--space-2);
  padding: var(--space-4);
  border: 1px dashed var(--ink-500);
  border-radius: var(--radius-md);
}

.create__summary {
  cursor: pointer;
  color: var(--text-100);
  font-size: var(--step--1);
  font-weight: 700;
  list-style: none;
}

.create__summary::-webkit-details-marker { display: none; }

.create__summary::before {
  content: '+';
  display: inline-grid;
  place-items: center;
  width: 20px;
  height: 20px;
  margin-right: var(--space-2);
  border-radius: var(--radius-pill);
  background: var(--accent-500);
  color: #fff;
  font-weight: 700;
  transition: transform var(--dur-base) var(--ease-spring);
}

.create[open] .create__summary::before { transform: rotate(45deg); }
.create[open] .create__summary { margin-bottom: var(--space-4); }

@media (max-width: 600px) {
  .invite { align-items: flex-start; flex-direction: column; }
  .invite__actions, .pending { width: 100%; }
  .pending { justify-content: center; }
}
</style>
