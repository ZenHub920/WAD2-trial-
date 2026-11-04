# Encore first-time group and meetup experience

> Historical report for the previous batch. The current comprehensive pass is
> documented in `ENCORE_GROUP_MATCHING_MEETUP_FIXES.md`. In particular, viewing
> a pathway no longer changes enrollment, and the current planner stages and
> availability-response model supersede the descriptions below.

Date: 5 November 2026. Branch: `feat/first-time-group-meetup-ux`.
Initial baseline: `5cb4b66`, fast-forwarded from GitHub before edits. A second
fetch found six new teammate commits; the review branch was safely fast-forwarded
to `9c16117` and the uncommitted work reapplied. Two further teammate visual
commits were then incorporated through `b5ee66c` before final browser testing.
One overlapping CSS insertion was resolved by retaining both sets of rules.
The later group dropdowns, top navigation, concert-page styling, waveform
background, pagination, meetup-button alignment and poster palettes remain.
Brandon's group/ticket/concert work, Hern Yee's organizer-only Place/Time picker,
mandatory onboarding and avatar participation requirement are also preserved.
The existing browsing pathway and visual identity are retained.
Existing questionnaire fields/options, group preference aggregation, two-sided
scoring, matching stability, capacity/queue rules and approval requirements
remain in use. This task changes when an ordinary seeker can initiate matching
and how the workflows explain their current state.

## Scope and decisions

The original brief described operator-run matching. The user's subsequent
instruction replaces that policy: **an ordinary seeker presses Find a match to
run matching**. Enrollment, switching methods and saving priorities do not run a
round. There is no automatic schedule or promised matching time.

If no suitable group is found, show **No suitable group is available.** and an
explicit **Browse and choose groups** action. This changes the saved joining
method before displaying direct browsing; it sends no application.

No changes from this task are committed, pushed or merged into main. Existing
local demo tools/data/credentials and server configuration remain ignored and
outside this change set. The two previously deleted Markdown reports are not
restored; this new report is explicitly required by the current brief.

## What changes for a user

- **Automatic matching:** join the list, optionally prioritise groups, then press
  **Find a match**. Prioritising has an immediate reversible saved state. A real
  offer needs seeker and host approval. After confirmation, open the existing
  group, messages or planner directly.
- **No match:** see **No suitable group is available.**, with **Browse and choose
  groups** as the primary alternative. The switch is saved first. If it fails,
  the interface keeps the automatic method and explains the error; no request
  is sent to a group. A separate Find a match action allows a later retry.
- **Meetup planner:** see the next relevant task and jump to it. Explore all
  authorized stages, share availability, suggest/vote for places, then let the
  authorized organizers review the leading option or compare alternatives.
- **Group connections:** see which group was invited and who must reply. After
  acceptance, immediately open the shared chat, even if the list refresh fails.
- **Host setup:** see whether settings, expected friends and member preferences
  are ready before publishing, with buttons or links to resolve missing steps.

## Problems and corrections

| Workflow | Problem | Implemented correction |
|---|---|---|
| Automatic matching | Saving a group like could be mistaken for applying or running a match. | Rename to Prioritise for matching, show a reversible selected state and immediate card-specific acknowledged feedback. |
| Matching progress | Setup, enrollment, waiting, offers and approvals were scattered. | One named progress region uses canonical server matching state, personal readiness, actual proposals and confirmed memberships. Saved priority groups sit alongside it. |
| Enrollment failure | Selecting a method could leave the rejected method highlighted. | Restore the persisted method on rejection; show a contextual prerequisite explanation/link. Saved successful responses survive failed follow-up reads. |
| Method selection | Find my match sounded like a search even when it only selected a method. | Use View automatic matching or Automatic matching selected; reserve Find a match for the actual search. Hide the priority-results link when there are no results. |
| Self-service search | Users depended on an operator executing a round. | Authenticated Find a match action invokes the existing solver, with caller-scoped idempotency, authorization, capacity protection and personal-only results. |
| No suitable match | A generic waiting state did not explain the outcome or alternative. | Exact no-suitable-group message plus an explicit action to switch to direct browsing. |
| Confirmed membership | An empty discovery result suggested creating another group despite existing membership. | Direct confirmed members to their existing group, chat and planner. |
| Search rate limits | Alternate URL casing/trailing slashes could miss the matching limit. | Apply the same bucket to all route variants accepted by Express. |
| Meetup responsibilities | Participants and organizers had similar interfaces without a clear next task. | State-, capability- and draft-driven What should I do next? guidance with navigation/focus to the relevant control. |
| Meetup stages | Own saved availability unnecessarily prevented inspecting authorized places/discussion. | All authorized stages are inspectable; existing server write capabilities and plan locks remain. No invented availability-response statistics. |
| Recommendations | Ranking terminology and every alternative were exposed immediately. | Show the leading recommendation plainly; retain the two-dropdown picker under Compare other options. Preview still requires explicit reviewed submission. |
| Group invitations | Generic feedback obscured which group was invited and what happens next. | Group-specific feedback, consistent sent/received/accepted/declined states and visible received-invitation actions. |
| Accepted connection | A successful acceptance followed by failed refresh could conceal the new chat. | Preserve the actual accepted response and expose Open shared chat immediately. |
| First-time host setup | Missing publication requirements were mostly explained after failure. | Saved-settings, exact expected-friend and member-preference readiness with contextual actions and explicit draft/published/connection-enabled distinctions. |
| Navigation | Connections and requests were difficult to find from the owning group. | Direct group workspace/navigation links and actionable invitation guidance; existing back navigation and unsaved protection remain. |

## Automatic matching flow

1. Complete the existing private questionnaire and concert-specific request.
   The status response exposes only a readiness boolean, not questionnaire text.
2. Choose automatic matching. The existing immediate eligible method switch and
   canonical algorithm-mode enrollment contract are retained. The legacy
   `matching_opt_in` flag is not substituted for the actual matching contract.
3. Optionally prioritise groups. The preference endpoint saves an ordering hint;
   it creates neither a direct application nor a matching round or reservation.
4. Press **Find a match**. Only this new explicit action invokes self-service
   matching. It uses the existing two-sided profile construction and Gale–Shapley
   solver over the eligible concert pool; another already-enrolled seeker can
   also receive an offer from that batch.
5. A real proposal becomes the next prominent action. Queue position, held-spot
   readiness, expiry and existing restrictions remain authoritative. A proposal
   is not membership: both seeker and host must explicitly approve.
6. After both approvals, actual confirmed membership exposes links to the group
   workspace, group messages and meetup planning.
7. With no suitable group, offer retry or the explicit switch to direct browsing.
   Neither option fabricates a result or bypasses host approval.

The button sends `POST /api/me/concerts/:id/matching/find` with a UUID
`Idempotency-Key`. The server validates the caller, records the attempt, runs
the existing matching transaction when needed and returns only that seeker's
current state. The no-match browsing action uses the existing
`PUT /api/me/seeker-requests/:id/joining-mode` with `direct`, then reloads the
ordinary browsing controls. An application still requires its separate explicit
request/confirmation action and host approval.

The new search action validates authentication, saved preferences, current
concert eligibility, own open algorithm-mode request and conflicting memberships
or claims. UUID receipts are scoped to authenticated user and concert, including
empty/no-op outcomes. Replaying a key returns fresh personal state without a new
round or reenrollment. Responses omit other users' assignments, traces and global
round metrics. A ten-attempt-per-minute IP/user policy bounds repeated searches,
including alternate URL casing and trailing slashes accepted by Express.
Search receipts live in a new `matching_search_requests` table, created through
normal database initialization. An atomic transaction covers the receipt, round,
proposals and reservations; failures roll everything back. No real/demo database
was migrated manually for this task.

## Meetup flow

The three stages remain **Find a time → Choose a place → Agree on the plan**.
Participants may inspect later stages before contributing. Guidance distinguishes
no saved times, unsaved changes, optional journey drafts, suggested places,
recommendation review, outstanding approval and confirmed/cancelled plans.

Regular members share times, suggest/vote for places and discuss the decision.
Only authorized organizers see final recommendations and proposal controls. The
leading option is prominent; Compare other options reveals the existing ranked
Place/Time picker. Changing a preview does not save, vote, propose or approve.
The review dialog retains the exact time/place, attendance warning and explicit
confirmation/proposal action. Stale versions cannot silently submit.

One hosted group's host confirms directly on explicit review. Connected groups
require both current hosts; a Kaki pair requires both participants. Multiple
approvers each approve explicitly, including the proposer. Ordinary members are
not extra required approvers; full attendance is not a universal requirement.
Reopening preserves contributions, clears selection and invalidates approvals.

Aggregate counts describe saved available times. The current schema does not
distinguish a person who submitted no times from one who has not responded, so
the UI does not invent a submitted/responded count. Private origins stay private.

Existing ranking, optional journey search, manual coordinates, weather/parking/
transport services and safeguards remain. The teammate's removed Compare travel
options control is not reintroduced: the current picker uses baseline distance
recommendations; saved car/transit labels do not imply route-time ranking.

## Group connections and host readiness

Discover → Invite → Receiving-host response → Shared chat → Optional meetup.
A connection shares a room across current members; it does not merge memberships
or automatically assign a seeker. Only authorized hosts issue/respond to invites.
Acceptance keeps the new chat action visible even if subsequent reads fail.

Declines retain actual history. Withdrawal deletes the pending invitation under
the existing backend contract; its immediate feedback is not fabricated as a
persisted history record. Existing pair uniqueness/reinvitation rules remain.

Publication readiness follows actual backend requirements: settings exist, the
number of active friend-invitation members equals `expected_friends`, and every
active member has saved preferences. Unsaved details remain separately identified.
Changing capacity still unpublishes until explicitly republished. Connections
are a separate published setting; setup guidance never bypasses validation.

## Regression verification

These results come from executed runs during this task. Focused subsets are not
added to the full-suite totals as extra unique tests.

| Check | Status / evidence |
|---|---|
| Managed matching HTTP | 13 new self-service tests pass within the full backend suite; scoped variant-rate regression also passed. |
| Frontend full suite | `npm run test:client`: 673 tests passed across 45 files, plus 7 comparison-logic tests, after all final client changes. |
| Backend full suite | `npm run test:server`: 728 passed, zero failed on the combined `9c16117` review branch. |
| Browser interactions | `npm run test:e2e`: all 70 cases passed on `b5ee66c` plus the UX work. All 10 first-time group/meetup cases then passed again after final label/link polish. |
| Production build | `npm --prefix client run build`: passed after the final changes. |
| Credential boundary | Five configured private values checked against 401 publishable files and 112 built files: no matches. This is a scoped leak check, not a claim to detect every possible secret. |
| Git/workspace checks | No conflict markers/unmerged files or staged changes; `git diff --check` passes. Credentials, demo data and generated results are excluded. Task changes remain uncommitted on the review branch. |

The server and server tests are identical between `9c16117` (the executed full
backend run) and final teammate baseline `b5ee66c`; the last two upstream commits
only change client visuals/tests. The archived full browser HTML report records
70 expected results, zero unexpected results, zero flaky cases and zero skips.

Recent teammate changes require an avatar before Kaki participation. Old backend
fixtures now provide valid synthetic PNGs in temporary directories through the
ordinary APIs, preserving negative-avatar tests and the teammate's requirement.
Ticket rejection tests now prove the existing Ticketmaster concert rows remain
unchanged rather than assuming the catalogue starts empty. No production rule
was relaxed to make tests pass.

Tests use disposable in-memory databases, generated test sessions and controlled
provider responses. They do not seed or modify the user's original/demo database,
send real email/push or use production provider credentials. Browser test servers
use separate loopback ports; the normal development app is not restarted.

## Remaining limits and file inventory

- Self-service matching is explicit and concert-pool based; no background search
  scheduler, guaranteed offer or guaranteed matching time is introduced.
- Live OneMap/LTA/NEA availability and real OS Web Push still require separate
  manual integration/device verification.
- Current local/API/SSE behavior does not prove hosted multi-process delivery.
- A withdrawn invitation has no persistent backend history record.

### Production files changed by this task

| Area | Files |
|---|---|
| Matching client | `client/src/api.js`, `client/src/views/GroupExplorerView.vue`, `client/src/components/MatchProposalCard.vue`, plus two matching-instruction text changes in `client/src/views/ConcertView.vue` |
| Matching server | `server/src/services/matchingService.js`, `server/src/controllers/matchController.js`, `server/src/routes/index.js`, `server/src/services/apiRateLimiter.js` |
| Search receipts | `server/src/db/matchingSearchMigrations.js`, `server/src/db/connection.js` |
| Meetup guidance/disclosure | `client/src/views/MeetupView.vue`, `client/src/composables/useMeetupBoard.js` |
| Groups/navigation | `client/src/components/GroupNavigation.vue`, `client/src/views/GroupConnectionsView.vue`, `client/src/views/GroupMembershipView.vue`, `client/src/views/ConnectionChannelView.vue` |

### Test files added or updated

- Client: `test/client/group-navigation.test.js`,
  `group-explorer-consistency.test.js`, `group-matching.test.js`,
  `group-connections-workspace.test.js`, `group-membership-workspace.test.js`,
  `meetup-planner.test.js`, `concert-consistency.test.js`, and
  `test/client/chat/connection-chat.test.js`.
- Browser: `test/e2e/first-time-group-meetup-ux.spec.js`,
  `community-workflows.spec.js`, `meetup-decision-interactions.spec.js`,
  `meetup-interactions-and-drafts.spec.js`, `meetup-navigation.spec.js`.
- Server: `test/server/selfServeMatching.test.js`, `managedMatching.test.js`,
  `kaki.test.js`, `kakiChat.test.js`, `kakiPreferenceGate.test.js`,
  `kakiRealtime.test.js`, `tickets.test.js`.

Existing test definitions were adapted to the teammate's Messages label and
persistent Create group navigation, the deliberate comparison disclosure, and
the immediate shared-chat action. Assertions still check exact destinations,
ranked options, persisted choices, actual writes, privacy and required approvals.
The newly pulled recommendation-detail fixture now includes origin coverage and
asserts the current distance explanation; missing origins still mean unknown
journeys. Concert tests follow the teammate's retained history/Find my group
links, with historical cutoffs and exact participation writes still checked.
No timeout was increased to hide a failed chat test; the isolated full client
rerun passed after the initially concurrent run timed out.

Generated logs, screenshots, reports and temporary provider fixtures remain under
ignored `test/results/`; no `.agent-local` folder is used.

### Local evidence

- [Full backend log](test/results/first-time-server-integrated.log)
- [Final client log](test/results/first-time-client-complete.log)
- [Full 70-case browser log](test/results/first-time-browser-verified.log)
- [Full browser HTML report](test/results/first-time-ux/full-browser-report/index.html)
- [Final 10-case browser recheck](test/results/first-time-browser-copy-check.log)
- [Final production-build log](test/results/first-time-build-complete.log)
- [No suitable group: desktop](test/results/first-time-ux/screenshots/first-time-no-suitable-group.png)
- [No suitable group: mobile light](test/results/first-time-ux/screenshots/first-time-no-suitable-group-light-390.png)
- [No suitable group: mobile dark](test/results/first-time-ux/screenshots/first-time-no-suitable-group-dark-390.png)
- [Meetup guidance and leading option](test/results/first-time-ux/screenshots/first-time-meetup-leading-recommendation.png)
- [Publication readiness](test/results/first-time-ux/screenshots/first-time-host-publication-ready.png)
- [Connected shared chat](test/results/first-time-ux/screenshots/first-time-connected-shared-chat.png)

These are local ignored artifacts, not files added to Git. The full browser run
covered the existing matching, Kaki, chats, notifications, planner, profile and
ticket scenarios. Revised flows were exercised with separate authenticated
people, real HTTP/SSE, both themes, keyboard controls, mobile touch, six viewport
widths and enlarged text. Provider responses were controlled; those tests do not
claim live external-service or actual operating-system popup verification.
