<script setup>
import { computed, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api } from "../api.js";
import { currentUser } from "../auth.js";
import LoadingSpinner from "../components/LoadingSpinner.vue";
import BackLink from "../components/BackLink.vue";
import MeetupLocationSearch from "../components/MeetupLocationSearch.vue";
import MeetupAvailabilityGrid from "../components/MeetupAvailabilityGrid.vue";
import MeetupTransportPanel from '../components/MeetupTransportPanel.vue';
import { connectionState, onChatEvent } from '../chatLive.js';
import "../assets/groups.css";
const props = defineProps({ id: String });
const route = useRoute(),
  router = useRouter();
const board = ref(null),
  boards = ref([]),
  error = ref(""),
  busy = ref(false),
  loading = ref(true),
  notice = ref(""),
  weather = ref(null),
  rainfall = ref(null),
  travelRecommendations = ref(null),
  transport = ref(null),
  comment = ref(""),
  slots = ref({});
const form = reactive({
  title: "Meet before the concert",
  startsAt: "",
  endsAt: "",
});
const place = reactive({
  label: "",
  latitude: 1.3,
  longitude: 103.85,
  sheltered: true,
});
const position = reactive({ latitude: 1.3, longitude: 103.85, label: "", travelMode: 'transit' });
const travelOptions = reactive({ shelteredOnly: false });
const selectedSlotCount = computed(() => Object.values(slots.value).filter(slot => slot.selected).length);
const selectedTimes = computed({
  get: () => Object.entries(slots.value).filter(([, slot]) => slot.selected).map(([start]) => Number(start)),
  set: times => {
    const chosen = new Set(times);
    for (const [start, slot] of Object.entries(slots.value)) slot.selected = chosen.has(Number(start));
  },
});
const scope = computed(() => Object.fromEntries(['partyId', 'connectionId', 'kakiConversationId']
  .filter(key => typeof route.query[key] === 'string').map(key => [key, route.query[key]])));
const savedSlots = ref('[]'), refreshing = ref(false), syncNote = ref('');
const selectionSnapshot = rows => JSON.stringify(Object.entries(rows).filter(([, slot]) => slot.selected)
  .map(([start, slot]) => [Number(start), slot.travelMode, slot.latitude, slot.longitude, slot.label]));
const availabilityDirty = computed(() => selectionSnapshot(slots.value) !== savedSlots.value);
const liveLabel = computed(() => connectionState.value === 'live' ? 'Live with your group' : 'Keeping your group in sync');
let alive = true, loadRequest = 0, refreshTimer, pollTimer, stopEvents, refreshQueued = false;
const context = () => `${props.id ?? ''}:${currentUser.value?.id ?? ''}:${JSON.stringify(scope.value)}`;
const statuses = { planning: "Collecting availability", proposed: "Awaiting required approvals", confirmed: "Meetup confirmed", cancelled: "Meetup cancelled" };
const iso = (ms) => new Date(ms).toISOString();
const time = (ms) =>
  new Date(ms).toLocaleString("en-SG", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: 'Asia/Singapore',
  });
async function load({ preserveDrafts = false } = {}) {
  const key = context(), request = ++loadRequest;
  if (props.id) {
    const data = (await api.meetup(props.id)).meetup;
    if (!alive || context() !== key || request !== loadRequest) return;
    const keepDraft = preserveDrafts && availabilityDirty.value;
    if (board.value?.version !== data.version) {
      travelRecommendations.value = null; transport.value = null; weather.value = null; rainfall.value = null;
    }
    const nextSlots = Object.fromEntries(
      data.grid.map((s) => {
        const own = data.availability.find(
          (a) => a.starts_at <= s.startsAt && a.ends_at >= s.startsAt + 1800000,
        );
        return [
          s.startsAt,
          {
            selected: Boolean(own),
            latitude: own?.latitude ?? null,
            longitude: own?.longitude ?? null,
            label: own?.label ?? "",
            travelMode: own?.travel_mode ?? own?.travelMode ?? 'transit',
          },
        ];
      }),
    );
    savedSlots.value = selectionSnapshot(nextSlots);
    if (keepDraft) for (const start of Object.keys(nextSlots)) if (slots.value[start]) nextSlots[start] = slots.value[start];
    slots.value = nextSlots;
    board.value = data;
    if (data.status === 'cancelled') syncNote.value = 'This plan was cancelled. Your draft has been kept for reference.';
    else if (keepDraft) syncNote.value = 'Group updates received. Your unsaved availability is kept.';
    else syncNote.value = '';
  } else {
    const data = await api.meetups(scope.value);
    if (alive && context() === key && request === loadRequest) boards.value = data.meetups;
  }
}
watch(
  context,
  async () => {
    loadRequest++;
    error.value = "";
    notice.value = "";
    board.value = null;
    boards.value = []; slots.value = {}; savedSlots.value = '[]'; syncNote.value = '';
    busy.value = false; refreshing.value = false; refreshQueued = false; clearTimeout(refreshTimer);
    comment.value = ''; travelRecommendations.value = null;
    Object.assign(form, { title: 'Meet before the concert', startsAt: '', endsAt: '' });
    Object.assign(place, { label: '', latitude: 1.3, longitude: 103.85, sheltered: true });
    Object.assign(position, { latitude: 1.3, longitude: 103.85, label: '', travelMode: 'transit' });
    travelOptions.shelteredOnly = false;
    weather.value = null;
    rainfall.value = null;
    transport.value = null;
    loading.value = true;
    const key = context();
    if (!currentUser.value) { loading.value = false; return; }
    try {
      await load();
    } catch (e) {
      if (context() === key) error.value = e.status === 404 ? "This meetup is unavailable, or you are no longer a participant." : "Could not load your meetup plans. Please try again.";
    } finally {
      if (alive && context() === key) loading.value = false;
    }
  },
  { immediate: true },
);
async function refreshPlanner() {
  if (!alive || !currentUser.value || document.visibilityState !== 'visible') return;
  if (busy.value || refreshing.value) { refreshQueued = true; return; }
  const key = context();
  refreshing.value = true;
  try { await load({ preserveDrafts: true }); }
  catch (e) {
    if (context() !== key) return;
    if ([401, 403, 404].includes(e.status)) {
      board.value = null; slots.value = {}; savedSlots.value = '[]';
      error.value = 'This meetup is unavailable, or you are no longer a participant.';
    } else syncNote.value = 'Live refresh paused. Your draft is safe; use Refresh planner to retry.';
  } finally {
    if (context() === key) {
      refreshing.value = false;
      if (refreshQueued && !busy.value) scheduleRefresh();
    }
  }
}
function scheduleRefresh() {
  refreshQueued = true;
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    if (busy.value || refreshing.value) return;
    refreshQueued = false;
    void refreshPlanner();
  }, 150);
}
function showStep(id) { document.getElementById(id)?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }); }
onMounted(() => {
  stopEvents = onChatEvent((type, data) => {
    if (type === 'ready' || ['group-members', 'connection-members'].includes(type)
      || (type === 'meetup-updated' && (!props.id || data.meetupId === props.id))) scheduleRefresh();
  });
  window.addEventListener('focus', scheduleRefresh);
  document.addEventListener('visibilitychange', scheduleRefresh);
  // Reconcile missed events and separate server processes without provider calls.
  pollTimer = setInterval(scheduleRefresh, 15000);
});
onUnmounted(() => {
  alive = false; loadRequest++; stopEvents?.(); clearTimeout(refreshTimer); clearInterval(pollTimer);
  window.removeEventListener('focus', scheduleRefresh);
  document.removeEventListener('visibilitychange', scheduleRefresh);
});
async function act(fn, { savingAvailability = false } = {}) {
  if (busy.value) return;
  const key = context();
  busy.value = true;
  error.value = "";
  notice.value = "";
  try {
    await fn();
    if (!alive || context() !== key) return;
    await load({ preserveDrafts: !savingAvailability });
    if (context() !== key) return;
    notice.value = "Meetup updated.";
  } catch (e) {
    if (!alive || context() !== key) return;
    error.value = ({
      invalid_meetup_window: "Choose a window between 30 minutes and 7 days, starting and ending on a half-hour.",
      stale_meetup_version: "This plan has changed. Your draft is kept; review the refreshed plan and try again.",
      scope_membership_required: "Only members of this group or conversation can create its meetup.",
      meetup_cancelled: "This meetup has been cancelled and can no longer be changed.",
      invalid_place: "Enter a place name and valid latitude and longitude.",
      invalid_availability: "Check your selected times and location coordinates before saving.",
    })[e.message] ?? "Could not update this meetup. Please try again.";
    if (e.message === 'stale_meetup_version') await refreshPlannerAfterConflict();
  } finally {
    if (context() === key) {
      busy.value = false;
      if (refreshQueued) scheduleRefresh();
    }
  }
}
async function discardAvailability() {
  if (busy.value) return;
  const key = context(); busy.value = true;
  try { await load(); }
  catch { if (context() === key) error.value = 'Could not reload your saved availability. Please try again.'; }
  finally { if (context() === key) busy.value = false; }
}
async function refreshPlannerAfterConflict() {
  try { await load({ preserveDrafts: true }); }
  catch { /* Keep the original conflict and the draft available for retry. */ }
}
async function create() {
  await act(async () => {
    const scope = {};
    for (const k of ["partyId", "connectionId", "kakiConversationId"])
      if (typeof route.query[k] === "string") scope[k] = route.query[k];
    const r = await api.createMeetup({
      ...form,
      ...scope,
      startsAt: new Date(`${form.startsAt}+08:00`).toISOString(),
      endsAt: new Date(`${form.endsAt}+08:00`).toISOString(),
    });
    await router.push(`/meetups/${r.meetup.id}`);
  });
}
async function saveAvailability() {
  await act(() =>
    api.meetupAvailability(
      props.id,
      Object.entries(slots.value)
        .filter(([, s]) => s.selected)
        .map(([start, s]) => ({
          startsAt: iso(Number(start)),
          endsAt: iso(Number(start) + 1800000),
          travelMode: s.travelMode ?? 'transit',
          ...(s.latitude !== null && s.longitude !== null
            ? { latitude: s.latitude, longitude: s.longitude, label: s.label }
            : {}),
        })),
      board.value.version,
    ),
    { savingAvailability: true },
  );
}
function assignLocation() {
  for (const slot of Object.values(slots.value))
    if (slot.selected)
      Object.assign(slot, {
        latitude: position.latitude,
        longitude: position.longitude,
        label: position.label,
      });
}
function assignTravelMode() {
  for (const slot of Object.values(slots.value))
    if (slot.selected) slot.travelMode = position.travelMode;
}
async function getWeather() {
  if (busy.value) return;
  const key = context(), version = board.value?.version, id = props.id;
  busy.value = true;
  error.value = "";
  try {
    const { environment } = await api.meetupEnvironment(id);
    if (!alive || context() !== key || board.value?.version !== version) return;
    weather.value = environment.forecast;
    rainfall.value = environment.rainfall;
  } catch (e) {
    if (alive && context() === key && board.value?.version === version) error.value = "Could not load the weather forecast. Please try again.";
  } finally {
    if (context() === key) { busy.value = false; if (refreshQueued) scheduleRefresh(); }
  }
}
async function getTravelSuggestions() {
  if (busy.value) return;
  const key = context(), version = board.value?.version, id = props.id;
  busy.value = true; error.value = '';
  try {
    const data = await api.meetupTravelSuggestions(id, { ...travelOptions });
    if (alive && context() === key && board.value?.version === version) travelRecommendations.value = data.recommendations;
  }
  catch { if (alive && context() === key && board.value?.version === version) error.value = 'Could not refresh travel options. Reload the plan if it has changed.'; }
  finally { if (context() === key) { busy.value = false; if (refreshQueued) scheduleRefresh(); } }
}
async function getParking() {
  if (busy.value) return;
  const key = context(), version = board.value?.version, id = props.id;
  busy.value = true; error.value = '';
  try {
    const data = await api.meetupTransport(id, { parkingOnly: 'true' });
    if (alive && context() === key && board.value?.version === version) transport.value = data.transport;
  }
  catch { if (alive && context() === key && board.value?.version === version) error.value = 'Could not check nearby parking. Please try again.'; }
  finally { if (context() === key) { busy.value = false; if (refreshQueued) scheduleRefresh(); } }
}
</script>
<template>
  <div class="container groups-page">
    <BackLink fallback="/groups/connect" fallback-label="Back to My groups" />
    <header class="page-banner">
      <h1>{{ board?.title ?? "Meetup planning" }}</h1>
      <p>Find a time together, compare places and agree on the plan.</p>
    </header>
    <nav v-if="id" class="group-actions">
      <button type="button" class="btn btn--ghost" @click="router.push('/meetups')">All meetup plans</button>
      <button type="button" class="btn btn--ghost" :disabled="refreshing || busy" @click="refreshPlanner">Refresh planner</button>
      <span class="meetup-live" role="status"><span aria-hidden="true"></span>{{ liveLabel }}{{ refreshing ? ' · Updating…' : '' }}</span>
    </nav>
    <p v-if="error" class="group-error" role="alert">{{ error }}</p>
    <p v-if="notice" class="group-success" role="status">{{ notice }}</p>
    <p v-if="busy" class="loading-state" role="status"><LoadingSpinner />Updating your meetup plan…</p>
    <p v-if="loading" class="loading-state" role="status"><LoadingSpinner />Loading meetup plans…</p>
    <template v-else-if="!id"
      ><p>
        Plan a meetup with your group or a mutual companion match.
      </p>
      <form
        v-if="
          route.query.partyId ||
          route.query.connectionId ||
          route.query.kakiConversationId
        "
        class="card group-panel"
        @submit.prevent="create"
      >
        <h2>Create a meetup plan</h2>
        <p>Choose a 30-minute to 7-day window, using half-hour increments. Your companions can then share their availability.</p>
        <label
          >Title<input v-model="form.title" maxlength="120" required /></label
        ><label
          >First possible meeting time (Singapore time)<input
            v-model="form.startsAt"
            type="datetime-local"
            step="1800"
            required /></label
        ><label
          >End of availability window (Singapore time)<input
            v-model="form.endsAt"
            type="datetime-local"
            step="1800"
            required /></label
        ><button class="btn btn--primary" :disabled="busy">
          Create planning board
        </button>
      </form>
      <div class="group-grid"><article v-for="m in boards" :key="m.id" class="card group-panel"><h2>{{ m.title }}</h2><p class="group-muted">{{ statuses[m.status] ?? "Plan updated" }}</p><button type="button" class="btn btn--primary" @click="router.push(`/meetups/${m.id}`)">Open planner</button></article></div>
      <p v-if="!boards.length && !error">No meetup plans yet. Start a plan from your group or an active companion conversation.</p>
      </template>
    <template v-else-if="board"
      ><p>
        {{ board.participantCount }} participants — {{ statuses[board.status] ?? "Plan updated" }}
      </p>
      <button
        v-if="
          board.status !== 'cancelled' &&
          (board.creator_id === currentUser?.id ||
            board.requiredApprovers.includes(currentUser?.id))
        "
        class="btn btn--danger"
        :disabled="busy"
        @click="act(() => api.cancelMeetup(id, board.version))"
      >
        Cancel meetup
      </button>
      <nav class="meetup-steps" aria-label="Meeting planning steps">
        <button type="button" @click="showStep('meetup-availability')"><span>1</span><strong>Find a time</strong><small>Paint your availability</small></button>
        <button type="button" @click="showStep('meetup-places')"><span>2</span><strong>Choose a place</strong><small>Compare everyone's journey</small></button>
        <button type="button" @click="showStep('meetup-review')"><span>3</span><strong>Agree on the plan</strong><small>Propose, discuss and approve</small></button>
      </nav>
      <p v-if="syncNote" class="group-muted" role="status">{{ syncNote }}</p>
      <section id="meetup-availability" class="card group-panel meetup-availability">
        <h2>When are you available?</h2>
        <p>Share when you’re free, then add your starting place below. Your starting locations stay private.</p>
        <div class="meetup-availability__summary"><strong>{{ selectedSlotCount }} half-hour {{ selectedSlotCount === 1 ? 'block' : 'blocks' }} selected</strong><span :class="{ 'meetup-unsaved': availabilityDirty }">{{ availabilityDirty ? 'Unsaved changes' : 'Your saved availability' }}</span></div>
        <MeetupAvailabilityGrid :grid="board.grid" :participant-count="board.participantCount" v-model:selected="selectedTimes" :disabled="busy || board.status === 'cancelled'" />
        <p class="group-muted">Each participant chooses their own travel method. We can compare car and public transport journeys together.</p>
        <fieldset class="meetup-travel-fields" :disabled="busy || board.status === 'cancelled'">
        <legend>Where will you be travelling from?</legend>
        <div class="group-controls">
          <label>Travel method for selected times<select v-model="position.travelMode"><option value="transit">Public transport</option><option value="drive">Car</option></select></label>
          <button type="button" class="btn btn--ghost" :disabled="busy || !selectedSlotCount" @click="assignTravelMode">Apply travel method to selected times</button>
        </div>
        <div class="group-controls">
          <label
            >Location label<input
              v-model="position.label"
              placeholder="e.g. nearby MRT station" /></label
          ><label
            >Latitude<input
              v-model.number="position.latitude"
              type="number"
              min="-90"
              max="90"
              step="any" /></label
          ><label
            >Longitude<input
              v-model.number="position.longitude"
              type="number"
              min="-180"
              max="180"
              step="any"
          /></label>
        </div>
        <MeetupLocationSearch :meetup-id="id" label="Find your approximate starting place" @selected="location => Object.assign(position, location)" />
        <button class="btn btn--ghost" :disabled="busy || !selectedSlotCount" @click="assignLocation">
          Apply this location to selected times
        </button>
        <p>
          Starting locations are optional. Use an approximate public place;
          adjust individual time periods below if your location or travel method changes. Save your selected availability to share these choices with the planner.
        </p>
        <details>
          <summary>Different locations or travel methods during the day</summary>
          <template v-for="s in board.grid" :key="s.startsAt"
            ><div v-if="slots[s.startsAt].selected" class="group-controls">
              <span>{{ time(s.startsAt) }}</span
              ><label>Travel method<select v-model="slots[s.startsAt].travelMode"><option value="transit">Public transport</option><option value="drive">Car</option></select></label><label>Location label<input v-model="slots[s.startsAt].label" maxlength="150" placeholder="Approximate public place" /></label><label
                >Latitude<input
                  v-model.number="slots[s.startsAt].latitude"
                  type="number"
                  min="-90"
                  max="90"
                  step="any" /></label
              ><label
                >Longitude<input
                  v-model.number="slots[s.startsAt].longitude"
                  type="number"
                  min="-180"
                  max="180"
                  step="any"
              /></label></div
          ></template>
        </details>
        </fieldset>
        <div class="group-actions">
        <button
          class="btn btn--primary"
          :disabled="busy || board.status === 'cancelled'"
          @click="saveAvailability"
        >
          Save selected availability
        </button>
        <button v-if="availabilityDirty" type="button" class="btn btn--ghost" :disabled="busy" @click="discardAvailability">Discard my changes</button>
        </div>
      </section>
      <form
        id="meetup-places" class="card group-panel"
        @submit.prevent="act(() => api.proposeMeetupPlace(id, place))"
      >
        <h2>Suggest a meeting place</h2>
        <fieldset class="meetup-travel-fields" :disabled="busy || board.status === 'cancelled'">
        <MeetupLocationSearch :meetup-id="id" @selected="location => Object.assign(place, { label: location.label, latitude: location.latitude, longitude: location.longitude })" />
        <label
          >Place name<input v-model="place.label" required maxlength="150"
        /></label>
        <div class="group-controls">
          <label
            >Latitude<input
              v-model.number="place.latitude"
              type="number"
              min="-90"
              max="90"
              step="any"
              required /></label
          ><label
            >Longitude<input
              v-model.number="place.longitude"
              type="number"
              min="-180"
              max="180"
              step="any"
              required
          /></label>
        </div>
        <label class="group-check"
          ><input v-model="place.sheltered" type="checkbox" />Sheltered
          place</label
        ><button class="btn btn--primary" :disabled="busy">Add place</button>
        </fieldset>
      </form>
      <section id="meetup-review" class="card group-panel">
        <h2>Recommended options</h2>
        <p class="group-muted">Options consider how many people are available, then compare journeys using each person's saved travel method.</p>
        <div class="group-controls">
          <label class="group-check"><input v-model="travelOptions.shelteredOnly" type="checkbox" />Only places marked sheltered</label>
        </div>
        <button class="btn btn--ghost" :disabled="busy || board.status === 'cancelled'" @click="getTravelSuggestions">Compare travel options</button>
        <p v-if="travelRecommendations" class="group-muted" role="status">{{ travelRecommendations.message }}</p>
        <p v-if="!board.suggestions.length">No meeting options yet. Add a public meeting place and ask participants to save their availability.</p>
        <article
          v-for="s in (travelRecommendations?.options ?? board.suggestions)"
          :key="`${s.placeId}:${s.startsAt}`"
        >
          <p>
            {{ s.label }}, {{ time(s.startsAt) }}, {{ s.availableCount }}/{{
              s.participantCount
            }}
            available, {{ s.totalDistanceKm === null ? 'distance unavailable' : `${s.totalDistanceKm} km combined distance` }}
            ({{ s.locationRespondents }} locations supplied)
          </p>
          <p v-if="s.travelModes" class="group-muted">Travel methods: {{ s.travelModes.transit }} by public transport · {{ s.travelModes.drive }} by car.</p>
          <p v-if="s.totalTravelMinutes !== null && s.totalTravelMinutes !== undefined" class="group-muted">{{ s.totalTravelMinutes }} minutes combined journey time; longest journey {{ s.maximumTravelMinutes }} minutes.</p>
          <p v-if="s.basis === 'straight_line_distance'" class="group-muted">Straight-line distance estimate. Fresh route times are unavailable for this option.</p>
          <div class="group-actions">
            <button
              class="btn btn--ghost"
              :disabled="busy"
              @click="act(() => api.voteMeetupPlace(id, s.placeId))"
            >
              Vote for place</button
            ><button
              class="btn btn--primary"
              :disabled="busy"
              @click="
                act(() =>
                  api.proposeMeetupPlan(id, {
                    placeId: s.placeId,
                    startsAt: iso(s.startsAt),
                    version: board.version,
                  }),
                )
              "
            >
              Propose this time &amp; place
            </button>
          </div>
        </article>
      </section>
      <section v-if="board.selected_place_id" class="card group-panel">
        <h2>Current proposal</h2>
        <p>
          {{
            board.places.find((p) => p.id === board.selected_place_id)?.label
          }}, {{ time(board.selected_start) }}
        </p>
        <p>
          Approvals: {{ board.approvals.length }}/{{
            board.requiredApprovers.length
          }}
        </p>
        <button
          v-if="
            board.status === 'proposed' &&
            board.requiredApprovers.includes(currentUser?.id)
          "
          class="btn btn--success"
          :disabled="busy"
          @click="act(() => api.approveMeetup(id, board.version))"
        >
          Approve plan</button
        ><button class="btn btn--ghost" :disabled="busy" @click="getWeather">
          Check weather and recent rainfall
        </button>
        <p v-if="weather">{{ weather.message ?? 'Weather is unavailable right now.' }}</p>
        <p v-if="weather?.stale" class="group-muted">This is a cached forecast; check again before travelling.</p>
        <p v-if="rainfall?.status === 'available'" class="group-muted">Recent rainfall: {{ rainfall.millimetres }} mm at {{ rainfall.station }}, {{ rainfall.distanceKm }} km from the meeting place ({{ time(Date.parse(rainfall.observedAt)) }}). This is an observation, not a forecast.</p>
        <div class="meetup-parking">
          <h3>Driving to the meetup?</h3>
          <p class="group-muted">Check nearby car parks around the proposed meeting place. Available lots describe conditions now and may change before your meetup.</p>
          <button type="button" class="btn btn--ghost" :disabled="busy" @click="getParking">Check nearby parking</button>
          <template v-if="transport?.parking">
            <p v-if="transport.parking.status !== 'available'">Parking information is unavailable right now. Please try again later.</p>
            <template v-else>
              <p v-if="transport.parking.stale" class="group-muted">Showing saved parking availability. Refresh before travelling.</p>
              <p v-if="transport.parking.coverage === 'bounded_snapshot'" class="group-muted">Showing a limited set of reporting car parks; other parking may be available.</p>
              <p v-if="!transport.parking.carparks.length">No reported car parks within {{ transport.parking.radiusKm }} km of this meeting place.</p>
              <ul v-else class="meetup-parking__list">
                <li v-for="carpark in transport.parking.carparks" :key="carpark.id"><strong>{{ carpark.name }}</strong><span>Approx. {{ carpark.distanceKm }} km away · {{ carpark.availableLots }} {{ carpark.availableLots === 1 ? 'car lot' : 'car lots' }} available</span></li>
              </ul>
            </template>
          </template>
        </div>
      </section>
      <MeetupTransportPanel :key="`${id}:${currentUser?.id}`" :meetup-id="id" :concert="board.concert" :plan-version="board.version" :has-meeting-place="Boolean(board.selected_place_id)" />
      <section class="card group-panel">
        <h2>Discuss and revise</h2>
        <p>
          Changes to the plan require fresh approvals.
        </p>
        <p v-if="!board.comments.length">No discussion yet. Share a suggestion with the other participants.</p>
        <p v-for="c in board.comments" :key="c.id">
          <strong>{{ c.name }}:</strong> {{ c.body }}
        </p>
        <form
          @submit.prevent="
            act(async () => {
              await api.meetupComment(id, comment);
              comment = '';
            })
          "
        class="group-panel">
          <label
            >Message<textarea
              v-model="comment"
              :disabled="busy || board.status === 'cancelled'"
              maxlength="2000"
              required
            /></label
          ><button class="btn btn--primary" :disabled="busy">Post</button>
        </form>
      </section></template
    >
  </div>
</template>
<style scoped>
.meetup-live { display: inline-flex; align-items: center; gap: .5rem; color: var(--text-300); font-size: var(--step--1); }
.meetup-live > span { width: .5rem; height: .5rem; border-radius: 50%; background: var(--mint-400); }
.meetup-steps { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--space-3); margin-block: var(--space-4); }
.meetup-steps button { display: grid; grid-template-columns: auto 1fr; gap: .2rem .7rem; align-items: center; text-align: left; padding: var(--space-4); border: var(--border-soft); border-radius: var(--radius-md); background: var(--ink-800); color: var(--text-100); cursor: pointer; }
.meetup-steps button > span { grid-row: span 2; display: grid; place-items: center; width: 1.8rem; height: 1.8rem; border: 1px solid var(--mint-400); border-radius: 50%; color: var(--mint-400); }
.meetup-steps small { color: var(--text-300); }
.meetup-availability__summary { display: flex; flex-wrap: wrap; justify-content: space-between; gap: .5rem; margin-block: var(--space-4); color: var(--text-300); }
.meetup-unsaved { color: var(--accent-400); }
.meetup-travel-fields { display: block; border: 0; margin: var(--space-4) 0; padding: 0; min-width: 0; width: 100%; }
.meetup-travel-fields legend { font-weight: 600; padding-bottom: var(--space-3); }
#meetup-availability, #meetup-places, #meetup-review { scroll-margin-top: 6rem; }
@media (max-width: 620px) { .meetup-steps { grid-template-columns: 1fr; } .meetup-steps small { display: none; } .meetup-steps button > span { grid-row: auto; } }
.meetup-parking { display: grid; justify-items: start; gap: var(--space-3); padding-top: var(--space-4); margin-top: var(--space-3); border-top: var(--border-hairline); }
.meetup-parking h3 { font-size: var(--step-1); }
.meetup-parking__list { display: grid; gap: var(--space-3); width: 100%; padding: 0; list-style: none; }
.meetup-parking__list li { display: grid; gap: var(--space-1); padding: var(--space-3); background: var(--ink-750); border-radius: var(--radius-sm); }
.meetup-parking__list span { color: var(--text-300); font-size: var(--step--1); }
</style>
