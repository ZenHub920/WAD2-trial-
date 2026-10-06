# Encore

**Concert companion matching, built on the Gale-Shapley stable matching algorithm.**

People miss shows they wanted to see because nobody in their circle shares the artist.
Ticket resale solved supply; it never solved company. The forums that try to fill the gap
run first-come-first-served, which pairs the fastest responder rather than the best fit —
and those pairings fall apart before the date.

Encore runs a matching round per concert. Everyone is considered together, and the result
carries a guarantee: **no two people would both rather have been matched with each other.**

---

## Quick start

Two processes. Backend first.

```bash
# Terminal 1 — API on :3000
cd server
npm install
npm run seed          # 5 concerts, ~124 people, ~34 groups
npm start

# Terminal 2 — Vue app on :5173
cd client
npm install
npm run dev
```

Open <http://localhost:5173>.

```bash
cd server
npm test              # 78 tests
npm run bench         # algorithm comparison against baselines
npm run bench:scale   # runtime scaling study
```

---

## Why this is Gale-Shapley and not something else

Gale-Shapley solves the **Stable Marriage Problem**, which needs two *disjoint* sets of
agents. "Match any concert-goer with any other concert-goer" is not bipartite — that is the
**Stable Roommates Problem**, which Gale-Shapley cannot solve and which is not even
guaranteed to have a stable solution.

So the domain is modelled with the two-sided structure that genuinely exists:

| Side | Who | Capacity |
|---|---|---|
| **Party** | someone holding spare tickets, or forming a group | `q ≥ 1` |
| **Seeker** | wants to join exactly one group | `1` |

That is the **Hospital/Residents problem** — the many-to-one generalisation of stable
marriage — and it keeps every guarantee: a stable matching always exists, deferred
acceptance finds one in time linear in the acceptable pairs, and the seeker-proposing
version is seeker-optimal.

Irving's algorithm for stable roommates is also implemented
(`server/src/matching/stableRoommates.js`) for a true peer-to-peer mode, including correct
detection of instances with no stable matching.

Full specification: **[`docs/ALGORITHM.md`](docs/ALGORITHM.md)**.

---

## What the backend actually does

**Preference lists are computed, not entered.** Nobody ranks two hundred strangers. Eight
signals are scored per pair — vibe similarity (cosine over a six-axis vector), section,
plans, arrival time, reliability, language, region, budget fit — then combined under **two
different weight vectors**, one per direction. A party bears the no-show risk so it weights
reliability at 26%; a seeker is buying an evening so it weights section and vibe. That
asymmetry is what makes the instance a real stable-matching problem rather than something a
sort could solve.

**Hard constraints come first.** Gender preference, age policy, budget ceiling and
blocklists are gates, not scores. A pair failing one appears on neither list, which makes
the preference lists *incomplete* — the case Hospital/Residents handles natively, and the
reason a seeker can correctly finish a round unmatched.

**Stability is verified, not asserted.** The blocking-pair search runs after every round,
and every stored round keeps the preference snapshot it was computed from, so any
historical matching can be re-checked later. There is an endpoint for it, and a button on
every results page.

**Every round records its proposal trace**, which is what the visualiser replays.

---

## Evaluation

`npm run bench`. 400 seekers, 200 parties, 296 slots, 52,370 compatible pairs:

| Algorithm | Blocking pairs | Match rate | Mean rank | Total score |
|---|---|---|---|---|
| **Gale-Shapley** | **0** | 74.0% | 5.55 | 499.78 |
| Greedy (best pair first) | 175 | 74.0% | 4.32 | **503.73** |
| Random (first-come-first-served) | 21,097 | 74.0% | 65.88 | 387.06 |

**Greedy wins on aggregate score by 0.79% and produces 175 blocking pairs.** Those are 175
pairs of people who would both rather abandon the system's suggestion and pair up privately.
A higher total across a matching nobody honours is worth less than a slightly lower one
that holds — aggregate score is not the objective, stability is.

Gale-Shapley produced zero blocking pairs in all four scenarios tested (balanced,
oversubscribed, undersubscribed, large groups). Greedy produced them in all four.

### Runtime, and where the real bottleneck is

`npm run bench:scale`. The solver is not the expensive part:

| Seekers | Parties | Feasible pairs | Build prefs | Solve | Verify |
|---|---|---|---|---|---|
| 100 | 40 | 2,598 | 4ms | 0.2ms | 0.1ms |
| 1,000 | 400 | 265,556 | 800ms | 15ms | 17ms |
| 5,000 | 2,000 | 6,668,452 | 36,191ms | 1,636ms | 1,228ms |

Preference construction dominates by more than 20×. Two things came out of profiling it:
caching each user's vibe-vector magnitude (a `sqrt` per pair per side) and skipping
blocklist string allocation when the blocklist is empty cut the pair-scoring cost by 1.7×.
Then partitioning by concert — free, since cross-event pairs are infeasible by definition —
took the same 5,000-seeker population from **36.2s to 1.7s**, a 24× improvement.

---

## Layout

```
server/
  src/matching/       the engine — no HTTP, no database, independently testable
    compatibility.js    hard constraints + directional scoring
    preferences.js      preference lists and O(1) rank maps
    galeShapley.js      deferred acceptance, Hospital/Residents
    stability.js        blocking-pair verification
    baselines.js        greedy and random, for comparison
    metrics.js          evaluation metrics
    stableRoommates.js  Irving's algorithm, peer-to-peer mode
    maxHeap.js          worst-held-offer retrieval in O(log q)
  src/db/             schema, repositories, seed
  src/services/       round orchestration, re-verification, per-seeker explanations
  src/routes/         HTTP layer
  test/               78 tests
  bench/              synthetic data generator + evaluation harness

client/
  src/assets/         design tokens and base stylesheet
  src/components/     header, footer, stability explainer, vibe radar
  src/views/          home, concerts, concert, algorithm visualiser, round, method

docs/ALGORITHM.md     the specification
```

The matching engine has no dependency on Express or SQLite, which is why the benchmarks can
run it directly and why the tests cover the algorithm without standing up a server.

---

## The visualiser

`/concerts/:id/algorithm` replays a round's recorded proposal trace — play, pause, step,
scrub, speed. Accepts, rejects and evictions are colour-coded, groups show their held
offers filling and emptying, and displaced seekers drop back into the "still proposing"
rail. It is reading the solver's actual output, not an animation of an idea.

---

## API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/concerts` | list with live supply/demand counts |
| `GET` | `/api/concerts/:id/parties` | groups with spare tickets |
| `GET` | `/api/concerts/:id/requests` | people looking |
| `GET` | `/api/concerts/:id/match/preview?baselines=true&trace=true` | dry run, writes nothing |
| `POST` | `/api/concerts/:id/match` | run and persist a round |
| `GET` | `/api/rounds/:id` | round with per-seeker results |
| `GET` | `/api/rounds/:id/trace` | the proposal sequence |
| `GET` | `/api/rounds/:id/verify` | re-check stability against the stored snapshot |
| `GET` | `/api/concerts/:id/explain/:requestId` | why one seeker got their result |

---

## Known limits

- **Ties break by id.** Deterministic and reproducible, and it keeps the strict-preference
  guarantees, but a fairer scheme would randomise per round so the same user is not
  repeatedly advantaged.
- **Seeker-optimal means party-pessimal.** Proposing from the other side gives parties their
  best stable outcome instead. Which side proposes is a policy decision.
- **SQLite.** Fine for this scale and it keeps the project runnable from a clone. All SQL is
  confined to `repositories.js`, so moving to MySQL or Postgres is one file.
- **No authentication.** Out of scope; user identity is passed directly.

All people and events in the seed data are fictional.
