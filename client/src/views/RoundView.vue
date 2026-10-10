<script setup>
import { ref, computed, onMounted } from 'vue';
import { api, LABELS } from '../api.js';
import { useRoute } from 'vue-router';

const props = defineProps({ id: { type: String, required: true } });
const route = useRoute();
const concertLink = computed(() => {
  const concertId = route.query.concertId;
  return typeof concertId === 'string' && concertId ? `/concerts/${encodeURIComponent(concertId)}` : '/concerts';
});

const round = ref(null);
const results = ref([]);
const verification = ref(null);
const loading = ref(true);
const verifying = ref(false);
const error = ref(null);

onMounted(async () => {
  try {
    const data = await api.round(props.id);
    round.value = data.round;
    results.value = data.results;
  } catch (err) {
    error.value = err;
  } finally {
    loading.value = false;
  }
});

async function verify() {
  verifying.value = true;
  try {
    verification.value = await api.verifyRound(props.id);
  } catch (err) {
    error.value = err;
  } finally {
    verifying.value = false;
  }
}

const matched = computed(() => results.value.filter((r) => r.outcome === 'matched'));
const unmatched = computed(() => results.value.filter((r) => r.outcome === 'unmatched'));

/** Group matched seekers under the party that took them. */
const groups = computed(() => {
  const byParty = new Map();
  for (const row of matched.value) {
    if (!byParty.has(row.party_id)) {
      byParty.set(row.party_id, { host: row.host_name, section: row.section, members: [] });
    }
    byParty.get(row.party_id).members.push(row);
  }
  return [...byParty.entries()];
});

/** Distribution of achieved ranks, for the histogram. */
const rankHistogram = computed(() => {
  const counts = new Map();
  for (const row of matched.value) {
    counts.set(row.seeker_rank, (counts.get(row.seeker_rank) ?? 0) + 1);
  }
  const max = Math.max(1, ...counts.values());
  return [...counts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([rank, count]) => ({ rank, count, pct: (count / max) * 100 }));
});
</script>

<template>
  <div class="container section">
    <div v-if="loading" class="skeleton" />

    <div v-else-if="error" class="notice--error" role="alert">
      <h3>{{ error.status === 403 ? 'Operator access required'
        : error.status === 401 ? 'Sign in required' : 'Could not load this round' }}</h3>
      <p v-if="error.status === 403">Detailed round results are available only to operators. You can still see the public forecast and your own result on the concert page.</p>
      <p v-else-if="error.status === 401">Sign in with an operator account to see detailed round results. Your own result is available on the concert page after signing in.</p>
      <p v-else class="mono">{{ error.message }}</p>
      <RouterLink v-if="error.status === 401" to="/login" class="btn btn--primary">Sign in</RouterLink>
      <RouterLink :to="concertLink" class="btn btn--ghost">{{ route.query.concertId ? 'Concert and your result' : 'Browse concerts and your result' }}</RouterLink>
    </div>

    <template v-else-if="round">
      <RouterLink :to="`/concerts/${round.concertId}`" class="back">← Back to concert</RouterLink>

      <header class="head">
        <p class="eyebrow">Round {{ round.id }}</p>
        <h1>Matching results</h1>
        <p class="lede">
          {{ round.metrics.matched }} of {{ round.metrics.eligibleSeekers }} seekers placed,
          computed by {{ round.algorithm.replace(/_/g, ' ') }} in
          {{ round.timings.totalMs }}ms.
        </p>
      </header>

      <!-- ----------------------------------------------- Stability banner -->
      <div class="stamp" :class="round.isStable ? 'stamp--ok' : 'stamp--bad'">
        <div class="stamp__mark">{{ round.isStable ? '✓' : '!' }}</div>
        <div class="stamp__body">
          <h2>
            {{ round.isStable ? 'Verified stable' : `${round.blockingPairCount} blocking pairs` }}
          </h2>
          <p v-if="round.isStable">
            Every acceptable pairing was checked. There is no pair of people who would
            both rather have been matched with each other than with what they got.
          </p>
          <p v-else>
            This matching contains pairs who would both prefer to defect. That is a bug —
            deferred acceptance should never produce one.
          </p>

          <button class="btn btn--ghost stamp__btn" :disabled="verifying" @click="verify">
            {{ verifying ? 'Checking…' : 'Re-check independently' }}
          </button>

          <Transition name="fade">
            <p v-if="verification" class="stamp__verdict mono">
              Re-ran the blocking-pair search over {{ verification.pairsChecked }} acceptable
              pairs against this round's stored preference snapshot:
              <strong :class="verification.verified ? 'ok' : 'bad'">
                {{ verification.blockingPairCount }} found
              </strong>.
              {{ verification.agreesWithStoredClaim
                ? 'Agrees with the stored claim.'
                : 'DISAGREES with the stored claim — the record has been altered.' }}
            </p>
          </Transition>
        </div>
      </div>

      <!-- ------------------------------------------------------- Metrics -->
      <section class="metrics">
        <div v-for="metric in [
          { label: 'Match rate', value: `${Math.round(round.metrics.matchRate * 100)}%`,
            note: `${round.metrics.matched} of ${round.metrics.eligibleSeekers}` },
          { label: 'First choice', value: `${Math.round(round.metrics.firstChoiceRate * 100)}%`,
            note: 'got their top-ranked group' },
          { label: 'Top three', value: `${Math.round(round.metrics.topThreeRate * 100)}%`,
            note: 'placed within their first three' },
          { label: 'Mean rank', value: round.metrics.seekerRank.mean ?? '—',
            note: `worst was ${round.metrics.seekerRank.worst ?? '—'}` },
          { label: 'Capacity used', value: `${Math.round(round.metrics.capacityUtilisation * 100)}%`,
            note: 'of all open slots' },
          { label: 'Solve time', value: `${round.timings.solveMs}ms`,
            note: `prefs ${round.timings.preferencesMs}ms` },
        ]" :key="metric.label" class="metric">
          <p class="metric__label">{{ metric.label }}</p>
          <p class="metric__value tabular">{{ metric.value }}</p>
          <p class="metric__note">{{ metric.note }}</p>
        </div>
      </section>

      <!-- ----------------------------------------------------- Histogram -->
      <section v-if="rankHistogram.length" class="histogram">
        <h2 class="section-title">Where people landed on their own list</h2>
        <p class="section-note">
          Rank 1 means they were placed with their top-ranked group. Deferred acceptance
          is seeker-optimal, so this distribution is the best achievable across all
          stable matchings.
        </p>
        <div class="bars">
          <div v-for="bin in rankHistogram" :key="bin.rank" class="bar">
            <div class="bar__track">
              <div class="bar__fill" :style="{ height: `${bin.pct}%` }">
                <span class="bar__count tabular">{{ bin.count }}</span>
              </div>
            </div>
            <span class="bar__label mono">#{{ bin.rank }}</span>
          </div>
        </div>
      </section>

      <!-- -------------------------------------------------------- Groups -->
      <section class="groups">
        <h2 class="section-title">The groups</h2>
        <div class="groups__grid">
          <article v-for="[partyId, group] in groups" :key="partyId" class="card group">
            <header class="group__head">
              <h3>{{ group.host }}</h3>
              <span class="tag tag--accent">{{ LABELS.section[group.section] }}</span>
            </header>
            <ul class="group__members">
              <li v-for="member in group.members" :key="member.seeker_request_id">
                <span class="group__name">{{ member.seeker_name }}</span>
                <span class="group__rank mono tabular" :title="`Their #${member.seeker_rank} choice`">
                  #{{ member.seeker_rank }}
                </span>
              </li>
            </ul>
          </article>
        </div>
      </section>

      <!-- ----------------------------------------------------- Unmatched -->
      <section v-if="unmatched.length" class="unmatched">
        <h2 class="section-title">Not placed this round</h2>
        <p class="section-note">
          Demand exceeded the open slots, or their hard filters left nothing compatible.
          They carry into the next round automatically.
        </p>
        <div class="chips">
          <span v-for="row in unmatched" :key="row.seeker_request_id" class="tag">
            {{ row.seeker_name }}
          </span>
        </div>
      </section>
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

.head { margin-bottom: var(--space-6); }
.head h1 { margin-block: var(--space-3) var(--space-4); }

.section-title {
  font-size: var(--step-2);
  margin-bottom: var(--space-3);
}

.section-note {
  color: var(--text-400);
  font-size: var(--step--1);
  max-width: var(--measure);
  margin-bottom: var(--space-5);
}

/* ---- Stability stamp ---------------------------------------------------- */

.stamp {
  display: flex;
  gap: var(--space-5);
  padding: var(--space-5);
  border-radius: var(--radius-lg);
  border: 1px solid;
  margin-bottom: var(--space-7);
}

.stamp--ok {
  border-color: color-mix(in oklab, var(--mint-400) 40%, var(--ink-600));
  background: color-mix(in oklab, var(--mint-400) 8%, var(--ink-800));
}

.stamp--bad {
  border-color: color-mix(in oklab, var(--rose-400) 45%, var(--ink-600));
  background: color-mix(in oklab, var(--rose-400) 9%, var(--ink-800));
}

.stamp__mark {
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  font-size: var(--step-1);
  font-weight: 700;
  color: var(--ink-900);
}

.stamp--ok .stamp__mark { background: var(--mint-400); }
.stamp--bad .stamp__mark { background: var(--rose-400); }

.stamp__body h2 {
  font-size: var(--step-1);
  margin-bottom: var(--space-2);
}

.stamp--ok h2 { color: var(--mint-400); }
.stamp--bad h2 { color: var(--rose-400); }

.stamp__body p {
  color: var(--text-300);
  font-size: var(--step--1);
  max-width: 62ch;
}

.stamp__btn {
  margin-top: var(--space-4);
}

.stamp__verdict {
  margin-top: var(--space-4);
  padding: var(--space-3);
  border-radius: var(--radius-sm);
  background: var(--ink-850);
  font-size: var(--step--2);
  line-height: 1.5;
}

.stamp__verdict .ok { color: var(--mint-400); }
.stamp__verdict .bad { color: var(--rose-400); }

/* ---- Metrics ------------------------------------------------------------ */

.metrics {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: var(--space-3);
  margin-bottom: var(--space-8);
}

.metric {
  padding: var(--space-4);
  border-radius: var(--radius-md);
  border: var(--border-hairline);
  background: var(--ink-800);
}

.metric__label {
  font-family: var(--font-mono);
  font-size: var(--step--2);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-400);
}

.metric__value {
  font-family: var(--font-display);
  font-size: var(--step-3);
  font-weight: 700;
  color: var(--text-100);
  line-height: 1.15;
  margin-block: var(--space-2) var(--space-1);
}

.metric__note {
  font-size: var(--step--2);
  color: var(--text-400);
}

/* ---- Histogram ---------------------------------------------------------- */

.histogram { margin-bottom: var(--space-8); }

.bars {
  display: flex;
  align-items: flex-end;
  gap: var(--space-3);
  height: 190px;
  padding: var(--space-4);
  border-radius: var(--radius-lg);
  border: var(--border-hairline);
  background: var(--ink-800);
}

.bar {
  flex: 1;
  max-width: 76px;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.bar__track {
  flex: 1;
  display: flex;
  align-items: flex-end;
}

.bar__fill {
  position: relative;
  width: 100%;
  min-height: 4px;
  border-radius: var(--radius-sm) var(--radius-sm) 0 0;
  background: linear-gradient(to top, var(--accent-600), var(--accent-400));
  animation: grow var(--dur-slow) var(--ease-out) backwards;
}

@keyframes grow {
  from { transform: scaleY(0); transform-origin: bottom; }
}

.bar__count {
  position: absolute;
  top: -1.45em;
  left: 50%;
  translate: -50% 0;
  font-size: var(--step--2);
  color: var(--text-300);
}

.bar__label {
  text-align: center;
  margin-top: var(--space-2);
  font-size: var(--step--2);
  color: var(--text-400);
}

/* ---- Groups ------------------------------------------------------------- */

.groups { margin-bottom: var(--space-8); }

.groups__grid {
  display: grid;
  gap: var(--space-4);
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
}

.group__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  padding-bottom: var(--space-3);
  margin-bottom: var(--space-3);
  border-bottom: var(--border-hairline);
}

.group__head h3 { font-size: var(--step-0); }

.group__members {
  list-style: none;
  padding: 0;
  display: grid;
  gap: var(--space-2);
}

.group__members li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3);
  border-radius: var(--radius-sm);
  background: var(--ink-750);
  font-size: var(--step--1);
}

.group__name { color: var(--text-200); }

.group__rank {
  font-size: var(--step--2);
  color: var(--accent-400);
}

/* ---- Unmatched ---------------------------------------------------------- */

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}

/* ---- States ------------------------------------------------------------- */

.skeleton {
  height: 400px;
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

.notice--error h3 { color: var(--rose-400); margin-bottom: var(--space-2); }

.fade-enter-active { transition: opacity var(--dur-base) var(--ease-out); }
.fade-enter-from { opacity: 0; }
</style>
