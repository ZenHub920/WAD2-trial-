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

Everything below describes what the code in [server/src/matching/](server/src/matching/) and
[recommendationRepository.js](server/src/db/recommendationRepository.js) actually does. The
engine is pure — no database, no HTTP, no clock — which is what makes it benchmarkable and
unit-testable in isolation.

### Why Hospital/Residents, not plain Gale–Shapley

Gale–Shapley solves **Stable Marriage**, which needs two *disjoint* sets of agents. A naive
"match any concert-goer with any other" formulation is **not bipartite** — it is **Stable
Roommates**, which Gale–Shapley cannot solve and which is not even guaranteed to *have* a
stable matching.

So the domain is modelled with the two-sided structure that genuinely exists in it:

| Side | Who | Capacity |
|---|---|---|
| **Party** (the "hospital") | A user hosting a group for one concert | `q >= 1` (`queueable_places`) |
| **Seeker** (the "resident") | A user looking to join exactly one party for that concert | `1` |

This is **Hospital/Residents**, the many-to-one generalisation of stable marriage, and it
keeps every Gale–Shapley guarantee: a stable matching always exists, deferred acceptance
finds one in time linear in the acceptable pairs, and the seeker-proposing version is
**seeker-optimal**.

### Step 1 — Hard constraints

`checkFeasibility()` in [compatibility.js](server/src/matching/compatibility.js). A pair
appears on **neither** preference list unless all of these hold, which is what makes the
lists *incomplete* rather than complete permutations — the case HR handles natively:

| # | Constraint | Rejection reason |
|---|---|---|
| 1 | Same concert | `different_concert` |
| 2 | `seeker.user_id !== party.host_user_id` | `self_match` |
| 3 | Neither user is on the other's blocklist (checked both directions) | `blocked` |
| 4 | `seeker.spend_band_max >= party.spend_band` | `unaffordable` |
| 5 | Gender preference, enforced symmetrically | `seeker_gender_pref` / `host_gender_pref` |
| 6 | Age policy | `below_party_min_age` / `age_gap_outside_tolerance` |

**Gender** is a three-valued preference, not a "same only" flag. `companion_gender_pref` is
`any`, `male` or `female`; `any` accepts everyone, otherwise the other side's stored gender
must be that one. Both directions are checked, so either side can exclude the pair.

**Age has two different rules**, which is easy to misread:

- `party.strict_age_policy` sets a **floor** — the seeker's band must be at or above
  `party.min_age_band`. One-directional.
- `seeker.strict_age_policy` sets a **symmetric band gap** — the distance between the two
  bands must be within `seeker.age_tolerance` (default `1`).

The blocklist check is guarded behind a non-empty blocklist because the common case is empty
and building two template strings per pair is measurable across millions of pairs.

### Step 2 — Preference lists

Nobody ranks hundreds of strangers by hand, so both orderings are **computed**.
`buildPreferences()` in [preferences.js](server/src/matching/preferences.js) enumerates
pairs **grouped by concert**, so the cost is the sum over concerts of the local product
rather than every seeker against every party. This partition is sound because cross-concert
pairs are infeasible anyway, so the feasibility graph is genuinely disconnected along that
boundary.

#### The base score

`scorePair()` computes eight components in `[0,1]` once per pair, then combines them under
**two different weight vectors**:

| Component | Rule |
|---|---|
| `section` | exact match `1.0` · adjacent tier `0.6` · unknown or distant `0.2` |
| `vibe` | cosine similarity of the two 6-dimensional vibe vectors |
| `arrival` | same `1.0` · adjacent `0.5` · opposite ends `0.0` · unknown `0.5` |
| `plans` | Jaccard index of desired activities; **`0.5` when neither side wants extras** — neutral, not incompatible |
| `language` | `1.0` if any shared language, else `0.0` |
| `region` | same `1.0` · adjacent `0.5` · otherwise `0.2`, from a hand-built adjacency graph, not a distance metric |
| `reliability` | the counterpart's reliability, defaulting to `0.5`, capped at `1` — **directional**: each side judges the *other's* |
| `budgetFit` | `max(0, 1 - gap / 3)` where `gap = spend_band_max - spend_band` |

```
SEEKER->PARTY   section .22  vibe .24  arrival .12  plans .14
                language .08  region .06  reliability .10  budgetFit .04

PARTY->SEEKER   section .12  vibe .22  arrival .10  plans .12
                language .08  region .06  reliability .26  budgetFit .04
```

A host bears the no-show risk, so `reliability` dominates the party's ranking (`.26` against
`.10`); a seeker is buying an experience, so `section` and `vibe` dominate theirs. Both
vectors are asserted to sum to `1` at module load.

**The asymmetry is load-bearing, not cosmetic.** If both sides ranked by the same symmetric
score, every agent would agree on the ordering, the instance would be trivial, and greedy
assignment would find the single reachable stable matching. The asymmetry is what makes this
a genuine stable-matching problem where preference cycles and blocking pairs can exist.

Cosine similarity was the largest cost in preference construction — six property lookups per
side and two square roots, per pair — so each user's vibe vector and its magnitude are
computed once and cached in a `WeakMap` keyed by the vibe object. Nothing is mutated and the
cache is collected with the data it describes.

#### What the live app actually ranks on

The weighted score above is the **default** scorer. For real group matching the service
injects its own, so the live ordering is a **60/40 blend** —
[recommendationRepository.js:92](server/src/db/recommendationRepository.js#L92):

```js
seekerToParty: 0.6 * base.seekerToParty + 0.4 * discovery.seekerScore
partyToSeeker: 0.6 * base.partyToSeeker + 0.4 * discovery.groupScore
```

`discovery` is the questionnaire comparison (`compareProfiles`); `base` is the
eight-component score. Three things about this matter:

- **You are matched against the group, not its host.** `aggregateParty()` replaces the host's
  profile with the group's: vibe is the **mean across all active members**, languages are the
  **union**, reliability is the **mean**. A five-person group with one unreliable member
  scores accordingly.
- **Dealbreakers zero the pair.** If the discovery comparison reports `blocked`, both
  directions are forced to `0` rather than merely penalised.
- **Feasibility is checked per member, not just the host.** `feasible()` runs
  `checkFeasibility` against the host *and every active member*, so one blocked member
  excludes the whole group. It also applies the questionnaire's `preferenceEligibility` gate.

A party with no `group_settings` row — a legacy or unconfigured listing — falls back to the
plain weighted score with no discovery term.

#### Two overrides that outrank score

`buildPreferences` takes two more options the service supplies, and both change the ordering
in ways the raw score cannot express:

- **`preferredPairs`** — `sortCandidates` sorts by the `preferred` flag **before** score, so a
  seeker's explicitly prioritised groups form a **hard tier above everything else**, however
  poorly they score. A deliberate product decision: an explicit choice beats a computed one.
- **`declinedPairs`** — an already-declined pair is skipped entirely, so a rejected offer is
  never re-proposed in a later round.

#### Tie-breaking

Scores are rounded to 6 decimals so they are stable across platforms, then ties break by
ascending id. The ordering is therefore **total and deterministic**, which keeps runs
reproducible and keeps the instance in the strict-preference regime where the HR guarantees
apply without weak/strong/super-stability complications.

### Step 3 — Seeker-proposing deferred acceptance

[galeShapley.js](server/src/matching/galeShapley.js):

```
free <- queue of all seekers with a non-empty preference list
while free is not empty:
    s <- free.pop()
    if s has exhausted pref[s]: s is unmatched; continue
    p <- pref[s][s.next++]

    if |held[p]| < capacity[p]:
        accept s provisionally
    else:
        w <- the member of held[p] with the WORST rank under p
        if rank[p][s] < rank[p][w]:
            evict w; free.push(w)        -- w resumes proposing down its own list
            accept s
        else:
            free.push(s)                 -- rejected; s tries its next party
```

Two data-structure choices make the complexity claim real:

- **`partyRanks` is a `Map`** from seeker id to list position, built once by
  `buildRankMaps()`. The inner loop asks "does `p` prefer `s` to `w`?" once per proposal;
  answering by scanning the list is linear and drags the whole algorithm to `O(n^2 q)`. With
  rank maps it is `O(1)`.
- **`held[p]` is a max-heap keyed by rank** ([maxHeap.js](server/src/matching/maxHeap.js)),
  so reading the worst member is `O(1)` and evicting is `O(log q)`. It is a *max*-heap
  because rank `0` is most preferred, so "worst" means the largest rank value.

Total cost: **`O(E log q)`** where `E` is the number of acceptable pairs.

**Termination:** each iteration advances exactly one seeker's pointer through a finite list
and pointers never move backwards, so total work is bounded by the sum of the list lengths,
which is `E`.

Proposal order is deterministic (seekers sorted by id) so traces and tests reproduce. The
*result* is order-independent — deferred acceptance converges to the same seeker-optimal
matching regardless of proposal order.

With `trace: true` every `accept` / `evict` / `reject` event is recorded, which is what the
round page animates.

### Step 4 — Verification

Two checks run after every solve, and they are not the same check.

**`assertIndividuallyRational()`** holds for *every* solver: nobody may be assigned to a
party absent from their preference list, and no party may exceed capacity. A violation is a
bug regardless of what the solver promised, so it always throws.

**`findBlockingPairs()`** tests stability. A pair `(s, p)` blocks matching `M` when:

1. `s` and `p` are mutually acceptable and the pair is not already in `M`, **and**
2. `s` is unmatched or strictly prefers `p` to its current assignment, **and**
3. `p` has a free slot or strictly prefers `s` to its worst current member

The implementation is `O(E)` with two optimisations: each party's worst held rank is
precomputed so condition 3 is `O(1)` per pair, and because each seeker's list is in
descending preference order the scan **breaks** as soon as it reaches their current
assignment — everything after it is worse by construction.

In [matchingService.js](server/src/services/matchingService.js) this runs **inside the
transaction**, so an unstable result can never be committed, and the verdict is stored with
the round. Every matching in the database carries a proof of its own stability.

### Instance classification and the solver registry

`classifyInstance()` in [classify.js](server/src/matching/classify.js) reports the
**narrowest** class that fits, because narrower classes carry stronger guarantees:

| Class | Condition | Solver |
|---|---|---|
| `empty` | either side empty | — |
| `one_to_one` | all capacities = 1 (Stable Marriage) | deferred acceptance |
| `one_to_many` | some capacity > 1 (Hospital/Residents) | deferred acceptance |
| `with_couples` | at least one **reciprocated** `linked_request_id` (HRC) | none exact — relaxed |
| `with_lower_quotas` | at least one party with `min_size > 1` (HRLQ) | none exact — relaxed |
| `peer_to_peer` | one pool, no parties (Stable Roommates) | Irving's algorithm |

A link counts only when **reciprocated** — a one-sided link is malformed data or a withdrawn
partner, and treating it as a couple would change the problem being solved without anyone
asking. A `min_size` of 0 or 1 is not a constraint.

**Decomposition is only valid along infeasibility boundaries.** It is tempting to split a
mixed instance — solve the singles with HR, the linked pairs separately, union the results.
That silently destroys stability: a single and a member of a linked pair can form a blocking
pair across the partition, and neither sub-solve would ever examine it. An instance may be
split only where the feasibility graph is *disconnected*. Partitioning by concert is sound
for exactly that reason; partitioning by couples or by capacity is not. So the classifier
describes the whole instance and never splits it.

[registry.js](server/src/matching/registry.js) holds all four algorithms with what each may
claim. `selectSolver()` takes the strongest-guarantee solver that can run; if none models
every feature present, the strongest *partial* solver runs on the **relaxed** instance and
the dropped constraints are recorded. A solver that ignored a constraint did not solve the
problem it was given, so its guarantees do not carry over — stability is downgraded to
`not_guaranteed` and optimality to `none`.

| Solver | Handles | Stability | Selectable | Complexity |
|---|---|---|---|---|
| `hospital-residents` | one-to-one, one-to-many, (relaxed) couples and quotas | `guaranteed` | yes | `O(E log q)` |
| `stable-roommates` | peer-to-peer | `not_guaranteed` | yes | `O(n^2)` |
| `greedy-welfare` | one-to-one, one-to-many | `not_guaranteed` | **no** — comparison only | `O(E log E)` |
| `random-fcfs` | one-to-one, one-to-many | `not_guaranteed` | **no** — comparison only | `O(E)` |

Two notes the registry records about deferred acceptance are worth surfacing to users:
seeker-optimal implies **party-pessimal**, and by the **Rural Hospitals Theorem** the set of
unmatched seekers is identical in every stable matching.

### The guarantee ledger

**Verification severity follows the promise.** With one solver, "verify and throw" was
correct. With a registry it is not: HR-with-Couples is NP-hard and may admit no stable
matching, so asserting would crash on a correct result, while loosening the assertion
globally would strip protection from solvers that genuinely do guarantee stability.

| Promise | Check | On a blocking pair |
|---|---|---|
| `guaranteed` | assert | **throw** — it is a bug |
| `best_effort` / `not_guaranteed` | measure | record the count |

Every round records what was **promised** before it ran (theory, from the solver's
declaration) separately from what was **measured** after it (this instance, from the
verifier). Conflating the two is how a system starts overstating its results:

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
`relaxations_json` and `ledger_json` — the first four duplicated out of the JSON so rounds
can be filtered in SQL without parsing every blob.

### Peer-to-peer — Irving's stable roommates

When every participant is symmetric (nobody holds places, everyone wants a partner) the
instance is not bipartite. [stableRoommates.js](server/src/matching/stableRoommates.js)
implements **Irving's algorithm**: phase 1 is a Gale–Shapley-like proposal sequence producing
a reduced preference table; phase 2 eliminates *rotations*, the cyclic structures that must
be resolved for stability. It has its own verifier, `findRoommateBlockingPairs()`, because
the bipartite conditions do not apply to a single pool — and `solveInstance()` refuses to run
a `pairs`-shaped solver on a two-sided instance for the same reason.

Unlike HR, **a stable matching may not exist** — the classic three-person cycle — and the
algorithm detects and reports that rather than returning something unstable. The contrast
between HR (always solvable) and Stable Roommates (sometimes not) is a real result, not a gap.

### Benchmark results

`cd server && npm run bench` — measured on this machine:

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
| **Large groups** (q up to 6)<br>600 seekers · 120 parties · 395 slots | Gale–Shapley | **0** | 65.8 | 4.79 | 53.2% | 655.78 |
| | Greedy | **362** | 65.8 | 4.78 | 54.2% | 659.44 |
| | Random | **30 057** | 65.8 | 49.53 | 1.3% | 495.44 |

**The headline result:** greedy beats deferred acceptance on aggregate compatibility by
0.4–0.65%, and produces 48–362 blocking pairs doing it. Gale–Shapley produced a stable
matching in **4 of 4** scenarios; greedy produced blocking pairs in **4 of 4**.

A blocking pair is not a theoretical blemish. It is a real pair of users who would both
rather abandon the system's suggestion and pair up privately — a product failure. A higher
total across a matching nobody honours is worth less than a slightly lower one that holds.
That trade *is* the argument for the algorithm.

Match rate is **identical** across all three algorithms in every scenario. That is the Rural
Hospitals Theorem visible in the data: a seeker Encore turns away would be turned away by any
stable method, so it is not an artefact of this solver or of which side proposes.

**Runtime scaling** (`npm run bench:scale`):

| Seekers | Parties | Feasible pairs | Prefs (ms) | Solve (ms) | Verify (ms) | Blocking |
|---|---|---|---|---|---|---|
| 100 | 40 | 3 303 | 2.5 | 0.1 | 0.1 | 0 |
| 500 | 200 | 80 271 | 80.8 | 1.6 | 1.9 | 0 |
| 1 000 | 400 | 325 396 | 350.0 | 6.6 | 9.8 | 0 |
| 2 500 | 1 000 | 2 033 197 | 2 729.6 | 79.6 | 88.5 | 0 |

Solve time tracks `E` closely, as `O(E log q)` predicts. The dominant cost is **building**
the preference lists, not solving them — scoring runs over all candidate pairs while the
solve is `O(E log q)`. The 5 000-seeker case exhausts the default heap, since the benchmark
materialises every preference list at once; treat 2 500 seekers per concert as the tested
ceiling.

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

**1 379 automated tests** across the three layers, plus **19 Playwright end-to-end specs**.
Roughly 25 600 lines of test code against ~45 500 lines of application code.

### The three layers, and where they live

| Test Type | What is Tested? | Components Involved | Where in this repo | Tests |
|---|---|---|---|---|
| **Unit test** | A single unit — a plain function, or one Vue component in isolation | One component in isolation | [test/client/](test/client/) · [test/client-node/](test/client-node/) · [test/server/](test/server/) | — |
| **Integration test** | The interaction between two or more units | Two or more integrated components, or a route plus its repository | [test/client/](test/client/) · [test/server/](test/server/) | — |
| **End-to-End (E2E) test** | The complete system from the user's perspective | Entire application — Vite client, Express API, SQLite database | [test/e2e/](test/e2e/) | 19 specs |

Counted by runner rather than by layer, since many files mix component and integration suites:

| Runner | Framework | Files | Tests |
|---|---|---|---|
| `npm run test:client` | **Vitest** + `@vue/test-utils` (jsdom) | 44 | **683** |
| `npm run test:client` (second pass) | Node's built-in runner, DOM-free client utilities | 1 | included above |
| `npm run test:server` | Node's built-in runner (`node --test`) | 63 | **696** |
| `npm run test:e2e` | **Playwright** (Chromium) | 19 | 19 specs |

A Vue component counts as a "unit" here, so a component test is a form of unit testing. When
two or more real components are mounted together, the file labels that suite
`Integration:` — [market-integration.test.js](test/client/market-integration.test.js) and the
profile page's second suite are the clearest examples.

### Running the tests

```bash
npm test              # server, then client (stops if the server suite fails)
npm run test:server   # Node test runner, 63 files
npm run test:client   # Vitest component tests, then the DOM-free pass
npm run test:e2e      # Playwright — boots its own API and Vite server
npm run test:all      # everything

cd client && npm run test:watch        # Vitest in watch mode
cd client && npm run test:e2e:report   # open the Playwright HTML report
```

### Conventions this project follows

**Test suites and test cases.** `describe()` names a suite, `it()` names a case. The
marketplace and profile files use the numbered form throughout:

```js
describe('TestSuite: OrderSummary', () => {
  it('Test2: adds the delivery fee into the order total', () => { ... })
})
```

**Assertions.** `expect(...)` supplies the actual value and a matcher supplies the expected
one; together they are one assertion. Matchers in use across the suite:

| Matcher | Where it is used here |
|---|---|
| `toBe()` | primitives — prices, counts, flags, `element.disabled` |
| `toEqual()` | objects and arrays — the ordered option list a `<select>` renders, request payloads |
| `toContain()` | substring of rendered text, membership in an array |
| `toHaveLength()` | number of cards, rows or members rendered |
| `toBeTruthy()` / `toBeFalsy()` | presence checks such as `wrapper.find(...).exists()` |

**Stubs.** A child component is replaced with a lightweight fake when the parent is the thing
under test, and both kinds appear here. An **automatic stub** when the child is simply
irrelevant to the assertion — Vue Test Utils swaps in an empty placeholder:

```js
// market-components.test.js — the poster and avatar are not what this test is about
mount(OrderItem, { global: { stubs: { TicketPoster: true, UserAvatar: true } } });
```

And a **custom stub** that echoes what it receives, when the point of the test is that the
parent passes the right thing down:

```js
// group-matching.test.js — a fake RouterLink that exposes its target as an href
mount(GroupListingCard, {
  global: { stubs: { RouterLink: { props: ['to'], template: '<a :href="to"><slot /></a>' } } },
});
```

`mountPage` forwards a `stubs` option for the same purpose, and whole modules are stubbed with
`vi.mock` where a gate component or a composable would otherwise pull in the network.

**Robust over fragile.** [helpers.js](test/client/helpers.js) deliberately offers no
selector-based lookup. `button(wrapper, 'Save my response')` finds a `<button>` by its visible
text and `field(wrapper, 'Concert')` finds an input through its `<label>`:

```js
export function button(wrapper, text) {
  const found = wrapper.findAll('button').find(item => item.text().trim() === text);
  if (!found) throw new Error(`Button not found: ${text}`);
  return found;
}
```

So a test keeps passing when the markup is restructured and fails when the *label* changes —
which is the point at which a user would notice. Tests assert on rendered text, emitted
events and the requests sent, not on CSS classes or HTML structure. The one deliberate
exception is [theme-contrast.test.js](test/client/theme-contrast.test.js), which asserts
contrast ratios on the design tokens because that *is* the observable behaviour being checked.

**What is left untested on purpose.** Every HTML tag, every CSS class, exact DOM structure,
and framework behaviour. Integration suites also skip what a component suite already proved —
the profile page's integration tests check that the form and the notification panel save
independently, and do not re-check field validation.

**Verification and validation.** These tests are verification: they check the app against its
specification. Validation — whether the workflows suit real concert-goers — is what the
in-app `/feedback` page and the post-concert reliability loop collect, and is not something a
test suite can answer.

---

### What is tested, page by page

#### Sign in and Welcome — onboarding

New accounts are forced through `/welcome` before anything else, so these tests guard the gate
itself as much as the form.

| Test | Input | Expected output | Purpose |
|---|---|---|---|
| Starts a new member on About you | A fresh account, no saved answers | The About-you step, which requires a language before continuing | The gate opens at the first incomplete step |
| Cannot be skipped | Any new account | No skip button; the page states that saving is required | The preferences gate cannot be bypassed |
| Saves answers as they change | Edits to any answer | Saved with no Save button present | Autosave is the contract, not a button |
| Continues to `?next=` after saving | `?next=/groups`, then a completed save | Navigates to `/groups` | The gate returns people where they were heading |
| Ignores an off-site `?next=` | `?next=https://example.com` | Navigates to the concert list instead | An open-redirect guard |
| Asks for the six vibe ratings | Preferences saved, vibe not | The vibe step, then continues | Both halves of onboarding are required |
| Keeps the questionnaire open on failure | A save that rejects | The questionnaire stays open with an error | A failed save never loses the answers |

Files: [welcome-and-admin.test.js](test/client/welcome-and-admin.test.js) (14) ·
[preferences-onboarding.test.js](test/client/preferences-onboarding.test.js) (7) ·
[route-guards.test.js](test/client/route-guards.test.js) (9)

#### Profile page

The clearest example of the two layers side by side: a `(component tests)` suite of 11
numbered cases, then an `(integration tests)` suite mounting the profile form together with
its notification section.

| Test | Input | Expected output | Purpose |
|---|---|---|---|
| (1) Fills the form with the server's profile | A profile response | Every field populated from it | Props and loaded state render correctly |
| (2) Email is read-only | Any profile | Email not editable; the signed-in name reaches the picture control | A field that must not be edited, and prop passing to a child |
| (3) Signed-out visitor | The load answers `401` | "Sign in to see your profile." | Conditional rendering by auth state |
| (4) Retry after a failed load | A rejected load, then a success | Retry offered, then the form appears | Error state is recoverable |
| (5) Refuses a blank display name | Display name blanked | "Enter a display name.", and no request sent | Client-side validation |
| (6) Refuses with no language chosen | No language chosen | "Choose at least one language." | A required multi-select |
| (7) Saves the edited profile | Several fields edited, name as `'  Jamie Tan  '` | **One** PATCH, name trimmed, then "Saved" | The payload is normalised and batched |
| (8) Explains an expired session | The save answers `401` | Expired-session message with a sign-in link | A failed save never discards the edit |
| (9) Applies a chosen picture at once | A picture is chosen | Sent at once, profile PATCH untouched | Two independent save paths |
| (10)–(11) Rejected picture, then log out | An unreadable file; then Log out | "That file is not a readable image."; session cleared and back to the home page | Upload failure and sign-out side effects |
| **Integration** (1) Renders both together | A profile and notification preferences | Profile form *and* notification panel both render | The page composes its children |
| **Integration** (2)–(3) Independent saves | Change one side only | Saves that side without touching the other | The two panels do not interfere |
| **Integration** (4) Signed out | No session | Notification section omitted entirely | Conditional composition |

Six further cases cover account switching: a late autosave response from the previous account
is ignored, the old account's pending autosave timer is cancelled rather than sent under the
new one, and an avatar response does not overwrite a newer display name.

Files: [profile-page.test.js](test/client/profile-page.test.js) (21)

#### Public profile — concert vibe

| Test | Input | Expected output | Purpose |
|---|---|---|---|
| Renders six self-rated axes | A completed vibe | Six axes plus an accessible text equivalent, no invalid SVG coordinates | The chart is both correct and readable by screen readers |
| Shows chart, interests and ratings | A full profile | All three, plus the privacy boundary explained | What is and is not shared is stated |
| An unanswered vibe is not all-zero | No vibe saved | Not presented as a measured flat personality | Absent data must not read as measured data |
| Saved zeros stay distinct | Explicit `0` ratings | Shown as real ratings, not as unanswered | Zero and null are different |
| Navigating between people | Person A, then person B | A's profile cleared at once; a late A response ignored | No stale profile leaks across navigation |
| Missing or blocked profile | Either case | One neutral unavailable state | Blocking is not disclosed |

Files: [public-profile.test.js](test/client/public-profile.test.js) (6)

#### Concerts

| Test | Input | Expected output | Purpose |
|---|---|---|---|
| Asks for a picture before the finder | An account with no photo | Prompted for a picture before joining | A precondition is enforced in the UI |
| Keeps inputs after a failed join | Selections, then a failing join | Choices retained so a retry sends the same ones | A retry is deliberate, not a guess |
| Rechecks eligibility at submission | A page left open across local midnight | Eligibility re-evaluated on submit | A stale page cannot submit an expired action |
| Keeps an overseas concert open | A concert in another timezone | Its own local day stays open | Eligibility is per-event timezone |
| Ignores late responses | Detail/setlist responses arriving after the concert prop changes | Both ignored | No cross-concert data bleed |
| Operator panel | An operator session | Matching context shown, with no run controls and no requests | A read-only operator view really is read-only |
| Removes its timer on unmount | Unmounting the page | Timer and focus listener removed | No leaks from the midnight refresh |

Files: [concert-consistency.test.js](test/client/concert-consistency.test.js) (13)

#### Ticket marketplace

The most conventionally structured area — pure functions, then components, then integration.

**Component tests.** `OrderSummary` (3), `MarketNotice` (2), `ProofUpload` (6),
`ListingDetailCard` (12), `TicketListingCard` (5).

| Test | Input | Expected output | Purpose |
|---|---|---|---|
| `OrderSummary` Test2 | `subtotalCents: 31000`, `deliveryFeeCents: 550` | `SGD $315.50`, and not `Free` | A computed total from two props |
| `OrderSummary` Test3 | With and without a `heading` prop | `<h3>` present only when given | Conditional rendering |
| `MarketNotice` Test1 | `tone: 'error'` | `role="alert"` with title and message | Errors are announced to screen readers |
| `ProofUpload` Test4–5 | A file over 2 MB, then exactly 2 MB | Rejected, then accepted | A **boundary** case on the size limit |
| `ProofUpload` Test2 | A valid PNG | Emitted to the parent as a data URL | The emitted event carries the right payload |
| `ListingDetailCard` Test5–6 | Same listing, buyer then seller | Buyer: message seller, checkout disabled. Seller: Edit and Remove | One component, two roles |
| `ListingDetailCard` Test9 | `busy: true` | Actions disabled | A request cannot be sent twice |
| `TicketListingCard` Test4 | Verified and unverified listings | Badge only on the verified one | Conditional rendering from a flag |

**Integration tests.** Real components mounted together: `OrderItem + TicketPoster +
VerifiedBadge`, `TicketDetailView + ListingDetailCard` for both buyer and seller,
`MyListingsView + ProofUpload`, `ListingView`, `EditListingView`.

| Test | Input | Expected output | Purpose |
|---|---|---|---|
| Poster fallback | A listing photo that fails to load | Falls back to the generated poster | Three components cooperate on one visual |
| Buyer Test2 | Message seller | The chat thread for this listing opens | Cross-page navigation with the right id |
| Buyer Test3 | A signed-out buyer | Sent to sign in, then brought back | The redirect round-trip |
| Seller Test3 | Remove, confirmed | Returns to My listings | A destructive action behind confirmation |
| Seller Test4 | Remove, cancelled | Listing kept | Cancelling really cancels |
| `MyListingsView` Test3 | Upload proof, submit | Listing moves to pending review | A status transition across two components |
| `ListingView` Test1 | No live Ticketmaster discovery | Saved concerts offered; only the id is sent | A degraded provider still allows listing |
| `EditListingView` Test1 | Edited price | Sent in cents, then returns to the listing | Unit conversion in the payload |

A further set covers lost responses: a publication that committed but whose response never
arrived is recoverable without creating a second listing; repeated submissions are ignored
while the first is pending; and a response arriving after an account switch is discarded.

**Unit tests of plain functions** — `formatMoney`, `priceParts`, `sectionLabel`,
`listingTitle`, `formatRelative`, `formatDateTime`, `hueFor`, `useSavedListings`. Includes a
zero-price ticket, large amounts, invalid timestamps giving an empty string, and `hueFor`
always producing the same hue in `0–359` for a given id.

Files: [market-unit.test.js](test/client/market-unit.test.js) (25) ·
[market-components.test.js](test/client/market-components.test.js) (23) ·
[market-tickets-page.test.js](test/client/market-tickets-page.test.js) (17) ·
[market-integration.test.js](test/client/market-integration.test.js) (40) ·
[market-saved-feedback.test.js](test/client/market-saved-feedback.test.js) (2)

#### Companion finder — Kaki

| Test | Input | Expected output | Purpose |
|---|---|---|---|
| No eligible profiles for a show | A joined concert with no candidates | The artist and date stay selectable | An empty result is not a broken filter |
| Explains no joined concerts | An account with no concert plans | Says so, and keeps a safe legacy fallback | An honest empty state |
| Reviewed vs absent candidates | A deck already swiped through | The two are distinguished; decisions never cleared by a filter reset | Filtering must not destroy decisions |
| Narrow filters | Over-restrictive filters | Identified as narrow; Reset restores the preview | The user is told *why* it is empty |
| A vetoed candidate | A compatibility veto | A generic empty state, with no private veto detail | Another person's dealbreakers stay private |
| Ranking fails to load | A rejected recommendations call | Falls back to the filtered list, not an error | Ranking is an enhancement, not a requirement |
| A late ranking response | Concert query changes mid-flight | The late response is ignored | No cross-concert result bleed |
| Swipe persistence | A like | Saved once; the card advances only after it persists | No optimistic success claim |
| A failed decision | A like that rejects | Kept available for retry, no success announced | Honest failure |
| Dragging | Non-primary mouse button, background cards | Ignored and inert | Only deliberate gestures count |

Files: [kaki-concert-context.test.js](test/client/kaki-concert-context.test.js) (11) ·
[swipe-feedback.test.js](test/client/swipe-feedback.test.js) (5)

#### Messages and chat

Covers the three separate thread types — companion chat, ticket chat and group channels —
plus the Server-Sent Events stream.

| Test | Input | Expected output | Purpose |
|---|---|---|---|
| Sending and reading | A sent message | Appears, and is marked read | The core send/read cycle |
| Live delivery | An event on the SSE stream | The thread updates without a reload | Real-time delivery works |
| Connection handling | A dropped stream | Reconnects | Transient network loss is survivable |
| Group channel scope | A member and a non-member | Only members receive channel events | Authorisation is enforced per event |
| Ticket thread recovery | A mutation whose response was lost | Recovered without duplicating the message | Lost responses do not duplicate sends |
| Planner entry in chat | A conversation with and without a meetup | The correct planner entry point in each case | One component, several contexts |
| Inbox | Mixed companion and ticket threads | Both listed, kept distinct | Separate thread types share one inbox |

Files: [chat/chat-api.test.js](test/client/chat/chat-api.test.js) (8) ·
[chat/chat-live.test.js](test/client/chat/chat-live.test.js) (9) ·
[chat/group-channel.test.js](test/client/chat/group-channel.test.js) (11) ·
[chat/ticket-chat-recovery.test.js](test/client/chat/ticket-chat-recovery.test.js) (6) ·
[chat-planner-entry.test.js](test/client/chat-planner-entry.test.js) (9) ·
[messages-inbox.test.js](test/client/messages-inbox.test.js) (2)

#### Groups — Find a group

The largest client area, because a group application is the hardest thing in the app to get
wrong safely: there are two routes in (browse-and-apply, or automatic matching), and the page
must never claim a request was sent when it was not.

| Test | Input | Expected output | Purpose |
|---|---|---|---|
| Viewing versus enrolling | Opening the automatic pathway | Viewed without enrolling; joining needs explicit confirmation | Looking is not joining |
| A pending request blocks switching | An outstanding application | The other pathway can be viewed but not activated | One commitment at a time |
| Switch succeeds, refresh fails | A successful switch, then a failing read | The confirmed enrollment is still shown | The authoritative response wins over a failed refresh |
| Double submission | Two rapid searches | The second is locked out | One search at a time |
| One pending application | A second application attempt | Refused, with the limit explained | The single-pending-application rule |
| A lost POST response | A request that committed, response dropped | Recovered without resubmitting | No duplicate applications |
| An ambiguous search after remount | A remount mid-search | The same scoped UUID is reused; no automatic POST | Idempotency across a remount |
| A rate-limited recovery | A recovery that is rate limited | The attempt is retained and the UUID restored | Backpressure does not lose state |
| Unsuccessful application | A failed application | A note is kept; no claim that a request was sent | Never report a success that did not happen |
| Discovery and preferences both fail | Both calls reject | A real offer stays visible | Independent failures stay independent |
| Unknown vs zero group count | `undefined` vs `0` | Distinguished in the message | "We don't know" is not "there are none" |
| A late response from another account | Account switch mid-flight | The previous account's results are not reused | Personalised results never cross accounts |
| Completed concert | A past concert | Both pathways closed; pending history retained | History stays readable after the event |

Files: [group-explorer-consistency.test.js](test/client/group-explorer-consistency.test.js) (42) ·
[group-matching.test.js](test/client/group-matching.test.js) (17)

`group-matching.test.js` covers the cards themselves: the comparison deck sends exactly one
application, a failed application stays retryable, a queued offer cannot be accepted out of
turn but can be declined, approval marks render as a green tick / amber pending / red cross,
and an applicant's match reasons are shown **without** rendering their questionnaire answers.

#### Groups — My groups, membership and settings

| Test | Input | Expected output | Purpose |
|---|---|---|---|
| Eligible concerts only | Past, today, future and started concerts | Only today and future offered | Group creation needs an upcoming show |
| Ineligible route preselection | `?concertId=` a past concert | Rejected rather than silently substituted | The URL cannot pick an invalid concert |
| Cutoff rechecked at submission | A page open overnight | Re-checked on submit | Same guard as the concert page |
| Configuration fails after creation | A created draft, failed configure | The known draft reopens for setup recovery | No orphaned second group |
| An uncertain creation | A lost or `409` creation response | Reconciled against the sole owned group | A duplicate group is never created |
| Two creation requests | Rapid double submit | The second is blocked while the first is pending | Idempotent creation |
| First-time host setup | A new group | Listed straight away; reserved friend places shown; no publish step | Matches the current no-draft product rule |
| Host controls and members | A member, not the host | Setup and publication controls hidden; chat and plans kept | Role-based rendering |
| Pending join requests | A queue of applicants | Each with picture and profile link, in queue order, accept or decline | The host's review surface |
| Unsaved settings on navigation | Edits, then navigate or reload | Protected, and no prompt when nothing changed | A guard that does not nag |
| Partial settings save | Name succeeded, size failed | Only the failed change is retried | Partial success is reported honestly |
| Per-source retry | Any one of five sources failing | Only the failed source is retried | Five independent reads, five independent retries |

Files: [group-workspace-recovery.test.js](test/client/group-workspace-recovery.test.js) (27) ·
[group-membership-workspace.test.js](test/client/group-membership-workspace.test.js) (15) ·
[group-connections-workspace.test.js](test/client/group-connections-workspace.test.js) (14) ·
[group-settings-interactions.test.js](test/client/group-settings-interactions.test.js) (5) ·
[group-navigation.test.js](test/client/group-navigation.test.js) (1)

#### Meetup planner

The biggest single file in the suite, because the planner is three steps with drafts that must
survive every one of them, plus optimistic concurrency against other members editing.

| Test | Input | Expected output | Purpose |
|---|---|---|---|
| Three-stage planning | Moving between steps 1–3 | One step at a time; drafts kept across steps; keyboard navigable | The wizard contract |
| Never writes a draft on its own | Opening and browsing the planner | No write is sent | Nothing is saved without an explicit action |
| Drag to paint availability | Click, drag, and drag from a selected slot | Slots selected, then erased | The grid's three gestures |
| Touch painting | Hold then drag; swipe | Paints; swipe scrolls instead | Distinct touch and mouse models |
| Save with transit or drive | A selected period plus a travel method | Saved with that method | The journey options |
| Editing a picked starting point | A map pick, then new search text | The old pick is dropped and never saved | No stale coordinates |
| Changing only the travel method | Method changed, starting point untouched | Every selected time gets the new method | One starting point for all times |
| A stale save | A version conflict | The draft is kept and the current version reloaded for review | Optimistic concurrency, without data loss |
| A live update during editing | Someone else confirms the plan | The unsaved draft is retained and further changes lock | Concurrent edits do not discard local work |
| A confirmed plan | A finalised meetup | Contributions locked; organizers can reopen | Locked until deliberately reopened |
| Organizer picker | An alternative time and place | The algorithm's recommendation and the reviewed choice both preserved | Reviewing is not approving |
| Proposal recovery | A teammate's proposal | Recovered; approval remains explicit | No implicit approvals |
| Changing boards | Board A, then board B | A's private drafts cleared; A's late routes ignored | No cross-board leakage |
| Creation date guardrails | Dates around the concert | Out-of-window dates refused | A meetup must sit in its concert's window |
| Map selection | A spot picked on the Google map (a stand-in in tests) | Saved as the starting point or meeting place | No real Maps calls in tests |
| Nearby transport | A confirmed meeting place | MRT stations and one row per bus with arrival times; the venue on request | Live data degrades honestly |
| Scope-aware navigation | Entry from chat, groups or management | Returns to where it came from | `?from=` round-trips correctly |

Files: [meetup-planner.test.js](test/client/meetup-planner.test.js) (132) ·
[meetup-navigation.test.js](test/client/meetup-navigation.test.js) (29) ·
[availability-grid.test.js](test/client/availability-grid.test.js) (20) ·
[meetup-entry.test.js](test/client/meetup-entry.test.js) (18) ·
[meetup-location-search.test.js](test/client/meetup-location-search.test.js) (15) ·
[meetup-form-panels.test.js](test/client/meetup-form-panels.test.js) (13) ·
[nearby-transport.test.js](test/client/nearby-transport.test.js) (14) ·
[meetup-time.test.js](test/client/meetup-time.test.js) (10)

#### Notifications

| Test | Input | Expected output | Purpose |
|---|---|---|---|
| Triggers | Group, match, meetup and feedback events | A notification for each | Each event type produces one |
| Reading | Open one, then read all | Individually and bulk marked read; the badge follows | Read state is consistent |
| The bell | Unread counts and an empty inbox | Correct count, and a usable empty state | The most-seen component in the app |
| Preferences | Categories toggled | Saved without touching the profile | Independent save path |
| Browser push queue | A queued push | Delivered through the service worker | The push pipeline |
| Notification click | A click on a push notification | Opens the right page | The deep link resolves |

Files: [notification/notification-bell.test.js](test/client/notification/notification-bell.test.js) (15) ·
[notification/notification-api.test.js](test/client/notification/notification-api.test.js) (12) ·
[notification/service-worker.test.js](test/client/notification/service-worker.test.js) (7) ·
[notification/notification-ui.test.js](test/client/notification/notification-ui.test.js) (3)

#### Shared UI, navigation and theme

| Test | Input | Expected output | Purpose |
|---|---|---|---|
| Header overlays | Navigation during initial lazy routing | Overlays behave and ownership is unambiguous | Lazy routes must not strand an overlay |
| Navigation and filters | Expanding the nav and filter panels | Disclosure state correct | Progressive disclosure |
| `SearchSelect` | Typing and selecting | Emits the chosen value | A reusable control's contract |
| `ConfirmDialog` | Keyboard interaction | Keyboard-operable confirm and cancel | Destructive actions are reachable without a mouse |
| Artist wave backdrop | A poster | Renders without invalid geometry | A decorative component that must not break layout |
| Theme contrast | Light and dark tokens | Shared colour contracts hold in both | WCAG contrast is asserted, not assumed |

Files: [header-overlays.test.js](test/client/header-overlays.test.js) (8) ·
[theme-contrast.test.js](test/client/theme-contrast.test.js) (9) ·
[navigation-disclosure.test.js](test/client/navigation-disclosure.test.js) (3) ·
[search-select.test.js](test/client/search-select.test.js) (3) ·
[confirmation-dialog.test.js](test/client/confirmation-dialog.test.js) (5) ·
[artist-wave-backdrop.test.js](test/client/artist-wave-backdrop.test.js) (6) ·
[client-node/group-comparison.test.js](test/client-node/group-comparison.test.js)

---

### End-to-end journeys — Playwright

Playwright asks a different question from Vitest: *can the user complete the task?* The config
boots the whole stack itself — an API on `127.0.0.1:3105` (waiting on `/api/health`) and Vite
on `127.0.0.1:5175` — and runs serially with `reducedMotion: 'reduce'`, keeping a trace and
screenshot on failure.

| Journey | Spec |
|---|---|
| Sign in, edit and save a profile | [profile.spec.js](test/e2e/profile.spec.js) |
| List, browse, buy and message about a ticket | [ticket-marketplace.spec.js](test/e2e/ticket-marketplace.spec.js) |
| Companion finder and the availability calendar | [kaki-and-availability-calendar.spec.js](test/e2e/kaki-and-availability-calendar.spec.js) |
| Messaging across thread types | [chat.spec.js](test/e2e/chat.spec.js) |
| Group discovery results | [group-discovery-results.spec.js](test/e2e/group-discovery-results.spec.js) |
| Create a group through to a planned meetup | [group-and-meetup-lifecycle.spec.js](test/e2e/group-and-meetup-lifecycle.spec.js) |
| A first-time user's group and meetup path | [first-time-group-meetup-ux.spec.js](test/e2e/first-time-group-meetup-ux.spec.js) |
| Matching recovery after an interrupted search | [group-matching-recovery.spec.js](test/e2e/group-matching-recovery.spec.js) |
| Group settings and realtime consistency | [group-settings-interactions.spec.js](test/e2e/group-settings-interactions.spec.js) · [group-realtime-consistency.spec.js](test/e2e/group-realtime-consistency.spec.js) |
| Meetup creation, drafts, decisions and finalisation | [meetup-creation-retry.spec.js](test/e2e/meetup-creation-retry.spec.js) · [meetup-interactions-and-drafts.spec.js](test/e2e/meetup-interactions-and-drafts.spec.js) · [meetup-decision-interactions.spec.js](test/e2e/meetup-decision-interactions.spec.js) · [meetup-responses-and-finalisation.spec.js](test/e2e/meetup-responses-and-finalisation.spec.js) · [meetup-navigation.spec.js](test/e2e/meetup-navigation.spec.js) |
| Notifications end to end | [notifications.spec.js](test/e2e/notifications.spec.js) |
| Community workflows and cross-page consistency | [community-workflows.spec.js](test/e2e/community-workflows.spec.js) · [cross-workflow-consistency.spec.js](test/e2e/cross-workflow-consistency.spec.js) |
| Phone through wide-desktop layout | [responsive-ui.spec.js](test/e2e/responsive-ui.spec.js) |

---

### Server-side tests

63 files, **696 tests**, on Node's built-in runner. Each builds a real Express app through
`createApp({ db, env, fetchImpl })` against a fresh in-memory SQLite database and drives it
over HTTP, so the real routing, middleware, validation and SQL all execute. Dependency
injection means almost no module mocking — a stub `fetchImpl` stands in for Ticketmaster or
OneMap.

| Area | What it covers | Largest files |
|---|---|---|
| **The algorithm** | Deferred acceptance, Irving's algorithm, scoring, feasibility, the registry and classifier, questionnaire factors | `compatibility` (27) · `galeShapley` (26) · `preferenceFactors` (26) · `registry` (22) |
| **Group discovery and matching** | Discovery results, eligibility, self-serve and managed matching, join lifecycle, seat reservations | `groupDiscovery` (34) · `hybridDirect` (23) · `managedMatching` (17) · `selfServeMatching` (13) |
| **Community workflows** | Group settings, membership, consensus, historical coordination, profile participation | `community-domain-workflows` (28) · `community-http-workflows` |
| **Meetups** | Domain rules, guardrails, transport, car planning, navigation, integrations, weather | `meetupIntegrations` (18) · `meetupTransport` (10) · `meetupDomain` (10) |
| **Chat and realtime** | Companion chat, group channels, catch-up, keyset pagination, SSE scope | `kakiChat` (22) · `kakiRealtime` (15) · `groupChannel` (13) |
| **Security** | Sessions, account security, HTTP headers and CSRF, rate limiting, provider and Ticketmaster hardening, system CA | `accountSecurity` (17) · `httpSecurity` (17) · `providerSecurity` (14) |
| **Platform** | Delivery and push, concerts API, setlists, palette extraction, migrations | `delivery` (23) · `concert-api` (25) · `setlist` (14) |

### Benchmarks

Not tests, but the same harness. These produce the comparison tables in
[the algorithm section](#the-matching-algorithm):

```bash
cd server
npm run bench          # Gale-Shapley against the greedy and random baselines
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
└── test/
    ├── server/             (63) Node test runner
    ├── client/             (44) Vitest + @vue/test-utils
    ├── client-node/         (1) Node runner, DOM-free client utilities
    ├── e2e/                (19) Playwright
    ├── bench/                   evaluation harness and instance generator
    ├── config/                  vitest + playwright configs
    ├── scripts/                 test launchers
    ├── support/                 shared dependency resolution, e2e server
    └── results/                 reports and caches (gitignored)
```

**Approximate size:** 15 800 lines of server JS · 26 700 lines of Vue · 3 000 lines of
client JS · 25 600 lines of tests.
