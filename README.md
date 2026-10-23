# Encore

Encore helps concertgoers find people to attend shows with. Group matching uses
the Gale-Shapley stable matching algorithm.

People miss shows when their friends do not share their taste in music. Ticket
resale addresses ticket supply, while first-come-first-served forums pair people
by response time. Those pairings can fall apart before the show.

Encore runs a matching round per concert and considers everyone in the round
together. In a stable matching, no two people would both prefer to be matched
with each other.

## Quick start

Start the backend and frontend in separate terminals, with the backend first.

```bash
# Terminal 1 — API on :3000
cd server
npm install
# Set TICKETMASTER_API_KEY in server/.env first (see Live concert discovery).
npm run sync:concerts # import real concerts without resetting existing data
npm start

# Terminal 2 — Vue app on :5173
cd client
npm install
npm run dev
```

Open <http://localhost:5173>.

### Interface

The main navigation has Concerts, Find a companion, Groups and, when signed in,
Messages. Concert browsing and fan ticket sales share `/concerts`. Companion and
ticket enquiries share `/messages`, with separate private threads. Concert search
matches artist, tour and venue, not the separate city field.

Group pages have Browse groups, My groups and Create group navigation. My groups
at `/groups/connect` lists all owned groups across concerts and active groups you
have joined. Owned cards link directly to management, meetup planning and group
connections. Create group (`?view=create`) opens a full form; creation is no longer
inside a collapsed panel. Connecting groups opens from an owned card with
`?view=connections&groupId=...`. Pending join requests and connection invitations
stay actionable; old join requests and cancelled groups are kept in history.

Direct group comparisons keep their local session when switching to List view or
refreshing the same results, even if a refresh returns no groups. Withdrawing an
application re-enables requests from the existing comparison instead of requiring
a page reload.

The Encore logo links to `/`, where the homepage rotates through up to five
upcoming Ticketmaster concerts ranked by activity, with pictures breaking ties.
Up to six other upcoming concerts appear below the carousel.
The companion finder's Edit filters shortcut
appears while browsing profiles and is hidden when the filter form is open.
The theme toggle and notification bell sit 8px apart on desktop and mobile.
The theme toggle stays outside the mobile menu.

Loading circles appear in the component or button handling a request and stop
when it succeeds or fails. They respect reduced-motion preferences.
Automatic-matching explanations are available on `/method`.

Group search keeps keyword search and sorting visible. Refine results shows one
filter category at a time for seating, budget, arrival, activities, vibe, minimum
places or preferred groups, without checkboxes. Active filters appear as removable
chips; Clear all filters resets them without changing the selected sort order.

The shared preference editor shows one section at a time: personal interests,
companion preferences or things to avoid. Choices are searchable toggle buttons
with selection counts. Custom wording and meaning suggestions remain available;
Save preferences applies all three sections. Group discovery and membership use
the same editor, with responsive panels, consistent field sizes and aligned card
actions across group pages.

Checkboxes and native dropdowns have theme-aware checked, disabled and focus
styles. They keep keyboard interaction and native option selection.

When signed in, click the bell to open notifications. Press Escape, click outside
the popover or use its close button to dismiss it. Notification preferences are
in `/profile#notifications`; there is no separate notifications page.

The badge counts all unread notifications, including those beyond the popover's
current page. Counts above 99 display as `99+`. It refreshes every 30 seconds and
updates immediately after a notification is marked read. Opening a companion or
ticket conversation, including through a notification link, marks your message
notifications for that thread as read. Other conversations and other users'
notifications stay unchanged. The badge disappears when everything is read.

Route changes reset resource-specific drafts. Notification refreshes and weather
checks preserve unsaved settings and availability.
Profile preferences wait for session restoration and saved answers before the
editor opens; switching accounts discards stale preference responses. Companion
filter options retain the full eligible pool, and failed ranking requests still
respect the selected filters. Group messages update open channels live, and a
failed send keeps the draft.

Group channels require both active group membership and a host-granted channel
place. Leaving the group revokes that grant; rejoining requires the host to add
you again. Cancelling a group closes its channel without deleting message history.
Sending a channel reply clears the sender's notification for that thread.

### Account sessions

Register or sign in at `/login`. `POST /api/auth/register` and
`POST /api/auth/login` return a public user and set a seven-day, HttpOnly,
SameSite=Lax cookie. Only a SHA-256 hash of its random token is stored in the
SQLite `sessions` table; `GET /api/auth/me` restores the signed-in user after a
reload and `POST /api/auth/logout` revokes the cookie (HTTP 204). The cookie is
marked Secure when `NODE_ENV=production`; serve the app over HTTPS in production.
The Vue app uses same-origin `/api` requests through its development proxy.

Creating a party, seeker request or Kaki participation requires a session
(HTTP 401 otherwise). The cookie identifies the owner; the server does not trust
user IDs in request JSON. The old open `POST /api/users` endpoint is gone.
Concert browsing and aggregate matching previews remain public. Full round results,
traces, rosters and round execution require a database-provisioned operator
(HTTP 403 for ordinary accounts). Normal users can join the matching pool
through `/api/me/concerts/:id/matching`; its response contains only their own state
and proposal. Legacy results remain available through
`GET /api/me/concerts/:id/result`.

Provision an existing account from the server host (never via a web request):

```bash
cd server
npm run operator:grant -- person@example.com
```

This command uses `ENCORE_DB` when configured; the server and command must
point at the same database. Registration and profile editing cannot grant
operator access. Existing database files are migrated in place; never run
the destructive demo seed on accounts you want to keep.

### Find my group

At `/groups`, save a concert group request, then choose **Find my group** to
join the automatic matching pool. An operator runs the matching round from the
concert page; enrollment alone does not run Gale–Shapley or start a scheduler.

Each side ranks feasible pairs using 60% structured compatibility and 40%
directional saved preferences, with member-derived group profiles. Saved preferred
groups take priority without overriding eligibility. The solver verifies stability
and stores the round, score snapshots and trace. Unsupported relaxations are
rejected rather than silently applied.

Automatic proposals and direct applications share each group's FIFO queue.
Entries expire 48 hours after creation, including time spent waiting. Available
places are held by the earliest entries; later entries wait without a seat.
Only the first held entry can be approved. Direct applications need host approval;
automatic proposals need both host and seeker approval. Confirmation converts
the existing hold into membership. Withdrawal, decline or expiry promotes waiters
without restarting their deadlines.

Pending admissions must be explicitly resolved before accepting a friend invitation,
including an invitation to the same group. Automatic confirmation copies the
concert-specific preferences used for matching, without replacing account preferences.

`GET`, `POST` and `DELETE /api/me/concerts/:id/matching` read the caller's state,
join the automatic pool and switch back to direct joining respectively. POST
requires a UUID-v4 `Idempotency-Key`. Active offers must be resolved before
switching methods; leaving the pool does not silently withdraw an application
or decline an offer. See [Hybrid group matching](docs/HYBRID_GROUP_MATCHING.md)
for the complete workflow.

### Concerts and ticket listings

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

The single browse page is `/concerts`; there is no separate Ticket market tab.
Cards count tickets for sale by summing the quantities of active listings, not
by counting listings. `/concerts/:id` shows each listing's seller, seating
section, ticket quantity, verification state and total listing price, with links
to the listing and seller enquiry. Prices apply to the entire listing, not each
individual ticket.

Group places are openings in app groups. Active group finders are open
group-matching requests for the displayed concerts. Neither count represents
ticket inventory, total attendees or companion-finder participants. Loading and
unavailable feeds are labelled separately from zero activity.
The "Concerts with saved listings" filter stores bookmarks in this browser's
local storage; bookmarks do not belong to the account.

Checkout is unavailable until a real payment provider is integrated.
Authenticated `POST /api/tickets/:id/orders` returns HTTP 503
`payment_provider_not_configured` without creating an order or changing inventory.
Historical orders remain private to the buyer and are labelled as previous
simulated checkout. They do not prove payment. Fake saved payment accounts,
simulated purchases, the destructive demo-seeding command and hardcoded
application concerts have been removed.


### Find a companion

The signed-in finder loads eligible concertgoers through `GET /api/kaki/pool`.
Likes and skips are stored per account and concert on the server.
`GET /api/kaki/decisions` restores history; `PUT` or
`DELETE /api/kaki/decisions/:concertId/:targetUserId` changes or undoes a decision.
A like stays pending until both people like each other for the same concert.
`GET /api/kaki/matches` returns mutual pairs that are still eligible.

Join the finder with `POST /api/concerts/:id/participation`. This does not create
a group-finding request or enter a group-matching round. Hosting a group or
opening a group request does not enrol you in the finder; you must join it
explicitly. Withdrawing removes outgoing Kaki decisions for that concert.
Blocking in either direction hides the pair. Edit matching preferences and vibe
axes in Profile through `GET` / `PATCH /api/me/profile`.
Public user responses never expose email.

### Live concert discovery

Copy `server/.env.example` to `server/.env` and set `TICKETMASTER_API_KEY` to your
Ticketmaster Consumer Key. The Discovery API does not use the Consumer Secret;
do not put it in this file or commit credentials. The server and sync command load
`.env` automatically, including when started from another working directory.
Explicit process environment values take precedence.

`GET /api/concerts/external?keyword=...` searches the first 50 upcoming Singapore
music events via Ticketmaster's Discovery API, without exposing the key to the
browser. Each successful request upserts its events into SQLite before returning
`events`, so concert detail links and seller listings use stable local IDs.
The home page, concert browse page and seller concert selector request this live
endpoint; seeded concerts are not substituted when discovery fails. Real
fan-listed concerts from `/api/tickets` remain browsable independently, including
seller-entered events that are outside the provider feed. Official purchase
links open Ticketmaster, separate from local ticket availability. Group activity
is fetched from local counts after provider event IDs have been persisted.
Optional Ticketmaster text is stored in the existing concert `blurb` field and
rendered as plain text on concert cards and concert detail pages. Selection
prefers event `description`, `info`, then `additionalInfo`, followed by the
primary embedded artist's `description` or `additionalInfo`. These artist fields
are documented in the [Attraction Details API](https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/#attraction-details-v2),
but are not guaranteed to be populated. No biography is invented when absent.

Optional HTTPS `seatmap.staticUrl` values from the
[Discovery API](https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/#search-events-v2)
are stored as `concerts.seatmap_url` and exposed in discovery, concert list and
detail responses. The group creation form shows the selected venue and links to
its event-specific seating plan when supplied, or to the official event page
when no map is available. Seating choices remain general matching preferences,
not a verified venue section list or live seat inventory. Group size in this
form retains the capacity definition: new companion places, excluding the host
and invited friends.

New seating choices are VIP, Standing pen and Category 1–6 in group creation,
group requests, concert participation and group filters. These are app categories,
not Ticketmaster-confirmed sections. Existing records keep their original section
keys and labels; the database upgrade widens the seating constraints without
relabeling them. Matching rewards exact category matches without assuming that
consecutive category numbers are physically adjacent.

New arrival choices are On time (the default) and Early across group creation,
requests, participation and filters. Existing midday preferences remain readable.

The same import is also available from the command line:

```bash
cd server
npm run sync:concerts
```

Syncing again updates imported event details without deleting existing accounts,
user-created concerts, groups or match rounds. `GET /api/concerts` and
`GET /api/concerts/:id` include `source`, `source_event_id`, `official_url`,
and `image_attribution` for imported events. Ticketmaster coverage in Singapore
varies; events without a usable venue or date are skipped. Without a key, live
discovery returns HTTP 503; provider failures return HTTP 502 and a visible
frontend error, not mock events. Seller-entered concert details remain supported
as user input, not prefilled inventory.
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


## Matching model

Gale-Shapley solves the Stable Marriage Problem, which requires two disjoint sets
of agents. Matching any concertgoer with any other concertgoer is the Stable
Roommates Problem. Gale-Shapley cannot solve that problem, and some instances
have no stable solution.

Encore models group matching with two sides:

| Side | Who | Capacity |
|---|---|---|
| Party | someone holding spare tickets, or forming a group | `q ≥ 1` |
| Seeker | wants to join exactly one group | `1` |

This is the Hospital/Residents problem, the many-to-one generalisation of stable
marriage. A stable matching always exists for this model. Deferred acceptance
finds one in time linear in the number of acceptable pairs, and the
seeker-proposing version is seeker-optimal.

Irving's algorithm for stable roommates is also implemented
(`server/src/matching/stableRoommates.js`) for a true peer-to-peer mode, including correct
detection of instances with no stable matching.

### Solver selection and guarantees

The problem classes form a hierarchy: Stable Marriage ⊂ Hospital/Residents ⊂ HR
with Couples. The engine selects the solver with the strongest guarantee that
can represent the instance's constraints.

Before solving, the engine classifies each round. It then runs the selected
solver and verifies the result. When the solver guarantees stability,
verification is an assertion. For problem classes without that guarantee,
verification measures stability. The round stores the promised guarantees
separately from the measured results.

If no solver models a constraint exactly, the engine solves a relaxed instance
and records the omitted constraint and reduced guarantee. For example, a pair
of friends who must both be placed or neither is handled by deferred acceptance
on a relaxed instance. The round reports:

> Solved with linked_pairs ignored — this is not a solution to the full problem.
> 0 blocking pairs in the relaxed instance.

The relaxed result can have zero measured blocking pairs without a stability
guarantee for the full problem.

Mixed instances must be solved with singles and couples together. Solving them
separately would miss blocking pairs between a single and a member of a couple.
Partitioning is valid when the feasibility graph is disconnected, as it is
between concerts.

`GET /api/solvers` lists every algorithm with what it can and cannot promise.

See [`docs/ALGORITHM.md`](docs/ALGORITHM.md), §10, for the full specification.


## Backend matching

The backend computes preference lists so users do not need to rank two hundred
strangers. It scores eight signals per pair: vibe similarity (cosine over a
six-axis vector), section, plans, arrival time, reliability, language, region and
budget fit. It combines these scores using a different weight vector for each
direction. Parties weight reliability at 26% because they bear the no-show risk.
Seekers give more weight to section and vibe. These directional preferences
require stable matching; sorting pairs by a shared score would lose that
distinction.

Gender preference, age policy, budget ceiling and blocklists are hard
constraints. A pair that fails one is excluded from both preference lists.
Hospital/Residents supports these incomplete lists, so a seeker can finish a
round unmatched.

After each round, the backend searches for blocking pairs. It stores the
preference snapshot with the round so historical results can be checked again
through the verification endpoint or the button on the results page.
Each round also stores the proposal trace used by the visualiser.


## Evaluation

Results from `npm run bench` with 400 seekers, 200 parties, 296 slots and 52,370 compatible pairs:

| Algorithm | Blocking pairs | Match rate | Mean rank | Total score |
|---|---|---|---|---|
| Gale-Shapley | 0 | 74.0% | 5.55 | 499.78 |
| Greedy (best pair first) | 175 | 74.0% | 4.32 | 503.73 |
| Random (first-come-first-served) | 21,097 | 74.0% | 65.88 | 387.06 |

Greedy scores 0.79% higher overall but produces 175 blocking pairs. In each of
those pairs, both people prefer each other to their assigned matches and could
leave those matches to pair up privately. Encore prioritises stability over
aggregate score.

Gale-Shapley produced zero blocking pairs in all four scenarios tested (balanced,
oversubscribed, undersubscribed, large groups). Greedy produced them in all four.

### Runtime

Results from `npm run bench:scale`:

| Seekers | Parties | Feasible pairs | Build prefs | Solve | Verify |
|---|---|---|---|---|---|
| 100 | 40 | 2,598 | 4ms | 0.2ms | 0.1ms |
| 1,000 | 400 | 265,556 | 800ms | 15ms | 17ms |
| 5,000 | 2,000 | 6,668,452 | 36,191ms | 1,636ms | 1,228ms |

Preference construction takes more than 20× as long as solving. Caching each
user's vibe-vector magnitude (a `sqrt` per pair per side) and skipping blocklist
string allocation when the blocklist is empty reduced pair-scoring cost by 1.7×.
Partitioning by concert is valid because cross-event pairs are infeasible.
It reduced preference construction for the same 5,000-seeker population from
36.2s to 1.7s, reported as a 24× improvement.


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
  src/components/     navigation, cards, forms, chat and matching visualisations
  src/views/          concerts/tickets, companions, groups, messages, planning and accounts

docs/ALGORITHM.md     the specification
```

The matching engine has no dependency on Express or SQLite, which is why the benchmarks can
run it directly and why the tests cover the algorithm without standing up a server.


## The visualiser

Operators can replay a round's recorded proposal trace at
`/concerts/:id/algorithm`. Controls include play, pause, step, scrub and speed.
Accepts, rejects and evictions are colour-coded, and groups show held offers
filling and emptying. Public concert pages show aggregate forecast metrics
without personal results.


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
| `GET` | `/api/me/concerts/:id/matching` | own managed matching queue, request and approval state |
| `POST` | `/api/me/concerts/:id/matching` | join automatic matching pool; UUID-v4 Idempotency-Key required; does not run a round |
| `DELETE` | `/api/me/concerts/:id/matching` | switch to direct joining; active offers must be resolved first |
| `GET` | `/api/rounds/:id` | operator-only full per-seeker results |
| `GET` | `/api/rounds/:id/trace` | operator-only proposal sequence |
| `GET` | `/api/rounds/:id/parties/:partyId` | operator-only full party roster |
| `GET` | `/api/rounds/:id/verify` | operator-only re-check against stored snapshot |
| `GET` | `/api/solvers` | every algorithm, with its guarantees and limits |
| `GET` | `/api/concerts/:id/explain/:requestId` | operator-only explanation for one seeker |


## Known limits

- Ties break by ID. This is deterministic and preserves strict-preference
  guarantees. Randomising ties per round would avoid repeatedly favouring the
  same user.
- Seeker-optimal results are party-pessimal. Letting parties propose instead gives
  them their best stable outcome. The proposing side is a policy choice.
- SQLite keeps the project runnable from a clone and is sufficient at this scale.
  All SQL is in `repositories.js`, so moving to MySQL or Postgres requires changing
  one file.
- Sessions establish account ownership. They do not verify identity or ticket
  authenticity.

Synthetic data is confined to isolated tests and matching benchmarks, not application initialization.
