# Backend integrations and operations

This update starts from GitHub commit `46ce237`. Feature branches cover account safety, travel planning, and browser notifications; they are combined in `integration/backend-planning-notifications`.

## Shared questionnaire and current Kaki Finder flow

The **same saved account questionnaire** is used by Kaki Finder and group discovery. Answers include what someone enjoys, what they want in companions, soft avoids, up to three hard dealbreakers, and optional quiz answers. Group profiles combine the answers of active members: preference frequencies reflect the whole group and any member's hard veto remains a veto.

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

## What changed

| Area | Behaviour and data flow |
| --- | --- |
| Hard dealbreakers | Shared mutual eligibility checks exclude incompatible candidates before ranking and recheck applications, offers and group invitations before acceptance. A veto cannot be outweighed by a high average score. |
| Reliable notifications | Message/event → SQLite inbox and transactional job → leased background worker → encrypted Web Push → service worker verifies the current signed-in recipient → operating-system popup. Read, muted, expired, suspended or inaccessible notifications are suppressed. |
| Background operations | Durable jobs expire applications/offers, advance the existing seat queue, issue expiry/meetup/feedback reminders, recheck weather and refresh concerts. Jobs retry with backoff and recover abandoned leases. Automatic matching rounds remain operator controlled. |
| Travel planning | Availability and private starting locations + proposed places → bounded OneMap journey queries → aggregate travel ranking. Attendance comes first, then reachable people, combined travel time and the longest journey. Incomplete route data uses a clearly labelled distance fallback. |
| Transport and weather | Authorized planner requests → server adapters → cached LTA/NEA data. The UI shows live bus arrivals, train disruptions/crowding, forecasts and nearby rainfall with timestamps and precision labels. |
| Account safety | Trusted-origin email link → expiring, single-use hashed token → verification or password reset. Password changes/resets and global sign-out revoke sessions; suspended accounts lose access. Existing users are not suddenly required to verify email. |
| Moderation | Report → operator-only queue → retained message evidence → review/dismiss/warn/suspend → immutable audit record. Ordinary users cannot retrieve moderation evidence. |
| Concert refresh | Bounded paged Ticketmaster search → durable cache/import → change audit → alerts for date/time/venue/status changes. Known omitted events receive bounded individual refreshes; disappearance alone never implies cancellation. Confirmed meetup plans are not rewritten. |
| Larger conversations | Authorized thread → latest50 messages → thread-scoped before/after cursors, maximum100 per page. “Load older messages” preserves scroll position; reconnects drain forward pages before advancing the cursor. Targeted queries also narrow meetup and feedback candidate reads. |

The migrations are additive schema updates applied at startup to both existing and new databases. They preserve accounts, matching history and memberships. New tables store account controls, action-token hashes, moderation audit, rate limits, push subscriptions, background jobs, provider cache/budgets and concert changes. Back up the database before deploying schema updates.

## Browser popups

In **Profile → Notifications**, press **Enable browser notifications** and accept the browser prompt. This is an explicit user action; the application does not prompt automatically on page load. The service worker can receive a notification when the page is closed, subject to browser/OS settings and a valid session. Clicking the popup opens the relevant conversation or meetup.

Production needs HTTPS; localhost supports development. On iPhone/iPad, Web Push requires a supported installed Home Screen web app. Delivery is not guaranteed when the browser/OS has disabled background notifications. Device opt-out, logout and account switches detach subscriptions. Chat bodies are not included in push payloads.

Generate the VAPID pair once with `cd server` then `npm run push:keys`. The script writes ignored `server/.env` without printing private keys. Configure `VAPID_SUBJECT` with your contact address. The public key is intentionally returned to browsers; the private key and provider credentials are never returned.

## Account setup and operations

Copy `server/.env.example` to `server/.env` without replacing any existing private configuration. Configure `APP_ORIGIN` as the exact frontend origin and add the SMTP credentials you already have. The recovery UI is at `/account/security`, linked from Login and Profile. SMTP requires TLS. Mail tokens are never saved in plaintext or logged; email delivery runs in memory, so a restart during delivery may require requesting a fresh link.

Operators can use:

- `GET /api/operator/reports` and `GET /api/operator/reports/:id` for the queue and evidence.
- `POST /api/operator/reports/:id/resolve` with `{ "action": "review|dismiss|warn|suspend", "note": "reason" }`.
- `POST /api/operator/users/:id/unsuspend` with an audit note.

Rate limits cover login, registration, recovery, password changes, messages, reports and provider endpoints. Counters persist across restart. Configure `TRUST_PROXY` only for your actual proxy topology, otherwise forwarded addresses must not be trusted.

The server starts its job worker automatically; `ENABLE_BACKGROUND_JOBS=false` disables it for local diagnosis. `createApp()` alone never starts timers. Keep the API process running for reminders and queued deliveries. This SQLite implementation is intended for processes sharing the same database, not separate uncoordinated database copies.

## Every public API used

| Provider/API | Implemented use | Account/key |
| --- | --- | --- |
| **Ticketmaster Discovery** — event search and event detail | Import/refresh Singapore music events, images, official links, seating map URLs and event changes. | Registered Consumer Key; server-only. |
| **OneMap authentication** | Obtain/renew the server's access token. | Register a OneMap account; server email/password or manually supplied token. |
| **OneMap Search** | Search public addresses/venues and fill in meeting-place coordinates. | OneMap access token. |
| **OneMap Routing** | Walking and scheduled public-transport journey estimates for proposed meeting options. | OneMap access token. |
| **LTA DataMall Bus Arrival v3** | Bus arrivals, load and wheelchair-accessible vehicle flags for a selected bus stop. | Registered DataMall Account Key. |
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

These integrations use public/free-access services with quotas; no paid fallback, billing account or automatic paid upgrade is configured. The app adds caches, request coalescing, timeouts and bounded queries. Ticketmaster's conservative daily request counter persists; OneMap/LTA/NEA adapter budgets are per process and reset on restart, so they are not a substitute for provider account quotas. Hosting, your SMTP plan and any future provider terms are outside the app's control. Review provider terms before commercial deployment. Do not enable a paid subscription to run these features.

OneMap/LTA need your new accounts before live verification. Browser push needs local VAPID configuration and a browser permission grant; SMTP needs your local credentials. Automated tests use mocked external providers and delivery transports. See [API_MEETUP_SETUP.md](API_MEETUP_SETUP.md) and [WEB_PUSH_AND_BACKGROUND_JOBS.md](WEB_PUSH_AND_BACKGROUND_JOBS.md) for endpoint details and limitations.

## How MusicBrainz would help

MusicBrainz provides music **metadata**, not audio streaming or a user's listening history. A typical integration searches an artist name, lets the user select the correct result, stores the stable **MusicBrainz ID (MBID)**, and then looks up aliases, releases and other public metadata. That would help Encore distinguish artists with similar names and match different spellings of the same artist.

Public reads currently require no API key, but requests need a meaningful application User-Agent and must stay at or below **one request per second**. Cache results because artist metadata changes slowly. Its hosted API is free for noncommercial use; commercial usage has separate terms. Sources: [MusicBrainz API](https://musicbrainz.org/doc/MusicBrainz_API), [rate limits](https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting).

Other provider references: [Ticketmaster Discovery](https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/), [OneMap documentation](https://www.onemap.gov.sg/apidocs/), [LTA dynamic data](https://datamall.lta.gov.sg/content/datamall/en/dynamic-data.html), [NEA weather API guidance](https://www.weather.gov.sg/faq), [Apple Web Push](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/).
