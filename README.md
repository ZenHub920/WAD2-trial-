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
npm run seed          # demo users and concerts; clears the existing database
npm start

# Terminal 2 — Vue app on :5173
cd client
npm install
npm run dev
```

Open <http://localhost:5173>.

### Account sessions

Register or sign in at `/login`. `POST /api/auth/register` and
`POST /api/auth/login` return a public user and set a seven-day, HttpOnly,
SameSite=Lax cookie. Only a SHA-256 hash of its random token is stored in the
SQLite `sessions` table; `GET /api/auth/me` restores the signed-in user after a
reload and `POST /api/auth/logout` revokes the cookie (HTTP 204). The cookie is
marked Secure when `NODE_ENV=production`; serve the app over HTTPS in production.
The Vue app uses same-origin `/api` requests through its development proxy.

Creating a party, seeker request, or Kaki participation requires a session
(HTTP 401 otherwise). Ownership comes from the cookie, **not** user IDs in
request JSON; the old open `POST /api/users` endpoint is gone. Concert browsing
and aggregate matching previews remain public. Only a database-provisioned
operator can run a round or read full round results, traces, rosters and
explanations (HTTP 403 for ordinary accounts). Members see only their own
latest group result via `GET /api/me/concerts/:id/result`.

Provision an existing account from the server host (never via a web request):

```bash
cd server
npm run operator:grant -- person@example.com
```

This command uses `ENCORE_DB` when configured; the server and command must
point at the same database. Registration and profile editing cannot grant
operator access. Existing database files are migrated in place; never run
the destructive demo seed on accounts you want to keep.

### Ticket marketplace

Ticket sales and companion groups are separate inventories. `POST /api/tickets`
creates a concert and its ticket listing atomically for the signed-in seller;
it accepts `concert` (`artist`, `venue`, `event_date`), `priceCents`, `quantity`,
`section`, optional `description` and optional `imageData`. `GET /api/tickets`
lists active sales, and `GET /api/tickets/:id` shows one sale. Sellers manage
their own listings with `GET /api/me/tickets`, `PATCH /api/tickets/:id` and
`DELETE /api/tickets/:id`. Prices are integer cents and quantities positive
integers. Images are validated (PNG/JPEG/GIF/WebP, up to 2 MiB) and stored in
`server/data/ticket-images` by default, not in SQLite; set
`ENCORE_TICKET_IMAGE_DIR` to change the directory. Keep both the database and
image directory in backups. Existing priced party rows are copied to tickets
once and removed from active companion matching without deleting historical
round references. Neither a listing nor a seller is proof of ticket ownership.

The `/marketplace` cards use the existing `/api/tickets` listings, including
the seller, concert, section, quantity, price and optional image. Search and
filters work on that inventory; “Saved only” bookmarks are stored in this
browser's local storage, not in an account. Checkout and payment are not
implemented; viewing a listing never records a paid order.


### Kaki Finder

The signed-in finder reads profiles of eligible concertgoers through
`GET /api/kaki/pool`. Likes and skips are stored per account and concert, not
in browser storage. `GET /api/kaki/decisions` restores history; `PUT` or
`DELETE /api/kaki/decisions/:concertId/:targetUserId` changes or undoes a
decision. A like is pending until both people like one another for the same
concert. `GET /api/kaki/matches` reports only those mutual, currently eligible
pairs. Joining a concert through `POST /api/concerts/:id/participation`
enrolls you in Kaki Finder; it does **not** create a seeker request or enter
the group-matching round. Existing open group seekers and hosts are also
eligible for Kaki until they explicitly withdraw. Withdrawal removes your
outgoing Kaki decisions for that concert; blocking either direction hides
the pair. The Profile tab edits matching preferences and vibe axes through
`GET` / `PATCH /api/me/profile`; public user responses never expose email.

### Live concert discovery

Copy `server/.env.example` to `server/.env` and put the Ticketmaster
**Consumer Key** in `TICKETMASTER_API_KEY`. The Consumer Secret is not used by
the Discovery API; do not put it in this file or commit credentials. The server
and sync command load `.env` automatically, even when started from another
working directory. Explicit process environment values take precedence.

`GET /api/concerts/external?keyword=...` searches the first 50 upcoming Singapore
music events via Ticketmaster's Discovery API, without exposing the key to the
browser. Its `events` are live discovery results, **not** matchable until imported.
To save them as local concerts with stable IDs, run:

```bash
cd server
npm run sync:concerts
```

Run the seed **before** syncing if you want demo users: `npm run seed` clears the
database, including imported events. Syncing again updates imported event details
without deleting local parties or match rounds. `GET /api/concerts` and
`GET /api/concerts/:id` then include `source`, `source_event_id`, `official_url`,
and `image_attribution` for imported events. The existing Vue client does not yet
render these links; the frontend can use `official_url` for the event's official
purchase page. Ticketmaster coverage in Singapore varies; events without a
usable venue or date are skipped. Without a key, live discovery returns HTTP 503.
No ticket ownership, authenticity or availability is verified by this integration.

AI-use disclosure: The Ticketmaster integration, MVC extraction, sessions,
ticket marketplace, Kaki decision API, profiles/participation, round access
controls, tests, and this documentation were generated with AI assistance.
The IS216 briefing restricts AI use for core backend implementation; review
these contributions against your course rules before submitting them.

```bash
cd server
npm test              # backend unit and API tests
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

### One engine, several solvers, and an honest account of each

The problems form a hierarchy — Stable Marriage ⊂ Hospital/Residents ⊂ HR with Couples —
so a second solver is never added for coverage. It is added because **the more structure an
instance has, the stronger the promise that can be made about the answer.**

Each round is classified before it is solved, dispatched to the strongest-guarantee solver
that can represent it, and verified in the manner that solver's promise requires: an
*assertion* where stability is guaranteed, a *measurement* where the problem class does not
admit that promise. What was promised beforehand and what was measured afterwards are
recorded separately, because conflating them is how a system starts overstating its results.

An instance containing something no solver models exactly — two friends who must both be
placed or neither — is neither refused nor silently mis-answered. Deferred acceptance runs
on the relaxed instance, the dropped constraint is recorded, the stability promise is
downgraded, and the round reports:

> Solved with linked_pairs ignored — this is not a solution to the full problem.
> 0 blocking pairs in the relaxed instance.

Note the result is simultaneously *measured stable* and *not guaranteed stable*. Both are
true and they are different claims.

One caveat worth stating: a mixed instance must **not** be split into singles and couples
and solved separately. A single and a member of a couple can form a blocking pair across the
partition that neither sub-solve would ever examine. Decomposition is sound only where the
feasibility graph is disconnected — which is exactly why partitioning by concert is free.

`GET /api/solvers` lists every algorithm with what it can and cannot promise.

Full specification: **[`docs/ALGORITHM.md`](docs/ALGORITHM.md)** (§10 for the above).

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
    classify.js         what kind of matching problem this instance actually is
    registry.js         every solver, and what each may claim about its output
    guarantees.js       the promise vocabulary, and verification that honours it
    solve.js            classify -> select -> solve -> verify -> ledger
    compatibility.js    hard constraints + directional scoring
    preferences.js      preference lists and O(1) rank maps
    galeShapley.js      deferred acceptance, Hospital/Residents
    stability.js        blocking-pair verification
    baselines.js        greedy and random, for comparison
    metrics.js          evaluation metrics
    stableRoommates.js  Irving's algorithm, peer-to-peer mode
    maxHeap.js          worst-held-offer retrieval in O(log q)
  src/db/             SQLite schema and repositories (model)
  src/services/       round orchestration, explanations, provider and session logic
  src/controllers/    HTTP validation, request handling, response shaping
  src/routes/         endpoint-to-controller mappings
  test/               backend unit and HTTP API tests
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

`/concerts/:id/algorithm` replays a round's recorded proposal trace for an
operator — play, pause, step, scrub, speed. Accepts, rejects and evictions
are colour-coded; groups show held offers filling and emptying. The public
concert page still shows aggregate forecast metrics without personal results.

---

## API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/concerts` | list with live supply/demand counts |
| `GET` | `/api/concerts/external?keyword=...` | first 50 upcoming SG music events from Ticketmaster (requires server key) |
| `GET` / `POST` | `/api/tickets` | browse listings / create a seller listing (session required for POST) |
| `GET` / `PATCH` / `DELETE` | `/api/tickets/:id` | detail / owner-only edit or remove |
| `GET` | `/api/me/tickets` | seller's listings (session required) |
| `GET` | `/api/kaki/pool`, `/api/kaki/decisions`, `/api/kaki/matches` | signed-in candidate pool, decision history, mutual likes |
| `PUT` / `DELETE` | `/api/kaki/decisions/:concertId/:targetUserId` | signed-in like/skip or undo |
| `GET` / `PATCH` | `/api/me/profile` | view and edit own matching profile |
| `GET` / `POST` / `DELETE` | `/api/concerts/:id/participation` | check, join/update or leave Kaki for a concert |
| `GET` | `/api/me/concerts` | concerts explicitly joined for Kaki |
| `GET` | `/api/concerts/:id/parties` | groups with spare tickets |
| `GET` | `/api/concerts/:id/requests` | people looking |
| `GET` | `/api/concerts/:id/match/preview?baselines=true` | public aggregate dry run; only operators receive identities/trace |
| `POST` | `/api/concerts/:id/match` | operator-only: run and persist a round |
| `GET` | `/api/me/concerts/:id/result` | own latest group-round result (session required) |
| `GET` | `/api/rounds/:id` | operator-only full per-seeker results |
| `GET` | `/api/rounds/:id/trace` | operator-only proposal sequence |
| `GET` | `/api/rounds/:id/parties/:partyId` | operator-only full party roster |
| `GET` | `/api/rounds/:id/verify` | operator-only re-check against stored snapshot |
| `GET` | `/api/solvers` | every algorithm, with its guarantees and limits |
| `GET` | `/api/concerts/:id/explain/:requestId` | operator-only explanation for one seeker |

---

## Known limits

- **Ties break by id.** Deterministic and reproducible, and it keeps the strict-preference
  guarantees, but a fairer scheme would randomise per round so the same user is not
  repeatedly advantaged.
- **Seeker-optimal means party-pessimal.** Proposing from the other side gives parties their
  best stable outcome instead. Which side proposes is a policy decision.
- **SQLite.** Fine for this scale and it keeps the project runnable from a clone. All SQL is
  confined to `repositories.js`, so moving to MySQL or Postgres is one file.
- **Authentication exists; verification does not.** Sessions establish account
  ownership, but neither identity nor ticket authenticity has been verified.

All people and events in the seed data are fictional.
