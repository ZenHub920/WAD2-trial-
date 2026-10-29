<script setup>
import { computed, onMounted, onUnmounted, reactive, ref, useId, watch } from 'vue';
import { api } from '../api.js';
import MeetupLocationSearch from './MeetupLocationSearch.vue';
import LoadingSpinner from './LoadingSpinner.vue';

const props = defineProps({
  meetupId: { type: String, required: true },
  concert: { type: Object, default: null },
  hasMeetingPlace: { type: Boolean, default: false },
  planVersion: { type: Number, default: 0 },
});
const headingId = `nearby-transport-${useId()}`;
const phase = ref('pre'), pending = ref(false), venueOverride = ref(null);
const results = reactive({ pre: null, post: null });
const errors = reactive({ pre: '', post: '' });
const automatic = reactive({ pre: false, post: false });
const result = computed(() => results[phase.value]);
const error = computed(() => errors[phase.value]);
const venueName = computed(() => props.concert?.venue || result.value?.venueName || 'the concert venue');
const canCheck = computed(() => phase.value === 'post' || props.hasMeetingPlace);
const key = () => `${props.meetupId}:${props.planVersion}:${props.concert?.venue ?? ''}`;
let alive = true, generation = 0, refreshTimer;
const time = value => {
  if (value === null || value === undefined || value === '') return 'Time not reported';
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString('en-SG', { timeZone: 'Asia/Singapore', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : 'Time not reported';
};
const distance = value => Number.isFinite(value) ? `${Math.round(value * 1000)} m away` : 'Distance not reported';
const crowdLabel = value => ({ l: 'Low crowding', m: 'Moderate crowding', h: 'High crowding' })[String(value).toLowerCase()] || 'Crowding not reported';
const busLabel = value => ({ SEA: 'Seats available', SDA: 'Standing available', LSD: 'Limited standing space' })[value] || 'Crowding not reported';
const stationCrowds = station => {
  const codes = new Set([station.id, ...(station.codes ?? [])]);
  return (result.value?.crowding?.stations ?? []).filter(row => codes.has(row.station));
};
const busReport = stop => result.value?.buses?.stops?.find(row => row.code === stop.code);

async function check({ auto = false } = {}) {
  if (pending.value || !canCheck.value || !alive) return;
  const requestedPhase = phase.value, context = key(), version = generation;
  const options = { phase: requestedPhase };
  if (requestedPhase === 'post' && venueOverride.value) Object.assign(options, venueOverride.value);
  pending.value = true;
  errors[requestedPhase] = '';
  try {
    const data = (await api.meetupTransport(props.meetupId, options)).transport;
    if (!alive || key() !== context || version !== generation || phase.value !== requestedPhase) return;
    results[requestedPhase] = data;
    if (!auto) automatic[requestedPhase] = Boolean(data?.anchor && [data.trains, data.crowding, data.buses].some(feed => feed?.status === 'available'));
  } catch (failure) {
    if (!alive || key() !== context || version !== generation || phase.value !== requestedPhase) return;
    if ([401, 403, 404].includes(failure.status)) {
      results.pre = null; results.post = null; automatic.pre = false; automatic.post = false;
      errors[requestedPhase] = 'These travel checks are unavailable. Reopen the planner to check your access.';
    } else errors[requestedPhase] = 'Could not refresh nearby transport. Any displayed information is the previous check; please try again.';
  } finally { pending.value = false; }
}
function switchPhase(next) {
  if (phase.value === next) return;
  phase.value = next;
  generation++;
}
function selectVenue(location) {
  if (!Number.isFinite(location.latitude) || !Number.isFinite(location.longitude)) return;
  generation++;
  venueOverride.value = { latitude: location.latitude, longitude: location.longitude, label: location.label };
  results.post = null; automatic.post = false; errors.post = '';
}
function useConcertVenue() {
  generation++; venueOverride.value = null; results.post = null; automatic.post = false; errors.post = '';
}
function refreshIfVisible() {
  if (document.visibilityState === 'visible' && automatic[phase.value] && results[phase.value]?.anchor)
    void check({ auto: true });
}
watch([() => props.meetupId, () => props.concert?.venue], () => {
  generation++; phase.value = 'pre'; venueOverride.value = null;
  results.pre = null; results.post = null; errors.pre = ''; errors.post = '';
  automatic.pre = false; automatic.post = false;
});
watch(() => props.planVersion, () => {
  generation++; results.pre = null; errors.pre = ''; automatic.pre = false;
});
watch(() => props.hasMeetingPlace, value => {
  if (!value) { generation++; results.pre = null; automatic.pre = false; }
});
onMounted(() => {
  refreshTimer = setInterval(refreshIfVisible, 60000);
  document.addEventListener('visibilitychange', refreshIfVisible);
});
onUnmounted(() => { alive = false; generation++; clearInterval(refreshTimer); document.removeEventListener('visibilitychange', refreshIfVisible); });
</script>

<template>
  <section class="card group-panel nearby-transport" :aria-labelledby="headingId" :data-transport-phase="phase">
    <header><h2 :id="headingId">Getting there and getting home</h2><p>Check train disruptions, station crowds and bus loads close to your plans.</p></header>
    <div class="nearby-transport__choices" role="group" aria-label="Transport journey">
      <button type="button" class="btn" :class="phase === 'pre' ? 'btn--primary' : 'btn--ghost'" :aria-pressed="phase === 'pre'" @click="switchPhase('pre')">Before the meetup</button>
      <button type="button" class="btn" :class="phase === 'post' ? 'btn--primary' : 'btn--ghost'" :aria-pressed="phase === 'post'" @click="switchPhase('post')">After the concert</button>
    </div>
    <p v-if="phase === 'pre'">Look around your proposed meeting place before travelling to meet the group.</p>
    <p v-else>Look around <strong>{{ venueName }}</strong> when deciding how to leave the concert.</p>
    <p v-if="phase === 'pre' && !hasMeetingPlace" class="group-muted">Propose a meeting place above first, then check nearby transport here.</p>
    <details v-if="phase === 'post'" :open="Boolean(result && !result.anchor)" class="nearby-transport__venue">
      <summary>{{ venueOverride ? `Selected venue: ${venueOverride.label}` : 'Check or correct the concert venue' }}</summary>
      <p class="group-muted">Choose the venue itself, rather than your home or meeting place. This selection is only for these transport checks.</p>
      <MeetupLocationSearch :key="meetupId" :meetup-id="meetupId" label="Find the concert venue" @selected="selectVenue" />
      <button v-if="venueOverride" type="button" class="btn btn--ghost" @click="useConcertVenue">Use the concert's venue again</button>
    </details>
    <p v-if="venueOverride && phase === 'post'" class="group-muted">Using {{ venueOverride.label }}. Press Check nearby transport to refresh this location.</p>
    <div class="group-actions">
      <button type="button" class="btn btn--primary" :disabled="pending || !canCheck" @click="check()"><LoadingSpinner v-if="pending" />{{ pending ? 'Checking nearby transport…' : 'Check nearby transport' }}</button>
      <label v-if="result?.anchor" class="group-check"><input v-model="automatic[phase]" type="checkbox" />Refresh every minute while open</label>
    </div>
    <p class="nearby-transport__timing">Conditions now, not a prediction for the concert date. Station crowd observations are updated by LTA about every ten minutes; bus loads describe approaching vehicles at that stop, rather than an entire route.</p>
    <p v-if="error" role="alert" class="group-error">{{ error }}</p>
    <template v-if="result">
      <p v-if="!result.anchor" role="status" class="group-muted">{{ phase === 'post' ? 'Choose the exact concert venue above so nearby checks use the right location.' : 'Choose a meeting place before checking nearby transport.' }}</p>
      <template v-else>
        <div class="nearby-transport__context"><strong>Near {{ result.anchor.label }}</strong><span v-if="result.checkedAt">Checked {{ time(result.checkedAt) }} SGT</span></div>
        <p v-if="result.nearby?.status !== 'available'" role="status" class="group-muted">Nearby station and bus-stop lookup is unavailable. No citywide crowd levels are substituted.</p>
        <template v-else>
          <div class="nearby-transport__advisory">
            <h3>Train advisories for nearby lines</h3>
            <p v-if="result.trains?.status !== 'available'">Train advisories are unavailable right now.</p>
            <template v-else>
              <p v-if="result.trains.serviceStatus === 'normal'">No disruption reported on these nearby lines.</p>
              <p v-else-if="result.trains.serviceStatus === 'disrupted'" class="nearby-transport__warning">Disruption reported on a nearby line.</p>
              <p v-else>Nearby line impact is not confirmed. Check again before travelling.</p>
              <p v-if="result.trains.stale" class="group-muted">Showing saved advisories; a fresh check is unavailable.</p>
              <p v-for="(segment, index) in result.trains.affectedSegments ?? []" :key="`segment-${index}`"><strong>{{ segment.line }}</strong>: {{ segment.stations }}<span v-if="segment.direction"> · {{ segment.direction }}</span></p>
              <p v-for="(message, index) in result.trains.messages ?? []" :key="`message-${index}`">{{ message.content }}</p>
            </template>
          </div>
          <div class="nearby-transport__columns">
            <section aria-label="Nearby stations">
              <h3>Nearby stations</h3><p class="group-muted">Up to three stations within 1.5 km.</p>
              <p v-if="result.nearby.stationsStatus === 'unavailable'">Station lookup is unavailable.</p>
              <p v-else-if="!result.nearby.stations?.length">No stations reported within this area.</p>
              <article v-for="station in result.nearby.stations ?? []" :key="station.id" class="nearby-transport__stop">
                <h4>{{ station.name }}</h4><p class="group-muted">{{ (station.codes ?? [station.id]).join(' / ') }} · {{ distance(station.distanceKm) }}</p>
                <p v-if="result.crowding?.status !== 'available'">Station crowd information is unavailable.</p>
                <p v-else-if="!stationCrowds(station).length">Crowding not reported for this station.</p>
                <div v-for="(crowd, index) in stationCrowds(station)" :key="`${crowd.station}-${index}`">
                  <p><strong>{{ crowdLabel(crowd.level) }}</strong><span v-if="stationCrowds(station).length > 1"> · {{ crowd.station }}</span></p>
                  <small>{{ time(crowd.observedAt) }}<span v-if="crowd.observedAt"> SGT</span><span v-if="crowd.stale || result.crowding.stale"> · Saved observation</span></small>
                </div>
              </article>
            </section>
            <section aria-label="Nearby bus stops">
              <h3>Nearby bus stops</h3><p class="group-muted">Up to three stops within 800 m.</p>
              <p v-if="result.nearby.busStopsStatus === 'unavailable'">Bus-stop lookup is unavailable.</p>
              <p v-else-if="!result.nearby.busStops?.length">No bus stops reported within this area.</p>
              <article v-for="stop in result.nearby.busStops ?? []" :key="stop.code" class="nearby-transport__stop">
                <h4>{{ stop.name }}</h4><p class="group-muted">Stop {{ stop.code }} · {{ distance(stop.distanceKm) }}</p>
                <p v-if="busReport(stop)?.status !== 'available'">Bus crowd information is unavailable for this stop.</p>
                <template v-else>
                  <p v-if="busReport(stop).stale" class="group-muted">Showing saved bus loads; check again before travelling.</p>
                  <p v-if="!busReport(stop).services?.length">No bus services reported at this stop.</p>
                  <details v-else><summary>View {{ busReport(stop).services.length }} bus {{ busReport(stop).services.length === 1 ? 'service' : 'services' }}</summary>
                    <div v-for="service in busReport(stop).services" :key="service.service" class="nearby-transport__service"><strong>Bus {{ service.service }}</strong>
                      <p v-if="!service.crowdLevels?.length">Crowding not reported.</p>
                      <p v-for="(vehicle, index) in service.crowdLevels ?? []" :key="index">{{ vehicle.position === 1 ? 'Next bus' : `Following bus ${vehicle.position - 1}` }}: {{ busLabel(vehicle.load) }}<span v-if="vehicle.wheelchairAccessible"> · Wheelchair accessible</span></p>
                    </div>
                  </details>
                </template>
              </article>
            </section>
          </div>
        </template>
      </template>
      <p v-if="result.message" class="group-muted">{{ result.message }}</p>
    </template>
  </section>
</template>

<style scoped>
.nearby-transport { display: grid; gap: var(--space-4); }
.nearby-transport header { display: grid; gap: var(--space-2); }
.nearby-transport__choices { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.nearby-transport__timing, .nearby-transport__context span, .nearby-transport small { color: var(--text-300); font-size: var(--step--1); line-height: 1.5; }
.nearby-transport__context { display: flex; flex-wrap: wrap; justify-content: space-between; gap: var(--space-2); padding-block: var(--space-3); border-block: var(--border-soft); }
.nearby-transport__columns { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-4); }
.nearby-transport__columns > section, .nearby-transport__advisory { display: grid; align-content: start; gap: var(--space-3); min-width: 0; }
.nearby-transport__stop { display: grid; gap: var(--space-2); padding: var(--space-4); border: var(--border-soft); border-radius: var(--radius-md); background: var(--ink-800); }
.nearby-transport__stop h4 { font-size: var(--step-0); }
.nearby-transport__service { padding-top: var(--space-3); }
.nearby-transport__warning { color: var(--rose-400); }
.nearby-transport__venue { border-left: 2px solid var(--ink-500); padding-left: var(--space-3); }
@media (max-width: 650px) { .nearby-transport__columns { grid-template-columns: 1fr; } .nearby-transport__choices .btn { flex: 1; } }
</style>
