<script setup>
/**
 * Live MRT, crowd and bus updates near the concert venue or the meeting place
 * (once one is chosen). Choosing one checks transport straight away; there is
 * no separate "check" step.
 */
import { computed, onMounted, onUnmounted, ref, useId, watch } from 'vue';
import { api } from '../api.js';
import { formatMeetupObservationTime } from '../utils/meetupTime.js';
import LoadingSpinner from './LoadingSpinner.vue';

const props = defineProps({
  meetupId: { type: String, required: true },
  concert: { type: Object, default: null },
  hasMeetingPlace: { type: Boolean, default: false },
  planVersion: { type: Number, default: 0 },
  active: { type: Boolean, default: true },
  /** Inside another card (Before you go): no card frame or heading of its own. */
  embedded: { type: Boolean, default: false },
});
const headingId = `nearby-transport-${useId()}`;
/** 'venue' | 'meeting' */
const source = ref('venue');
const pending = ref(false), result = ref(null), error = ref(''), automatic = ref(false);
const venueName = computed(() => props.concert?.venue || result.value?.venueName || 'the concert venue');
let alive = true, generation = 0, refreshTimer;
const time = formatMeetupObservationTime;
const distance = value => Number.isFinite(value) ? `${Math.round(value * 1000)} m away` : 'Distance not reported';
const crowdLabel = value => ({ l: 'Low crowding', m: 'Moderate crowding', h: 'High crowding' })[String(value).toLowerCase()] || 'Crowding not reported';
const busLabel = value => ({ SEA: 'Seats available', SDA: 'Standing available', LSD: 'Limited standing space' })[value] || 'Crowding not reported';
const stationCrowds = station => {
  const codes = new Set([station.id, ...(station.codes ?? [])]);
  return (result.value?.crowding?.stations ?? []).filter(row => codes.has(row.station));
};
const busReport = stop => result.value?.buses?.stops?.find(row => row.code === stop.code);
/**
 * One compact row per bus: its next three arrivals in minutes, each coloured by
 * how full that bus is (green seats, amber standing, red limited standing).
 * Soonest bus first; a stop shows five buses until "Show all".
 */
const loadClass = load => ({ SEA: 'seats', SDA: 'standing', LSD: 'limited' })[load] ?? 'unknown';
function minutesAway(when) {
  const reference = Date.parse(result.value?.checkedAt ?? '') || Date.now();
  const minutes = Math.round((Date.parse(when) - reference) / 60000);
  return minutes <= 0 ? 'Arr' : `${minutes} min`;
}
function busRows(stop) {
  const services = busReport(stop)?.services ?? [];
  return services.map(service => {
    const arrivals = (service.arrivals?.length ? service.arrivals : service.crowdLevels ?? []).slice(0, 3).map(bus => ({
      // Without an arrival time, say how full it is instead.
      label: bus.estimatedArrival ? minutesAway(bus.estimatedArrival) : ({ SEA: 'Seats', SDA: 'Standing', LSD: 'Crowded' })[bus.load] ?? '—',
      load: loadClass(bus.load),
      title: `${busLabel(bus.load)}${bus.wheelchairAccessible ? ' · wheelchair accessible' : ''}`,
    }));
    const first = Date.parse(service.arrivals?.[0]?.estimatedArrival ?? '') || Infinity;
    return { service: service.service, arrivals, first };
  }).sort((a, b) => a.first - b.first || a.service.localeCompare(b.service, undefined, { numeric: true }));
}
const expandedStops = ref(new Set());
const toggleStop = code => { const next = new Set(expandedStops.value); next.has(code) ? next.delete(code) : next.add(code); expandedStops.value = next; };
const providerNote = reason => reason === 'lta_not_configured' ? ' LTA DataMall is not configured.'
  : reason === 'onemap_not_configured' ? ' OneMap is not configured.' : '';

/** What the server needs for the current choice. */
function request() {
  return { phase: source.value === 'meeting' ? 'pre' : 'post' };
}
async function check({ auto = false } = {}) {
  const options = request();
  if (!options || !alive || !props.active || (pending.value && auto)) return;
  const version = ++generation;
  pending.value = true; error.value = '';
  try {
    const data = (await api.meetupTransport(props.meetupId, options)).transport;
    if (!alive || version !== generation) return;
    result.value = data;
  } catch (failure) {
    if (!alive || version !== generation) return;
    error.value = [401, 403, 404].includes(failure.status)
      ? 'These travel checks are unavailable. Reopen the planner to check your access.'
      : 'Could not load nearby transport. Please try again.';
  } finally { if (version === generation) pending.value = false; }
}
function choose(next) {
  source.value = next;
  result.value = null; error.value = ''; automatic.value = false;
  void check();
}
function refreshIfVisible() {
  if (props.active && document.visibilityState === 'visible' && automatic.value && result.value?.anchor) void check({ auto: true });
}
// Open on the meeting place when there is one, otherwise the concert venue.
watch(() => props.active, active => { if (active && !result.value && !pending.value) choose(props.hasMeetingPlace ? 'meeting' : source.value); }, { immediate: true });
watch(() => props.meetupId, () => { choose('venue'); });
watch(() => props.planVersion, () => { if (source.value === 'meeting') void check(); });
watch(() => props.hasMeetingPlace, value => { if (!value && source.value === 'meeting') choose('venue'); });
onMounted(() => {
  refreshTimer = setInterval(refreshIfVisible, 60000);
  document.addEventListener('visibilitychange', refreshIfVisible);
});
onUnmounted(() => { alive = false; generation++; clearInterval(refreshTimer); document.removeEventListener('visibilitychange', refreshIfVisible); });
</script>

<template>
  <section class="nearby-transport" :class="{ 'card group-panel': !embedded }" :aria-labelledby="embedded ? undefined : headingId" :aria-label="embedded ? 'Public transport' : undefined" :data-transport-source="source">
    <header v-if="!embedded"><h2 :id="headingId">Getting there and getting home</h2><p>Live MRT, crowd and bus updates near the venue or the meeting place.</p></header>
    <div class="nearby-transport__choices" role="group" aria-label="Where to check">
      <button type="button" class="btn" :class="source === 'venue' ? 'btn--primary' : 'btn--ghost'" :aria-pressed="source === 'venue'" :disabled="pending && source === 'venue'" @click="choose('venue')">Concert venue</button>
      <button v-if="hasMeetingPlace" type="button" class="btn" :class="source === 'meeting' ? 'btn--primary' : 'btn--ghost'" :aria-pressed="source === 'meeting'" :disabled="pending && source === 'meeting'" @click="choose('meeting')">Meeting place</button>
    </div>
    <p v-if="pending" class="loading-state" role="status"><LoadingSpinner />Checking nearby transport…</p>
    <details class="nearby-transport__about">
      <summary>About this transport data</summary>
      <ul>
        <li>These are conditions right now, not a forecast for concert day.</li>
        <li>Up to three nearby stations and bus stops are shown. Missing reports don’t mean it’s empty.</li>
      </ul>
    </details>
    <p v-if="error" role="alert" class="group-error">{{ error }}</p>
    <template v-if="result">
      <p v-if="!result.anchor" role="status" class="group-muted">{{ source === 'venue' ? `We couldn’t find ${venueName} on the map, so nearby transport isn’t available.` : 'Choose a meeting place to see nearby MRT stations and bus stops.' }}</p>
      <template v-else>
        <div class="nearby-transport__context"><span class="nearby-transport__place"><strong>{{ /^near\s/i.test(result.anchor.label) ? result.anchor.label : `Near ${result.anchor.label}` }}</strong><button type="button" class="nearby-transport__refresh" :class="{ 'nearby-transport__refresh--spinning': pending }" :disabled="pending" aria-label="Refresh transport" title="Refresh" @click="check()"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" /></svg></button></span><span v-if="result.checkedAt">Checked {{ time(result.checkedAt) }} SGT</span></div>
        <p v-if="result.nearby?.status !== 'available'" role="status" class="group-muted">Nearby station and bus-stop lookup is unavailable.{{ providerNote(result.nearby?.reason) }}</p>
        <template v-else>
          <div class="nearby-transport__advisory">
            <h3>Train advisories for nearby lines</h3>
            <p v-if="result.trains?.status !== 'available'">Train advisories are unavailable right now.{{ providerNote(result.trains?.reason) }}</p>
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
              <h3>Nearby bus stops</h3>
              <p class="bus-legend" aria-label="How full each bus is"><span class="bus-legend__dot bus-row__time--seats"></span>Seats <span class="bus-legend__dot bus-row__time--standing"></span>Standing <span class="bus-legend__dot bus-row__time--limited"></span>Crowded</p>
              <p v-if="result.nearby.busStopsStatus === 'unavailable'">Bus-stop lookup is unavailable.</p>
              <p v-else-if="!result.nearby.busStops?.length">No bus stops reported within this area.</p>
              <article v-for="stop in result.nearby.busStops ?? []" :key="stop.code" class="nearby-transport__stop">
                <h4>{{ stop.name }}</h4><p class="group-muted">Stop {{ stop.code }} · {{ distance(stop.distanceKm) }}</p>
                <p v-if="busReport(stop)?.status !== 'available'">Bus crowd information is unavailable for this stop.</p>
                <template v-else>
                  <p v-if="busReport(stop).stale" class="group-muted">Showing saved bus loads; check again before travelling.</p>
                  <p v-if="!busReport(stop).services?.length">No bus services reported at this stop.</p>
                  <template v-else>
                    <ul class="bus-rows" :aria-label="`Buses at ${stop.name}`">
                      <li v-for="row in (expandedStops.has(stop.code) ? busRows(stop) : busRows(stop).slice(0, 5))" :key="row.service" class="bus-row">
                        <span class="bus-row__number">{{ row.service }}</span>
                        <span class="bus-row__times">
                          <span v-for="(bus, index) in row.arrivals" :key="index" class="bus-row__time" :class="`bus-row__time--${bus.load}`" :title="bus.title">{{ bus.label }}</span>
                          <span v-if="!row.arrivals.length" class="group-muted">Not reported</span>
                        </span>
                      </li>
                    </ul>
                    <button v-if="busRows(stop).length > 5" type="button" class="bus-rows__more" @click="toggleStop(stop.code)">{{ expandedStops.has(stop.code) ? 'Show fewer buses' : `Show all ${busRows(stop).length} buses` }}</button>
                  </template>
                </template>
              </article>
            </section>
          </div>
        </template>
      </template>
    </template>
  </section>
</template>

<style scoped>
.nearby-transport {
  display: grid;
  gap: var(--space-4);
}
.nearby-transport header {
  display: grid;
  gap: var(--space-2);
}
.nearby-transport__choices {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
.nearby-transport__about, .nearby-transport__context span, .nearby-transport small {
  color: var(--text-300);
  font-size: var(--step--1);
  line-height: 1.5;
}
.nearby-transport__about ul {
  display: grid;
  gap: var(--space-2);
  padding-left: var(--space-4);
  margin-top: var(--space-3);
}
.nearby-transport__context {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: var(--space-2);
  padding-block: var(--space-3);
  border-block: var(--border-soft);
}
.nearby-transport__columns {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-4);
}
.nearby-transport__columns > section, .nearby-transport__advisory {
  display: grid;
  align-content: start;
  gap: var(--space-3);
  min-width: 0;
}
.nearby-transport__stop {
  display: grid;
  gap: var(--space-2);
  padding: var(--space-4);
  border: var(--border-soft);
  border-radius: var(--radius-md);
  background: var(--ink-800);
}
.nearby-transport__stop h4 {
  font-size: var(--step-0);
}
/* Bus arrivals: one tidy row per bus. */
.nearby-transport__place { display: inline-flex; align-items: center; gap: var(--space-2); min-width: 0; }
.nearby-transport__refresh {
  display: inline-grid; place-items: center; width: 32px; height: 32px; padding: 0; flex: none;
  border: var(--border-soft); border-radius: 50%; background: var(--panel-bg); color: var(--accent-400); cursor: pointer;
}
.nearby-transport__refresh:hover:not(:disabled) { background: color-mix(in srgb, var(--accent-400) 10%, var(--panel-bg)); }
.nearby-transport__refresh:disabled { cursor: progress; }
.nearby-transport__refresh svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.nearby-transport__refresh--spinning svg { animation: nearby-refresh-spin .9s linear infinite; }
@keyframes nearby-refresh-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .nearby-transport__refresh--spinning svg { animation: none; } }
.bus-rows { display: grid; gap: var(--space-1); margin: 0; padding: 0; list-style: none; }
.bus-row { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-1) 0; border-top: var(--border-hairline); }
.bus-row:first-child { border-top: 0; }
.bus-row__number { flex: none; min-width: 3.2rem; padding: 2px var(--space-2); border-radius: var(--radius-sm); background: var(--ink-700); color: var(--text-100); font-weight: 700; font-size: var(--step--1); text-align: center; }
.bus-row__times { display: flex; flex-wrap: wrap; gap: var(--space-1); }
.bus-row__time { min-width: 3.4rem; padding: 2px var(--space-2); border-radius: var(--radius-pill); font-size: var(--step--2); font-weight: 600; text-align: center; border: 1px solid transparent; }
.bus-row__time--seats { background: color-mix(in srgb, var(--signal-good) 14%, transparent); color: var(--signal-good); border-color: color-mix(in srgb, var(--signal-good) 35%, transparent); }
.bus-row__time--standing { background: color-mix(in srgb, var(--amber-400) 16%, transparent); color: var(--amber-400); border-color: color-mix(in srgb, var(--amber-400) 35%, transparent); }
.bus-row__time--limited { background: color-mix(in srgb, var(--signal-bad) 14%, transparent); color: var(--signal-bad); border-color: color-mix(in srgb, var(--signal-bad) 35%, transparent); }
.bus-row__time--unknown { background: var(--ink-700); color: var(--text-300); }
.bus-rows__more { justify-self: start; padding: 0; border: 0; background: none; color: var(--accent-400); font: inherit; font-size: var(--step--1); text-decoration: underline; cursor: pointer; }
.bus-legend { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-1) var(--space-2); margin: 0; color: var(--text-300); font-size: var(--step--2); }
.bus-legend__dot { display: inline-block; width: .7rem; height: .7rem; border-radius: 50%; border: 1px solid; }
.nearby-transport__warning {
  color: var(--rose-400);
}
.nearby-transport__venue {
  border-left: 2px solid var(--ink-500);
  padding-left: var(--space-3);
}
@media (max-width: 650px) {
  .nearby-transport__columns {
    grid-template-columns: 1fr;
  }
  .nearby-transport__choices .btn {
    flex: 1;
  }
}
</style>
