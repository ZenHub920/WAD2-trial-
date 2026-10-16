# Encore: member-led groups, recommendations and concert coordination

Implementation date: 17 October 2026, Singapore time.

This document describes the revised implementation. It supersedes the initial group-search design in `GROUP_FEATURES_IMPLEMENTATION.md` where the two differ. In particular, member-managed groups now use explicit seeker choice and receiving-host approval; they are not automatically assigned by Gale–Shapley.

## Branches and review

Work started from `main` at `3481b67`. GitHub was checked first and was already up to date. Existing uncommitted work was preserved in a foundation commit on the review branch, including the prior group implementation and the user's local proposal/feedback components. No development database was deleted, recreated or seeded.

Feature branches:

| Branch | Responsibility |
| --- | --- |
| `feature/group-membership-preferences` | Membership records, private friend links, shared preference vocabulary and aggregation |
| `feature/group-recommendations-approval` | Ranked recommendations, pagination, explicit join requests, host approval and client integration |
| `feature/notifications` | Persistent notifications, account settings and chat notification integration |
| `feature/meetup-coordination` | Availability boards, proposed locations, discussion, approvals and weather |
| `feature/attendance-feedback` | Post-event feedback, authorization and reliability projection |
| `feature/integration-hardening` | Cross-feature capacity/security fixes, additional HTTP tests, documentation and review formatting |

All are assembled through merge commits into `review/encore-backend-integration`. Each feature branch builds on the already integrated foundation so its prerequisites are available. Cross-feature corrections are in the final hardening branch and review integration result. `main` is not the destination of any feature commit, merge or push.

## 1. A real group and its places

An attendance group is the group a person belongs to for one concert. A social connection is an agreement between separate groups to meet; it does not create a second attendance membership.

The enforced rule is **one active attendance group per person per concert**, whether that person hosts it or is a member. Cancellation and leaving retain historical records. A host can create a replacement after cancelling the earlier group.

Three quantities are separate:

- The host: already belongs to the group.
- Expected existing friends: accepted through private invitation links; these people do not consume stranger places.
- Additional stranger places: capacity offered through discovery. This can be zero for a friends-only group that still wants to connect with another group.

`group_memberships` is the authoritative active-membership table. A partial unique index prevents a person having two active memberships for the same concert. Database triggers guard hosting and membership/concert consistency. Existing confirmed algorithm proposals also reserve their places; they become membership records on confirmation.

### Forming and publishing a group

1. The host creates a party through the existing concert-party endpoint.
2. The group-management page configures expected friends and stranger places, and places the group into draft state.
3. The host completes individual preference questions.
4. The host generates one private link for each friend and shares it outside the app.
5. A friend signs in and explicitly accepts the link. The server checks membership, blocks, expiry, use status and friend quota.
6. Each accepted friend completes their own preference form.
7. The host publishes once the expected friends have joined and all current members have answered.
8. The host separately opts into group-to-group discovery.

Each friend token is random, expires after seven days, is single use, and is stored only as a SHA-256 hash. A repeat acceptance by the same user is idempotent. Invitation tokens are never returned in general membership/discovery responses.

Changing the configured member count returns a group to draft. A friend leaving also returns it to draft, allowing the host to replace the friend or reduce the expected count before republishing. Members can update their own answers, never another member's answers.

**Data flow:** Vue group form → existing session-authenticated API → membership repository → immediate SQLite transaction → membership/settings/preferences → publication eligibility check → discoverable group.

## 2. Many preference wordings, one matching vocabulary

Every respondent answers three separate questions:

- **About:** what I enjoy.
- **Wants:** what I enjoy in companions.
- **Avoid:** what I prefer to avoid; these are soft preferences.

Standard options include pre-show meetups, food before/after the concert, merchandise, shared transport, public transport, early queueing, arriving at doors, singalong, quiet listening, dancing, photography, group photos, lighter phone use, earplugs, and water/rest breaks.

These are personal preferences. Selecting photography is not permission to ignore an event's photography rules. Safety-related options are optional coordination choices, not health advice or admission requirements.

The standard vocabulary was informed by [Ticketmaster's concert preparation guidance](https://blog.ticketmaster.com/how-to-prepare-for-concert/), [Ticketmaster's concert packing guidance](https://blog.ticketmaster.com/what-to-bring-to-a-concert/), and [WHO's safe-listening guidance](https://www.who.int/news-room/questions-and-answers/item/deafness-and-hearing-loss-safe-listening). Event restrictions still come from the event/venue, rather than these preference tags.

### Normalization and custom text

Original wording is retained. Unicode normalization, case folding and punctuation normalization support deterministic comparison. Known aliases map to the same concept:

| Entered wording | Shared concept |
| --- | --- |
| Supper | Food after the concert |
| Late-night makan | Food after the concert |
| Post concert food | Food after the concert |
| Dinner beforehand | Food before the concert |

An explicit recognized concept ID must exist in the catalog. Suggestions use known aliases and lexical overlap; the backend does not pretend to understand every sentence semantically. An unknown term becomes a normalized custom key and keeps its original wording. Matching unknown terms is exact normalized matching, not an invented synonym or an automatic hard rejection.

There is no embedding service, LLM call, paid preference API or external processing of members' free text. Semantic suggestions could be added later without changing the concept-based scoring contract.

The endpoint `GET /api/preference-concepts?q=...` supports suggestions. The current client provides standard checkboxes and custom text per intent. It does not yet provide a richer inline suggestion/confirmation widget while typing; API support for that integration exists.

### How the group profile is calculated

Each active member contributes at most one vote per concept per intent. Synonyms and duplicate tags from the same member are deduplicated.

If three of four respondents select supper, its support is 0.75. If two select quiet listening, its support is 0.50. The backend retains those fractions instead of pretending the group is unanimous or selecting one complete combination of answers.

Individual answers are not returned in public group cards. Members can read their own raw answers; discovery uses aggregate profiles. Group members see names and answer-completion status so the host knows when publication is ready.

## 3. How individual-to-group recommendations work

1. The seeker selects a concert at `/groups`.
2. If needed, they create an ordinary seeker request using the existing validated API. This is separate from Kaki participation.
3. They save their discovery preferences using the same standard/custom vocabulary.
4. The server finds published groups with spare stranger places.
5. It checks concert, availability, prior declines/rejections, and existing hard compatibility rules. Blocks and applicable hard preferences are checked against active members, not just the host.
6. It compares seeker wants against the group's aggregate about-profile, and group wants against the seeker's about-profile. Avoid preferences reduce the soft score.
7. It ranks results, applies requested search/filter/sort controls, and returns 20 per page by default, with a maximum page size of 30.
8. The seeker sees a qualitative compatibility indicator and up to three supported reasons, then chooses a group and sends a join request.
9. The host reviews the request in Connect Groups and approves or rejects on behalf of the group.
10. Approval rechecks eligibility and current capacity inside an immediate transaction, creates membership, copies the seeker's discovery answers into their member preferences, and updates request status. There is no second seeker acceptance: submitting the request expressed consent.

### Exact ranking approach

For each direction, recognized wants are compared with the other side's about-support fractions. Supported overlap is normalized by preference weight, so simply adding tags does not raise the score. When custom wants exist, they contribute at most 20% of that directional concept score; recognized preferences contribute 80%. Without informative wants, the baseline is neutral rather than assumed rejection. Avoid overlap can subtract up to 0.5.

The two directions are averaged for a mutual concept score. Individual recommendations combine **60% existing structured compatibility** with **40% mutual concept compatibility**. Structured scoring reuses `matching/compatibility.js`, including section, vibe, arrival, plans, languages, geography, reliability and spending. For member-managed groups, the structured profile uses aggregated member vibe/languages/reliability rather than only the host's profile. It averages profile dimensions, not members' complete compatibility scores. Hard eligibility is checked separately before scoring.

Weights are explicit application defaults, not a learned or statistically validated model. Results with insufficient preference evidence are labeled limited confidence. The existing Kaki swipe/filter mechanics are preserved; this is not a claim that Kaki has an identical numerical recommender.

Reasons are constructed from actual shared concepts and support evidence. They are not generated from invented interests or an assumption that everyone attending an artist is automatically a superfan. Fewer than three reasons are shown when fewer than three supported reasons exist.

### Choice, requests and capacity

Only one pending join choice per seeker per concert is allowed. The seeker may withdraw before choosing another group. Withdrawn and expired requests may reopen, retaining status-change events in `group_join_request_events`. A rejection is final for that seeker-request/group pair and is also excluded from the legacy matching path.

Managed join requests record the group's version at the time of choice. Membership, configuration or member-preference changes invalidate that choice: approval fails with a conflict, and the seeker is notified to review, withdraw and resubmit. This preserves consent without a second acceptance step for an unchanged group. Receiving hosts can inspect the requester's public profile and submitted discovery preferences before deciding.

Pending join requests do not reserve places. Accepting two different seekers into the last place cannot both succeed: each approval checks current capacity while holding the write reservation. Accepted stranger memberships and active algorithm proposals consume places exactly once. Friends and the host do not consume advertised stranger places.

**Data flow:** seeker preferences → authenticated Express endpoints → validated concept selections in SQLite → eligibility + shared-profile scoring → ranked page + reasons → chosen join request → receiving host decision → transactional membership/capacity update → notifications.

### Where Gale–Shapley now fits

Member-managed groups use direct choice and host approval and are excluded from operator-run automatic placement. This prevents the legacy proposal-confirmation path from bypassing host approval.

Unconfigured legacy listings retain their existing Gale–Shapley workflow, including explicit saved algorithm preferences, deterministic rankings, blocks, declines, history, idempotency, expiry and proposal confirmation. The UI labels that saved-preference action as a separate optional legacy automatic-placement action. Existing memberships prevent another active concert assignment.

## 4. How group-to-group recommendations and invitations work

1. Each group forms, gathers member preferences, publishes and opts into meeting other groups.
2. The initiating host selects their group and concert.
3. The server excludes cancelled, unavailable, same-host and blocked group pairs. A block involving an active member also prevents a connection, including a directly forged POST that bypasses discovery.
4. Both shared preference profiles are compared directionally.
5. Ranking combines **70% mutual concept compatibility** and **30% shared published logistics**: section, arrival and spending. These weights are explicit defaults.
6. The host receives a paginated top-20 list with supported reasons and invitation status for each pair.
7. The host sends an invitation. Canonical pair ordering and SQLite uniqueness prevent duplicate/reversed invitations.
8. Only the receiving host can accept or decline. Acceptance rechecks current blocks and connection eligibility.
9. Both hosts see an accepted connection and can open a shared planning board for members of both groups.

Friends-only groups with zero stranger places can connect. Accepting a connection never merges memberships, changes stranger capacity, transfers tickets, runs Gale–Shapley or rewrites matching history.

**Data flow:** two member-derived group profiles → eligibility gates → ranked recommendations → session-verified invitation → pending SQLite connection → receiving-host decision → accepted social connection → notifications / shared planning access.

## 5. Notifications, including chat integration

Notifications are durable SQLite rows, rather than ephemeral events that disappear when users are offline. They cover:

- New and reopened seeker join requests and responses.
- Group connection invitations and responses.
- Algorithm proposals and status changes.
- Existing Kaki chat messages and marketplace chat messages.
- Meetup creation, planning changes, discussion, proposed plans, confirmation and cancellation.
- Post-event feedback receipt.

Database triggers create notifications for existing chat/group/proposal writes in the same transaction. Unique `(recipient, event_key)` constraints prevent duplicate delivery of the same event. The sender is not notified of their own chat message. Notifications contain a generic title and a resource path, not private message previews.

Each user has category switches for chat, group, match, meetup and feedback. Inbox APIs are session-scoped, support pagination and unread/read state, and reject reading another account's notification. The client checks for new notifications every 30 seconds. This feature does not send email, mobile push or desktop system notifications, and does not claim instant cross-process delivery.

### Contract for the teammate's future chat

After authorizing the sender and deriving recipients from real conversation membership, call this **inside the chat write transaction**:

```js
repos.notifications.chatMessage({
  messageId: savedMessage.id, // stable and globally unique for this chat system
  conversationPath: `/groups/${partyId}/members`, // replace with the implemented chat route
  senderId: authenticatedUser.id,
  recipientIds: authorizedConversationMemberIds,
});
```

The hook deduplicates recipients/events, excludes the sender and honors chat opt-outs. It is an internal repository method, never a client-accessible “notify any user” endpoint. The teammate must supply the actual chat route and enforce conversation membership; this change does not create their future group-chat system. Existing Kaki/marketplace messages already have notification triggers and should not call this hook again.

**Data flow:** authorized business/chat write → transactional trigger or internal hook → recipient notification rows → session-scoped inbox/unread API → polling badge/list → read acknowledgement.

## 6. Collaborative meetup coordination

Planning lives on a dedicated board at `/meetups/:id`, linked from groups, accepted connections, profiles and Kaki conversations. A future group-chat UI can embed the same APIs or link to the board; it does not need a second planning backend.

A board belongs to exactly one scope:

- One attendance group.
- One accepted group connection, covering both groups' members.
- One valid Kaki conversation, covering its two mutually matched users.

Every read and write recalculates access from current membership/mutual-match state. Leaving a group or losing chat eligibility removes access. A block within the involved participants closes access to shared private planning data.

### Availability and changing daytime locations

1. A participant creates a board with a possible meeting window, using explicit timezone-aware timestamps.
2. Participants select 30-minute availability slots, similar in purpose to an availability grid such as [When2meet](https://www.when2meet.com/).
3. They may supply approximate coordinates for where they expect to be during each time interval. Different intervals can have different starting locations.
4. Everyone sees aggregate slot counts. The API returns a person's raw availability/location rows only to that person.
5. Members nominate actual candidate meeting places, with coordinates and a sheltered flag, and can discuss or vote on them.

The current integration accepts coordinates directly; it does not have a map picker, geocoder, transit service or automatic catalog of nearby cafes. Approximate public starting points are sufficient; precise home/work locations are not required.

### What the location algorithm optimizes

The algorithm evaluates the nominated places across valid meeting slots. Its deterministic ranking is:

1. More participants available for the whole slot.
2. More supplied starting locations within 15 km of the place.
3. Lower total great-circle distance from the available participants' supplied locations.
4. Lower worst individual distance.
5. More votes, then earlier time and deterministic place ID.

It returns the top 20 options with attendee and location-response counts. People without location data still contribute availability, but do not falsely contribute zero known travel distance. This is an optimum under the stated candidate set/objective, **not** a global optimum over every possible location, and straight-line distance is not public-transport travel time.

Users may propose and discuss alternatives rather than accept the highest-ranked result. The board records a proposed time/place and a version number. Approval must refer to that exact version:

- One attendance group: its host approves on the group's behalf.
- Connected groups: both hosts approve.
- Kaki pair: both people approve.

Changing places, votes or availability invalidates the selected plan and earlier approvals. Stale submissions receive a conflict response. An organizer/required approver can cancel the board with a current version. A discussion comment alone does not invalidate an already agreed plan.

### Weather warnings

The adapter uses the public [NEA two-hour forecast via data.gov.sg](https://api-open.data.gov.sg/v2/real-time/api/two-hr-forecast), with provider guidance at [data.gov.sg's real-time API documentation](https://guide.data.gov.sg/developer-guide/real-time-apis).

- The selected place is associated with the nearest forecast area.
- The complete 30-minute meeting slot must be covered by the forecast's validity period.
- Rain/shower/thunder wording produces an advisory to consider a sheltered meeting place.
- Data is cached for five minutes; requests have a five-second timeout.
- Unsupported location, a meeting outside the short-range horizon, missing data, or provider failure returns an explicit unavailable result.
- No numeric rain probability is invented. A forecast with no rain indication is not a guarantee.
- The provider request retrieves area forecasts; participants' private starting locations are not sent to it.

`DATA_GOV_SG_API_KEY` is optional configuration if the deployment needs provider-authenticated access. No paid map, routing or AI service is configured. Weather is checked on request from the board, not through a background weather-alert scheduler.

**Data flow:** current group/Kaki authorization → scoped planning board → private interval/location submissions + public candidate places → aggregate availability and distance ranking → discussion/votes → versioned proposal → required approvals → confirmed meetup → notifications. Weather is a separate cached provider lookup for the chosen place/time.

## 7. Post-concert feedback

Feedback is available after the concert day ends in Singapore. A user must have been a genuine confirmed co-member before the event cutoff; joining afterward does not manufacture eligibility. Self-feedback and repeat feedback for the same recipient/concert are rejected.

The existing `/api/feedback` contract now works:

```json
{
  "partyId": "p_example",
  "ratedUserId": "u_example",
  "showedUp": true,
  "rating": 5,
  "comment": "Clear communication before the concert"
}
```

Supply either `partyId` for member-led groups or `roundId` for the existing confirmed matching context, never both. The rater is always the authenticated session user; a submitted rater identity is ignored.

Old round-based feedback stays in `attendance_feedback`. Direct group feedback goes into `group_attendance_feedback`. The reliability view combines both and retains the existing attendance/rating formula and three-observation prior; the cached recipient reliability is refreshed transactionally. Feedback comments/history are returned only to the author or recipient, not as a public review feed.

The feedback screen at `/feedback` loads eligible recipients and the account's own feedback history. Merely accepting a group-to-group social invitation does not grant review eligibility. Actual physical attendance is reported by participants; this is not a ticket-scan attendance-verification system.

**Data flow:** eligible co-membership after event cutoff → session-authorized feedback POST → validation and duplicate check → feedback row + combined reliability projection → cached user reliability + generic notification → future existing compatibility scoring.

## 8. Database migration and historical compatibility

Migrations are repeatable upgrades to an existing database structure. They run in normal bootstrap and isolated test bootstrap. They do not seed or replace the user's SQLite file.

The upgrade adds membership/settings/preferences, friend-link tokens, join requests and their status events, notifications/settings, meetup data and direct-group feedback. Explicit indexes, transactions and ownership checks protect the operational paths. The earlier global one-host constraint is superseded by active-group guards so a cancelled historical group does not prevent a legitimate replacement.

Existing hosts/confirmed proposals are reconciled to membership where possible. Conflicting legacy memberships are recorded in `membership_conflicts`; records are not silently deleted, cancelled or arbitrarily merged. Operators can inspect `GET /api/operator/group-membership-conflicts`. Affected groups cannot enter the managed publication workflow until the conflict is deliberately resolved, for example by their owner cancelling an obsolete duplicate. Historical matching results remain intact.

Legacy automatic matching, Kaki mutual swipes/chat, authentication, profiles, ticket inventory, orders and seller conversations remain available. Member-managed groups are a separate approval flow. No unrelated authentication provider, ORM or competing matching solver was introduced.

## 9. Endpoint map

All listed account/group endpoints require the existing authenticated session. The operator audit additionally requires operator status.

| Area | Endpoints |
| --- | --- |
| Concepts | `GET /api/preference-concepts?q=...` |
| Personal preferences | `GET/PUT /api/me/discovery-preferences/:concertId` |
| Group formation | `PUT /api/groups/:id/settings`, `GET /api/groups/:id/membership`, `PUT /api/groups/:id/member-preferences`, `POST /api/groups/:id/publish` |
| Friend links | `POST /api/groups/:id/friend-invites`, `POST /api/group-friend-invites/:token/accept` |
| Membership lifecycle | `GET /api/me/attendance-groups`, `POST /api/groups/:id/leave`, `POST /api/groups/:id/cancel` |
| Seeker discovery | `GET /api/groups/discover/:concertId?limit=20&offset=0` |
| Join approval | `POST /api/groups/:id/join-requests`, `GET /api/me/group-join-requests`, `POST /api/group-join-requests/:id/respond` with `accept`, `reject` or `withdraw` |
| Connections | Existing `/api/group-connections` invitation/response endpoints; `/api/group-connections/candidates/:concertId?fromPartyId=...&limit=20&offset=0` now ranks candidates |
| Notifications | `GET /api/me/notifications`, `GET /api/me/notifications/unread`, `POST /api/me/notifications/:id/read`, `POST /api/me/notifications/read-all`, `GET/PUT /api/me/notification-preferences` |
| Planning | `GET /api/me/meetups`, `POST /api/meetups`, `GET /api/meetups/:id` |
| Planning inputs | `PUT /api/meetups/:id/availability`, `POST /api/meetups/:id/places`, `PUT /api/meetups/:id/vote`, `POST /api/meetups/:id/comments` |
| Agreement | `POST /api/meetups/:id/propose`, `POST /api/meetups/:id/approve`, `POST /api/meetups/:id/cancel` |
| Weather | `GET /api/meetups/:id/weather` |
| Feedback | `POST /api/feedback`, `GET /api/me/feedback-opportunities`, `GET /api/me/feedback` |

Discovery filters are applied before pagination. Accepted query controls include `q`, `section`, `arrival`, `spendBand`, `minCapacity`, `activity`, `vibe`, `preferredOnly` and `sort`. API responses retain `{ groups: [...] }` and add `total`, `limit` and `offset`.

### Source map for review

| File or files | What changed |
| --- | --- |
| `server/src/db/communityMigrations.js` | Membership/settings, uniqueness guards, preference storage, join lifecycle/audit and safe legacy reconciliation. |
| `server/src/db/membershipRepository.js` | Friend links, current membership, per-member answers, publication, leaving/cancelling and group versions. |
| `server/src/services/discoveryPreferences.js` | Catalog, alias normalization, suggestions, answer validation, vote aggregation and directional concept scoring. |
| `server/src/db/recommendationRepository.js` | Mutual group recommendations, whole-group eligibility, direct join requests, one pending choice, host approval and changed-group consent checks. |
| `server/src/db/groupDiscoveryRepository.js` and `server/src/routes/groupDiscovery.js` | Preserve discovery/invitation contracts while adding member block checks, ranking, pre-pagination filtering and response metadata. |
| `server/src/db/capacity.js`, `server/src/db/repositories.js`, `server/src/db/proposalRepository.js`, `server/src/services/matchingService.js` | Register new repositories; include direct admissions in live capacity; preserve legacy matching and exclude managed groups from automatic placement. |
| `server/src/db/notificationRepository.js` | Notification migrations/triggers, inbox, preferences, unread state and trusted future-chat hook. |
| `server/src/db/meetupRepository.js` | Scoped planning data, dynamic participant authorization, private availability, proposed places, comments, votes and revision-specific approvals/cancellation. |
| `server/src/services/meetupPlanning.js` and `server/src/services/meetupWeather.js` | Deterministic coverage/distance ranking and cached, bounded public forecast integration. |
| `server/src/db/feedbackRepository.js` | Post-event eligibility, duplicate protection, private history and combined reliability projection. |
| `server/src/db/connection.js`, `server/src/routes/community.js`, `server/src/routes/index.js` | Production/test migration wiring and session-authenticated API registration, including operator conflict audit. |
| `server/test/community.test.js`, `server/test/communityApi.test.js`, `server/test/groupDiscovery.test.js` | Repository/migration/algorithm tests, actual authenticated HTTP flows and updated single-group expectations. |
| `client/src/components/PreferenceEditor.vue`, `GroupListingCard.vue`, `GroupFilters.vue` | Standard/custom answer forms, qualitative reasons and shared discovery controls. |
| `client/src/views/GroupMembershipView.vue`, `GroupExplorerView.vue`, `GroupConnectionsView.vue` | Formation/friend enrollment, publication, paginated recommendations, explicit requests and host review. |
| `client/src/components/NotificationsLink.vue`, `client/src/views/NotificationsView.vue` | Account notification badge, inbox/read actions and settings. |
| `client/src/views/MeetupView.vue`, `client/src/views/FeedbackView.vue` | Minimal integrated planning and feedback screens for the backend features. |
| `client/src/api.js`, `client/src/main.js`, `client/src/components/SiteHeader.vue`, `client/src/views/ProfileView.vue`, `client/src/views/KakiChatView.vue` | Existing HTTP client/route/navigation integration and planning links from Kaki chat. |
| `docs/GROUP_FEATURES_IMPLEMENTATION.md` and this document | Preserve the initial historical report and explain the revised behavior, implementation boundaries and verification. |

The initial foundation's other local edits remain preserved. No runtime dependency or package-lock changes are part of this expansion. A temporary formatter was used only on the newly added feature files; its download/cache lives under ignored verification tooling.

## 10. Tests, running and review

Before expansion, the existing working implementation passed **181 tests, zero failures**. Focused repository and authenticated HTTP tests were added in `server/test/community.test.js` and `server/test/communityApi.test.js`. Existing multiple-host-group expectations were updated to the revised one-active-group business rule rather than weakening authorization.

Final executed test/build results are recorded in the review completion section below after the final regression run. Test databases are isolated; the development SQLite database was not used for destructive testing.

```powershell
Set-Location 'C:\Users\aungb\Documents\WAD2\wad2 project\WAD2-trial-'
git switch review/encore-backend-integration

# Install only if dependencies are not already present.
$env:NODE_USE_SYSTEM_CA = '1'
Push-Location server
npm.cmd ci
node --test test/community.test.js test/communityApi.test.js
node --test test/groupDiscovery.test.js
npm.cmd test
npm.cmd run dev
# Start the frontend in a second terminal.
```

```powershell
Set-Location 'C:\Users\aungb\Documents\WAD2\wad2 project\WAD2-trial-\client'
npm.cmd ci
npm.cmd run build
npm.cmd run dev
```

Use `npm.cmd` on this machine because its PowerShell policy blocks `npm.ps1`. `NODE_USE_SYSTEM_CA=1` uses the machine's trusted certificates; TLS verification is not disabled. Default backend/frontend ports remain 3000/5173. Normal startup runs migrations against the configured database. No new package scripts were invented and no new runtime dependencies were added.

### Manual acceptance sequence

1. Use separate signed-in accounts for host, friend and seeker.
2. Host a group; configure one friend and two stranger places.
3. Complete the host preferences, create a link, and have the friend accept and answer. Verify publication fails before completion and succeeds afterward.
4. Have the seeker enroll, save standard/custom preferences, search recommendations, and inspect reasons.
5. Submit a join request. Verify capacity is unchanged until host approval, another pending choice is rejected, and only the host can approve.
6. Approve and verify membership and exactly one consumed stranger place. Try hosting/joining a second group for the same concert; it should be rejected.
7. Form another published group; enable connections; send and accept an invitation. Verify membership and ticket state stay separate.
8. Check notifications under each account and category opt-outs. Existing Kaki/marketplace chat messages should notify only the other account.
9. Create a planning board from the accepted connection. Submit different availability and starting locations. Verify only the submitter can read raw location rows.
10. Propose places, vote and discuss. Propose a time/place; verify both hosts must approve the same version. Change availability and verify old approval fails.
11. Check weather for an eligible near-term Singapore plan. Outside the forecast horizon, expect unavailable rather than a fabricated prediction.
12. After an actual concert, submit feedback for eligible co-members. Verify unrelated, self and duplicate submissions fail and reliability updates.
13. Exercise existing Kaki, operator matching for legacy listings, profile, marketplace, tickets and conversations.

### Explicit limits

- Browser interaction/mobile-layout acceptance has not been completed; passing Vite compilation and HTTP tests is not a browser QA claim.
- Unknown custom phrases do not receive arbitrary AI semantic interpretation. Known aliases and normalized exact custom matches work; richer suggestions remain an optional integration improvement.
- New member-managed groups use host approval; the legacy automatic-placement workflow is preserved separately.
- Notifications are in-app polling, not email/mobile push or a distributed event broker. The teammate's future group-chat implementation still needs its own routes, authorization and UI.
- Meetup place entry uses coordinates and nominated real places, not automatic nearby-place search or transit routing. The availability grid supports 30-minute slots, a maximum seven-day board window, and at most 96 submitted windows per person.
- Weather covers supported Singapore areas and the provider's short-range validity window, not arbitrary future concert days. There is no scheduled background weather notification service.
- Group-to-group connections do not merge groups or create review eligibility by themselves.
- Legacy membership conflicts require deliberate resolution; no existing records are silently removed.

## Review completion

Final executed verification on 17 October 2026:

| Check | Result |
| --- | --- |
| Pre-expansion baseline: `npm.cmd test` | 181 passed, 0 failed, 0 skipped |
| New repository/migration and authenticated API tests: `node --test test/community.test.js test/communityApi.test.js` | 24 passed, 0 failed; 18 repository/service tests and 6 HTTP integration tests |
| Full final regression: `npm.cmd test` | **205 passed, 0 failed, 0 skipped** |
| Production frontend: `npm.cmd run build` | Passed; 149 modules transformed |
| `node --check` on changed JavaScript files | 23 passed |
| Production `getDb()` bootstrap against explicitly isolated `:memory:` storage | Passed; 46 tables; zero foreign-key violations |
| `git diff --check` | Passed |

The existing negative-path ticket test intentionally logs a simulated SQLite trigger failure while its rollback assertions pass. Weather success/error/cache/horizon behavior was tested with controlled provider responses; the public provider payload was also inspected, but no live weather request against a user's private planning board or real multi-account browser acceptance pass is claimed.

Review the assembled result on `review/encore-backend-integration`. All feature work and integration corrections are committed on non-main branches, with feature merges retained in history. The local `main` reference remains `3481b67`; no main merge or main push is authorized or performed. The source guide, endpoint map and manual acceptance checklist above are intended to support the owner's review before any later main integration.
