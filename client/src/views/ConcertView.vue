<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { api, LABELS, SECTION_OPTIONS, ARRIVAL_OPTIONS, formatDate } from '../api.js';
import { currentUser, sessionReady } from '../auth.js';
import { formatMoney } from '../market.js';
import '../assets/groups.css';
import MatchProposalCard from '../components/MatchProposalCard.vue';
import LoadingSpinner from '../components/LoadingSpinner.vue';
import BackLink from '../components/BackLink.vue';
import ArtistWaveBackdrop from '../components/market/ArtistWaveBackdrop.vue';
import SetlistReel from '../components/market/SetlistReel.vue';
import SetlistEditor from '../components/market/SetlistEditor.vue';
import { useConcertEligibility } from '../composables/useConcertEligibility.js';

const props = defineProps({ id: { type: String, required: true } });

const concert = ref(null);
const { canCoordinate, isFinished, refreshEligibility } = useConcertEligibility(() => concert.value?.concert);
let alive = true, concertRequest = 0;
// Ticketmaster image URLs occasionally 404; the cover then falls back to a gradient.
const coverBroken = ref(false);
const coverImage = computed(() => (!coverBroken.value && concert.value?.concert?.hero_image_url) || null);
const parties = ref([]);
const requests = ref([]);
const loading = ref(true);
const error = ref(null);
const matchingError = ref('');
const setlist = ref(null);

/**
 * The concert's colour theme, as CSS variables for the whole page.
 *
 * Only the hue varies: the server fixes lightness and saturation so a page
 * themed from a pale sleeve and one themed from a neon sleeve are equally
 * readable. Absent while loading, which simply leaves the defaults in place.
 */
const paletteVars = computed(() => {
  const palette = concert.value?.palette;
  if (!palette) return {};
  return {
    '--art-accent': palette.accent,
    '--art-muted': palette.muted,
    '--art-surface': palette.surface,
    '--art-surface-end': palette.surfaceEnd,
  };
});
const participation = ref(null);
const participationLoading = ref(false);
const participationBusy = ref(false);
const participationError = ref('');
// Companion cards show each person's face, so joining needs a profile picture.
const needsPicture = computed(() => Boolean(currentUser.value) && !currentUser.value.avatarUrl);
const participationLoadError = ref(false);
const participationRetry = ref(0);
const participationNeedsSignIn = ref(false);
const sectionPref = ref('category_1');
const arrivalPref = ref('doors');
let participationRequest = 0;
const myProposals = ref([]);
const resultLoading = ref(false);
const resultError = ref(null);
const resultRetry = ref(0);
let resultRequest = 0;
const tickets = ref([]);
const ticketsLoading = ref(false);
const ticketsError = ref('');
let ticketRequest = 0;
const ticketCount = computed(() => tickets.value.reduce((sum, listing) => sum + listing.quantity, 0));
const ticketFromCents = computed(() => Math.min(...tickets.value.map(listing => listing.priceCents)));
async function loadTickets() {
  const requestId = ++ticketRequest;
  ticketsLoading.value = true;
  ticketsError.value = '';
  tickets.value = [];
  try {
    const response = await api.tickets();
    if (requestId === ticketRequest) tickets.value = response.listings.filter(listing => listing.concert.id === props.id && listing.status === 'active');
  } catch {
    if (requestId === ticketRequest) ticketsError.value = 'Could not load tickets for this concert. Please try again.';
  } finally {
    if (requestId === ticketRequest) ticketsLoading.value = false;
  }
}
watch(() => props.id, loadTickets, { immediate: true });

function refreshMyProposals() {
  resultRetry.value++;
}

watch(
  [() => props.id, () => currentUser.value?.id, sessionReady, resultRetry],
  async ([concertId, userId, ready]) => {
    const requestId = ++resultRequest;
    myProposals.value = [];
    resultError.value = null;
    resultLoading.value = Boolean(ready && userId);
    if (!ready || !userId) return;

    try {
      const response = await api.myProposals();
      // Ignore stale responses after the concert, session or retry changes.
      if (requestId === resultRequest) {
        myProposals.value = response.proposals.filter(proposal => proposal.concertId === concertId);
      }
    } catch (err) {
      if (requestId === resultRequest) resultError.value = err;
    } finally {
      if (requestId === resultRequest) resultLoading.value = false;
    }
  },
  { immediate: true },
);

watch(
  [() => props.id, () => currentUser.value?.id, () => participationRetry.value],
  async ([concertId, userId]) => {
    const requestId = ++participationRequest;
    participationBusy.value = false;
    participation.value = null;
    participationError.value = '';
    participationLoadError.value = false;
    participationNeedsSignIn.value = false;
    sectionPref.value = 'category_1';
    arrivalPref.value = 'doors';
    participationLoading.value = Boolean(userId);
    if (!userId) return;
    try {
      const result = await api.participation(concertId);
      if (requestId !== participationRequest) return;
      participation.value = result.participation;
      if (result.participation) {
        sectionPref.value = result.participation.sectionPref;
        arrivalPref.value = result.participation.arrivalPref;
      }
    } catch (err) {
      if (requestId !== participationRequest) return;
      participationNeedsSignIn.value = err.status === 401;
      participationLoadError.value = err.status !== 401;
      participationError.value = err.status === 401
        ? 'Your session has expired. Sign in to join.'
        : 'Could not load your companion-finder preferences. Please try again.';
    } finally {
      if (requestId === participationRequest) participationLoading.value = false;
    }
  },
  { immediate: true },
);

async function saveParticipation() {
  if (participationBusy.value || participationLoading.value) return;
  refreshEligibility();
  if (!canCoordinate.value) { participationError.value = isFinished.value ? 'This concert has finished. Your existing participation and conversations remain available.' : 'A valid concert date is needed to join the companion finder.'; return; }
  if (needsPicture.value && !participation.value) return;
  const requestId = participationRequest;
  participationBusy.value = true;
  participationError.value = '';
  try {
    const result = await api.joinConcert(props.id, {
      sectionPref: sectionPref.value,
      arrivalPref: arrivalPref.value,
    });
    if (requestId === participationRequest) participation.value = result.participation;
  } catch (err) {
    if (requestId === participationRequest) {
      participationNeedsSignIn.value = err.status === 401;
      participationError.value = err.status === 401
        ? 'Your session has expired. Sign in to join.'
        : err.message === 'concert_finished' ? 'This concert has finished. Your existing participation and conversations remain available.'
          : err.message === 'profile_picture_required' ? 'Add a profile picture to join. Companion cards show your face.'
          : 'Could not save your companion-finder preferences. Please try again.';
      if (err.message === 'concert_finished') refreshEligibility();
    }
  } finally {
    if (requestId === participationRequest) participationBusy.value = false;
  }
}

async function leaveParticipation() {
  if (participationBusy.value || participationLoading.value || !participation.value) return;
  const requestId = participationRequest;
  participationBusy.value = true;
  participationError.value = '';
  try {
    await api.leaveConcert(props.id);
    if (requestId === participationRequest) participation.value = null;
  } catch (err) {
    if (requestId === participationRequest) {
      participationNeedsSignIn.value = err.status === 401;
      participationError.value = err.status === 401
        ? 'Your session has expired. Sign in to leave.'
        : 'Could not leave the companion finder. Please try again.';
    }
  } finally {
    if (requestId === participationRequest) participationBusy.value = false;
  }
}

async function load() {
  const requestId = ++concertRequest, id = props.id;
  const current = () => alive && requestId === concertRequest && props.id === id;
  loading.value = true;
  error.value = null;
  matchingError.value = '';
  parties.value = [];
  requests.value = [];
  concert.value = null; setlist.value = null; coverBroken.value = false;
  // Its own request, deliberately: a setlist is an extra, so a failure here
  // must never take the concert page down with it.
  api.concertSetlist(id)
    .then((result) => { if (current()) setlist.value = result.setlist; })
    .catch(() => { if (current()) setlist.value = null; });
  try {
    const [detail, matching] = await Promise.all([
      api.concert(id),
      Promise.all([api.parties(id), api.requests(id)]).catch(() => {
        if (current()) matchingError.value = 'Could not load group-matching availability. Ticket availability is still shown below.';
        return null;
      }),
    ]);
    if (!current()) return;
    concert.value = detail;
    if (matching) {
      parties.value = matching[0].parties;
      requests.value = matching[1].requests;
    }
  } catch (err) {
    if (current()) error.value = err;
  } finally {
    if (current()) loading.value = false;
  }
}

onMounted(load);
watch(() => props.id, load);
onUnmounted(() => { alive = false; concertRequest++; participationRequest++; resultRequest++; ticketRequest++; });

const totalPlaces = computed(() => parties.value.reduce((sum, party) => sum + party.capacity, 0));

const pendingProposals = computed(() => myProposals.value.filter(proposal => proposal.status === 'proposed'));
const confirmedProposals = computed(() => myProposals.value.filter(proposal => proposal.status === 'confirmed'));
const pastProposals = computed(() => myProposals.value.filter(proposal => !['proposed', 'confirmed'].includes(proposal.status)));
const visibleProposals = computed(() => [...pendingProposals.value, ...confirmedProposals.value]);
const needsReplyCount = computed(() => pendingProposals.value.filter(proposal =>
  proposal.canHostRespond !== false && proposal.queueStatus !== 'waiting'
  && !(proposal.role === 'host' ? proposal.hostApproved : proposal.seekerApproved)).length);
</script>

<template>
  <div class="container section concert-page" :style="paletteVars">
    <!-- Behind everything, and coloured by the palette vars set just above. -->
    <ArtistWaveBackdrop />

    <BackLink fallback="/concerts" fallback-label="Back to All concerts" />

    <p v-if="loading" class="loading-state" role="status"><LoadingSpinner />Loading concert details…</p>

    <div v-else-if="error" class="notice notice--error" role="alert">
      <h1>Could not load this concert</h1>
      <p>{{ error.status === 404 ? 'This concert is no longer available.' : 'Please try again.' }}</p>
      <button class="btn btn--ghost" @click="load">Try again</button>
    </div>

    <template v-else-if="concert">
      <!-- ------------------------------------------------------------ Head -->
      <header class="head">
        <div class="head__text">
          <div class="cover">
            <img v-if="coverImage" :src="coverImage" alt="" @error="coverBroken = true" />
            <span v-else class="cover__initial" aria-hidden="true">{{ concert.concert.artist.charAt(0) }}</span>
            <span class="cover__shade" aria-hidden="true" />
            <div class="cover__text">
              <p class="cover__date">{{ formatDate(concert.concert.event_date) }}</p>
              <h1>{{ concert.concert.artist }}</h1>
              <p v-if="concert.concert.tour_name" class="head__tour">
                {{ concert.concert.tour_name }}
              </p>
              <p class="head__venue">
                {{ concert.concert.venue }}, {{ concert.concert.city }}<template v-if="concert.concert.doors_time">, doors {{ concert.concert.doors_time }}</template>
              </p>
            </div>
          </div>
          <p v-if="concert.concert.blurb" class="head__blurb">{{ concert.concert.blurb }}</p>
        </div>

        <aside class="head__panel">
          <h2 class="head__panel-title">Group matching</h2>
          <p v-if="matchingError" class="group-error" role="alert">{{ matchingError }}</p>
          <dl v-else class="counts">
            <div>
              <dt>Groups</dt>
              <dd class="tabular key-figure">{{ parties.length }}</dd>
            </div>
            <div>
              <dt>Group places</dt>
              <dd class="tabular key-figure">{{ totalPlaces }}</dd>
            </div>
            <div>
              <dt>Active group finders</dt>
              <dd class="tabular key-figure">{{ requests.length }}</dd>
            </div>
          </dl>
          <p class="group-muted">Group places are not tickets. Seekers start automatic matching by pressing Find a match.</p>

          <RouterLink
            v-if="concert.latestRound && sessionReady && currentUser?.isOperator"
            :to="{ path: `/rounds/${concert.latestRound.id}`, query: { concertId: id } }"
            class="head__previous"
          >
            Last round: {{ concert.latestRound.matched }} matched
            <span :class="concert.latestRound.isStable ? 'ok' : 'bad'">
              {{ concert.latestRound.isStable ? ', verified stable' : ', UNSTABLE' }}
            </span>
          </RouterLink>
          <p v-else-if="concert.latestRound" class="head__previous">
            Last round: {{ concert.latestRound.matched }} matched
          </p>
        </aside>
      </header>

      <!-- Directly under group matching, as the running order for this show. -->
      <SetlistReel :artist="concert.concert.artist" :setlist="setlist" />
      <SetlistEditor
        v-if="sessionReady && currentUser?.isOperator"
        :concert-id="id"
        :setlist="setlist"
        @saved="setlist = $event"
      />

      <section class="my-result card" aria-labelledby="my-result-title">
        <header class="my-result__head">
          <div>
            <p class="my-result__eyebrow">Go together</p>
            <h2 id="my-result-title">Your automatic matches</h2>
            <p class="my-result__intro">Review your group offer, see who has approved, and follow its place in the queue.</p>
          </div>
          <button v-if="sessionReady && currentUser" type="button" class="btn btn--ghost" :disabled="resultLoading" @click="refreshMyProposals"><LoadingSpinner v-if="resultLoading" />Refresh status</button>
        </header>
        <p v-if="!sessionReady || resultLoading" class="loading-state" role="status"><LoadingSpinner />Loading your proposals…</p>
        <p v-else-if="!currentUser">
          <RouterLink to="/login">Sign in</RouterLink> to see your matching offers.
        </p>
        <div v-else-if="resultError" role="alert">
          <p>Could not load your current match proposals. Please try again.</p>
          <button type="button" class="btn btn--ghost" @click="refreshMyProposals">Try again</button>
        </div>
        <div v-else-if="!myProposals.length" class="my-result__empty">
          <h3>{{ canCoordinate ? 'No group offer yet' : 'No matching history' }}</h3>
          <p v-if="canCoordinate">Join the match list, then press Find a match to search. Any group offer is confirmed once <strong>you and the host</strong> both approve.</p>
          <p v-else>There are no previous group offers for this concert. Existing conversations and group history remain available.</p>
          <RouterLink v-if="canCoordinate" :to="{ path: '/groups', query: { concertId: id, mode: 'algorithm' } }" class="btn btn--primary">Find my group</RouterLink>
        </div>
        <template v-else>
          <p v-if="needsReplyCount" class="my-result__summary" role="status">{{ needsReplyCount === 1 ? 'One match is ready for your reply.' : `${needsReplyCount} matches are ready for your reply.` }}</p>
          <p v-else-if="pendingProposals.length" class="my-result__summary">{{ pendingProposals.length === 1 ? 'Your offer is pending.' : 'Your offers are pending.' }} Check the queue and approval progress below.</p>
          <MatchProposalCard
            v-for="proposal in visibleProposals"
            :key="proposal.id"
            :proposal="proposal"
            @updated="refreshMyProposals"
          />
          <details v-if="pastProposals.length" class="my-result__past">
            <summary>Previous proposals ({{ pastProposals.length }})</summary>
            <MatchProposalCard v-for="proposal in pastProposals" :key="proposal.id" :proposal="proposal" @updated="refreshMyProposals" />
          </details>
        </template>
      </section>

      <section class="kaki-join card" aria-labelledby="kaki-join-title">
        <div class="kaki-join__intro">
          <h2 id="kaki-join-title">Find a companion</h2>
          <p v-if="canCoordinate">Join this concert's companion finder. Messaging opens after a mutual like; this is separate from group matching.</p>
          <p v-else-if="isFinished">This concert has finished. Your previous participation and companion conversations are kept.</p>
        </div>
        <p v-if="!currentUser" class="kaki-join__state">
          <RouterLink :to="{ path: '/login', query: { redirect: $route.fullPath } }" class="btn btn--primary">Sign in to find companions</RouterLink>
        </p>
        <p v-else-if="participationLoading" class="kaki-join__state loading-state" role="status"><LoadingSpinner />Loading your participation…</p>
        <div v-else-if="participationNeedsSignIn" class="kaki-join__state">
          <p role="alert">{{ participationError }}</p>
          <RouterLink to="/login" class="btn btn--primary">Sign in</RouterLink>
        </div>
        <div v-else-if="participationLoadError" class="kaki-join__state">
          <p class="kaki-join__error" role="alert">{{ participationError }}</p>
          <button class="btn btn--ghost" type="button" @click="participationRetry++">Retry loading participation</button>
        </div>
        <form v-else class="kaki-join__form" @submit.prevent="saveParticipation">
          <p v-if="participation" class="kaki-join__joined" :class="canCoordinate ? 'group-success' : 'group-muted'">{{ canCoordinate ? 'You are in the companion finder for this concert.' : 'Your participation is saved as part of this concert’s history.' }}</p>
          <div class="kaki-join__fields">
            <label>
              Preferred section
              <select v-model="sectionPref" :disabled="participationBusy || !canCoordinate" required>
                <option v-if="!Object.hasOwn(SECTION_OPTIONS, sectionPref)" :value="sectionPref" disabled>Previously selected: {{ LABELS.section[sectionPref] ?? sectionPref }}</option>
                <option v-for="(label, value) in SECTION_OPTIONS" :key="value" :value="value">{{ label }}</option>
              </select>
            </label>
            <label>
              Arrival plan
              <select v-model="arrivalPref" :disabled="participationBusy || !canCoordinate" required>
                <option v-if="!Object.hasOwn(ARRIVAL_OPTIONS, arrivalPref)" :value="arrivalPref" disabled>Previously selected: {{ LABELS.arrival[arrivalPref] ?? arrivalPref }}</option>
                <option v-for="(label, value) in ARRIVAL_OPTIONS" :key="value" :value="value">{{ label }}</option>
              </select>
            </label>
          </div>
          <p v-if="needsPicture && !participation && canCoordinate" class="kaki-join__picture">
            Add a profile picture to join. Companion cards show your face to other fans.
            <RouterLink to="/profile">Add a picture</RouterLink>
          </p>
          <p v-if="participationError" class="kaki-join__error" role="alert">{{ participationError }}</p>
          <div class="kaki-join__actions">
            <span v-if="participationBusy" class="loading-state" role="status"><LoadingSpinner />Working…</span>
            <RouterLink v-if="participation && canCoordinate" :to="{ path: '/kaki', query: { concertId: id } }" class="btn btn--ghost">Browse companions</RouterLink>
            <RouterLink v-if="isFinished" to="/messages" class="btn btn--ghost">Existing conversations</RouterLink>
            <button v-if="canCoordinate" type="submit" class="btn btn--primary" :disabled="participationBusy || (needsPicture && !participation)">
              {{ participationBusy ? 'Working…' : participation ? 'Save preferences' : 'Join companion finder' }}
            </button>
            <button v-if="participation" type="button" class="btn btn--danger-ghost" :disabled="participationBusy" @click="leaveParticipation">Leave companion finder</button>
          </div>
        </form>
      </section>
      <!-- A short summary only; the full listings live on the Tickets page. -->
      <section class="card ticket-summary" aria-labelledby="concert-tickets-title">
        <div class="ticket-summary__text">
          <h2 id="concert-tickets-title">Tickets for sale</h2>
          <p v-if="ticketsLoading" class="loading-state" role="status"><LoadingSpinner />Checking fan-listed tickets…</p>
          <p v-else-if="ticketsError" role="alert" class="group-error">{{ ticketsError }}</p>
          <p v-else-if="!tickets.length">No tickets are listed for this concert yet.</p>
          <p v-else>
            {{ ticketCount }} {{ ticketCount === 1 ? 'ticket' : 'tickets' }} across {{ tickets.length }} {{ tickets.length === 1 ? 'listing' : 'listings' }}, from {{ formatMoney(ticketFromCents) }}.
          </p>
        </div>
        <button v-if="ticketsError" class="btn btn--ghost" type="button" @click="loadTickets">Try again</button>
        <RouterLink v-else-if="tickets.length" :to="{ name: 'tickets', query: { concert: id } }" class="btn btn--primary">View tickets</RouterLink>
        <RouterLink v-else-if="!ticketsLoading" to="/list-ticket" class="btn btn--ghost">List a ticket</RouterLink>
      </section>

    </template>

  </div>
</template>

<style scoped>
/* The backdrop sits at z-index -1. Without a stacking context of its own here
   it would fall behind the page background and never be seen at all; with one
   it lands between that background and everything on this page. */
.concert-page {
  isolation: isolate;
}

.my-result {
  display: grid;
  gap: var(--space-3);
  margin-bottom: var(--space-6);
  padding: var(--space-5);
}
.my-result h2 {
  font-size: var(--step-1);
}
.my-result > p, .my-result__head p {
  margin: 0;
}
.my-result__head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-4);
  padding-bottom: var(--space-4);
  border-bottom: var(--border-hairline);
}
.my-result__head > div {
  display: grid;
  gap: var(--space-2);
  min-width: 0;
  flex: 1 1 20rem;
}
.my-result__head .btn {
  white-space: normal;
}
.my-result__eyebrow {
  color: var(--accent-400);
  font-size: var(--step--2);
  font-weight: 700;
}
.my-result__intro, .my-result__summary {
  color: var(--text-300);
  font-size: var(--step--1);
}
.my-result__empty {
  display: grid;
  justify-items: start;
  gap: var(--space-3);
  padding-block: var(--space-4);
}
.my-result__empty h3 {
  font-size: var(--step-0);
}
.my-result__empty p {
  color: var(--text-300);
  max-width: var(--measure);
  font-size: var(--step--1);
}
.my-result__empty .btn {
  white-space: normal;
}
.my-result__past {
  padding-top: var(--space-3);
  border-top: var(--border-hairline);
}
.my-result__past summary {
  color: var(--text-300);
  cursor: pointer;
  font-size: var(--step--1);
}
.kaki-join {
  display: grid;
  gap: var(--space-4);
  margin-bottom: var(--space-6);
  padding: var(--space-5);
}
.kaki-join__intro h2 {
  font-size: var(--step-1);
}
.kaki-join__intro p {
  margin-top: var(--space-2);
  color: var(--text-300);
}
.kaki-join__form {
  display: grid;
  gap: var(--space-4);
}
.kaki-join__joined {
  width: fit-content;
}
.kaki-join__fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-4);
}
.kaki-join__fields label {
  display: grid;
  gap: var(--space-2);
  color: var(--text-300);
  font-size: var(--step--1);
}
.kaki-join__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
}
.kaki-join__picture {
  margin: 0;
  padding: var(--space-3) var(--space-4);
  border-left: 3px solid var(--accent-400);
  border-radius: var(--radius-sm);
  background: var(--ink-750);
  color: var(--text-200);
  font-size: var(--step--1);
}
.kaki-join__picture a {
  margin-left: var(--space-1);
  font-weight: 650;
}
.kaki-join__error {
  color: var(--rose-400);
}
@media (max-width: 600px) {
  .kaki-join__fields {
    grid-template-columns: 1fr;
  }
}


/* ---- Head --------------------------------------------------------------- */

.head {
  display: grid;
  gap: var(--space-6);
  padding-bottom: var(--space-7);
  margin-bottom: var(--space-6);
  border-bottom: var(--border-hairline);
}

@media (min-width: 960px) {
  .head {
    grid-template-columns: minmax(0, 1fr) minmax(0, 320px);
    gap: var(--space-8);
    align-items: start;
  }
}

/* The concert's own photo, with the details set over it. */
.cover {
  position: relative;
  isolation: isolate;
  display: grid;
  align-items: end;
  /* The poster scales with its column rather than stopping at a fixed height,
     so it fills the width it is given instead of leaving a band of empty
     column beside it. `min-height` is the floor for narrow screens, where
     the ratio alone would make it too short to read the title over. */
  aspect-ratio: 16 / 10;
  /* The ratio must only ever decide the HEIGHT. Left to itself it also sizes
     the width, which on a phone resolved the 360px floor into a 576px-wide
     box and pushed the page sideways. */
  width: 100%;
  min-height: 360px;
  overflow: hidden;
  border-radius: var(--radius-xl);
  /* The artist's own hue when the page has one, the house purple otherwise.
     Both are dark by construction, so the white text over them always holds. */
  background: linear-gradient(
    120deg,
    var(--art-surface, #2f195f),
    var(--art-surface-end, #5b2a86) 55%,
    color-mix(in oklab, var(--art-accent, #9c3d8f) 55%, #000)
  );
  box-shadow: 0 30px 60px -34px var(--art-surface-end, #5b2a86);
  color: #fff;
  animation: cover-in var(--dur-slower) var(--ease-settle) both;
}

.cover img {
  position: absolute;
  inset: 0;
  z-index: -2;
  width: 100%;
  height: 100%;
  object-fit: cover;
  animation: cover-zoom 20s ease-in-out infinite alternate;
}

.cover__initial {
  position: absolute;
  top: var(--space-5);
  right: var(--space-6);
  z-index: -2;
  font-family: var(--font-display);
  font-size: 9rem;
  font-weight: 800;
  line-height: 1;
  color: rgba(255, 255, 255, 0.18);
}

.cover__shade {
  position: absolute;
  inset: 0;
  z-index: -1;
  background: linear-gradient(to top, rgba(20, 8, 42, 0.92), rgba(20, 8, 42, 0.35) 55%, rgba(20, 8, 42, 0.05));
}

.cover__text {
  padding: var(--space-6);
}

.cover__date {
  display: inline-block;
  padding: var(--space-1) var(--space-3);
  border-radius: var(--radius-pill);
  background: rgba(255, 255, 255, 0.92);
  color: #2f195f;
  font-size: var(--step--2);
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

@keyframes cover-in {
  from {
    opacity: 0;
    transform: translateY(16px) scale(0.98);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@keyframes cover-zoom {
  from {
    transform: scale(1);
  }
  to {
    transform: scale(1.08);
  }
}

.head__text h1 {
  margin-block: var(--space-3) var(--space-2);
  font-size: var(--step-5);
  line-height: 1.05;
  color: #fff;
  text-shadow: 0 2px 24px rgba(0, 0, 0, 0.35);
}

.head__tour {
  color: #efc3f5;
  font-size: var(--step-0);
  font-weight: 600;
}

.head__venue {
  color: rgba(255, 255, 255, 0.8);
  font-size: var(--step--1);
  margin-top: var(--space-2);
}

.head__blurb {
  margin-top: var(--space-4);
  color: var(--text-300);
  max-width: var(--measure);
}

.head__panel {
  background: var(--ink-800);
  border: var(--border-hairline);
  border-radius: var(--radius-lg);
  padding: var(--space-5);
  position: sticky;
  top: calc(var(--header-height) + var(--space-4));
}

.head__panel-title {
  font-size: var(--step-1);
  color: var(--text-200);
  font-weight: 600;
}

.choices {
  margin-block: var(--space-2) var(--space-6);
}
.choices__title {
  font-size: var(--step-1);
}
.choice {
  display: grid;
  gap: var(--space-1);
  height: 100%;
  padding: var(--space-4) var(--space-5);
  border: 1px solid var(--panel-edge);
  border-top: 4px solid var(--highlight);
  border-radius: var(--radius-lg);
  background: var(--panel-bg);
  box-shadow: var(--panel-shadow);
  color: var(--text-300);
  text-decoration: none;
  transition: transform var(--dur-fast) var(--ease-settle), box-shadow var(--dur-fast) var(--ease-settle);
}
.choice:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
}
.choice strong {
  color: var(--text-100);
  font-size: var(--step-1);
}
.choice strong::after {
  content: ' →';
  color: var(--highlight-ink);
}
.choice__icon {
  font-size: 1.5rem;
}
@media (prefers-reduced-motion: reduce) {
  .choice,
  .choice:hover {
    transition: none;
    transform: none;
  }
}
.counts {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-3);
  margin-top: var(--space-4);
  padding-bottom: var(--space-4);
  border-bottom: var(--border-hairline);
}

/* A label that wraps would push its number lower than its neighbours';
   pinning each number to the bottom of its column keeps the row level. */
.counts > div {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: var(--space-1);
}

.counts dt {
  font-size: var(--step--2);
  color: var(--text-400);
  line-height: 1.3;
}

.counts dd {
  font-family: var(--font-display);
  font-size: var(--step-2);
  font-weight: 700;
  color: var(--highlight-ink);
  line-height: 1.1;
}

.head__previous {
  display: block;
  margin-top: var(--space-4);
  padding-top: var(--space-3);
  border-top: var(--border-hairline);
  font-size: var(--step--2);
  color: var(--text-400);
  text-decoration: none;
}

.head__previous:hover {
  color: var(--text-200);
}
.head__previous .ok {
  color: var(--mint-400);
}
.head__previous .bad {
  color: var(--rose-400);
  font-weight: 600;
}


.notice {
  grid-column: 1 / -1;
  padding: var(--space-6);
  border-radius: var(--radius-lg);
  border: 1px dashed var(--ink-500);
  color: var(--text-400);
}

.notice--error {
  border-style: solid;
  border-color: color-mix(in oklab, var(--rose-400) 40%, var(--ink-600));
  background: color-mix(in oklab, var(--rose-400) 7%, transparent);
}

.notice h2 {
  font-size: var(--step-1);
  color: var(--rose-400);
  margin-bottom: var(--space-2);
}
.head__text, .head__panel, .ticket-summary__text {
  min-width: 0;
  overflow-wrap: anywhere;
}
.ticket-summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  margin-bottom: var(--space-6);
  padding: var(--space-5);
}
.ticket-summary__text {
  display: grid;
  gap: var(--space-2);
}
.ticket-summary__text p {
  color: var(--text-300);
}
.ticket-summary .btn {
  white-space: normal;
}
.ticket-summary h2 {
  font-size: var(--step-2);
}
</style>
