<script setup>
import { reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api } from "../api.js";
import { currentUser } from "../auth.js";
import LoadingSpinner from "../components/LoadingSpinner.vue";
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
    weather.value = (await api.meetupWeather(props.id)).weather;
  } catch (e) {
    error.value = "Could not load the weather forecast. Please try again.";
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <div class="container groups-page">
    <h1>{{ board?.title ?? "Meetup planning" }}</h1>
    <nav class="group-actions">
      <RouterLink v-if="id" to="/meetups">All meetup plans</RouterLink>
      <RouterLink to="/groups/connect">My groups</RouterLink>
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
        class="btn btn--ghost"
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
        <p v-if="!board.suggestions.length">No meeting options yet. Add a public meeting place and ask participants to save their availability.</p>
        <article
          v-for="s in board.suggestions"
          :key="`${s.placeId}:${s.startsAt}`"
        >
          <p>
            {{ s.label }}, {{ time(s.startsAt) }}, {{ s.availableCount }}/{{
              s.participantCount
            }}
            available, {{ s.totalDistanceKm === null ? 'distance unavailable' : `${s.totalDistanceKm} km combined distance` }}
            ({{ s.locationRespondents }} locations supplied)
          </p>
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
          class="btn btn--primary"
          :disabled="busy"
          @click="act(() => api.approveMeetup(id, board.version))"
        >
          Approve plan</button
        ><button class="btn btn--ghost" :disabled="busy" @click="getWeather">
          Check short-range weather
        </button>
        <p v-if="weather">{{ weather.message ?? 'Weather is unavailable right now.' }}</p>
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
