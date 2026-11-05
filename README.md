# ENCORE — Discover. Connect. Experience.

**ENCORE** is a Singapore-focused concert companion web application developed for **IS216 Web Application Development II**. It brings concert discovery, compatible companion and group matching, messaging, community ticket listings, and meetup coordination into one experience.

Rather than relying on who happens to respond first in a public forum, ENCORE gives concertgoers ways to find people with compatible preferences. After connecting, they can coordinate practical details—availability, meeting locations, travel, and relevant weather—within the same application.

> **Project status:** University group project. Some external integrations require credentials or third-party service availability. Community ticket listings support browsing and seller enquiries; **online payment/checkout is not enabled**.

## Contents

- [Why ENCORE?](#why-encore)
- [Features](#features)
- [How matching works](#how-matching-works)
- [Architecture and technology](#architecture-and-technology)
- [Data storage](#data-storage)
- [External integrations](#external-integrations)
- [Local setup](#local-setup)
- [Testing](#testing)
- [Security and privacy](#security-and-privacy)
- [Project structure](#project-structure)
- [Important limitations](#important-limitations)

## Why ENCORE?

Concertgoing has several connected challenges:

1. **Finding people:** Friends may not enjoy the same artists, dates, or concert experiences.
2. **Finding a good fit:** First-come social posts do not necessarily consider compatibility, reciprocal interest, or group capacity.
3. **Coordinating a plan:** Availability, meeting points, transport, weather, and group decisions often end up scattered across different apps.

ENCORE supports the journey from discovering a concert to finding companions and agreeing on a meetup plan.

## Features

### Concert discovery

- Explore Singapore concert information imported from the **Ticketmaster Discovery API**.
- View event details, dates, venues, images, and available external event links.
- Register concert participation to unlock concert-specific social experiences.
- Explore supported setlist information and Spotify track previews where available.

### Kaki Finder — person-to-person discovery

- Discover other participating concertgoers based on profile and preference information.
- View compatibility-based recommendations, with a **Stable Roommates** solver supporting the recommendation process where applicable.
- Express interest through likes; **a private conversation is available only after reciprocal interest**.
- Communicate through messages and receive relevant updates.
- Block or report users when needed.

> Stable Roommates may have no stable solution for some preference profiles; it is not a guarantee that every user receives a companion.

### Hosted groups

- Create, configure, and publish concert groups with membership and capacity limits.
- Invite friends and manage group members.
- Manage applications, group settings, and group communication.
- Track requests and matching offers through clear statuses.

### Two ways to find a group

| Pathway | Designed for | What happens |
| --- | --- | --- |
| **Browse and Choose** | Users who want to inspect groups and decide themselves | Search, filter, compare, and apply to a selected group; the host reviews the request. |
| **Automatic Matching** | Users who prefer a coordinated group assignment | Opt in, enter preferences, and trigger a capacity-aware **Gale–Shapley** matching round; resulting offers require the applicable approvals. |

The top group in Browse and Choose is **not necessarily** the group assigned through Automatic Matching. Browsing displays an individual compatibility ranking; automatic matching also accounts for competing seekers, each group's preferences, and available places.

### Meetup planner

- Create meetups for eligible groups or shared group coordination contexts.
- Collect participant availability through a time-selection interface.
- Suggest places, vote on options, and discuss arrangements.
- Generate ranked meeting time/place options using availability, votes, and available travel context.
- Allow designated organizer(s) to propose and approve final arrangements.
- Consult supported location, transport, and weather information when configured and available.

**A recommendation is not an approval.** Participant input informs the shortlist; the organizer or required organizers make the final decision.

### Messages and notifications

- One-to-one companion conversations following mutual likes.
- Group communication for eligible members.
- Ticket-listing enquiries and associated conversations.
- In-app notifications for relevant activity, with links to the affected workflow.
- Server-Sent Events (SSE) for supported live interface updates.
- Optional browser push notifications where configured and permitted.

### Community ticket marketplace

- Create, browse, edit, and manage concert-related ticket listings.
- View seller/listing details and start enquiries.
- Support relevant proof or verification review workflows.
- **No live payment processing:** checkout deliberately reports that a payment provider is not configured.

### Account and safety features

- Registration, sign-in, sign-out, and profile onboarding.
- Account email verification and password-reset flows when outbound email is configured.
- Visibility and authorization checks for protected group, chat, and operator actions.
- Blocking, reporting, and post-concert feedback/reliability features.

## How matching works

### 1. Compatibility and eligibility

The system first excludes incompatible seeker–group pairs using applicable requirements and restrictions, including capacity and safety-related constraints.

For each eligible pair, the core compatibility scorer examines **eight factors**:

1. Seating/section compatibility
2. Concert vibe
3. Arrival time
4. Concert plans
5. Language
6. Region
7. Reliability
8. Budget fit

The seeker and the group receive **separate directional scores**, with different factor weights. For example, the group-side scoring gives applicant reliability a **26%** weight, because a host carries the no-show risk.

A seeker is scored against the **group as a whole**, not just its host: concert vibe and reliability are averaged across every active member and languages are pooled, so adding a member changes the group's score. Feasibility is checked the same way — a block against any one member rules out the whole group.

For groups with an enhanced discovery profile, directional scores combine:

```text
Final directional score
  = 60% × core eight-factor compatibility
  + 40% × discovery-questionnaire compatibility
```

The discovery portion reflects the group's and seeker's stated interests, preferences, dislikes, and supported questionnaire/trait information. The 60/40 blend does **not** mean 60% seeker opinion and 40% host opinion, and does **not** mean 60% Browse and Choose and 40% Automatic Matching.

### 2. Direct browsing versus automatic assignment

**Browse and Choose** ranks eligible groups by a combined view of their two directional compatibility scores. A user chooses a group and sends an application for host review.

**Automatic Matching** builds separate seeker and group preference rankings, then applies a capacity-aware Hospitals/Residents form of Gale–Shapley deferred acceptance. Seekers propose in preference order; groups tentatively retain preferred eligible applicants up to available capacity. The system also considers other seekers competing for places.

For a standard Hospitals/Residents instance, a stable result has **no blocking pair**: there is no seeker and group that both prefer to be assigned to one another instead of the resulting arrangement. This guarantee applies to the standard model's assumptions, not automatically to every extended constraint or later approval outcome.

### 3. Consent, persistence, and capacity

- A match result generates an **operational offer**, not immediate confirmed membership.
- The required seeker and host decisions determine whether the membership is finalized.
- Pending/confirmed claims and capacity rules are tracked separately from historical matching results.
- Matching rounds use transactional database updates and idempotency safeguards to avoid duplicate or inconsistent results.

## Architecture and technology

```text
Browser — Vue 3 + Vue Router + Vite + Bootstrap/CSS
                       |
                       | HTTPS / REST requests, SSE updates
                       v
           Node.js + Express application
                       |
        routes → controllers → services
                       |
          repositories / matching engine
                       |
                 SQLite database
                       |
       local image storage where applicable

External providers accessed through backend integrations:
Ticketmaster · Google Maps Platform · LTA DataMall · NEA/data.gov.sg
Spotify track previews are rendered through embeds.
```

| Layer | Technologies | Responsibility |
| --- | --- | --- |
| Frontend | Vue 3, Composition API, Vue Router, Vite, JavaScript | Reactive views, forms, status feedback, guarded navigation |
| UI/styling | Custom CSS, design tokens, Bootstrap 5 | Responsive layouts, accessible controls, light/dark themes |
| Backend | Node.js 20+, Express | REST endpoints, authorization, orchestration, integrations |
| Matching | JavaScript algorithm modules | Compatibility, Stable Roommates, Gale–Shapley, verification |
| Persistence | SQLite via `better-sqlite3` | Users, concerts, groups, matches, chat, meetups, listings, notifications |
| Real-time | Server-Sent Events; optional Web Push | In-app updates and optional browser notifications |
| Email | Nodemailer / SMTP (optional) | Account-related emails |
| Testing | Node.js test runner, Vitest, Vue Test Utils, Playwright | Unit, component, integration, and E2E checks |

## Data storage

The primary persistent datastore is **SQLite**, initialized and migrated by the server. Core records include:

- Users, profiles, authentication sessions, and preferences
- Concerts and participation
- Hosted groups, memberships, applications, and invitations
- Seeker requests, matching rounds, historical results, and current proposals
- Conversations, messages, and notifications
- Meetups, availability, suggested places, votes, and approvals
- Community ticket listings, enquiries, and related verification data

SQLite transactions protect multi-step operations. Uploaded ticket and profile images use application-managed file storage; they are not the main relational database.

## External integrations

| Provider | ENCORE use | Notes |
| --- | --- | --- |
| **Ticketmaster Discovery API** | Singapore event discovery | Backend-held API key; normalized events may be stored locally |
| **Google Maps Platform** | Picking a meetup location: the map, place search and reverse lookup in the planner | Runs **in the browser** via `VITE_GOOGLE_MAPS_API_KEY`; Maps JavaScript API with Places API (New) |
| **OneMap** | Nearby MRT stations and bus stops, and route lookups behind the transport panel | Runs **server-side** and is still in active use; `ONEMAP_*` settings |
| **LTA DataMall** | Bus/train service information, nearby transport/parking context where supported | Optional account key; information may be unavailable |
| **NEA via data.gov.sg** | Weather forecasts and rainfall context | Forecast availability depends on the time horizon and provider |
| **Spotify embeds** | Supported track previews on concert pages | An embedded media feature, not a fifth backend data API |

External data is not guaranteed to be fresh or available. The application should communicate missing information rather than inventing travel times, transport statuses, or forecasts.

**How the two map providers divide the work.** Google Maps did not replace OneMap; they do different jobs. Google Maps runs **client-side** and is used only for choosing a location in the meetup planner (`client/src/components/GooglePlaceSearch.vue`). OneMap runs **server-side** in `server/src/services/singaporeTravel.js` and still supplies every nearby-transport and routing lookup. A Google key changes only the location picker; transport data continues to come from OneMap and LTA regardless.

## Local setup

### Prerequisites

- **Node.js 20 or newer** and npm (or the project's configured pnpm version)
- Optional provider credentials for external APIs

### 1. Install dependencies

From the repository root:

```bash
npm --prefix server install
npm --prefix client install
```

### 2. Configure the server environment

Create **`server/.env`**. The server loads this file when it starts. Example configuration:

```dotenv
# Local server
PORT=3000
APP_ORIGIN=http://localhost:5173

# Concert discovery
TICKETMASTER_API_KEY=

# Transport / weather (optional)
LTA_ACCOUNT_KEY=
DATA_GOV_SG_API_KEY=

# OneMap — nearby MRT/bus lookups and routing (optional)
# ONEMAP_EMAIL=
# ONEMAP_PASSWORD=
# ONEMAP_TOKEN=

# Optional email
# SMTP_HOST=
# SMTP_PORT=587
# SMTP_FROM=
# SMTP_USER=
# SMTP_PASS=

# Optional browser push
# VAPID_PUBLIC_KEY=
# VAPID_PRIVATE_KEY=
# VAPID_SUBJECT=mailto:maintainer@example.com
```

**Important:** Do not commit `.env`, secrets, session files, uploaded private images, or the local database to source control. Restrict Google Maps API keys by allowed API/service and appropriate application restrictions. Use separate development and production credentials.

Other supported settings: `ENCORE_DB`, `ENCORE_AVATAR_DIR`, `ENCORE_TICKET_IMAGE_DIR`, `CORS_ALLOWED_ORIGINS`, `ENABLE_BACKGROUND_JOBS`, `TRUST_PROXY`, `ENCORE_USE_SYSTEM_CA`, and the provider budget caps `TICKETMASTER_DAILY_LIMIT`, `TICKETMASTER_MAX_PAGES`, `TICKETMASTER_MIN_INTERVAL_MS`, `ONEMAP_DAILY_LIMIT`, `LTA_DAILY_LIMIT`, `CONCERT_SYNC_INTERVAL_MS` and `CONCERT_CACHE_TTL_MS`.

### 2b. Configure the client environment (Google Maps)

The Google Maps key is read by the **browser**, not the server, so it belongs in **`client/.env.local`** and must carry Vite's `VITE_` prefix. Copy `client/.env.example`:

```dotenv
# Google Maps JavaScript API key, with Places API (New) enabled.
# Restrict it to your site in Google Cloud.
VITE_GOOGLE_MAPS_API_KEY=
```

Without this key the meetup planner cannot search for or pick locations — see *Important limitations*.

### 3. Start the backend

In terminal 1:

```bash
cd server
npm run dev
```

By default, Express listens at **http://localhost:3000**. On first startup, the server initializes the SQLite schema and migrations.

### 4. Start the frontend

In terminal 2:

```bash
cd client
npm run dev
```

Open **http://localhost:5173**. Vite proxies requests beginning with `/api` to the backend at `http://localhost:3000` by default.

### 5. Import concerts (optional)

With a valid Ticketmaster API key:

```bash
cd server
npm run sync:concerts
```

Concert visibility and group/matching availability are subject to event dates, provider results, and participation rules.

### 6. Local test data (optional; development only)

The repository includes a **test-account seeding command**:

```bash
cd server
npm run seed:test-accounts
```

Every account it creates signs in with the password `EncoreTest123!` (for example `test3@gmail.com`). The seeder writes a database backup before adding fixtures and is safe to re-run. **Do not run it against real user data or a production database.**

A second option is the **sanitised demo database** committed at `test/fixtures/encore-demo.sqlite` — 21 demo accounts, 71 concerts, 7 groups, 5 ticket listings and 2 meetups, with `demo.alice@example.test` as an operator. Point the server at a copy rather than the file itself, so the working tree stays clean:

```bash
cp test/fixtures/encore-demo.sqlite server/data/demo.sqlite
cd server && ENCORE_DB=./data/demo.sqlite npm run dev
```

The demo passwords are not recorded in the repository — ask whoever added the snapshot if you need to sign in as one of those accounts.

## Testing

ENCORE uses complementary test types:

| Level | What it validates | Typical tools |
| --- | --- | --- |
| **Unit** | Algorithm correctness, scoring, validation, stability checks | Node.js test runner |
| **Component** | Vue components, user events, form states, dialogs | Vitest + Vue Test Utils + jsdom |
| **Integration** | APIs, authentication, group admissions, database state, permissions | Node.js test runner + Express + isolated SQLite |
| **End-to-end** | Complete browser journeys including matching, chats, groups, meetups and responsive navigation | Playwright / Chromium |

All test infrastructure lives in the top-level `test/` directory and reuses the client's installed tooling, so there is no second `node_modules` to install:

| Location | Runner | Files |
| --- | --- | --- |
| `test/server/` | Node test runner | 63 |
| `test/client/` | Vitest + Vue Test Utils | 44 |
| `test/client-node/` | Node test runner, DOM-free client utilities | 1 |
| `test/e2e/` | Playwright | 19 specs |
| `test/bench/` | Matching evaluation harness (not a test suite) | — |

Configuration is in `test/config/` and the launchers are in `test/scripts/`.

From the repository root:

```bash
npm test            # server + client test suites
npm run test:e2e    # Playwright browser tests
npm run test:all    # all of the above
```

For a first-time Playwright setup, install its supported browser binaries as instructed by Playwright (for example, `npx playwright install chromium` from `client/`). E2E tests may start local servers and create isolated fixtures; inspect the repository's test configuration before running them against any non-development environment.

**Do not infer passing results from the presence of test files.** Run the suites and record the actual result and date when reporting coverage or success. Some suites currently fail on `main`, so `npm test` exits non-zero; check the current state before quoting any figure.

The matching engine also has a benchmark harness, which produces the comparison against the greedy and random baselines:

```bash
cd server
npm run bench          # algorithm comparison
npm run bench:scale    # runtime scaling study
```

## Security and privacy

Safeguards implemented in the code:

- Cookie-backed authentication with server-managed sessions and HttpOnly session tokens.
- Authorization checks on protected routes, hosted-group actions, chats, and operator endpoints.
- API rate limiting and response/security headers.
- Input validation and server-side restrictions on group admission and matching.
- Database transactions, capacity checks, and idempotency keys for relevant multi-step actions.
- Membership validation for private messages and meetup operations.
- Safer external API usage through backend-managed credentials and bounded requests.
- Optional email and push configuration; browser push requires permission.

Security controls do not replace deployment-specific hardening. Production deployment should configure HTTPS, trusted origins, appropriate cookie settings, API key restrictions, backups, monitoring, and secret management.

## Project structure

```text
.
├── client/
│   ├── src/
│   │   ├── views/          # Routed Vue pages
│   │   ├── components/     # Reusable interface components
│   │   ├── composables/    # Shared reactive behaviour
│   │   ├── api.js          # Frontend API integration
│   │   └── main.js         # Vue app and router
│   └── vite.config.js
├── server/
│   ├── src/
│   │   ├── routes/         # Express HTTP endpoints
│   │   ├── controllers/    # Request handlers
│   │   ├── services/       # Business logic and provider adapters
│   │   ├── matching/       # Matching solvers, scoring, verification
│   │   └── db/             # SQLite schema, repositories, migrations
│   └── .env               # Local config — do not commit
├── shared/                 # Rules shared by client and server (.mjs)
├── test/
│   ├── server/            # Backend/unit/integration tests
│   ├── client/            # Vue component tests
│   ├── e2e/               # Playwright journeys
│   ├── bench/             # Matching evaluation harness
│   └── fixtures/          # Sanitised demo database
└── package.json           # Root test scripts
```

## Important limitations

- **No online payments:** The checkout endpoint returns an unavailable/not-configured response, and the UI does not accept payment.
- **Matching is not compulsory:** Algorithms propose compatible assignments; actual membership depends on required approvals and available places.
- **Stability has defined assumptions:** Standard Hospitals/Residents rounds can be verified as stable. More complex or relaxed matching models must not be advertised as having that same universal guarantee.
- **Live data depends on providers:** Concert discovery, routes, transport updates, and weather may be unavailable or delayed.
- **The meetup planner needs a Google Maps key:** without `VITE_GOOGLE_MAPS_API_KEY` in `client/.env.local`, the planner's location picker renders "The map could not load" and a location cannot be chosen at all. The older OneMap-backed picker (`MeetupLocationSearch.vue`) is still in the repository but is no longer rendered by any page, so there is currently no fallback.
- **Two map providers, different jobs:** Google Maps handles location picking in the browser; OneMap still serves every nearby-transport and routing lookup from the server. Neither replaces the other.

---

**ENCORE — Helping fans discover concerts, find their people, and make plans together.**
