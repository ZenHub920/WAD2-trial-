# Backend integrations and operations

Current feature overview and developer integration reference. See [hybrid matching](HYBRID_GROUP_MATCHING.md) for seeker/group workflows and [scoped testing](SCOPED_FEATURE_TESTING.md) for the latest matching, chat, planner and notification checks.

## Shared questionnaire and current Kaki Finder flow

Kaki Finder and group discovery use the same saved account questionnaire. Answers include what someone enjoys, what they want in companions, soft avoids, up to three hard dealbreakers, and optional quiz answers. Group profiles combine the answers of active members: preference frequencies reflect the whole group and any member's hard veto remains a veto.

Direct group browsing is available without completing the questionnaire. Answers improve its recommendations; automatic group matching requires answers. A concert-specific seeker answer record is also supported, with account answers as its fallback.

Kaki Finder currently works as follows:

1. **Join a concert.** The person records attendance, section and arrival preferences. This is separate from applying to a group.
2. **Open Kaki Finder.** The browser requests the pool of people attending shared concerts. Server filters remove the viewer, blocked pairs and people outside the selected search filters.
3. **Rank candidates.** The server loads saved questionnaires. Hard dealbreakers in either direction exclude the pair. With questionnaire answers, it compares preferences and quiz traits; without answers, it returns the eligible filtered pool without claiming a personalized ranking.
4. **Build the deck.** Kaki uses the solver registry's **Irving stable-roommates algorithm** for the peer pool. A stable partner, when one exists, leads the recommendation order; other candidates follow by compatibility. Some peer pools have no stable matching, so score ordering is the fallback. This is not automatic acceptance or a maximum-total-score guarantee.
5. **Like or skip.** Decisions are saved for a particular person and concert. Liking is not a group application. A user can undo a decision.
6. **Mutual like creates a connection.** Both people must like each other for the same concert before their Kaki chat is available. The server rechecks participation, blocks and eligibility when authorizing chat.
7. **Chat and coordinate.** Messages persist in SQLite, live events update open tabs, and notification jobs support device popups. A connected pair can use the shared meetup planner.

The separate **automatic seeker-to-group flow** uses Gale–Shapley/deferred acceptance over seekers and groups with capacity. It still requires **both host and seeker approval**. Direct search remains the paired-card choice flow: preferring a card narrows the deck; choosing to apply sends one pending application for host approval. Direct and automatic offers share the existing FIFO admission queue and seat accounting. Group-to-group invitations still need the receiving host's approval; they connect groups without silently merging memberships.

Accepted group connections have one shared chat for both groups' current members. Members can find it under **Messages → Groups** or open it from an accepted invitation. The chat uses the connection-scoped planner and existing notification/push delivery; access follows current group membership. Original host-managed single-group channels remain separate. See the [planner workflow](#meeting-planner).

Group formation uses private friend links before publishing: the host specifies expected friends and extra stranger places, friends join and contribute preferences, then the host publishes once the expected membership and answers are complete. Each member contributes one vote per preference concept/intent; public recommendations expose aggregate support. Hosting and joining both obey one active attendance group per person per concert. Connections require both groups to opt in, the sending host to invite, and the receiving host to accept; they consume no stranger places and do not merge memberships.

After the concert day ends in Singapore, eligible confirmed co-members can submit attendance/rating feedback. Self-feedback, duplicates and post-event joiners cannot create eligibility; a group connection alone is insufficient. Feedback contributes to reliability, and its comments/history remain private to author and recipient. Attendance is participant-reported.

## What changed

| Area | Behaviour and data flow |
| --- | --- |
| Hard dealbreakers | Shared mutual eligibility checks exclude incompatible candidates before ranking and recheck applications, offers and group invitations before acceptance. A veto cannot be outweighed by a high average score. |
| Reliable notifications | Message/event → SQLite inbox and transactional job → leased background worker → encrypted Web Push → service worker verifies the current signed-in recipient → operating-system popup. Read, muted, expired, suspended or inaccessible notifications are suppressed. |
| Background operations | Durable jobs expire applications/offers, advance the existing seat queue, issue expiry/meetup/feedback reminders, recheck weather and refresh concerts. Jobs retry with backoff and recover abandoned leases. Automatic matching rounds remain operator controlled. |
| Travel planning | Availability, private starting locations and each person's car/public-transport method + proposed places → bounded OneMap journey queries → aggregate travel ranking. Attendance comes first, then combined travel time and the longest journey. Budgets are not ranking factors. Incomplete route data uses a clearly labelled distance fallback. |
| Transport and weather | Authorized planner requests → server adapters → cached LTA/NEA data. The UI shows bus loads, station crowds, train disruptions, nearby car parking, forecasts and recent rainfall. Conditions are labelled current; arrival timestamps are omitted from the planner. |
| Account safety | Trusted-origin email link → expiring, single-use hashed token → verification or password reset. Password changes/resets and global sign-out revoke sessions; suspended accounts lose access. Existing users are not suddenly required to verify email. |
| Moderation | Report → operator-only queue → retained message evidence → review/dismiss/warn/suspend → immutable audit record. Ordinary users cannot retrieve moderation evidence. |
| Concert refresh | Bounded paged Ticketmaster search → durable cache/import → change audit → alerts for date/time/venue/status changes. Known omitted events receive bounded individual refreshes; disappearance alone never implies cancellation. Confirmed meetup plans are not rewritten. |
| Larger conversations | Authorized thread → latest50 messages → thread-scoped before/after cursors, maximum100 per page. “Load older messages” preserves scroll position; reconnects drain forward pages before advancing the cursor. Targeted queries also narrow meetup and feedback candidate reads. |

The migrations are additive schema updates applied at startup to both existing and new databases. They preserve accounts, matching history and memberships. New tables store account controls, action-token hashes, moderation audit, rate limits, push subscriptions, background jobs, provider cache/budgets and concert changes. Back up the database before deploying schema updates.

## Meeting planner

1. Press the **Plan meetup** button in an ordinary group chat, connected-groups chat, Kaki chat or group dashboard. The planner opens on a separate page, with existing plans filtered to that group/connection/pair. Press **Open planner** for a saved board, or create one with a title and a half-hour to seven-day window. Creation fields and displayed times use Singapore time, including on devices abroad.
2. In **Find a time**, drag across the heatmap to paint half-hour availability. Starting on a selected cell erases; tapping or keyboard arrows/Space also works. Columns are Singapore dates and rows are times. Colour intensity and numeric counts show saved group availability; check marks/outlines show your own selection. A full seven-day board supports all 336 half-hour slots.
3. Choose **Car** or **Public transport**, optionally search OneMap for an approximate public starting place, and apply these to selected cells. Individual periods can have different locations/methods. Press **Save selected availability** to share; painting alone stays local. Raw starting locations remain private.
4. In **Choose a place**, add public meeting-place candidates. A sheltered-place checkbox is participant-supplied information, not a verified provider property. **Compare travel options** ranks attendance first, then combined journey time and the longest journey using a bounded OneMap shortlist; votes break ties. Budgets are not ranking factors. Incomplete route coverage produces labelled distance estimates.
5. In **Agree on the plan**, vote/discuss and propose a time/place. Final approval remains the group host, both connected-group hosts or both Kaki participants, rather than every group member. Everyone may supply availability; unanimous availability is not a confirmation requirement. Availability/place/vote revisions reset the proposal and require fresh approvals; comments do not.
6. In **Getting there and getting home**, choose **Before the meetup** to check the proposed meeting place, or **After the concert** to check the concert venue. OneMap finds the nearest three rail stations within 1.5 km and three bus stops within 800 m. LTA crowd/advisory results are limited to those stations, their lines and nearby bus services; no citywide list or stop-code entry is needed. Bus arrival timestamps are omitted.

Post-concert checks use the concert attached to the group/connection/Kaki pair. A unique exact OneMap venue-name match can supply its public coordinates. Missing/ambiguous matches require **Check or correct the concert venue**: select the actual venue through the address search and check again. This location choice stays local to the transport panel; it does not replace the group's meeting place or use anyone's private origin.

Press **Check nearby transport** to start a check. When a feed is available, an optional checkbox enables minute-by-minute refresh only for the visible active panel; it can be paused. Geography is cached for a day, train advisories for a minute, station crowds for ten minutes and bus loads for twenty seconds. LTA itself updates station crowd observations about every ten minutes, so repeated refreshes need not change the crowd level. Sources and observation/check times remain visible; missing or stale data is labelled. These are current conditions, not a prediction of a concert's future crowd surge. NEA forecasts/rainfall and nearby car parking remain available separately.

Saved availability, places, votes, discussion, approvals and cancellation update other open planner pages through the existing authenticated SSE stream. Events contain only `meetupId` and `version`; clients refetch through normal membership checks. Reconnect/focus and a visible-page fifteen-second refresh recover missed events, including across separate server processes. No new realtime service or provider polling is added. **Refresh planner** is also available.

Live updates preserve unsaved heatmap selections, locations and discussion drafts. Saving availability includes the current board version; a stale write is rejected without partial changes, then the latest board is loaded while retaining the draft for review/retry. **Discard my changes** explicitly reloads saved availability. Switching boards/accounts clears private drafts and obsolete provider responses are ignored.

Authenticated provider endpoints:

| Endpoint | Purpose |
| --- | --- |
| `GET /api/meetups/:id/locations?q=…` | OneMap address lookup |
| `GET /api/meetups/:id/travel-suggestions` | Aggregate route/distance comparison |
| `GET /api/meetups/:id/transport` | LTA parking, crowding and advisories |
| `GET /api/meetups/:id/weather` | Weather forecast for the selected proposal |
| `GET /api/meetups/:id/environment` | Broader outlooks and recent rainfall |

`GET /api/me/meetups` optionally accepts one of `partyId`, `connectionId` or `kakiConversationId` to scope the list. `PUT /api/meetups/:id/availability` still accepts `windows`; the new UI also sends optional `version` for optimistic concurrency. Existing callers without it remain compatible. No schema migration is needed for the heatmap.

`GET /api/meetups/:id/transport?phase=pre|post` supplies the focused travel panels. Post-concert checks optionally accept a user-confirmed public venue `latitude`, `longitude` and `label`. Legacy transport queries remain supported; `parkingOnly=true` avoids unrelated advisory calls for the parking button. Nearby lookup uses authenticated [OneMap Nearby Transport](https://www.onemap.gov.sg/apidocs/nearbytransport); LTA crowd/advisory fields follow its [API guide](https://datamall.lta.gov.sg/content/dam/datamall/datasets/LTA_DataMall_API_User_Guide.pdf). All line clusters are normalized before nearby filtering, including supported LRT lines. Invalid inputs, current access and membership/version changes are checked before returning results.

Requests check current membership, validate inputs, call fixed server-side provider adapters/caches, then recheck membership and plan version before returning safe results. Credentials and raw provider payloads stay on the backend. See [team setup](TEAM_CREDENTIALS_SETUP.md) for credentials and [server/.env.example](../server/.env.example) for configuration/request-budget fields. Restart the backend after configuration changes. Missing credentials/provider outages leave manual place entry and labelled estimates available.

## Browser popups

In **Profile → Notifications**, press **Enable browser notifications** and accept the browser prompt. This is an explicit user action; the application does not prompt automatically on page load. The service worker can receive a notification when the page is closed, subject to browser/OS settings and a valid session. Clicking the popup opens the relevant conversation or meetup.

Production needs HTTPS; localhost supports development. On iPhone/iPad, Web Push requires a supported installed Home Screen web app. Delivery is not guaranteed when the browser/OS has disabled background notifications. Device opt-out, logout and account switches detach subscriptions. Chat bodies are not included in push payloads.

Generate the VAPID pair once with `cd server` then `npm run push:keys`. The script writes ignored `server/.env` without printing private keys. Configure `VAPID_SUBJECT` with your contact address. The public key is intentionally returned to browsers; the private key and provider credentials are never returned.

Authenticated push endpoints (all under `/api`):

| Endpoint | Purpose |
| --- | --- |
| `GET /me/push/config` | Availability and public VAPID key |
| `POST /me/push/status` | Check the caller's device ownership |
| `POST /me/push/subscriptions` | Register/renew a validated subscription |
| `DELETE /me/push/subscriptions` | Detach the caller's device |
| `GET /me/push/notifications/:id?subscriptionId=…` | Fetch an authorized unread popup |

The message, grouped inbox row and device jobs commit together. The worker rechecks access/read state and sends only notification/subscription IDs; the service worker retrieves the current title through the authenticated API. Reading a chat alert removes its row so later messages can notify again. Delivery is at least once; notification tags reduce duplicates. See [Web Push deployment](WEB_PUSH_COST_AND_DEPLOYMENT.md) for device verification, backups and hosting considerations.

## Account setup and operations

Copy `server/.env.example` to `server/.env` without replacing any existing private configuration. Configure `APP_ORIGIN` as the exact frontend origin and add the SMTP credentials you already have. The recovery UI is at `/account/security`, linked from Login and Profile. SMTP requires TLS. Mail tokens are never saved in plaintext or logged; email delivery runs in memory, so a restart during delivery may require requesting a fresh link.

Operators can use:

- `GET /api/operator/reports` and `GET /api/operator/reports/:id` for the queue and evidence.
- `POST /api/operator/reports/:id/resolve` with `{ "action": "review|dismiss|warn|suspend", "note": "reason" }`.
- `POST /api/operator/users/:id/unsuspend` with an audit note.

Rate limits cover login, registration, recovery, password changes, messages, reports and provider endpoints. Counters persist across restart. Configure `TRUST_PROXY` only for your actual proxy topology, otherwise forwarded addresses must not be trusted.

Custom cookie-authenticated write clients should send JSON and `X-Requested-With: Encore`, as the frontend does. A separately hosted frontend must apply the headers defined in `client/securityHeaders.js` at its static host; API response headers cannot configure another host's pages.

The server starts its job worker automatically; `ENABLE_BACKGROUND_JOBS=false` disables it for local diagnosis. `createApp()` alone never starts timers. Keep the API process running for reminders and queued deliveries. This SQLite implementation is intended for processes sharing the same database, not separate uncoordinated database copies.

Custom server entry points call `delivery.start({ intervalMs: 60000 })` after setup and await `delivery.stop()` before closing SQLite. Extend the worker with `registerTask(name, handler, { intervalMs })`, `enqueue({ key, type, payload, availableAt })` or `registerWeatherChecks(integrations.weather)`. Lifecycle expiry runs each minute, reminders every five minutes and registered weather checks every thirty minutes. The worker never launches Gale–Shapley rounds. Job leases recover abandoned work; retries are bounded and completed/dead jobs have retention limits.

## Every public API used

| Provider/API | Implemented use | Account/key |
| --- | --- | --- |
| **Ticketmaster Discovery** — event search and event detail | Import/refresh Singapore music events, images, official links, seating map URLs and event changes. | Registered Consumer Key; server-only. |
| **OneMap authentication** | Obtain/renew the server's access token. | Register a OneMap account; server email/password or manually supplied token. |
| **OneMap Search** | Search public addresses/venues and fill in meeting-place coordinates. | OneMap access token. |
| **OneMap Routing** | Driving and scheduled public-transport journey estimates for proposed meeting options. | OneMap access token. |
| **LTA DataMall Bus Arrival v3** | Bus load and wheelchair-accessible vehicle flags for up to three approaching vehicles at a selected stop; arrival times are retained only for API compatibility. | Registered DataMall Account Key. |
| **LTA Car Park Availability v2** | Nearby reporting car parks and current available car lots around the selected meetup proposal. | Same DataMall Account Key; no extra SDK key. |
| **LTA Train Service Alerts** | Current rail disruptions and advisories. | Same DataMall key. |
| **LTA Passenger Crowd Density (real time)** | Current crowd levels for a selected train line/station. | Same DataMall key; coverage depends on LTA. |
| **NEA 2-hour weather forecast via data.gov.sg** | Local-area warning for meetings covered by the forecast period. | Public access; optional data.gov.sg key. |
| **NEA 24-hour forecast via data.gov.sg** | Broader national outlook when appropriate; labelled accordingly. | Same public/optional-key access. |
| **NEA 4-day outlook via data.gov.sg** | Approximate daily national outlook for later plans. | Same public/optional-key access. |
| **NEA rainfall via data.gov.sg** | Recent nearby station measurements; clearly distinguished from forecasts. | Same public/optional-key access. |

Web Push also communicates with the subscription's browser-managed push service (for example FCM, Mozilla or Apple). This is a delivery protocol, not a purchased messaging API; the app uses locally generated VAPID credentials. Email uses your configured SMTP server, not an added paid email provider.

**MusicBrainz is explained below, but is not added as a runtime integration in this update.** Existing remote image URLs and official ticket links are media/navigation resources, not additional API clients.

## Getting provider access and controlling cost

1. Register with [OneMap](https://www.onemap.gov.sg/apidocs/register). Add `ONEMAP_EMAIL` and `ONEMAP_PASSWORD`, or obtain an access token and set `ONEMAP_TOKEN`. Tokens expire; email/password configuration permits renewal.
2. Request an account/key through [LTA DataMall](https://datamall.lta.gov.sg/). Add the issued key to `LTA_ACCOUNT_KEY`. No credentials can be supplied here before those accounts exist.
3. NEA public data works without an account within public limits. For deployment, optionally request a [data.gov.sg API key](https://guide.data.gov.sg/developer-guide/api-overview) and set `DATA_GOV_SG_API_KEY`.
4. Keep the existing Ticketmaster Consumer Key in `TICKETMASTER_API_KEY`. No ticket purchase/payment API is enabled.
5. Credentials belong only in ignored `server/.env` or a deployment secret store. `.env.*` variants and `server/secrets/` are ignored; the tracked example contains blank values. Never place secrets in `VITE_` variables, frontend code or Git.

These integrations use public/free-access services with quotas; no paid fallback, billing account or automatic paid upgrade is configured. The app adds caches, request coalescing, timeouts and bounded queries. The security update persists Ticketmaster daily counters and OneMap/LTA/NEA HTTP-attempt budgets in SQLite, including authentication/retries. Processes with separate databases do not share counters, and application limits are not substitutes for provider account quotas. Hosting, your SMTP plan and any future provider terms are outside the app's control. Review provider terms before commercial deployment. Do not enable a paid subscription to run these features.

New developers need their own configured accounts or authorised development access. See [TEAM_CREDENTIALS_SETUP.md](TEAM_CREDENTIALS_SETUP.md). Automated tests use controlled external providers and delivery transports; they do not establish live service availability or native OS popup delivery. Current results and remaining checks are in [SCOPED_FEATURE_TESTING.md](SCOPED_FEATURE_TESTING.md).

## How MusicBrainz would help

MusicBrainz provides music **metadata**, not audio streaming or a user's listening history. A typical integration searches an artist name, lets the user select the correct result, stores the stable **MusicBrainz ID (MBID)**, and then looks up aliases, releases and other public metadata. That would help Encore distinguish artists with similar names and match different spellings of the same artist.

Public reads currently require no API key, but requests need a meaningful application User-Agent and must stay at or below **one request per second**. Cache results because artist metadata changes slowly. Its hosted API is free for noncommercial use; commercial usage has separate terms. Sources: [MusicBrainz API](https://musicbrainz.org/doc/MusicBrainz_API), [rate limits](https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting).

Other provider references: [Ticketmaster Discovery](https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/), [OneMap documentation](https://www.onemap.gov.sg/apidocs/), [LTA dynamic data](https://datamall.lta.gov.sg/content/datamall/en/dynamic-data.html), [NEA weather API guidance](https://www.weather.gov.sg/faq), [Apple Web Push](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/).

For current verification commands and scope, use [SCOPED_FEATURE_TESTING.md](SCOPED_FEATURE_TESTING.md). Live OneMap/LTA and SMTP delivery require configured credentials; operating-system popups additionally require device permission and a live delivery check.
