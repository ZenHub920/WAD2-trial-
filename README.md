# Encore

**Find people to go to the concert with.**

Encore is a concert companion app. The secondary ticket market solves ticket *supply* but
does nothing about *company* — people skip shows they want to see because nobody in their
circle likes the artist. Generic "find a buddy" forums produce first-come-first-served
chaos, where the fastest responder wins rather than the best fit.

Encore replaces that with a matching engine: it computes compatibility from a preference
questionnaire and runs **Gale–Shapley deferred acceptance** (Hospital/Residents variant) to
place concert-goers into groups, with a **provable guarantee that no two users would rather
abandon their assignment and pair up privately**.

Around that core sit the things a group actually needs: a ticket marketplace, companion
discovery, group chat, availability-and-location meetup planning with live Singapore
transport data, and post-concert feedback that feeds reliability back into matching.

---

## Table of contents

1. [Quick start](#quick-start)
2. [Using the app](#using-the-app)
3. [Architecture](#architecture)
4. [The matching algorithm](#the-matching-algorithm)
5. [Other algorithms](#other-algorithms)
6. [Data model](#data-model)
7. [API surface](#api-surface)
8. [Frontend](#frontend)
9. [Testing](#testing)
10. [Project layout](#project-layout)
11. [Current status and known gaps](#current-status-and-known-gaps)

---

## Quick start

**Prerequisites:** Node.js ≥ 20. No database server needed — SQLite runs in-process, so the
project is runnable straight from a clone.

The client and server are installed independently (each has its own lockfile):

```bash
# from the repository root
cd server && npm install
cd ../client && npm install
```

### Run it

Two processes. Open two terminals:

```bash
# terminal 1 — API on http://localhost:3000
cd server && npm run dev

# terminal 2 — app on http://localhost:5173
cd client && npm run dev
```

Then open **http://localhost:5173**. Vite proxies `/api` to port 3000, so the client stays
origin-relative and no CORS configuration or environment switching is needed in app code
(see [client/vite.config.js](client/vite.config.js)).

From the repository root, `npm run dev` starts **only the server** (it shells out to
`pnpm --dir server run dev`).

### Seed some data

An empty database shows empty pages. Two seeders exist:

```bash
cd server

# Demo dataset: synthetic concerts, parties and seekers
node src/db/seed.js                 # default size
node src/db/seed.js --big           # larger population, for load demos
node src/db/seed.js --reset         # drop existing rows first

# Local test accounts test3…test10, with pre-built scenarios
npm run seed:test-accounts
```

`seed:test-accounts` is the useful one for clicking through features by hand. It creates
accounts that all sign in with password `EncoreTest123!` (e.g. `test3@gmail.com`) and wires
up deliberate situations — an instant mutual match, a dealbreaker collision that makes two
users mutually un-likeable, an account with no photo so the Join button stays disabled, a
published group with open places, and an applicant waiting on the host's decision. It backs
up the database first and is safe to re-run. See the header of
[seedTestAccounts.js](server/src/db/seedTestAccounts.js) for the exact scenarios.

### Operator access

Some pages (official match rounds, round verification, proposal traces, setlist editing,
proof-of-purchase review, moderation reports) require the operator flag:

```bash
cd server && npm run operator:grant -- someone@example.com
```

### Environment variables

Everything optional — the app runs with no `.env` at all, degrading external integrations
to "unavailable" rather than failing. Put a `.env` in `server/`.

| Variable | Purpose |
|---|---|
| `PORT` | API port (default `3000`) |
| `ENCORE_DB` | SQLite file path (default `server/data/encore.db`) |
| `APP_ORIGIN` | Trusted origin; **required when `NODE_ENV=production`** |
| `CORS_ALLOWED_ORIGINS` | Extra comma-separated origins |
| `TRUST_PROXY` | Proxy hop count or subnet list for the deployed topology |
| `TICKETMASTER_API_KEY` | Enables real concert sync; also enables the periodic sync job |
| `TICKETMASTER_DAILY_LIMIT`, `TICKETMASTER_MAX_PAGES`, `TICKETMASTER_MIN_INTERVAL_MS` | Provider budget caps |
| `ONEMAP_EMAIL`, `ONEMAP_PASSWORD`, `ONEMAP_TOKEN`, `ONEMAP_DAILY_LIMIT` | Singapore location search and routing |
| `LTA_ACCOUNT_KEY`, `LTA_DAILY_LIMIT` | Live MRT / bus crowding data |
| `DATA_GOV_SG_API_KEY` | Weather and car-park availability |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Web push (`npm run push:keys` generates a pair) |
| `ENABLE_BACKGROUND_JOBS`, `BACKGROUND_JOB_INTERVAL_MS` | Background worker control |
| `CONCERT_SYNC_INTERVAL_MS`, `CONCERT_CACHE_TTL_MS` | Provider caching |
| `ENCORE_TICKET_IMAGE_DIR`, `ENCORE_AVATAR_DIR` | Upload directories |
| `ENCORE_USE_SYSTEM_CA` | Use the OS certificate store (corporate proxies) |

---

## Using the app

### First run as a user

1. **Register** at `/login`. A new account lands on **`/welcome`**.
2. `/welcome` collects three things: *About you*, *matching preferences*, and your *concert
   vibe*. This is enforced — see [routeGuards.js](client/src/routeGuards.js): until all
   three are saved, every protected page redirects back to `/welcome` with `?next=` so you
   are returned where you were heading. The gate exists because the matching engine has
   nothing to rank on without answers.
3. **Join a concert** from `/concerts`. Participation in a concert is the precondition for
   everything social — companions, groups and meetups are all scoped to one event.

### The five main surfaces

The primary navigation is deliberately ordered, and page transitions slide along that order
(`NAV_ORDER` in [App.vue](client/src/App.vue)) so movement matches the mental model of
swiping:

| Route | What it does |
|---|---|
| **`/concerts`** | Browse events, join one, see parties and the matching preview |
| **`/tickets`** | Ticket marketplace: list, browse, buy, chat with the seller, submit proof of purchase |
| **`/kaki`** | Companion finder — a swipeable deck of one other person at a time ("kaki" is Singlish for *mate*) |
| **`/groups`** | Group discovery: browse published groups, apply, host your own, compare candidates |
| **`/messages`** | One inbox; companion threads, ticket threads and group channels keep separate conversations |

### Companion finder (`/kaki`)

A ranked deck, not a list. You like or pass; a **mutual like opens a chat**. Filters
(artist, date, section, age range) narrow the pool *before* ranking, so the algorithm never
re-surfaces somebody you excluded. **Dealbreakers** from the questionnaire remove people
outright — if you marked "early queue" as a dealbreaker and they love queueing early,
neither of you can like the other. Blocking is mutual in effect (it closes the thread for
both sides) but only the blocker can lift it.

### Groups (`/groups`)

Two ways in, by design:

- **Pick a group directly** — browse published groups, apply, and the host approves or
  declines. You can hold one pending application at a time.
- **Be matched** — join the matching pool and let the engine place you. This is the
  self-serve path: `POST /api/me/concerts/:id/matching/find` runs a round for you and
  returns a proposal, a "waiting" state if no feasible group exists yet, or an idle state.
  Attempts are idempotent per request key, so a lost response cannot double-enrol you.

Hosts get a comparison deck of applicants with compatibility reasons, a friend-invite link,
publish/unpublish control, and member preference management. Each group has a shared
channel at `/groups/:id/channel` — membership is the host's to grant, so the page 404s for
anyone they have not added.

### Meetup planning (`/meetups`)

The part that makes a matched group actually meet. Three steps, with drafts preserved
across all of them:

1. **Share availability** — paint a heatmap grid of 30-minute slots (click, drag, or
   touch-hold-drag on mobile). Optionally add a *private* starting point, visible only to
   you, used to compare journey times without revealing where you live.
2. **Suggest places** — propose a public landmark or entrance; one vote per person.
3. **Finalise** — the planner ranks time-and-place options by how many people can make it,
   then by total and worst-case travel, then by votes. Only required organizers can propose
   and approve. Approval is explicit and counted (`2/2`), and reopening planning invalidates
   previous approvals.

Live Singapore data layers on top: **OneMap** for location search and routing, **LTA
DataMall** for MRT crowding and bus loads, **data.gov.sg** for weather and car-park
availability. Every integration is budgeted, cached, and degrades to "unavailable" with a
stated reason rather than breaking the page.

### After the concert

`/feedback` collects attendance feedback, which feeds the `user_reliability` SQL view. That
reliability score is weighted heavily in how *parties* rank *seekers* — a host exposing
tickets bears the no-show risk, so reliability dominates their preference ordering.

### Demonstrating the algorithm

Three pages exist specifically to show the engine working, which is unusual for a product
and intentional here:

- **`/method`** — plain-language explanation of the approach, reading solver metadata from
  `GET /api/solvers` rather than hardcoding claims.
- **`/concerts/:id/algorithm`** — a live preview on real data: the instance classification,
  which solver was chosen and why, the stability verdict, and a side-by-side comparison
  against the greedy and random baselines.
- **`/rounds/:id`** — results of a committed round, with an animated step-by-step trace of
  the proposal sequence (accept / evict / reject), per-party rosters, and the verification
  result (operator only).

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  Browser                                                         │
│                                                                  │
│  Vue 3 SPA (<script setup>, Composition API)                     │
│    views/ (32)  components/ (58)  composables/ (8)               │
│    vue-router 4 ── beforeEach: auth + preferences gate           │
│    api.js — single fetch wrapper, cookie-credentialed            │
│    EventSource ← Server-Sent Events                              │
│    service worker ← Web Push                                      │
└───────────────────────────┬──────────────────────────────────────┘
                            │  /api  (Vite proxy in dev)
┌───────────────────────────▼──────────────────────────────────────┐
│  Express 4 (ESM, Node ≥ 20)                                      │
│                                                                  │
│  Middleware   security headers → error guard → request guard      │
│               → CORS → rate limiter → JSON (4 MB, no inflate)     │
│  Routes       declarations only                                   │
│  Controllers  HTTP shape, validation, status codes                │
│  Services     business logic, external providers, SSE, jobs       │
│  Matching     the algorithm engine — pure functions, no I/O        │
│  Repositories all SQL; nothing above this layer writes SQL        │
└───────────────────────────┬──────────────────────────────────────┘
                            │  better-sqlite3 (synchronous)
┌───────────────────────────▼──────────────────────────────────────┐
│  SQLite — server/data/encore.db                                  │
│  schema.sql + 16 idempotent migration modules                   │
└──────────────────────────────────────────────────────────────────┘
                            │
                   external: Ticketmaster · OneMap · LTA DataMall
                             data.gov.sg · SMTP · Web Push
```

### Layering rules the codebase actually follows

- **Repositories own all SQL.** Controllers and services never write queries. The
  `repos` object is built once in [repositories.js](server/src/db/repositories.js) and
  threaded through; repositories needing cross-entity lookups receive `repos` themselves.
- **Routes declare, controllers respond.** [routes/index.js](server/src/routes/index.js) is
  a flat list of paths and guards. All validation and response shaping lives in controllers.
- **The matching engine is pure.** Everything in [server/src/matching/](server/src/matching/)
  is a function from data to data — no database, no HTTP, no clock. That is what makes it
  directly benchmarkable and unit-testable.
- **Dependency injection throughout.** `createApp({ db, env, fetchImpl, mailer, webPush })`
  takes every external dependency as a parameter. Tests pass an in-memory database and a
  stub `fetch` rather than mocking modules.

### Request lifecycle

Every `/api` request passes through, in order:

1. **Security headers** — CSP, frame options, referrer policy; relaxed only for public image paths
2. **Error response guard** — strips internal error detail outside development
3. **Request guard** — custom-header CSRF check on unsafe methods
4. **CORS** — exact origin allowlist; never trusts `Host`/`X-Forwarded-Host`
5. **Rate limiter** — SQLite-backed, keyed on IP *and* authenticated user
6. **JSON body parse** — 4 MB cap, compressed bodies rejected (`415`)
7. **Session resolution** — `req.user` from an httpOnly SHA-256-hashed cookie token
8. **Group-membership invalidation** — on membership-mutating routes, the audience is
   snapshotted before and after so a departed member's open tab closes promptly
9. **Route guard** — `requireUser` or `requireOperator`
10. **Controller**
11. On a successful non-GET, `delivery.wake()` nudges the background worker

### Real-time and background work

**Server-Sent Events, not WebSockets** — and the reasoning is written down in
[realtime.js](server/src/services/realtime.js): chat traffic is almost entirely
server→client, sending stays an ordinary authenticated POST, and SSE inherits the session
cookie, passes through the Vite dev proxy unchanged, and reconnects on its own with no
dependency. Events are addressed to **users**, not conversations, so a client cannot
subscribe its way into a thread it has no right to read. One caveat is stated plainly
rather than left to be discovered: this is an in-process bus, so running multiple server
processes behind a load balancer would need Redis pub/sub or similar.

A background worker ([delivery.js](server/src/services/delivery.js)) handles Web Push
fan-out, weather checks, expired-token cleanup (hourly) and Ticketmaster sync. Push
endpoints are validated against an allowlist of real push services, and P-256 keys are
checked as actual curve points rather than merely the right length.

---

## The matching algorithm

The full specification is in **[docs/ALGORITHM.md](docs/ALGORITHM.md)** — read that for the
formal treatment. This is the working summary.

### Why Hospital/Residents, not plain Gale–Shapley

Gale–Shapley solves **Stable Marriage**, which needs two *disjoint* sets of agents. A naive
"match any concert-goer with any other" formulation is **not bipartite** — it is **Stable
Roommates**, which Gale–Shapley cannot solve and which is not even guaranteed to *have* a
stable matching.

So the domain is modelled with the two-sided structure that genuinely exists in it:

| Side | Who | Capacity |
|---|---|---|
| **Party** (the "hospital") | A user holding tickets, or forming a group, with `q` open slots | `q ≥ 1` |
| **Seeker** (the "resident") | A user looking to join exactly one party for that concert | `1` |

This is the **Hospital/Residents** problem, the many-to-one generalisation of stable
marriage, and it keeps every Gale–Shapley guarantee: a stable matching always exists,
deferred acceptance finds one in time linear in the acceptable pairs, and the
seeker-proposing version is **seeker-optimal**.

### Step 1 — Hard constraints (feasibility gate)

`checkFeasibility(seeker, party)` in [compatibility.js](server/src/matching/compatibility.js).
A pair appears on **neither** preference list unless all hold:

1. Same concert
2. Not a self-match (`seeker.user_id ≠ party.host_user_id`)
3. **Affordability** — `seeker.spend_band_max ≥ party.spend_band`
4. **Gender preference**, checked in *both* directions
5. **Age policy** — if either side set a strict policy, the other's band must fall in tolerance
6. Neither user is on the other's blocklist

These are not decoration: a companion-matching product without them is unsafe, and they are
what make the preference lists *incomplete* rather than complete permutations — precisely
the case the HR variant handles natively.

### Step 2 — Derived preference lists

Nobody ranks hundreds of strangers by hand, so the system **computes** both orderings from a
weighted score. `scorePair()` produces eight normalised components in `[0,1]`:

| Component | Definition |
|---|---|
| `section` | exact match 1.0 · adjacent tier 0.6 · otherwise 0.2 |
| `vibe` | cosine similarity of the two 6-dimensional vibe vectors |
| `arrival` | 1.0 same plan · 0.5 adjacent · 0.0 opposite ends |
| `plans` | Jaccard index of desired-activity sets |
| `language` | 1.0 if any shared language, else 0.0 |
| `region` | 1.0 same · 0.5 adjacent · 0.2 otherwise (hand-built adjacency graph, not a distance metric) |
| `reliability` | counterpart's reliability, `+0.1` if verified, capped at 1 |
| `budget_fit` | `1 − (spend_band_max − spend_band) / 3` |

**The weights are deliberately asymmetric:**

```
SEEKER→PARTY   section .22  vibe .24  arrival .12  plans .14
               language .08  region .06  reliability .10  budget_fit .04

PARTY→SEEKER   section .12  vibe .22  arrival .10  plans .12
               language .08  region .06  reliability .26  budget_fit .04
```

A party exposing tickets bears the no-show risk, so `reliability` dominates its ranking; a
seeker is buying an experience, so `section` and `vibe` dominate theirs. (Both vectors are
asserted to sum to 1 at module load.)

**This asymmetry is essential, not cosmetic.** If both sides ranked by the same symmetric
score, every agent would agree on the ordering, the instance would be trivial, and greedy
assignment would find the single reachable stable matching. The asymmetry is what makes this
a genuine stable-matching problem with the possibility of preference cycles and blocking
pairs.

Ties break by ascending entity id after rounding to 6 decimal places, so ordering is total
and deterministic — which keeps runs reproducible and keeps the instance in the strict-
preference regime where HR's guarantees apply without weak/strong/super-stability
complications.

### Step 3 — Seeker-proposing deferred acceptance

[galeShapley.js](server/src/matching/galeShapley.js):

```
free ← queue of all seekers with a non-empty preference list
while free is not empty:
    s ← free.pop()
    if s has exhausted pref[s]: s is unmatched; continue
    p ← pref[s][s.next++]

    if |assigned[p]| < capacity[p]:
        assign s to p                            -- free slot
    else:
        w ← member of assigned[p] with the WORST rank under p
        if rank[p][s] < rank[p][w]:
            unassign w; free.push(w)             -- evict, w resumes proposing
            assign s to p
        else:
            free.push(s)                         -- rejected; try next party
```

Two data-structure choices make the complexity claim real:

- **`rank[p]` is a `Map`** from seeker id to list position, built once. Without it, every
  "does `p` prefer `s` to `w`?" test is a linear scan and the algorithm degrades to `O(n²q)`.
- **`assigned[p]` is a max-heap keyed by rank** ([maxHeap.js](server/src/matching/maxHeap.js)),
  so finding and evicting the worst member are `O(1)` and `O(log q)`. It is a *max*-heap
  because rank 0 is the most preferred, so "worst" means largest.

Total cost: **`O(E log q)`**, `E` = acceptable pairs — effectively linear.

**Termination** is straightforward: each iteration advances exactly one seeker's pointer
through a finite list, pointers never move backwards, so total work is bounded by `Σ|pref[s]| = E`.

Proposal order is deterministic (seekers sorted by id) purely so traces and tests are
reproducible — the *result* is order-independent, since deferred acceptance converges to the
same seeker-optimal matching regardless.

### Step 4 — Stability verification

A pair `(s, p)` **blocks** matching `M` if:

1. `s` and `p` are mutually acceptable and `(s,p) ∉ M`, **and**
2. `s` is unmatched or strictly prefers `p` to `M(s)`, **and**
3. `p` has a free slot or strictly prefers `s` to its worst current member

`findBlockingPairs()` enumerates every acceptable pair and tests all three in `O(E)`. It
runs after every round, **inside the transaction boundary**, so an unstable result can never
be committed. The verdict is stored with the round — every matching in the database carries
a proof of its own stability.

### The solver registry and the guarantee ledger

This is the part that goes beyond a textbook implementation, and the reasoning is worth
reading in [registry.js](server/src/matching/registry.js) and
[classify.js](server/src/matching/classify.js).

`classifyInstance()` reports the **narrowest** class that fits, because narrower classes
carry stronger guarantees:

| Class | Condition | Solver |
|---|---|---|
| `empty` | either side empty | — |
| `one_to_one` | all capacities = 1 (Stable Marriage) | deferred acceptance |
| `one_to_many` | some capacity > 1 (Hospital/Residents) | deferred acceptance |
| `with_couples` | ≥1 **reciprocated** `linked_request_id` (HRC) | none exact yet |
| `with_lower_quotas` | ≥1 party with `min_size > 1` (HRLQ) | none exact yet |
| `peer_to_peer` | one pool, no parties (Stable Roommates) | Irving's algorithm |

A link counts only when reciprocated — a one-sided link is malformed data or a withdrawn
partner, and treating it as a couple would change the problem being solved without anyone
asking. A `min_size` of 0 or 1 is not a constraint.

**Decomposition is only valid along infeasibility boundaries.** It is tempting to split a
mixed instance — solve the singles with HR, the linked pairs separately, union the results.
That silently destroys stability: a single and a member of a linked pair can form a blocking
pair across the partition, and neither sub-solve would ever examine it. An instance may be
split only where the feasibility graph is *disconnected*. Partitioning by concert is sound
for exactly that reason; partitioning by couples or capacity is not. The classifier
therefore describes the whole instance and never splits it.

`selectSolver()` then takes the strongest-guarantee solver that can run. If none models
every feature present, the strongest *partial* solver runs on the **relaxed** instance and
the dropped constraints are recorded — because a solver that ignored a constraint did not
solve the problem it was given, so its guarantees do not carry over. Stability is downgraded
to `not_guaranteed`, optimality to `none`.

**Verification severity follows the promise.** With one solver, "verify and throw" was
correct. With two it is not: HR-with-Couples is NP-hard and may admit no stable matching, so
asserting would crash on a correct result, while loosening the assertion globally would
strip protection from solvers that do guarantee stability.

| Promise | Check | On a blocking pair |
|---|---|---|
| `guaranteed` | assert | **throw** — it is a bug |
| `best_effort` / `not_guaranteed` | measure | record the count |

Every round records what was **promised** before it ran (theory) separately from what was
**measured** after (this instance). Conflating the two is how a system starts overstating
its results:

```json
{
  "solver": "hospital-residents",
  "instanceClass": "with_couples",
  "selectedBecause": "no registered solver models every constraint, so hospital-residents runs on the relaxed instance",
  "relaxations": ["linked_pairs"],
  "promised": { "stability": "not_guaranteed", "optimality": "none" },
  "verification": { "mode": "measure", "stable": true, "blockingPairs": 0, "pairsChecked": 74 },
  "headline": "Solved with linked_pairs ignored — this is not a solution to the full problem."
}
```

Note `verification.stable: true` alongside `promised.stability: "not_guaranteed"`. Both are
correct and they mean different things: no blocking pair was found *in the relaxed instance*,
a far smaller claim than *this is a stable solution to the problem that was asked*. That is
why `headline` exists and why the UI renders it rather than deciding for itself.

Persisted on `match_rounds` as `solver_id`, `instance_class`, `stability_promise`,
`relaxations_json`, `ledger_json` — the first four duplicated out of the JSON so rounds can
be filtered in SQL without parsing every blob.

### Peer-to-peer mode — Irving's stable roommates

When every participant is symmetric (nobody holds tickets, everyone wants a partner) the
instance is not bipartite. [stableRoommates.js](server/src/matching/stableRoommates.js)
implements **Irving's algorithm**: phase 1 is a Gale–Shapley-like proposal sequence producing
a reduced preference table; phase 2 eliminates *rotations*, the cyclic structures that must
be resolved for stability.

Unlike HR, **a stable matching may not exist**, and the algorithm detects and reports that
rather than returning something unstable. The contrast between HR (always solvable) and
Stable Roommates (sometimes not) is a real finding, not a gap.

### Benchmark results

`cd server && npm run bench` — measured on this machine, 2026-11-05:

| Scenario | Algorithm | Blocking pairs | Match % | Mean rank | 1st choice | Total score |
|---|---|---|---|---|---|---|
| **Balanced**<br>400 seekers · 200 parties · 296 slots | Gale–Shapley | **0** | 74.0 | 5.19 | 47.3% | 490.10 |
| | Greedy | **148** | 74.0 | 4.66 | 48.3% | 493.28 |
| | Random | **27 183** | 74.0 | 83.63 | 0.7% | 360.86 |
| **Oversubscribed**<br>800 seekers · 120 parties · 179 slots | Gale–Shapley | **0** | 22.4 | 3.52 | 65.9% | 309.53 |
| | Greedy | **190** | 22.4 | 1.81 | 70.4% | 311.14 |
| | Random | **40 184** | 22.4 | 48.64 | 1.1% | 223.96 |
| **Undersubscribed**<br>150 seekers · 200 parties · 409 slots | Gale–Shapley | **0** | 100.0 | 1.33 | 79.3% | 248.60 |
| | Greedy | **48** | 100.0 | 1.56 | 70.7% | 249.60 |
| | Random | **10 461** | 100.0 | 78.77 | 0.7% | 188.24 |
| **Large groups** (q ≤ 6)<br>600 seekers · 120 parties · 395 slots | Gale–Shapley | **0** | 65.8 | 4.79 | 53.2% | 655.78 |
| | Greedy | **362** | 65.8 | 4.78 | 54.2% | 659.44 |
| | Random | **30 057** | 65.8 | 49.53 | 1.3% | 495.44 |

**The headline result:** greedy beats deferred acceptance on aggregate compatibility by
0.4–0.65%, and produces 48–362 blocking pairs doing it. Gale–Shapley produced a stable
matching in **4 of 4** scenarios; greedy produced blocking pairs in **4 of 4**.

A blocking pair is not a theoretical blemish. It is a real pair of users who would both
rather abandon the system's suggestion and pair up privately — a product failure. A higher
total across a matching nobody honours is worth less than a slightly lower one that holds.
That trade *is* the argument for the algorithm.

Note also that match rate is **identical** across all three algorithms in every scenario.
That is the **Rural Hospitals Theorem** visible in the data: in Hospital/Residents the set
of unmatched residents is the same in every stable matching, so a seeker Encore turns away
would be turned away by any stable method — it is not an artefact of this solver or of which
side proposes. Worth being able to tell a user.

**Runtime scaling** (`npm run bench:scale`):

| Seekers | Parties | Feasible pairs | Prefs (ms) | Solve (ms) | Verify (ms) | Blocking |
|---|---|---|---|---|---|---|
| 100 | 40 | 3 303 | 2.5 | 0.1 | 0.1 | 0 |
| 500 | 200 | 80 271 | 80.8 | 1.6 | 1.9 | 0 |
| 1 000 | 400 | 325 396 | 350.0 | 6.6 | 9.8 | 0 |
| 2 500 | 1 000 | 2 033 197 | 2 729.6 | 79.6 | 88.5 | 0 |

Solve time tracks `E` closely, as the complexity claim predicts. The dominant cost is
**building** the preference lists, not solving them — scoring is `O(n·m)` over all candidate
pairs while the solve is `O(E log q)`.

> **Known limit:** the `n = 5000` row of the scaling study **crashes with a V8
> out-of-memory error**. At that size the instance holds roughly 8 million feasible pairs
> and the materialised preference lists exceed the default ~4 GB heap. The algorithm is not
> at fault — the benchmark holds every list in memory at once. Fixing it means streaming
> preference construction or raising `--max-old-space-size`. Treat 2 500 seekers per concert
> as the tested ceiling.

---

## Other algorithms

### Trait scoring — one rule per dimension

[traitScoring.js](server/src/services/traitScoring.js) is the most interesting non-matching
piece. Questionnaire concepts compare one way — *what I said I want* against *what you said
you are* — which is right for a **want** but wrong for most dimensions the quiz learns,
because they fail in different directions:

| Rule | Dimensions | Why |
|---|---|---|
| **SIMILARITY** | energy, fandom, extraversion | Two quiet people have a fine night; two loud people have a fine night; one of each is the mismatch. What matters is the **distance**, in either direction. |
| **BOTH_HIGH** | agreeableness | Not distance — two difficult people are not compatible just because they are equally difficult. The pair is only as accommodating as its least accommodating half, so the score follows the **lower** of the two. |
| **ORDINAL** | crowd position | Barricade, middle and back lie on a line. Neighbours are a compromise; the two ends mean spending the concert apart. |
| **INTENT** | what each came for | Not a scale at all — some pairs of intentions work, others do not, with no ordering between them. It takes a **table**. |

Scoring all four the same way is the main weakness of comparing only concept lists, and
fixing it is worth more than collecting more answers.

**Dealbreakers are not part of this arithmetic.** Everything above yields a number to be
weighed; a dealbreaker *removes somebody*. They are checked before any scoring runs, because
no amount of agreeing about supper makes up for the one thing somebody said they would not
accept. Same principle as the finder: a filter beats the ranking rather than competing
with it.

### Companion recommendations

[companionRecommendations.js](server/src/services/companionRecommendations.js) ranks the
`/kaki` deck, and the header explains why it is *not* Gale–Shapley: companion finding is
**one pool**. Everybody wants the same thing and nobody holds anything the others want, so
there are no two disjoint sides to propose between. Applying Gale–Shapley would mean
inventing a split (alphabetical? join order?) and the "stability" it then guaranteed would be
stability against an arbitrary fiction.

The right model for one symmetric pool is Stable Roommates, and the engine already knows it:
`classifyInstance({ people })` returns `PEER_TO_PEER` and the registry routes that to
Irving's algorithm. This module hands the pool to the **registry** rather than naming a
solver, so solver choice stays one decision recorded in one place — the same path group
rounds take, where the same registry picks deferred acceptance because *that* instance
really is bipartite.

Unlike HR, a stable matching need not exist here — and that is fine, because a deck only
needs an **order**. When Irving's reports no stable matching, the deck still ranks by score
and simply has no partner to lead with. With no questionnaire answers at all, it returns the
filtered pool untouched and *says so*, and the finder falls back to plain filtering rather
than pretending an order means something.

### Meetup option ranking

[meetupPlanning.js](server/src/services/meetupPlanning.js) — `compareMeetupOptions()` is a
lexicographic comparator over time-and-place candidates:

1. Most people available (descending)
2. Travel cost — total then worst-case journey minutes when route times are available,
   otherwise total then maximum haversine distance (`distanceKm()`, 6371 km mean radius)
3. Most votes
4. Earliest start, then place id — so ordering is total and stable

The fallback between route times and straight-line distance is explicit, and a
`distanceCoverageComparable: false` flag prevents comparing options whose distance data
covers different subsets of respondents — ranking on incomparable data would produce a
confident-looking but meaningless order.

### Supporting algorithms

- **Group comparison** — [groupComparison.js](client/src/utils/groupComparison.js) builds
  the host's side-by-side applicant deck with per-factor reasons
- **Message pagination** — [messagePage.js](server/src/db/messagePage.js) keyset (cursor)
  pagination, so inserts during scrollback cannot shift pages
- **Admission queue** — [admissionQueue.js](server/src/db/admissionQueue.js) ordering for
  pending join requests
- **Concert palette** — [concertPalette.js](server/src/services/concertPalette.js) extracts
  a dominant hue from the event poster so each concert page is themed by its own artwork
  (paired with the `usePosterHue` composable)
- **Provider budget + cache** — [providerBudget.js](server/src/services/providerBudget.js),
  [providerCache.js](server/src/services/providerCache.js) enforce per-provider daily call
  caps and TTL caching so an external API cannot be hammered or blow a quota

---

## Data model

SQLite, with [schema.sql](server/src/db/schema.sql) (837 lines) as the base and 16
idempotent migration modules layered on top at connection time. Every migration is safe to
re-run, so there is no separate migration command — opening the database brings it current.

**Core**
`users` · `sessions` · `blocks` · `concerts` · `concert_participants` · `parties`

**Marketplace**
`tickets` · `issued_tickets` · `ticket_numbers` · `orders` · `ticket_conversations` ·
`ticket_messages` · `saved_tickets` · `ticket_inquiries`

**Matching**
`seeker_requests` · `match_rounds` · `match_results` · `match_trace` · `match_proposals` ·
`match_declines` · `kaki_decisions` · `seeker_party_preferences` · `matching_search_requests` ·
`active_seat_claims`

**Groups**
`group_settings` · `group_memberships` · `membership_conflicts` ·
`group_member_preferences` · `group_friend_invites` · `group_join_requests` ·
`group_join_request_events` · `group_connections` · `group_channel_members` ·
`group_channel_messages` · `user_group_preferences` · `seeker_discovery_preferences`

**Meetups**
`meetups` · `meetup_creation_requests` · `meetup_places` · `meetup_availability` ·
`meetup_availability_responses` · `meetup_votes` · `meetup_comments` · `meetup_approvals` ·
`meetup_confirmation_context`

**Messaging**
`conversations` · `messages` · `conversation_reads` · `conversation_settings`

**Platform**
`notifications` · `notification_preferences` · `push_subscriptions` · `background_jobs` ·
`account_security` · `account_action_tokens` · `moderation_actions` · `api_rate_limits` ·
`reports` · `attendance_feedback` · `group_attendance_feedback` · `concert_setlists` ·
`setlist_tracks` · `provider_cache` · `provider_budget` · `concert_updates`

**One view:** `user_reliability`, derived from completed-versus-no-show history. This is
what closes the loop — post-concert feedback becomes the `reliability` component that
dominates how parties rank seekers.

Code shared between client and server lives in [shared/](shared/) as `.mjs`
(`concertEligibility`, `meetupDates`, `ticketSections`) so eligibility rules and slot maths
cannot drift between the two sides.

---

## API surface

All under `/api`. `GET /api/health` is the liveness probe (and what Playwright waits on).

| Area | Representative endpoints | Guard |
|---|---|---|
| **Auth** | `POST /auth/register`, `/auth/login`, `/auth/logout`, `GET /auth/me` | — |
| **Account security** | `POST /auth/password-reset/{request,confirm}`, `/auth/email-verification/{request,confirm}`, `/auth/password/change`, `DELETE /auth/sessions` | mixed |
| **Concerts** | `GET /concerts`, `/concerts/:id`, `/concerts/external`, `GET|PUT|DELETE /concerts/:id/setlist` | public / operator to write |
| **Participation** | `GET /me/concerts`, `POST|DELETE /concerts/:id/participation` | user |
| **Marketplace** | `GET|POST /tickets`, `PATCH|DELETE /tickets/:id`, `POST /tickets/:id/orders`, `POST /me/tickets/:id/proof` | user to write |
| **Ticket chat** | `POST /tickets/:id/conversations`, `GET /conversations`, `POST /conversations/:id/messages` | user |
| **Companion finder** | `GET /kaki/pool`, `/kaki/recommendations`, `/kaki/matches`, `PUT|DELETE /kaki/decisions/:concertId/:targetUserId` | user |
| **Companion chat** | `GET /kaki/stream` *(SSE)*, `/kaki/conversations`, `POST /kaki/conversations/:id/messages`, `PATCH|DELETE .../:messageId` | user |
| **Group discovery** | `GET /groups/discover/:concertId`, `/me/hosted-groups`, `GET|PUT /me/group-preferences/...` | user |
| **Group lifecycle** | `PUT /groups/:id/settings`, `POST /groups/:id/{publish,leave,cancel,friend-invites,join-requests}`, `POST /group-join-requests/:id/respond` | user |
| **Group channels** | `GET /me/group-channels`, `/group-channels/:partyId`, `POST .../messages`, `POST|DELETE .../members` | user + membership |
| **Matching (self-serve)** | `GET|POST|DELETE /me/concerts/:id/matching`, `POST /me/concerts/:id/matching/find`, `GET /me/concerts/:id/result` | user |
| **Matching (operator)** | `POST /concerts/:id/match`, `GET /rounds/:id`, `/rounds/:id/{trace,verify}`, `/concerts/:id/explain/:requestId` | **operator** |
| **Matching (open)** | `GET /concerts/:id/match/preview`, `GET /solvers` | public (trace needs operator) |
| **Meetups** | `GET /me/meetups`, `/meetup-context`, `POST /meetups`, `PUT /meetups/:id/{availability,vote}`, `POST /meetups/:id/{places,comments,propose,approve,cancel,reopen}` | user |
| **Meetup integrations** | `GET /meetups/:id/{weather,locations,transport,travel-suggestions,environment}` | user |
| **Profile** | `GET|PATCH /me/profile`, `GET /users/:id/profile`, `PUT|DELETE /me/avatar` | user |
| **Preferences** | `GET|PUT /me/preferences`, `GET /preference-quiz`, `/preference-concepts`, `GET|PUT /me/discovery-preferences/:concertId` | user |
| **Notifications** | `GET /me/notifications`, `/me/notifications/unread`, `POST .../read-all`, `GET|PUT /me/notification-preferences` | user |
| **Safety** | `PUT|DELETE /users/:userId/block`, `POST /users/:userId/reports`, `GET /me/blocked` | user |
| **Moderation** | `GET /operator/reports`, `POST /operator/reports/:id/resolve`, `POST /operator/users/:id/unsuspend`, `GET /operator/verifications` | **operator** |
| **Feedback** | `POST /feedback`, `GET /me/feedback`, `/me/feedback-opportunities` | user |

Two cross-cutting conventions:

- **Optimistic concurrency.** Mutating meetup endpoints take a **`version`** field, so two
  people editing the same plan get a "this plan has changed, your draft is kept" result
  rather than a silent overwrite.
- **Idempotency.** The matching endpoints (`POST /concerts/:id/match`,
  `POST /me/concerts/:id/matching`, `POST /me/concerts/:id/matching/find`) require an
  **`Idempotency-Key`** header — a UUID v4, rejected with `invalid_idempotency_key`
  otherwise. A retried attempt whose response was lost returns the original outcome instead
  of running a second round or double-enrolling the user.

---

## Frontend

Vue 3 + vue-router 4 + Vite 6. **No Pinia, no Vuex** — shared state is plain
`ref`/`computed` exported from modules ([auth.js](client/src/auth.js),
[groupPreferences.js](client/src/groupPreferences.js), [vibe.js](client/src/vibe.js),
[kaki.js](client/src/kaki.js), [market.js](client/src/market.js)). At this size that is
enough, and it keeps the reactive graph inspectable.

**Bootstrap 5 is used for the responsive grid and utilities only.** Its component styles
(`.btn`, `.card`, `.nav`) are deliberately excluded, because Encore has its own design
system — and `bootstrap-grid` loads *before* `base.css` so Encore's `.container` rule wins.

```
client/src/
  main.js              router table (32 routes), lazy-loaded views, title handling
  routeGuards.js       auth + preferences gate, run before every navigation
  api.js               single fetch wrapper (405 lines) — the only place that knows HTTP
  auth.js              session refresh, sign-out, race-safe via a version counter
  chatLive.js          EventSource subscription with reconnect
  chatPages.js         cursor pagination state
  browserPush.js       service-worker registration and subscription
  formErrors.js        inline field errors instead of browser validation bubbles
  views/         (32)  one per route
  components/    (58)  including market/ (20) and kaki/ subfolders
  composables/   (8)   useInView, useReveal, useCountUp, usePosterHue,
                       useReducedMotion, useMeetupBoard, useMeetupSummaries,
                       useConcertEligibility
  utils/         (5)   pure helpers — the easiest things to unit test
  assets/
    tokens.css   (282) colour, type, spacing, motion tokens — single source of truth
    base.css     (874) element and layout styles
    groups.css   (485) group/meetup surfaces
```

**Design tokens.** `tokens.css` defines `--ink-*` surface layers, `--text-*` ink levels,
`--accent-*` and data hues, all themed for light and dark via `data-theme` on `<html>`.
Theme choice persists in `localStorage`. Data-view hues (cyan for proposals, amber for
evictions, orchid for accepted/stable) were darkened from their originals specifically to
pass contrast on a white card instead of glowing on black — and
[theme-contrast.test.js](test/client/theme-contrast.test.js) asserts that.

**Accessibility and motion.** A skip link, `role="alert"` on error notices, keyboard
navigation through the meetup planner steps, and `prefers-reduced-motion` honoured
throughout — page transitions drop to opacity-only, scroll behaviour switches to `instant`,
and `useReducedMotion` lets components opt out of animation entirely.

**Responsive.** Every surface is built phone-first and verified up to wide desktop;
[responsive-ui.spec.js](test/e2e/responsive-ui.spec.js) exercises it across viewports. The
availability grid has genuinely distinct interaction models per input type — click-and-drag
with a mouse, hold-then-drag to paint with touch, and swipe to scroll.

---

## Testing

**1 379 automated tests** across three layers, plus 19 Playwright end-to-end specs. Roughly
25 600 lines of test code against ~45 500 lines of application code.

All test infrastructure lives in the top-level [test/](test/) directory rather than beside
the source, and reuses the client's installed tooling — moving tests must not require a
second `node_modules` or a machine-specific link.

```bash
npm test              # server + client (stops if the server suite fails)
npm run test:server   # Node test runner, 63 files
npm run test:client   # Vitest component tests, then client-node
npm run test:e2e      # Playwright, boots its own API + Vite
npm run test:all      # everything
```

### Vue component testing — Vitest + @vue/test-utils

**44 Vitest files, 683 tests** in [test/client/](test/client/). Configuration:
[vitest.config.mjs](test/config/vitest.config.mjs) — `jsdom` environment, the real `@vitejs/plugin-vue`
so `.vue` files compile exactly as in production, `maxWorkers: 2`, and `clearMocks` /
`restoreMocks` on so no test leaks a stub into the next.

[setup.js](test/client/setup.js) handles what jsdom lacks:

```js
enableAutoUnmount(afterEach);               // no component survives its test
window.matchMedia = vi.fn(query => ({       // jsdom has no matchMedia
  media: query,
  matches: query === '(prefers-reduced-motion: reduce)',
  addEventListener() {}, removeEventListener() {},
}));
Object.defineProperty(document, 'visibilityState', { value: 'visible' });
afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; });
```

Note `matches` deliberately returns `true` for reduced motion: tests run with animation
disabled, so assertions never race a transition.

[helpers.js](test/client/helpers.js) provides the shared harness:

```js
// Mount a view with a real router on a memory history
export async function mountPage(component, { path = '/', props = {}, stubs = {} } = {}) {
  const router = createRouter({ history: createMemoryHistory(), routes: [...] });
  await router.push(path);
  await router.isReady();
  const wrapper = mount(component, {
    props, attachTo: document.body, global: { plugins: [router], stubs },
  });
  await flushPromises();           // let onMounted fetches settle
  return { wrapper, router };
}

// Query by what the user sees, not by CSS class
export function button(wrapper, text) { /* find <button> by its text */ }
export function field(wrapper, text)  { /* find input via its <label> */ }
```

`button()` and `field()` are the important choice: they locate elements **by visible text
and label association**, not by selector. A test that finds a button by its label keeps
passing when the markup is restructured and fails when the *label* changes — which is
exactly when a user would notice.

Tests use a `TestSuite:` / `TestN:` naming convention with a comment above each case
explaining what it covers:

```js
// OrderSummary shows the order amount, delivery fee and total.
describe('TestSuite: OrderSummary', () => {
  // Computed property check: total = subtotal + delivery fee.
  it('Test2: adds the delivery fee into the order total', () => {
    const wrapper = mount(OrderSummary, {
      props: { subtotalCents: 31000, deliveryFeeCents: 550 },
    });
    expect(wrapper.text()).toContain('SGD $315.50');
    expect(wrapper.text()).not.toContain('Free');
  });

  // Conditional rendering: the <h3> appears only when the heading prop is set.
  it('Test3: shows a heading only when one is given', () => {
    expect(mount(OrderSummary, { props: { subtotalCents: 0 } })
      .find('h3').exists()).toBe(false);
  });
});
```

**What the Vue tests cover:**

| Concern | Example files |
|---|---|
| Props → render, computed values | `market-components`, `market-unit` |
| Conditional rendering, slots | `market-components`, `confirmation-dialog` |
| Events and `v-model` | `search-select`, `availability-grid` |
| Full page mount with router + stubbed API | `profile-page`, `market-tickets-page`, `welcome-and-admin` |
| Navigation guards | `route-guards`, `navigation-disclosure` |
| SSE / live updates | `chat/chat-live`, `notification/notification-ui` |
| Optimistic concurrency and draft preservation | `meetup-planner`, `group-workspace-recovery` |
| Lost-response recovery (POST committed, response dropped) | `group-explorer-consistency`, `chat/ticket-chat-recovery` |
| Accessibility and contrast | `theme-contrast`, `header-overlays` |
| Service worker | `notification/service-worker` |

The recovery tests are the most valuable ones. They assert that a request whose POST
committed but whose response was lost does not resubmit, and that unsaved drafts survive a
stale-version rejection — the failures that are hardest to find by hand and worst to ship.

Component tests mount against a **stubbed API layer** rather than a live server, except
where a file uses [serverHarness.js](test/client/serverHarness.js) to exercise a real
Express app over an in-memory database.

### Server testing — the Node built-in test runner

**63 files, 696 tests** in [test/server/](test/server/), run with `node --test`. No Jest, no
Mocha — Node's own runner, driven by
[run-node-tests.mjs](test/scripts/run-node-tests.mjs), which passes explicit file paths so
Node cannot wander off and discover Vitest specs, Playwright specs, or old reports.

Tests build a real Express app via `createApp({ db, env, fetchImpl })` against a fresh
in-memory SQLite database and exercise it over HTTP. Dependency injection means there is
almost no module mocking: a stub `fetchImpl` stands in for Ticketmaster or OneMap, and the
real routing, middleware, validation and SQL all run.

Coverage spans the algorithm (`galeShapley`, `stableRoommates`, `compatibility`, `registry`,
`preferenceFactors`), HTTP and security (`httpSecurity`, `sessions`, `accountSecurity`,
`providerSecurity`, `ticketmasterSecurity`), the full group and meetup lifecycle, real-time
delivery, push, pagination, and every migration module.

`test/client-node/` holds one more Node-runner file for pure client utilities that need no
DOM.

### End-to-end — Playwright

**19 specs** in [test/e2e/](test/e2e/). The config boots the whole stack itself: an API on
`127.0.0.1:3105` (waiting on `/api/health`) and a Vite server on `127.0.0.1:5175`. Serial
(`workers: 1`), `reducedMotion: 'reduce'`, trace and screenshot retained on failure.

Specs cover the full journeys: group-and-meetup lifecycle, matching recovery, realtime
consistency, ticket marketplace, notifications, chat, first-time UX, cross-workflow
consistency, and `responsive-ui` across viewports.

```bash
npm run test:e2e
cd client && npm run test:e2e:report    # open the HTML report
```

### Benchmarks

```bash
cd server
npm run bench          # algorithm comparison against baselines
npm run bench:scale    # runtime scaling study
```

---

## Project layout

```
wad2proj/
├── client/                      Vue 3 SPA
│   ├── src/                     see Frontend above
│   ├── public/                  manifest.webmanifest, sw.js, push-icon.svg
│   ├── index.html
│   ├── vite.config.js           dev server, /api proxy, security headers
│   └── securityHeaders.js       shared between dev and preview
│
├── server/                      Express API
│   ├── src/
│   │   ├── server.js            entry: listen, start jobs, graceful shutdown
│   │   ├── app.js               createApp() — composition root
│   │   ├── config/              env loading, system CA, VAPID key generation
│   │   ├── routes/          (8) declarations only
│   │   ├── controllers/    (17) HTTP shape and validation
│   │   ├── services/       (29) business logic, providers, SSE, jobs
│   │   ├── matching/       (13) the algorithm engine — pure, no I/O
│   │   ├── presentation/    (1) group identity formatting
│   │   └── db/             (45) schema, migrations, repositories, seeds
│   └── data/                    encore.db, uploaded images, avatars
│
├── shared/                      code used by both sides (.mjs)
│
├── test/
│   ├── server/             (63) Node test runner
│   ├── client/             (44) Vitest + @vue/test-utils
│   ├── client-node/         (1) Node runner, DOM-free client utilities
│   ├── e2e/                (19) Playwright
│   ├── bench/                   evaluation harness and instance generator
│   ├── config/                  vitest + playwright configs
│   ├── scripts/                 test launchers
│   ├── support/                 shared dependency resolution, e2e server
│   └── results/                 reports and caches (gitignored)
│
└── docs/
    └── ALGORITHM.md             the formal specification
```

**Approximate size:** 15 800 lines of server JS · 26 700 lines of Vue · 3 000 lines of
client JS · 25 600 lines of tests.

---

## Current status and known gaps

Stated plainly, because a README that only lists what works is not much use.

**Some tests are currently failing**, so `npm test` exits non-zero. They are tracked
separately and are not a guide to which features work.

**Uncommitted work in progress.** Six files are untracked and five of them are **not wired
into the app**:

| File | Status |
|---|---|
| `client/src/views/MarketplaceView.vue` | Not routed — `/tickets` uses `TicketMarketplaceView` |
| `client/src/views/ComingSoonView.vue` | Not imported anywhere |
| `client/src/components/PartyCard.vue` | Not imported anywhere |
| `client/src/components/SiteFooter.vue` | Not imported anywhere |
| `client/src/components/TabBar.vue` | Not imported anywhere |
| `server/src/db/seed.js` | Works, but is untracked and has no npm script |

**`seed.js` has no npm script.** Its own header documents `npm run seed`, which does not
exist in `server/package.json`. Run it as `node src/db/seed.js`.

**Checkout is intentionally unavailable.** `/tickets/:id/checkout` stays disabled until a
real payment provider is configured — see the comment in `main.js`. Orders exist as records;
no money moves.

**Two matching classes are detected but not solved.** `with_couples` (HRC) and
`with_lower_quotas` (HRLQ) are both NP-hard. The classifier reports them, the registry falls
back to deferred acceptance on the relaxed instance, and the ledger records the relaxation
and downgrades the promise — so the result is honest, not wrong. The intended
implementations are a Roth–Peranson style iterative heuristic (as the NRMP uses) plus an
integer-programming exact solver for small instances, which would also provide ground truth
to measure the heuristic against.

**Real-time is single-process.** The SSE bus is in-process. Horizontal scaling needs Redis
pub/sub or equivalent. Documented in `realtime.js` rather than left to be discovered.

**Benchmark ceiling.** The scaling study OOMs at 5 000 seekers (~8M feasible pairs exceed
the default heap). 2 500 seekers per concert is the tested ceiling.

**External integrations need keys.** Ticketmaster, OneMap, LTA and data.gov.sg all degrade
to "unavailable" with a stated reason without credentials. Nothing breaks; those panels just
report that they have no data.

---

## Further reading

- **[docs/ALGORITHM.md](docs/ALGORITHM.md)** — the formal specification: problem statement,
  constraints, derivation, proofs, baselines, metrics, solver registry and guarantee ledger
- **Source comments** — unusually load-bearing in this codebase. The headers of
  [registry.js](server/src/matching/registry.js),
  [classify.js](server/src/matching/classify.js),
  [traitScoring.js](server/src/services/traitScoring.js),
  [companionRecommendations.js](server/src/services/companionRecommendations.js) and
  [realtime.js](server/src/services/realtime.js) explain *why* each design decision was made
  and what the alternatives would have cost. They are worth reading before changing those
  modules.
