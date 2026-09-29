<script setup>
/**
 * The methodology page.
 *
 * The content site's argument: why this problem needs stable matching, what the
 * algorithm does, and what the evaluation showed. Written to be read by someone
 * who has never heard of Gale-Shapley.
 */
import { ref } from 'vue';

const weights = [
  { key: 'Vibe match', seeker: 24, party: 22, note: 'cosine similarity over six axes' },
  { key: 'Section', seeker: 22, party: 12, note: 'pit, standing, seated tiers' },
  { key: 'Plans', seeker: 14, party: 12, note: 'meetup, supper, merch, transport' },
  { key: 'Arrival', seeker: 12, party: 10, note: 'queue at noon vs turn up at doors' },
  { key: 'Reliability', seeker: 10, party: 26, note: 'show-up history and ratings' },
  { key: 'Language', seeker: 8, party: 8, note: 'any shared language' },
  { key: 'Region', seeker: 6, party: 6, note: 'for sharing transport' },
  { key: 'Budget fit', seeker: 4, party: 4, note: 'closeness, not just affordability' },
];

const comparison = [
  {
    algorithm: 'Gale-Shapley',
    blocking: 0,
    rank: 5.55,
    score: 499.78,
    best: true,
  },
  { algorithm: 'Greedy (best pair first)', blocking: 175, rank: 4.32, score: 503.73 },
  { algorithm: 'Random (first-come-first-served)', blocking: 21097, rank: 65.88, score: 387.06 },
];

const openSection = ref('stability');
</script>

<template>
  <div class="container section">
    <header class="head">
      <p class="eyebrow">Method</p>
      <h1>How Encore decides who goes with whom</h1>
      <p class="lede">
        The matching is not a recommendation engine and not a queue. It is a
        classical algorithm with a guarantee attached, and this page explains the
        guarantee and why it is the right one for this problem.
      </p>
    </header>

    <!-- ---------------------------------------------------- Two-sided model -->
    <section id="model" class="block">
      <h2>1. Two sides, not one pool</h2>
      <div class="prose">
        <p>
          It is tempting to model this as "everyone wants a companion, match them up."
          That formulation is the <strong>Stable Roommates problem</strong>, and it has an
          awkward property: for some sets of preferences, <em>no</em> stable matching
          exists at all.
        </p>
        <p>
          So Encore models the situation as it actually occurs. Someone whose friend
          dropped out is holding spare tickets — a <strong>party</strong>, with a fixed
          number of slots. Everyone else is a <strong>seeker</strong>, wanting exactly one.
          Two distinct sides, many-to-one. That is the
          <strong>Hospital/Residents problem</strong>, and unlike stable roommates it is
          always solvable.
        </p>
      </div>

      <div class="sides">
        <div class="side">
          <h3>Party</h3>
          <p class="side__role">the "hospital"</p>
          <ul>
            <li>Holds <strong>q</strong> open slots</li>
            <li>Ranks every seeker it finds acceptable</li>
            <li>Keeps its best offers, releases the rest</li>
          </ul>
        </div>
        <div class="side__arrow" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div class="side">
          <h3>Seeker</h3>
          <p class="side__role">the "resident"</p>
          <ul>
            <li>Wants exactly <strong>one</strong> slot</li>
            <li>Ranks every party it finds acceptable</li>
            <li>Proposes down its list until held</li>
          </ul>
        </div>
      </div>
    </section>

    <!-- ------------------------------------------------------- Preferences -->
    <section id="preferences" class="block">
      <h2>2. Nobody ranks strangers by hand</h2>
      <div class="prose">
        <p>
          A stable matching algorithm needs ordered preference lists. Asking a user to
          rank two hundred strangers is absurd, so the system computes the ranking from
          profile data — eight signals, each normalised, then weighted.
        </p>
        <p>
          The weights differ by direction, and that is the important part. A party is
          handing over a ticket and carries the risk of a no-show, so it weights
          <strong>reliability</strong> heavily. A seeker is buying an evening, so they
          weight <strong>section</strong> and <strong>vibe</strong>. If both sides ranked
          by the same number, every agent would agree on the ordering and the problem
          would collapse into something a sort could solve.
        </p>
      </div>

      <div class="weights">
        <div class="weights__head">
          <span>Signal</span>
          <span>Seeker weights</span>
          <span>Party weights</span>
        </div>
        <div v-for="row in weights" :key="row.key" class="weights__row">
          <div class="weights__label">
            <strong>{{ row.key }}</strong>
            <em>{{ row.note }}</em>
          </div>
          <div class="weights__bar">
            <span class="weights__fill weights__fill--seeker" :style="{ width: `${row.seeker * 3.6}%` }" />
            <span class="weights__num tabular">{{ row.seeker }}%</span>
          </div>
          <div class="weights__bar">
            <span class="weights__fill weights__fill--party" :style="{ width: `${row.party * 3.6}%` }" />
            <span class="weights__num tabular">{{ row.party }}%</span>
          </div>
        </div>
      </div>

      <p class="aside">
        Hard constraints sit before any of this. Gender preference, age policy, budget
        ceiling and blocklists are not scored — a pair failing one never appears on either
        list. That makes the preference lists <em>incomplete</em>, which the
        Hospital/Residents variant handles natively and which is why some seekers can
        correctly end a round unmatched rather than being forced into a pairing they
        rejected.
      </p>
    </section>

    <!-- --------------------------------------------------------- Algorithm -->
    <section id="gale-shapley" class="block">
      <h2>3. Deferred acceptance</h2>
      <div class="prose">
        <p>
          Seekers propose in order down their lists. A party with a free slot accepts
          provisionally. A party that is full compares the proposer against the worst
          offer it currently holds — and if the proposer is better, it swaps them, sending
          the displaced seeker back to propose further down their own list.
        </p>
        <p>
          "Provisionally" is the whole trick. Nothing is final until the process runs out
          of proposals, so an early acceptance never blocks a better pairing that turns
          up later. That is what a first-come-first-served thread cannot do.
        </p>
      </div>

      <pre class="code"><code>while some seeker is free and has parties left:
    s  ← next free seeker
    p  ← s's most preferred party not yet proposed to

    if p has a free slot:
        p provisionally accepts s
    else:
        w ← p's worst currently held seeker
        if p prefers s to w:
            p releases w  →  w becomes free again
            p provisionally accepts s
        else:
            p rejects s   →  s tries their next choice</code></pre>

      <div class="facts">
        <div class="fact">
          <p class="fact__value mono">O(E log q)</p>
          <p class="fact__note">
            E is the number of acceptable pairs. Rank lookups are O(1) and each party's
            held set is a heap.
          </p>
        </div>
        <div class="fact">
          <p class="fact__value">Always terminates</p>
          <p class="fact__note">
            Each proposal advances one seeker's pointer, and pointers never move back.
          </p>
        </div>
        <div class="fact">
          <p class="fact__value">Seeker-optimal</p>
          <p class="fact__note">
            Every seeker gets the best party they could obtain in <em>any</em> stable
            matching. Verified against brute force on small instances.
          </p>
        </div>
      </div>
    </section>

    <!-- --------------------------------------------------------- Stability -->
    <section id="stability" class="block">
      <h2>4. What we actually guarantee</h2>
      <div class="prose">
        <p>
          A pair <strong>blocks</strong> a matching when three things are true at once:
        </p>
      </div>

      <ol class="conditions">
        <li>
          <span class="conditions__n mono">i</span>
          <div>
            <h3>They are acceptable to each other</h3>
            <p>Neither was filtered out by the other's hard constraints.</p>
          </div>
        </li>
        <li>
          <span class="conditions__n mono">ii</span>
          <div>
            <h3>The seeker would rather have the party</h3>
            <p>It sits higher on their list than what they were given — or they got nothing.</p>
          </div>
        </li>
        <li>
          <span class="conditions__n mono">iii</span>
          <div>
            <h3>The party would rather have the seeker</h3>
            <p>It has a spare slot, or ranks them above someone it is currently holding.</p>
          </div>
        </li>
      </ol>

      <div class="prose">
        <p>
          If all three hold, those two people will simply arrange it privately, and the
          matching we published was fiction. The verifier enumerates every acceptable pair
          and tests all three conditions. Its result is stored with the round, so any
          historical matching can be re-checked later — the button on any results page
          does exactly that, against the preference snapshot taken at the time.
        </p>
      </div>
    </section>

    <!-- -------------------------------------------------------- Evaluation -->
    <section id="evaluation" class="block">
      <h2>5. Against the obvious alternatives</h2>
      <div class="prose">
        <p>
          Two baselines, run on identical instances. <strong>Greedy</strong> sorts every
          compatible pair by combined score and assigns from the top down — the
          implementation most people reach for first. <strong>Random</strong> approximates
          the forum thread: whoever gets there first.
        </p>
      </div>

      <div class="table-wrap">
        <table class="results">
          <caption>400 seekers, 200 parties, 296 slots, 52,370 compatible pairs</caption>
          <thead>
            <tr>
              <th scope="col">Algorithm</th>
              <th scope="col">Blocking pairs</th>
              <th scope="col">Mean rank</th>
              <th scope="col">Total score</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in comparison" :key="row.algorithm" :class="{ 'is-best': row.best }">
              <th scope="row">{{ row.algorithm }}</th>
              <td class="tabular" :class="row.blocking === 0 ? 'good' : 'bad'">
                {{ row.blocking.toLocaleString() }}
              </td>
              <td class="tabular">{{ row.rank }}</td>
              <td class="tabular">{{ row.score }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="finding">
        <h3>The result worth noticing</h3>
        <p>
          Greedy scores <strong>0.79% higher</strong> on aggregate compatibility — and
          produces <strong>175 blocking pairs</strong>. Those are 175 pairs of real people
          who would both rather abandon what the system told them and pair up on their own.
        </p>
        <p>
          A higher total score across a matching nobody will honour is worth less than a
          slightly lower one that holds. Aggregate score is not the objective; stability is.
        </p>
      </div>
    </section>

    <!-- ----------------------------------------------------- Where it bends -->
    <section id="limits" class="block">
      <h2>6. Where this stops working</h2>
      <div class="prose">
        <p>
          <strong>Preference construction, not the solver, is the bottleneck.</strong>
          At 5,000 seekers against 2,000 parties in a single event, building the preference
          lists took 36 seconds while deferred acceptance itself took 1.6. Partitioning by
          concert — which costs nothing, since pairs across different events are infeasible
          anyway — brought the same population down to 1.7 seconds.
        </p>
        <p>
          <strong>Ties are broken arbitrarily.</strong> Identical scores are ordered by id,
          which keeps runs reproducible and keeps the guarantees intact, but a fairer scheme
          would randomise per round so the same user is not always advantaged.
        </p>
        <p>
          <strong>Seeker-optimal means party-pessimal.</strong> Running the proposals from
          the other side gives every party its best stable outcome instead. Choosing which
          side proposes is a policy decision, not a technical one, and Encore picks seekers
          because they are the side with fewer alternatives.
        </p>
      </div>
    </section>
  </div>
</template>

<style scoped>
.head {
  max-width: var(--measure);
  margin-bottom: var(--space-8);
}

.head h1 { margin-block: var(--space-3) var(--space-4); }

.block {
  padding-top: var(--space-7);
  margin-top: var(--space-7);
  border-top: var(--border-hairline);
  scroll-margin-top: calc(var(--header-height) + var(--space-4));
}

.block:first-of-type {
  border-top: none;
  margin-top: 0;
  padding-top: 0;
}

.block > h2 {
  margin-bottom: var(--space-4);
}

.aside {
  margin-top: var(--space-5);
  padding: var(--space-4);
  border-left: 3px solid var(--accent-500);
  background: color-mix(in oklab, var(--accent-500) 6%, transparent);
  border-radius: 0 var(--radius-md) var(--radius-md) 0;
  font-size: var(--step--1);
  color: var(--text-300);
  max-width: var(--measure);
}

/* ---- Two sides ---------------------------------------------------------- */

.sides {
  display: grid;
  gap: var(--space-4);
  margin-top: var(--space-6);
  align-items: center;
}

@media (min-width: 720px) {
  .sides {
    grid-template-columns: 1fr auto 1fr;
  }
}

.side {
  padding: var(--space-5);
  border-radius: var(--radius-lg);
  border: var(--border-hairline);
  background: var(--ink-800);
}

.side h3 {
  font-size: var(--step-1);
  color: var(--accent-400);
}

.side__role {
  font-family: var(--font-mono);
  font-size: var(--step--2);
  color: var(--text-400);
  margin-bottom: var(--space-4);
}

.side ul {
  list-style: none;
  padding: 0;
  display: grid;
  gap: var(--space-2);
  font-size: var(--step--1);
  color: var(--text-300);
}

.side li::before {
  content: '— ';
  color: var(--text-400);
}

.side__arrow {
  display: flex;
  gap: 4px;
  justify-content: center;
}

.side__arrow span {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent-500);
  animation: flow 1.4s var(--ease-out) infinite;
}

.side__arrow span:nth-child(2) { animation-delay: 0.16s; }
.side__arrow span:nth-child(3) { animation-delay: 0.32s; }

@keyframes flow {
  0%, 100% { opacity: 0.25; transform: scale(0.8); }
  50% { opacity: 1; transform: scale(1.25); }
}

@media (max-width: 719px) {
  .side__arrow { flex-direction: row; }
}

/* ---- Weights ------------------------------------------------------------ */

.weights {
  margin-top: var(--space-6);
  border-radius: var(--radius-lg);
  border: var(--border-hairline);
  overflow: hidden;
}

.weights__head,
.weights__row {
  display: grid;
  grid-template-columns: 1.5fr 1fr 1fr;
  gap: var(--space-4);
  padding: var(--space-3) var(--space-4);
  align-items: center;
}

.weights__head {
  background: var(--ink-850);
  font-family: var(--font-mono);
  font-size: var(--step--2);
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--text-400);
}

.weights__row {
  border-top: var(--border-hairline);
  background: var(--ink-800);
}

.weights__label strong {
  display: block;
  font-size: var(--step--1);
  color: var(--text-100);
  font-weight: 550;
}

.weights__label em {
  font-style: normal;
  font-size: var(--step--2);
  color: var(--text-400);
}

.weights__bar {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--space-2);
  height: 20px;
}

.weights__fill {
  height: 8px;
  border-radius: var(--radius-pill);
  min-width: 4px;
  transition: width var(--dur-slow) var(--ease-out);
}

.weights__fill--seeker { background: var(--accent-500); }
.weights__fill--party  { background: var(--cyan-500); }

.weights__num {
  font-size: var(--step--2);
  color: var(--text-400);
  white-space: nowrap;
}

@media (max-width: 660px) {
  .weights__head { display: none; }

  .weights__row {
    grid-template-columns: 1fr;
    gap: var(--space-2);
  }
}

/* ---- Code --------------------------------------------------------------- */

.code {
  margin-top: var(--space-5);
  padding: var(--space-5);
  border-radius: var(--radius-lg);
  border: var(--border-hairline);
  background: var(--ink-850);
  overflow-x: auto;
  font-size: var(--step--1);
  line-height: 1.7;
  color: var(--text-300);
}

.code code { font-family: var(--font-mono); }

/* ---- Facts -------------------------------------------------------------- */

.facts {
  display: grid;
  gap: var(--space-3);
  margin-top: var(--space-5);
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
}

.fact {
  padding: var(--space-4);
  border-radius: var(--radius-md);
  border: var(--border-hairline);
  background: var(--ink-800);
}

.fact__value {
  font-family: var(--font-display);
  font-size: var(--step-1);
  font-weight: 700;
  color: var(--accent-400);
  margin-bottom: var(--space-2);
}

.fact__note {
  font-size: var(--step--2);
  color: var(--text-400);
  line-height: 1.5;
}

/* ---- Conditions --------------------------------------------------------- */

.conditions {
  list-style: none;
  padding: 0;
  display: grid;
  gap: var(--space-3);
  margin-block: var(--space-5);
}

.conditions li {
  display: flex;
  gap: var(--space-4);
  padding: var(--space-4);
  border-radius: var(--radius-md);
  border: var(--border-hairline);
  background: var(--ink-800);
}

.conditions__n {
  flex-shrink: 0;
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: var(--rose-400);
  color: var(--ink-900);
  font-size: var(--step--2);
  font-weight: 600;
}

.conditions h3 {
  font-size: var(--step-0);
  margin-bottom: var(--space-1);
}

.conditions p {
  font-size: var(--step--1);
  color: var(--text-300);
}

/* ---- Results table ------------------------------------------------------ */

.table-wrap {
  margin-top: var(--space-5);
  overflow-x: auto;
  border-radius: var(--radius-lg);
  border: var(--border-hairline);
}

.results {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--step--1);
  min-width: 520px;
}

.results caption {
  padding: var(--space-3) var(--space-4);
  text-align: left;
  font-family: var(--font-mono);
  font-size: var(--step--2);
  color: var(--text-400);
  background: var(--ink-850);
  border-bottom: var(--border-hairline);
}

.results th,
.results td {
  padding: var(--space-3) var(--space-4);
  text-align: right;
}

.results thead th {
  font-family: var(--font-mono);
  font-size: var(--step--2);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-400);
  font-weight: 500;
  border-bottom: var(--border-hairline);
}

.results tbody th,
.results thead th:first-child {
  text-align: left;
  font-weight: 500;
  color: var(--text-200);
}

.results tbody tr { background: var(--ink-800); }
.results tbody tr + tr th,
.results tbody tr + tr td { border-top: var(--border-hairline); }

.results tbody tr.is-best {
  background: color-mix(in oklab, var(--mint-400) 7%, var(--ink-800));
}

.results tbody tr.is-best th { color: var(--mint-400); font-weight: 600; }

.results .good { color: var(--mint-400); font-weight: 600; }
.results .bad  { color: var(--rose-400); }

/* ---- Finding ------------------------------------------------------------ */

.finding {
  margin-top: var(--space-5);
  padding: var(--space-5);
  border-radius: var(--radius-lg);
  border: 1px solid color-mix(in oklab, var(--accent-500) 35%, var(--ink-600));
  background: color-mix(in oklab, var(--accent-500) 7%, var(--ink-800));
}

.finding h3 {
  font-size: var(--step-1);
  color: var(--accent-400);
  margin-bottom: var(--space-3);
}

.finding p {
  color: var(--text-300);
  font-size: var(--step--1);
  max-width: var(--measure);
}

.finding p + p { margin-top: var(--space-3); }

@media (prefers-reduced-motion: reduce) {
  .side__arrow span { animation: none; opacity: 0.7; }
}
</style>
