<script setup>
/**
 * Algorithm visualiser.
 *
 * Replays the proposal trace the backend recorded for a real round: every
 * acceptance, rejection and eviction, in the order deferred acceptance produced
 * them. Nothing here is simulated — the events come from the solver.
 */
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { api, LABELS } from '../api.js';

const props = defineProps({ id: { type: String, required: true } });

const loading = ref(true);
const error = ref(null);
const concert = ref(null);
const trace = ref([]);
const metrics = ref(null);
const capacities = ref(new Map());
const seekerNames = ref(new Map());
const partyNames = ref(new Map());

const step = ref(0);          // number of events applied
const playing = ref(false);
const speed = ref(6);          // events per second
let timer = null;

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

onMounted(async () => {
  try {
    const [detail, partyData, requestData, run] = await Promise.all([
      api.concert(props.id),
      api.parties(props.id),
      api.requests(props.id),
      api.preview(props.id, { trace: true }),
    ]);

    concert.value = detail.concert;

    if (run.empty) {
      error.value = new Error('This concert has no open listings to match.');
      return;
    }

    trace.value = run.trace ?? [];
    metrics.value = run.metrics;

    capacities.value = new Map(partyData.parties.map((p) => [p.id, p.capacity]));
    partyNames.value = new Map(
      partyData.parties.map((p) => [
        p.id,
        { name: p.host.displayName, section: p.section, capacity: p.capacity },
      ]),
    );
    seekerNames.value = new Map(
      requestData.requests.map((r) => [r.id, { name: r.user.displayName, section: r.sectionPref }]),
    );
  } catch (err) {
    error.value = err;
  } finally {
    loading.value = false;
  }
});

onUnmounted(() => clearInterval(timer));

// ---------------------------------------------------------------------------
// State reconstruction
//
// The state after N events is derived by replaying the trace from the start.
// Replaying is O(N), which is cheap at demo sizes and means scrubbing backwards
// needs no undo logic — the trace is the single source of truth.
// ---------------------------------------------------------------------------

const state = computed(() => {
  const held = new Map();        // partyId -> [seekerId]
  const assigned = new Map();    // seekerId -> partyId
  let accepts = 0;
  let rejects = 0;
  let evictions = 0;

  for (const partyId of capacities.value.keys()) held.set(partyId, []);

  for (let i = 0; i < step.value && i < trace.value.length; i += 1) {
    const event = trace.value[i];
    const members = held.get(event.partyId) ?? [];

    if (event.type === 'accept') {
      members.push(event.seekerId);
      assigned.set(event.seekerId, event.partyId);
      accepts += 1;
    } else if (event.type === 'evict') {
      const at = members.indexOf(event.evictedSeekerId);
      if (at !== -1) members.splice(at, 1);
      assigned.delete(event.evictedSeekerId);
      members.push(event.seekerId);
      assigned.set(event.seekerId, event.partyId);
      evictions += 1;
    } else {
      rejects += 1;
    }
    held.set(event.partyId, members);
  }

  return { held, assigned, accepts, rejects, evictions };
});

const currentEvent = computed(() =>
  step.value > 0 ? trace.value[step.value - 1] : null,
);

const finished = computed(() => step.value >= trace.value.length);

const progress = computed(() =>
  trace.value.length === 0 ? 0 : (step.value / trace.value.length) * 100,
);

// ---------------------------------------------------------------------------
// Playback
// ---------------------------------------------------------------------------

function tick() {
  if (step.value >= trace.value.length) {
    pause();
    return;
  }
  step.value += 1;
}

function play() {
  if (finished.value) step.value = 0;
  playing.value = true;
  clearInterval(timer);
  timer = setInterval(tick, 1000 / speed.value);
}

function pause() {
  playing.value = false;
  clearInterval(timer);
}

function toggle() {
  playing.value ? pause() : play();
}

function reset() {
  pause();
  step.value = 0;
}

watch(speed, () => {
  if (playing.value) play();
});

function nudge(delta) {
  pause();
  step.value = Math.max(0, Math.min(trace.value.length, step.value + delta));
}

function onScrub(e) {
  pause();
  step.value = Number(e.target.value);
}

// ---------------------------------------------------------------------------
// Presentation helpers
// ---------------------------------------------------------------------------

const seekerLabel = (id) => seekerNames.value.get(id)?.name ?? id;
const partyLabel = (id) => partyNames.value.get(id)?.name ?? id;

const EVENT_COPY = {
  accept: (e) =>
    `${seekerLabel(e.seekerId)} proposed to ${partyLabel(e.partyId)}, who had a free slot and accepted.`,
  reject: (e) =>
    `${seekerLabel(e.seekerId)} proposed to ${partyLabel(e.partyId)}, who is full and prefers everyone already held. Rejected — they move to their next choice.`,
  evict: (e) =>
    `${seekerLabel(e.seekerId)} proposed to ${partyLabel(e.partyId)}, who preferred them to ${seekerLabel(e.evictedSeekerId)}. ${seekerLabel(e.evictedSeekerId)} is displaced and must propose again.`,
};

/** Seekers who are currently unplaced, for the "still proposing" rail. */
const floating = computed(() => {
  const out = [];
  for (const id of seekerNames.value.keys()) {
    if (!state.value.assigned.has(id)) out.push(id);
  }
  return out;
});

const sortedParties = computed(() =>
  [...partyNames.value.entries()].sort((a, b) => b[1].capacity - a[1].capacity),
);
</script>

<template>
  <div class="container container--wide section">
    <RouterLink :to="`/concerts/${id}`" class="back">← Back to concert</RouterLink>

    <header class="head">
      <div>
        <p class="eyebrow">Deferred acceptance, step by step</p>
        <h1>Watch the matching run</h1>
        <p class="lede">
          Every proposal the algorithm made, in order. Nothing here is a mock-up — these
          are the events the solver recorded while producing
          <template v-if="concert">{{ concert.artist }}'s</template> matching.
        </p>
      </div>
    </header>

    <div v-if="loading" class="skeleton" />

    <div v-else-if="error" class="notice notice--error">
      <h3>Nothing to replay</h3>
      <p>{{ error.message }}</p>
    </div>

    <template v-else>
      <!-- ------------------------------------------------------- Controls -->
      <div class="console">
        <div class="console__transport">
          <button class="icon-btn" aria-label="Restart" @click="reset">↺</button>
          <button class="icon-btn" aria-label="Step back" @click="nudge(-1)">‹</button>
          <button class="play" :aria-label="playing ? 'Pause' : 'Play'" @click="toggle">
            <span v-if="playing">❚❚</span>
            <span v-else>▶</span>
          </button>
          <button class="icon-btn" aria-label="Step forward" @click="nudge(1)">›</button>
          <button
            class="icon-btn"
            aria-label="Skip to end"
            @click="pause(); step = trace.length"
          >⇥</button>
        </div>

        <div class="console__scrub">
          <input
            type="range"
            min="0"
            :max="trace.length"
            :value="step"
            class="scrubber"
            aria-label="Scrub through proposals"
            @input="onScrub"
          />
          <p class="console__position mono tabular">
            {{ step }} / {{ trace.length }} proposals
          </p>
        </div>

        <label class="console__speed">
          <span class="sr-only">Playback speed</span>
          <select v-model.number="speed">
            <option :value="2">0.5×</option>
            <option :value="6">1×</option>
            <option :value="16">3×</option>
            <option :value="45">8×</option>
          </select>
        </label>
      </div>

      <div class="progress" role="presentation">
        <div class="progress__fill" :style="{ width: `${progress}%` }" />
      </div>

      <!-- ----------------------------------------------------- Live event -->
      <div
        class="event"
        :class="currentEvent ? `event--${currentEvent.type}` : 'event--idle'"
      >
        <span class="event__badge">
          {{ currentEvent ? currentEvent.type : 'ready' }}
        </span>
        <p class="event__text">
          <template v-if="currentEvent">{{ EVENT_COPY[currentEvent.type](currentEvent) }}</template>
          <template v-else>
            Press play. Seekers propose down their preference lists; groups hold the best
            offers they have received so far and release the rest.
          </template>
        </p>
      </div>

      <!-- --------------------------------------------------------- Tallies -->
      <dl class="tallies">
        <div>
          <dt>Accepted</dt>
          <dd class="tabular is-mint">{{ state.accepts }}</dd>
        </div>
        <div>
          <dt>Rejected</dt>
          <dd class="tabular is-rose">{{ state.rejects }}</dd>
        </div>
        <div>
          <dt>Displaced</dt>
          <dd class="tabular is-amber">{{ state.evictions }}</dd>
        </div>
        <div>
          <dt>Placed now</dt>
          <dd class="tabular">{{ state.assigned.size }}</dd>
        </div>
        <div>
          <dt>Still proposing</dt>
          <dd class="tabular">{{ floating.length }}</dd>
        </div>
      </dl>

      <!-- ----------------------------------------------------------- Board -->
      <div class="board">
        <section class="board__side">
          <h2 class="board__title">
            Still proposing
            <span class="board__count tabular">{{ floating.length }}</span>
          </h2>
          <TransitionGroup name="chip" tag="div" class="chips">
            <span
              v-for="seekerId in floating"
              :key="seekerId"
              class="chip"
              :class="{ 'chip--active': currentEvent?.seekerId === seekerId }"
            >{{ seekerLabel(seekerId) }}</span>
          </TransitionGroup>
          <p v-if="!floating.length" class="board__empty">
            Everyone has been placed or exhausted their list.
          </p>
        </section>

        <section class="board__main">
          <h2 class="board__title">Groups and their held offers</h2>
          <div class="parties">
            <article
              v-for="[partyId, info] in sortedParties"
              :key="partyId"
              class="party"
              :class="{
                'party--target': currentEvent?.partyId === partyId,
                [`party--${currentEvent?.type}`]: currentEvent?.partyId === partyId,
              }"
            >
              <header class="party__head">
                <h3>{{ info.name }}</h3>
                <span class="tag">{{ LABELS.section[info.section] }}</span>
              </header>

              <div class="slots">
                <div
                  v-for="n in info.capacity"
                  :key="n"
                  class="slot"
                  :class="{ 'slot--filled': (state.held.get(partyId) ?? []).length >= n }"
                >
                  <Transition name="occupant">
                    <span
                      v-if="(state.held.get(partyId) ?? [])[n - 1]"
                      class="slot__name"
                    >{{ seekerLabel((state.held.get(partyId) ?? [])[n - 1]) }}</span>
                    <span v-else class="slot__empty">open</span>
                  </Transition>
                </div>
              </div>
            </article>
          </div>
        </section>
      </div>

      <!-- ------------------------------------------------------ Conclusion -->
      <Transition name="verdict">
        <div v-if="finished && metrics" class="verdict">
          <div class="verdict__mark">✓</div>
          <div>
            <h2>Matching complete — and stable.</h2>
            <p>
              {{ metrics.matched }} of {{ metrics.eligibleSeekers }} seekers placed after
              {{ trace.length }} proposals.
              <strong>{{ metrics.blockingPairs }} blocking pairs</strong> — no two people
              would both rather have been matched with each other.
              {{ Math.round(metrics.firstChoiceRate * 100) }}% got their first choice.
            </p>
            <RouterLink :to="`/concerts/${id}`" class="btn btn--primary">
              Back to the concert
            </RouterLink>
          </div>
        </div>
      </Transition>
    </template>
  </div>
</template>

<style scoped>
.back {
  display: inline-block;
  margin-bottom: var(--space-5);
  color: var(--text-400);
  text-decoration: none;
  font-size: var(--step--1);
}

.back:hover { color: var(--accent-400); }

.head {
  margin-bottom: var(--space-6);
}

.head h1 {
  margin-block: var(--space-3) var(--space-4);
}

.head .lede {
  max-width: 62ch;
}

/* ---- Console ------------------------------------------------------------ */

.console {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-4);
  border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  border: var(--border-hairline);
  border-bottom: none;
  background: var(--ink-800);
}

.console__transport {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.icon-btn {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  border-radius: var(--radius-sm);
  border: var(--border-hairline);
  color: var(--text-300);
  font-size: var(--step-0);
  transition:
    color var(--dur-fast) var(--ease-out),
    border-color var(--dur-fast) var(--ease-out),
    background var(--dur-fast) var(--ease-out);
}

.icon-btn:hover {
  color: var(--text-100);
  border-color: var(--ink-500);
  background: var(--ink-750);
}

.play {
  width: 46px;
  height: 46px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: var(--accent-500);
  color: #fff;
  font-size: var(--step--1);
  box-shadow: var(--shadow-accent);
  transition: background var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out);
}

.play:hover { background: var(--accent-400); }
.play:active { transform: scale(0.94); }

.console__scrub {
  flex: 1;
  min-width: 220px;
}

.scrubber {
  width: 100%;
  appearance: none;
  height: 4px;
  border-radius: var(--radius-pill);
  background: var(--ink-600);
  cursor: pointer;
}

.scrubber::-webkit-slider-thumb {
  appearance: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--accent-400);
  border: 2px solid var(--ink-900);
  cursor: grab;
}

.scrubber::-moz-range-thumb {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--accent-400);
  border: 2px solid var(--ink-900);
  cursor: grab;
}

.console__position {
  margin-top: var(--space-2);
  font-size: var(--step--2);
  color: var(--text-400);
}

.console__speed select {
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-sm);
  border: var(--border-hairline);
  background: var(--ink-750);
  color: var(--text-200);
  font-size: var(--step--1);
}

.progress {
  height: 3px;
  background: var(--ink-700);
  border-inline: var(--border-hairline);
}

.progress__fill {
  height: 100%;
  background: linear-gradient(90deg, var(--accent-600), var(--accent-400));
  transition: width var(--dur-fast) linear;
}

/* ---- Event readout ------------------------------------------------------ */

.event {
  display: flex;
  align-items: flex-start;
  gap: var(--space-4);
  padding: var(--space-4) var(--space-5);
  border: var(--border-hairline);
  border-top: none;
  border-radius: 0 0 var(--radius-lg) var(--radius-lg);
  background: var(--ink-800);
  min-height: 78px;
  transition: background var(--dur-base) var(--ease-out);
}

.event__badge {
  flex-shrink: 0;
  padding: 3px var(--space-3);
  border-radius: var(--radius-pill);
  font-family: var(--font-mono);
  font-size: var(--step--2);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  background: var(--ink-700);
  color: var(--text-400);
}

.event__text {
  font-size: var(--step--1);
  color: var(--text-300);
  line-height: 1.5;
}

.event--accept { background: color-mix(in oklab, var(--mint-400) 7%, var(--ink-800)); }
.event--accept .event__badge { background: var(--mint-400); color: var(--ink-900); }

.event--reject { background: color-mix(in oklab, var(--rose-400) 7%, var(--ink-800)); }
.event--reject .event__badge { background: var(--rose-400); color: var(--ink-900); }

.event--evict { background: color-mix(in oklab, var(--amber-400) 8%, var(--ink-800)); }
.event--evict .event__badge { background: var(--amber-400); color: var(--ink-900); }

/* ---- Tallies ------------------------------------------------------------ */

.tallies {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
  gap: var(--space-3);
  margin-block: var(--space-5);
}

.tallies > div {
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-md);
  border: var(--border-hairline);
  background: var(--ink-800);
}

.tallies dt {
  font-size: var(--step--2);
  color: var(--text-400);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-family: var(--font-mono);
}

.tallies dd {
  font-family: var(--font-display);
  font-size: var(--step-2);
  font-weight: 700;
  color: var(--text-100);
  line-height: 1.2;
}

.is-mint { color: var(--mint-400); }
.is-rose { color: var(--rose-400); }
.is-amber { color: var(--amber-400); }

/* ---- Board -------------------------------------------------------------- */

.board {
  display: grid;
  gap: var(--space-5);
}

@media (min-width: 1000px) {
  .board {
    grid-template-columns: 260px 1fr;
    align-items: start;
  }
}

.board__title {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-family: var(--font-mono);
  font-size: var(--step--2);
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: var(--text-400);
  font-weight: 500;
  margin-bottom: var(--space-3);
}

.board__count {
  padding: 1px var(--space-2);
  border-radius: var(--radius-pill);
  background: var(--ink-700);
  color: var(--text-300);
}

.board__side {
  position: sticky;
  top: calc(var(--header-height) + var(--space-4));
  padding: var(--space-4);
  border-radius: var(--radius-lg);
  border: var(--border-hairline);
  background: var(--ink-850);
  max-height: 72vh;
  overflow-y: auto;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

.chip {
  padding: var(--space-1) var(--space-3);
  border-radius: var(--radius-pill);
  background: var(--ink-700);
  border: 1px solid transparent;
  font-size: var(--step--2);
  color: var(--text-300);
  white-space: nowrap;
  transition: all var(--dur-base) var(--ease-out);
}

.chip--active {
  background: var(--cyan-400);
  border-color: var(--cyan-400);
  color: var(--ink-900);
  font-weight: 600;
  transform: scale(1.06);
}

.board__empty {
  font-size: var(--step--2);
  color: var(--text-400);
  font-style: italic;
}

.parties {
  display: grid;
  gap: var(--space-3);
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
}

.party {
  padding: var(--space-4);
  border-radius: var(--radius-md);
  border: var(--border-hairline);
  background: var(--ink-800);
  transition:
    border-color var(--dur-base) var(--ease-out),
    box-shadow var(--dur-base) var(--ease-out),
    transform var(--dur-base) var(--ease-out);
}

.party--target {
  transform: translateY(-2px);
}

.party--accept {
  border-color: var(--mint-400);
  box-shadow: 0 0 0 3px color-mix(in oklab, var(--mint-400) 18%, transparent);
}

.party--reject {
  border-color: var(--rose-400);
  box-shadow: 0 0 0 3px color-mix(in oklab, var(--rose-400) 18%, transparent);
}

.party--evict {
  border-color: var(--amber-400);
  box-shadow: 0 0 0 3px color-mix(in oklab, var(--amber-400) 20%, transparent);
}

.party__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  margin-bottom: var(--space-3);
  padding-bottom: var(--space-3);
  border-bottom: var(--border-hairline);
}

.party__head h3 {
  font-size: var(--step--1);
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.slots {
  display: grid;
  gap: var(--space-2);
}

.slot {
  position: relative;
  height: 34px;
  display: flex;
  align-items: center;
  padding-inline: var(--space-3);
  border-radius: var(--radius-sm);
  border: 1px dashed var(--ink-500);
  font-size: var(--step--2);
  transition:
    background var(--dur-base) var(--ease-out),
    border-color var(--dur-base) var(--ease-out);
}

.slot--filled {
  border-style: solid;
  border-color: color-mix(in oklab, var(--accent-500) 45%, transparent);
  background: color-mix(in oklab, var(--accent-500) 12%, transparent);
}

.slot__name {
  color: var(--text-100);
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.slot__empty {
  color: var(--text-400);
  font-style: italic;
}

/* ---- Transitions -------------------------------------------------------- */

.chip-enter-active,
.chip-leave-active {
  transition: all var(--dur-base) var(--ease-out);
}

.chip-enter-from,
.chip-leave-to {
  opacity: 0;
  transform: scale(0.7);
}

.chip-leave-active {
  position: absolute;
}

.occupant-enter-active,
.occupant-leave-active {
  transition: all var(--dur-base) var(--ease-out);
}

.occupant-enter-from {
  opacity: 0;
  transform: translateX(-8px);
}

.occupant-leave-to {
  opacity: 0;
  transform: translateX(8px);
}

/* ---- Verdict ------------------------------------------------------------ */

.verdict {
  display: flex;
  gap: var(--space-5);
  align-items: flex-start;
  margin-top: var(--space-6);
  padding: var(--space-6);
  border-radius: var(--radius-lg);
  border: 1px solid color-mix(in oklab, var(--mint-400) 40%, var(--ink-600));
  background: color-mix(in oklab, var(--mint-400) 8%, var(--ink-800));
}

.verdict__mark {
  flex-shrink: 0;
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: var(--mint-400);
  color: var(--ink-900);
  font-size: var(--step-1);
  font-weight: 700;
}

.verdict h2 {
  font-size: var(--step-2);
  margin-bottom: var(--space-3);
}

.verdict p {
  color: var(--text-300);
  font-size: var(--step--1);
  max-width: 62ch;
  margin-bottom: var(--space-4);
}

.verdict strong {
  color: var(--mint-400);
}

.verdict-enter-active {
  transition: all var(--dur-slow) var(--ease-spring);
}

.verdict-enter-from {
  opacity: 0;
  transform: translateY(16px);
}

/* ---- States ------------------------------------------------------------- */

.skeleton {
  height: 420px;
  border-radius: var(--radius-lg);
  background: linear-gradient(100deg, var(--ink-800) 30%, var(--ink-750) 50%, var(--ink-800) 70%);
  background-size: 220% 100%;
  animation: shimmer 1.4s ease-in-out infinite;
}

@keyframes shimmer {
  from { background-position: 180% 0; }
  to   { background-position: -80% 0; }
}

.notice--error {
  padding: var(--space-6);
  border-radius: var(--radius-lg);
  border: 1px solid color-mix(in oklab, var(--rose-400) 40%, var(--ink-600));
  background: color-mix(in oklab, var(--rose-400) 7%, transparent);
}

.notice--error h3 {
  color: var(--rose-400);
  margin-bottom: var(--space-2);
}
</style>
