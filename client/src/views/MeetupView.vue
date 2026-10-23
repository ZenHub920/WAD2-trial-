<script setup>
import { reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api } from "../api.js";
import { currentUser } from "../auth.js";
import LoadingSpinner from "../components/LoadingSpinner.vue";
import BackLink from "../components/BackLink.vue";
import MeetupLocationSearch from "../components/MeetupLocationSearch.vue";
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
const position = reactive({ latitude: 1.3, longitude: 103.85, label: "" });
const travelOptions = reactive({ mode: 'transit', maxTravelMinutes: 60, shelteredOnly: false });
const transportOptions = reactive({ busStopCode: '', trainLine: '' });
const statuses = { planning: "Collecting availability", proposed: "Awaiting required approvals", confirmed: "Meetup confirmed", cancelled: "Meetup cancelled" };
const iso = (ms) => new Date(ms).toISOString();
const time = (ms) =>
  new Date(ms).toLocaleString("en-SG", {
    dateStyle: "medium",
    timeStyle: "short",
  });
async function load() {
  if (props.id) {
    const data = (await api.meetup(props.id)).meetup;
    board.value = data;
    travelRecommendations.value = null;
    slots.value = Object.fromEntries(
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
          },
        ];
      }),
    );
  } else boards.value = (await api.meetups()).meetups;
}
watch(
  () => props.id,
  async () => {
    error.value = "";
    notice.value = "";
    board.value = null;
    weather.value = null;
    rainfall.value = null;
    transport.value = null;
    loading.value = true;
    try {
      await load();
    } catch (e) {
      error.value = e.status === 404 ? "This meetup is unavailable, or you are no longer a participant." : "Could not load your meetup plans. Please try again.";
    } finally {
      loading.value = false;
    }
  },
  { immediate: true },
);
async function act(fn) {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  notice.value = "";
  try {
    await fn();
    await load();
    notice.value = "Meetup updated.";
  } catch (e) {
    error.value = ({
      invalid_meetup_window: "Choose a window between 30 minutes and 7 days, starting and ending on a half-hour.",
      stale_meetup_version: "This plan has changed. Reload it before proposing or approving a plan.",
      scope_membership_required: "Only members of this group or conversation can create its meetup.",
      meetup_cancelled: "This meetup has been cancelled and can no longer be changed.",
      invalid_place: "Enter a place name and valid latitude and longitude.",
      invalid_availability: "Check your selected times and location coordinates before saving.",
    })[e.message] ?? "Could not update this meetup. Please try again.";
  } finally {
    busy.value = false;
  }
}
async function create() {
  await act(async () => {
    const scope = {};
    for (const k of ["partyId", "connectionId", "kakiConversationId"])
      if (typeof route.query[k] === "string") scope[k] = route.query[k];
    const r = await api.createMeetup({
      ...form,
      ...scope,
      startsAt: new Date(form.startsAt).toISOString(),
      endsAt: new Date(form.endsAt).toISOString(),
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
          ...(s.latitude !== null && s.longitude !== null
            ? { latitude: s.latitude, longitude: s.longitude, label: s.label }
            : {}),
        })),
    ),
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
async function getWeather() {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    const { environment } = await api.meetupEnvironment(props.id);
    weather.value = environment.forecast;
    rainfall.value = environment.rainfall;
  } catch (e) {
    error.value = "Could not load the weather forecast. Please try again.";
  } finally {
    busy.value = false;
  }
}
async function getTravelSuggestions() {
  if (busy.value) return;
  busy.value = true; error.value = '';
  try { travelRecommendations.value = (await api.meetupTravelSuggestions(props.id, travelOptions)).recommendations; }
  catch { error.value = 'Could not refresh travel options. Reload the plan if it has changed.'; }
  finally { busy.value = false; }
}
async function getTransport() {
  if (busy.value) return;
  busy.value = true; error.value = '';
  try { transport.value = (await api.meetupTransport(props.id, Object.fromEntries(Object.entries(transportOptions).filter(([, value]) => value)))).transport; }
  catch { error.value = 'Could not check transport. Use a five-digit bus stop code, or choose a train line.'; }
  finally { busy.value = false; }
}
</script>
<template>
  <div class="container groups-page">
    <BackLink fallback="/groups/connect" fallback-label="Back to My groups" />
    <h1>{{ board?.title ?? "Meetup planning" }}</h1>
    <nav v-if="id" class="group-actions">
      <RouterLink to="/meetups">All meetup plans</RouterLink>
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
          >First possible meeting time<input
            v-model="form.startsAt"
            type="datetime-local"
            step="1800"
            required /></label
        ><label
          >End of availability window<input
            v-model="form.endsAt"
            type="datetime-local"
            step="1800"
            required /></label
        ><button class="btn btn--primary" :disabled="busy">
          Create planning board
        </button>
      </form>
      <div class="group-grid"><RouterLink v-for="m in boards" :key="m.id" :to="`/meetups/${m.id}`" class="card group-panel">{{ m.title }}<span class="group-muted">{{ statuses[m.status] ?? "Plan updated" }}</span></RouterLink></div>
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
      <section class="card group-panel">
        <h2>When are you available?</h2>
        <p>
          Select 30-minute time periods. Your starting locations stay private.
        </p>
        <div class="group-controls">
          <label v-for="s in board.grid" :key="s.startsAt" class="group-check"
            ><input v-model="slots[s.startsAt].selected" type="checkbox" />{{
              time(s.startsAt)
            }}, {{ s.availableCount }}/{{
              board.participantCount
            }}
            available</label
          >
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
        <button class="btn btn--ghost" @click="assignLocation">
          Apply this location to selected times
        </button>
        <p>
          Starting locations are optional. Use an approximate public place;
          adjust individual time periods below if your location changes.
        </p>
        <details>
          <summary>Different locations during the day</summary>
          <template v-for="s in board.grid" :key="s.startsAt"
            ><div v-if="slots[s.startsAt].selected" class="group-controls">
              <span>{{ time(s.startsAt) }}</span
              ><label
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
        <button
          class="btn btn--primary"
          :disabled="busy"
          @click="saveAvailability"
        >
          Save selected availability
        </button>
      </section>
      <form
        class="card group-panel"
        @submit.prevent="act(() => api.proposeMeetupPlace(id, place))"
      >
        <h2>Suggest a meeting place</h2>
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
      </form>
      <section class="card group-panel">
        <h2>Recommended options</h2>
        <div class="group-controls">
          <label>Travel by<select v-model="travelOptions.mode"><option value="transit">Public transport</option><option value="walk">Walking</option></select></label>
          <label>Journey budget (minutes)<input v-model.number="travelOptions.maxTravelMinutes" type="number" min="5" max="180" /></label>
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
          <p v-if="s.totalTravelMinutes !== null && s.totalTravelMinutes !== undefined" class="group-muted">{{ s.totalTravelMinutes }} minutes combined journey time; longest journey {{ s.maximumTravelMinutes }} minutes. {{ s.reachableCount }}/{{ s.locationRespondents }} supplied locations within your journey budget.</p>
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
      </section>
      <section class="card group-panel">
        <h2>Getting there today</h2>
        <p>Check current train advisories, station crowds and bus arrivals. These describe travel now; they do not predict conditions on the concert date.</p>
        <div class="group-controls">
          <label>Bus stop code (optional)<input v-model="transportOptions.busStopCode" maxlength="5" inputmode="numeric" placeholder="e.g. 83139" /></label>
          <label>Station crowds (optional)<select v-model="transportOptions.trainLine"><option value="">Choose a line</option><option v-for="line in ['CCL','CEL','CGL','DTL','EWL','NEL','NSL','TEL']" :key="line">{{ line }}</option></select></label>
        </div>
        <button class="btn btn--ghost" :disabled="busy" @click="getTransport">Check LTA transport updates</button>
        <template v-if="transport">
          <p v-if="transport.trains.status !== 'available'">Train updates are unavailable. Try again later.</p>
          <template v-else><p>{{ transport.trains.serviceStatus === 'normal' ? 'LTA reports normal train service.' : 'LTA reports a train service disruption.' }}<span v-if="transport.trains.stale"> Saved update; check again before travelling.</span></p><p v-for="(message, index) in transport.trains.messages" :key="index">{{ message.content }}</p></template>
          <template v-if="transport.buses"><p v-if="transport.buses.status !== 'available'">Bus arrivals are unavailable for this stop.</p><template v-else><p v-if="!transport.buses.services.length">No bus services reported at this stop.</p><p v-if="transport.buses.stale">Showing saved bus arrivals; refresh before travelling.</p><p v-for="service in transport.buses.services" :key="service.service">Bus {{ service.service }}: {{ service.arrivals.length ? service.arrivals.map(a => `${time(Date.parse(a.estimatedArrival))}${a.wheelchairAccessible ? ' (wheelchair accessible)' : ''}`).join(', ') : 'No arrival time reported' }}</p></template></template>
          <template v-if="transport.crowding"><p v-if="transport.crowding.status !== 'available'">Station crowd information is unavailable.</p><details v-else><summary>Station crowd levels {{ transport.crowding.stale ? '(saved)' : '' }}</summary><p v-for="station in transport.crowding.stations" :key="station.station">{{ station.station }}: {{ station.level || 'Not reported' }} ({{ station.observedAt }})</p></details></template>
        </template>
        <small class="group-muted">Data: <a href="https://www.onemap.gov.sg/apidocs/" target="_blank" rel="noopener noreferrer">OneMap / Singapore Land Authority</a>, <a href="https://datamall.lta.gov.sg/" target="_blank" rel="noopener noreferrer">LTA DataMall</a>, and <a href="https://data.gov.sg/datasets/d_f131f6e343bf8168e4057a04c4326a0a/view" target="_blank" rel="noopener noreferrer">NEA via data.gov.sg</a>. Shelter status is suggested by participants.</small>
      </section>
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
              maxlength="2000"
              required
            /></label
          ><button class="btn btn--primary" :disabled="busy">Post</button>
        </form>
      </section></template
    >
  </div>
</template>
