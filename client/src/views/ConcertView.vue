<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api, LABELS, SECTION_OPTIONS, ARRIVAL_OPTIONS, formatDate } from '../api.js';
import { currentUser, sessionReady } from '../auth.js';
import UserAvatar from '../components/market/UserAvatar.vue';
import { formatMoney } from '../market.js';
import '../assets/groups.css';
import MatchProposalCard from '../components/MatchProposalCard.vue';
import { useCountUp } from '../composables/useCountUp.js';
import LoadingSpinner from '../components/LoadingSpinner.vue';

const props = defineProps({ id: { type: String, required: true } });
const router = useRouter();

const concert = ref(null);
const parties = ref([]);
const requests = ref([]);
const preview = ref(null);
const loading = ref(true);
const running = ref(false);
const error = ref(null);
const runError = ref('');
const runNotice = ref('');
const matchingError = ref('');
const participation = ref(null);
const participationLoading = ref(false);
const participationBusy = ref(false);
const participationError = ref('');
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
        : 'Could not save your companion-finder preferences. Please try again.';
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
  loading.value = true;
  error.value = null;
  runError.value = '';
  runNotice.value = '';
  matchingError.value = '';
  parties.value = [];
  requests.value = [];
  try {
    const [detail, matching] = await Promise.all([
      api.concert(props.id),
      Promise.all([api.parties(props.id), api.requests(props.id)]).catch(() => {
        matchingError.value = 'Could not load group-matching availability. Ticket listings are still available below.';
        return null;
      }),
    ]);
    concert.value = detail;
    if (matching) {
      parties.value = matching[0].parties;
      requests.value = matching[1].requests;
    }

    preview.value = null;
  } catch (err) {
    error.value = err;
  } finally {
    loading.value = false;
  }
}

onMounted(load);
watch(() => props.id, load);

async function runRound() {
  if (!canRun.value) return;
  runError.value = '';
  running.value = true;
  try {
    // Keep the same key for retries, including after a page refresh.
    const storageKey = `encore-batch:${props.id}`;
    let batchKey = sessionStorage.getItem(storageKey);
    if (!batchKey) {
      batchKey = crypto.randomUUID();
      sessionStorage.setItem(storageKey, batchKey);
    }
    const outcome = await api.runMatch(props.id, batchKey);
    await router.push({
      path: `/rounds/${outcome.roundId}`,
      query: { concertId: props.id },
    });
  } catch (err) {
    runError.value = err.status === 403
      ? 'Only an operator can run matching rounds.'
      : err.status === 401
        ? 'Your session has expired. Sign in as an operator.'
        : err.status === 409
          ? 'Matching cannot run yet. Check availability and existing assignments.'
          : 'Could not run this matching round. Please try again.';
  } finally {
    running.value = false;
  }
}

function newMatchingBatch() {
  // Only an explicit new operation replaces the retry key.
  sessionStorage.setItem(`encore-batch:${props.id}`, crypto.randomUUID());
  runError.value = '';
  runNotice.value = 'New matching batch prepared. You can run matching now.';
}

const previewLoading = ref(false);

async function loadPreview() {
  if (previewLoading.value) return;
  previewLoading.value = true;
  runError.value = '';
  try {
    preview.value = await api.preview(props.id, { baselines: false, trace: false });
  } catch (err) {
    runError.value = 'Could not calculate a matching preview. Please try again.';
  } finally {
    previewLoading.value = false;
  }
}

const totalPlaces = computed(() => parties.value.reduce((sum, party) => sum + party.capacity, 0));

const canRun = computed(
  () => sessionReady.value && currentUser.value?.isOperator === true
    && parties.value.length > 0 && requests.value.length > 0 && !running.value,
);


const forecastMatched = useCountUp(() => preview.value?.metrics?.matched ?? 0, {
  duration: 1000,
});
const forecastFirstChoice = useCountUp(
  () => Math.round((preview.value?.metrics?.firstChoiceRate ?? 0) * 100),
  { duration: 1100 },
);
</script>

<template>
  <div class="container section">
    <RouterLink to="/concerts" class="back">← All concerts</RouterLink>

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
          <p>{{ formatDate(concert.concert.event_date) }}</p>
          <h1>{{ concert.concert.artist }}</h1>
          <p v-if="concert.concert.tour_name" class="head__tour">
            {{ concert.concert.tour_name }}
          </p>
          <p class="head__venue">
            {{ concert.concert.venue }}, {{ concert.concert.city }}<template v-if="concert.concert.doors_time">, doors {{ concert.concert.doors_time }}</template>
          </p>
          <p v-if="concert.concert.blurb" class="head__blurb">{{ concert.concert.blurb }}</p>
        </div>

        <aside class="head__panel">
          <h2 class="head__panel-title">Group matching</h2>
          <p v-if="matchingError" class="group-error" role="alert">{{ matchingError }}</p>
          <dl v-else class="counts">
            <div>
              <dt>Groups</dt>
              <dd class="tabular">{{ parties.length }}</dd>
            </div>
            <div>
              <dt>Group places</dt>
              <dd class="tabular">{{ totalPlaces }}</dd>
            </div>
            <div>
              <dt>Active group finders</dt>
              <dd class="tabular">{{ requests.length }}</dd>
            </div>
          </dl>
          <p class="group-muted">Group places are not tickets. Open group requests are considered in matching rounds.</p>

          <div v-if="preview && !preview.empty" class="head__forecast">
            <p class="head__forecast-label">If the round ran now</p>
            <p class="head__forecast-value">
              <strong class="tabular">{{ forecastMatched }}</strong>
              of {{ preview.metrics.eligibleSeekers }} placed
            </p>
            <p class="head__forecast-note">
              <span class="tag tag--mint">{{ preview.metrics.blockingPairs }} blocking pairs</span>
              <span class="tag tabular">{{ forecastFirstChoice }}% first choice</span>
            </p>
          </div>
          <p v-if="preview?.empty" class="group-muted">No matching preview is available for the current groups and requests.</p>

          <div v-if="sessionReady && currentUser?.isOperator" class="head__actions">
            <button
              type="button"
              class="btn btn--ghost"
              :disabled="previewLoading || running"
              @click="loadPreview"
            >
              <LoadingSpinner v-if="previewLoading" />
              {{ previewLoading ? 'Calculating…' : 'Preview matching' }}
            </button>
            <button type="button" class="btn btn--ghost" :disabled="running" @click="newMatchingBatch">
              Prepare new batch
            </button>
            <button type="button" class="btn btn--primary" :disabled="!canRun" @click="runRound">
              <LoadingSpinner v-if="running" />
              {{ running ? 'Running…' : 'Run matching round' }}
            </button>
            <RouterLink :to="`/concerts/${id}/algorithm`" class="btn btn--ghost">
              Watch it run
            </RouterLink>
          </div>
          <p v-if="runError" class="kaki-join__error" role="alert">{{ runError }}</p>
          <p v-if="runNotice" class="group-success" role="status">{{ runNotice }}</p>

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
      <section class="my-result card" aria-labelledby="my-result-title">
        <h2 id="my-result-title">Your match proposals</h2>
        <p v-if="!sessionReady || resultLoading" class="loading-state" role="status"><LoadingSpinner />Loading your proposals…</p>
        <p v-else-if="!currentUser">
          <RouterLink to="/login">Sign in</RouterLink> to see your matching offers.
        </p>
        <div v-else-if="resultError" role="alert">
          <p>Could not load your current match proposals. Please try again.</p>
          <button type="button" class="btn btn--ghost" @click="refreshMyProposals">Try again</button>
        </div>
        <p v-else-if="!myProposals.length">No proposals for this concert yet.</p>
        <template v-else>
          <MatchProposalCard
            v-for="proposal in myProposals"
            :key="proposal.id"
            :proposal="proposal"
            @updated="refreshMyProposals"
          />
        </template>
      </section>

      <section class="ticket-section" aria-labelledby="concert-tickets-title">
        <header class="group-actions ticket-section__head">
          <h2 id="concert-tickets-title">Tickets for sale</h2>
          <span v-if="!ticketsLoading && !ticketsError">{{ ticketCount }} {{ ticketCount === 1 ? 'ticket' : 'tickets' }} across {{ tickets.length }} {{ tickets.length === 1 ? 'listing' : 'listings' }}</span>
        </header>
        <p v-if="ticketsLoading" class="loading-state" role="status"><LoadingSpinner />Loading ticket listings…</p>
        <div v-else-if="ticketsError" role="alert" class="group-error">
          <p>{{ ticketsError }}</p>
          <button class="btn btn--ghost" @click="loadTickets">Try again</button>
        </div>
        <p v-else-if="!tickets.length">No tickets are listed for this concert yet.</p>
        <div v-else class="group-grid">
          <article v-for="listing in tickets" :key="listing.id" class="card group-panel ticket-listing">
            <header class="ticket-listing__seller">
              <UserAvatar :user="listing.seller" :size="40" />
              <div><h3>{{ listing.seller.displayName }}</h3><p>Seller</p></div>
              <span v-if="listing.seller.verified" class="tag">Verified profile</span>
            </header>
            <p>{{ LABELS.section[listing.section] ?? listing.section }}</p>
            <div class="group-actions">
              <strong>{{ formatMoney(listing.priceCents) }} total for this listing</strong>
              <span>{{ listing.quantity }} {{ listing.quantity === 1 ? 'ticket' : 'tickets' }} available</span>
            </div>
            <p><span class="tag" :class="{ 'tag--mint': listing.verified }">{{ listing.verified ? 'Verified ticket listing' : 'Ticket listing not verified' }}</span></p>
            <RouterLink :to="`/tickets/${encodeURIComponent(listing.id)}`" class="btn btn--primary">View listing &amp; contact seller</RouterLink>
          </article>
        </div>
        <p class="group-muted">Online checkout is unavailable because no payment provider is configured.</p>
      </section>
      <section class="card group-panel companion-options">
        <h2>Go with companions</h2>
        <p>Already have a ticket? Join an existing group or create your own. Group places do not include concert tickets.</p>
        <nav class="group-actions" aria-label="Group workflows">
          <RouterLink :to="{ path: '/groups', query: { concertId: id } }" class="btn btn--primary">Join a group</RouterLink>
          <RouterLink :to="{ path: '/groups/connect', query: { concertId: id, view: 'create' } }" class="btn btn--ghost">Create a group</RouterLink>
          <RouterLink :to="{ path: '/groups/connect', query: { concertId: id } }" class="btn btn--ghost">My groups</RouterLink>
        </nav>
      </section>
      <section class="kaki-join card" aria-labelledby="kaki-join-title">
        <div class="kaki-join__intro">
          <h2 id="kaki-join-title">Find a companion</h2>
          <p>Join this concert's companion finder. Messaging opens after a mutual like; this is separate from group matching.</p>
        </div>
        <p v-if="!currentUser" class="kaki-join__state">
          <RouterLink to="/login" class="btn btn--primary">Sign in to find companions</RouterLink>
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
          <p v-if="participation" class="kaki-join__joined">You are in the companion finder for this concert.</p>
          <div class="kaki-join__fields">
            <label>
              Preferred section
              <select v-model="sectionPref" :disabled="participationBusy" required>
                <option v-if="!Object.hasOwn(SECTION_OPTIONS, sectionPref)" :value="sectionPref" disabled>Previously selected: {{ LABELS.section[sectionPref] ?? sectionPref }}</option>
                <option v-for="(label, value) in SECTION_OPTIONS" :key="value" :value="value">{{ label }}</option>
              </select>
            </label>
            <label>
              Arrival plan
              <select v-model="arrivalPref" :disabled="participationBusy" required>
                <option v-if="!Object.hasOwn(ARRIVAL_OPTIONS, arrivalPref)" :value="arrivalPref" disabled>Previously selected: {{ LABELS.arrival[arrivalPref] ?? arrivalPref }}</option>
                <option v-for="(label, value) in ARRIVAL_OPTIONS" :key="value" :value="value">{{ label }}</option>
              </select>
            </label>
          </div>
          <p v-if="participationError" class="kaki-join__error" role="alert">{{ participationError }}</p>
          <div class="kaki-join__actions">
            <span v-if="participationBusy" class="loading-state" role="status"><LoadingSpinner />Working…</span>
            <RouterLink v-if="participation" :to="{ path: '/kaki', query: { concertId: id } }" class="btn btn--ghost">Browse companions</RouterLink>
            <button type="submit" class="btn btn--primary" :disabled="participationBusy">
              {{ participationBusy ? 'Working…' : participation ? 'Save preferences' : 'Join companion finder' }}
            </button>
            <button v-if="participation" type="button" class="btn btn--danger-ghost" :disabled="participationBusy" @click="leaveParticipation">Leave companion finder</button>
          </div>
        </form>
      </section>

    </template>

  </div>
</template>

<style scoped>
.my-result { display: grid; gap: var(--space-3); margin-bottom: var(--space-6); padding: var(--space-5); }
.my-result h2 { font-size: var(--step-1); }
.my-result p { margin: 0; color: var(--text-300); }
.kaki-join { display: grid; gap: var(--space-4); margin-bottom: var(--space-6); padding: var(--space-5); }
.kaki-join__intro h2 { font-size: var(--step-1); }
.kaki-join__intro p { margin-top: var(--space-2); color: var(--text-300); }
.kaki-join__form { display: grid; gap: var(--space-4); }
.kaki-join__joined { color: var(--mint-400); }
.kaki-join__fields { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-4); }
.kaki-join__fields label { display: grid; gap: var(--space-2); color: var(--text-300); font-size: var(--step--1); }
.kaki-join__actions { display: flex; flex-wrap: wrap; gap: var(--space-3); }
.kaki-join__error { color: var(--rose-400); }
@media (max-width: 600px) { .kaki-join__fields { grid-template-columns: 1fr; } }


.back {
  display: inline-block;
  margin-bottom: var(--space-5);
  color: var(--text-400);
  text-decoration: none;
  font-size: var(--step--1);
  transition: color var(--dur-fast) var(--ease-out);
}

.back:hover { color: var(--accent-400); }

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
    grid-template-columns: minmax(0, 1fr) minmax(0, 340px);
    gap: var(--space-8);
    align-items: start;
  }
}

.head__text h1 {
  margin-block: var(--space-3) var(--space-2);
  font-size: var(--step-5);
}

.head__tour {
  color: var(--accent-400);
  font-size: var(--step-0);
}

.head__venue {
  color: var(--text-400);
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

.counts {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-3);
  margin-top: var(--space-4);
  padding-bottom: var(--space-4);
  border-bottom: var(--border-hairline);
}

.counts dt {
  font-size: var(--step--2);
  color: var(--text-400);
}

.counts dd {
  font-family: var(--font-display);
  font-size: var(--step-2);
  font-weight: 700;
  color: var(--text-100);
  line-height: 1.1;
}

.head__forecast {
  padding-block: var(--space-4);
  border-bottom: var(--border-hairline);
}

.head__forecast-label {
  font-size: var(--step--2);
  color: var(--text-400);
  text-transform: uppercase;
  letter-spacing: 0.1em;
  font-family: var(--font-mono);
}

.head__forecast-value {
  margin-top: var(--space-2);
  font-size: var(--step-0);
  color: var(--text-200);
}

.head__forecast-value strong {
  font-family: var(--font-display);
  font-size: var(--step-2);
  color: var(--accent-400);
}

.head__forecast-note {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-top: var(--space-3);
}

.head__actions {
  display: grid;
  gap: var(--space-2);
  margin-top: var(--space-4);
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

.head__previous:hover { color: var(--text-200); }
.head__previous .ok { color: var(--mint-400); }
.head__previous .bad { color: var(--rose-400); font-weight: 600; }


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

.notice h2 { font-size: var(--step-1); color: var(--rose-400); margin-bottom: var(--space-2); }
.head__text, .head__panel, .ticket-listing, .ticket-listing__seller > div { min-width: 0; overflow-wrap: anywhere; }
.ticket-section { display: grid; gap: var(--space-4); margin-bottom: var(--space-6); }
.ticket-section__head { justify-content: space-between; }
.ticket-section h2, .companion-options h2 { font-size: var(--step-2); }
.ticket-listing { align-content: start; }
.ticket-listing h3 { font-size: var(--step-1); }
.ticket-listing__seller { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3); }
.ticket-listing__seller p { color: var(--text-300); font-size: var(--step--1); }
.ticket-listing > .btn { margin-top: auto; justify-self: start; white-space: normal; }
.companion-options { margin-bottom: var(--space-6); }
</style>
