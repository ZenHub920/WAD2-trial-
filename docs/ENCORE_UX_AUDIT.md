# Encore implementation audit and UI refinement

This report records the completed audit on `feature/encore-ux-audit-visual-polish`, starting from `52073e0`, with the earlier uncommitted planner changes preserved. No commits, pushes or merges were made during the audit. The user subsequently authorized committing and publishing all changes to `main`; the Git inventory below records the pre-publication review snapshot. This report supersedes the earlier planner report's navigation labels and verification status.

## What the audit found

The earlier planner validation, permissions, privacy and three-stage workflow were substantially implemented. The main gaps were navigation: static chat entry buttons, limited overview metadata, accidental duplicate boards, and notification links without a planner stage. Inspection also found an asynchronous weather authorization gap and a push-delivery parser that did not safely support stage fragments.

The visual baseline had faint input boundaries, low contrast in several dark-theme text/button combinations, generic translucent panels, large ambient effects, and a single large initial JavaScript bundle. The design direction kept Encore's purple identity while assigning clearer roles to page backgrounds, working surfaces and floating overlays. Important actions stay visible; advanced journey details remain disclosed on demand.

## Earlier planner requirements: source audit

“Verified complete” means source inspection and relevant automated checks support the behavior. It does not certify live provider availability. Paths below are relative to the repository root.

| Requirement | Final assessment | Source and evidence |
|---|---|---|
| Concert-related date restrictions | Verified complete | `shared/meetupDates.mjs`: `meetupDatePolicy`, `validateMeetupWindow`; `server/src/services/meetupValidation.js`: `requireMeetupWindow`; repository create/propose/approve all validate. Verified performance times constrain the window; unverified doors times do not become performance times. |
| Singapore timezone | Verified complete | Shared `parseMeetupTimestamp`, `inTimezone`, `parseSingaporeInput`, `singaporeInputValue`; `client/src/utils/meetupTime.js` formats consistently. Browser actors run in UTC to exercise explicit conversion. |
| Maximum seven-day windows | Verified complete | Shared `validateMeetupWindow` enforces duration, with tighter concert-specific bounds. Existing records remain readable. |
| Half-hour increments | Verified complete | Shared date validation and backend `normalizeMeetupAvailability`; creation form uses the same date policy. |
| Unified journey settings | Verified complete | `client/src/composables/useMeetupBoard.js`: `assignJourney`, `saveAvailability`; `MeetupView.vue` has one apply action for travel mode and optional location. Blank new origins preserve existing origins; manual/per-slot controls remain under disclosure. |
| Draft versus saved availability | Verified complete | Composable `selectionSnapshot`, `availabilityDirty`, `load`, `saveAvailability`, `discardAvailability`. Live refresh updates saved counts without overwriting dirty selections. Apply changes the draft; Save persists it. Unsaved drafts do not survive a full reload. |
| OneMap selection feedback | Verified complete; live service unable to verify | `MeetupLocationSearch.vue`: `search`, `select`, `focusResult`, `reset`; generation guards, loading/results/empty/unavailable states and explicit “not saved” feedback. Manual input remains available. |
| Persisted suggested places | Verified complete | `MeetupView.vue` renders `board.places` independently of saved availability. Composable `addPlace` clears inputs only after successful persistence/refresh. |
| Suggestions versus recommendations | Verified complete | Persisted places are separate from `recommendedOptions`/`recommendationEmpty`; recommendations use saved availability. Backend `planningData`/`detail` return stored suggestions independently. |
| Recommendation ranking | Verified complete, unchanged | `server/src/services/meetupPlanning.js`: shared `compareMeetupOptions`; `meetupIntegrations.js` requires sufficiently complete route matrices before journey-aware ranking. Attendance, fairness, deterministic ties and fallback safeguards remain. |
| Transport and unavailable states | Verified complete; live conditions unable to verify | `MeetupTransportPanel.vue`: `check`, `switchPhase`, `refreshIfVisible`; backend `meetupTransport.js`/`singaporeTravel.js`. Pre-meetup/post-concert scopes, venue confirmation, freshness and unavailable explanations remain. |
| Discussion/change requests | Verified complete | `MeetupDiscussionPanel.vue`: `submit`; composable `postComment`; repository `comment`. Authors/timestamps are retained. Discussion does not approve, revise or reopen a plan. |
| Organizer permissions | Verified complete | `server/src/services/meetupPolicy.js`: `requiredMeetupApprovers`, `meetupCapabilities`, `meetupActionError`; repository resolves current members/hosts. UI uses trusted capabilities. |
| Explicit reopening | Verified complete | Repository `reopen`; composable `requestOrganizerAction`/`organizerAction`; confirmation dialog. Authorized versioned transaction clears the selection, preserves contributions/history, and requires fresh approvals for a new proposal. |
| Approval lifecycle | Corrected | Existing locks/no-op/version safeguards verified. Repository `summary`/`detail` use `currentApprovals` to expose `hasApproved` and suppress `canApprove` after that caller approves. Both hosts/both Kaki participants retain their required roles; ordinary group members are contributors. |
| Starting-location privacy | Verified complete | Repository `detail` returns only the caller's availability/origins; internal `planningInput` serves ranking. New summaries omit all private origins/raw availability/routes. Multi-account tests check a private marker cannot appear in another member's detail or overview. |
| Smaller page responsibilities | Verified complete | `MeetupView.vue` presents the workflow; data/actions move to `useMeetupBoard`. Creation, discussion, heatmap, search, transport and now entry/overview are reusable components. This is separation of responsibilities, not a claim of fewer total lines. |
| Reusable frontend components | Verified complete | `MeetupCreationForm.vue`, `MeetupDiscussionPanel.vue`, `MeetupAvailabilityGrid.vue`, `MeetupLocationSearch.vue`, `MeetupTransportPanel.vue`, new `MeetupEntryCard.vue` and `MeetupOverview.vue`. |
| Board state management | Verified complete | `useMeetupBoard.js`: scoped loading, saved/draft state, mutations, feedback, live refresh, stage navigation, conflict handling and guarded provider reads. |
| Centralized validation | Verified complete | Backend `meetupValidation.js`: `requireMeetupWindow`, `normalizeMeetupTitle`, `normalizeMeetupPlace`, `normalizeMeetupAvailability`; shared date policy also used in `MeetupCreationForm.vue`. |
| Centralized authorization | Verified complete | `meetupPolicy.js` plus repository `participants`, `access`, `approvers`. Trusted membership is resolved server-side rather than accepting organizer flags. |
| Shared time utilities | Verified complete | `shared/meetupDates.mjs` and frontend `meetupTime.js`; timestamp storage remains compatible. |
| Shared navigation utilities | Corrected | `client/src/utils/meetupNavigation.js`: scope normalization, canonical conversation routes, board/stage links, allowlisted return origin. `meetupSummaries.js` supplies consistent next actions. |
| Shared recommendation comparator | Verified complete, unchanged | `compareMeetupOptions` is used by existing rankers without altering ranking semantics. |
| Safe asynchronous operations | Corrected | Composable `load`, `act`, `readPlan` guard scope/account/version; search/transport guard late responses. New summary cache coalesces requests and retries a read invalidated while pending. Legacy weather route now rechecks membership/version after awaiting its provider. |
| Transaction boundaries | Verified complete | Repository mutations retain immediate SQLite transactions. New creation request mappings are written in the same transaction as board creation/reuse and notifications. |

## Navigation completed

| Initial gap | Implemented result |
|---|---|
| Static meetup entry | One compact `MeetupEntryCard` beneath each group, connected-group and Kaki chat header. It shows participation or proposal/confirmation details and the correct action. Ordinary group members cannot create. Cancelled plans are explicitly read-only. |
| Inconsistent lookup/action labels | Session-scoped `useMeetupSummaries` and pure `meetupSummaries` helpers serve chat/dashboard links. One shared live/focus subscription uses reference counting; no extra polling timer or API call per group card. |
| Limited `/meetups` overview | `MeetupOverview` groups **Needs your attention**, **Upcoming & in progress**, and **Past & cancelled**. It shows concert, conversation, status, selected Singapore-local time/public place, and next action. Messages and My Groups provide secondary entry links. |
| Accidental duplicate boards | Default creation atomically resumes an active board for the scope. A stable request identity handles retries; reused attempts are recorded too. A different payload with the same identity returns a conflict. Explicit **Create a separate plan** preserves legitimate multiple boards. |
| Unclear return context | Group → its room; connection → shared room; Kaki → original conversation; overview-origin → My Meetups. Only `from=conversation|overview` is accepted. Bookmarks and notification links derive safe routes from authorized board metadata. |
| Stage-less notifications | Availability, place and review events link to the corresponding allowlisted fragment. Confirmation/reminders open Review. Push delivery reauthorizes the board and rejects malformed meetup destinations. Responses marked unchanged/reused do not emit redundant updates. |

### Current user workflow

1. Open a conversation. The small meetup card offers **Create meetup plan**, **Share availability**, **Review and approve**, or **View meetup details**, according to the actual state and your role.
2. An organizer creates a concert-related window. An existing plan opens directly; **Plans & options** exposes other plans and deliberate additional creation.
3. **Find a time:** drag to paint or erase half-hour cells, or use keyboard selection. Apply your private transit/car journey to selected times, then save. Saved group counts update live; unsaved selections remain distinct.
4. **Choose a place:** add/search a public suggestion, view saved suggestions even before availability exists, and compare recommendations when saved availability supports them. Votes express preferences.
5. **Agree on the plan:** the organizer proposes an option. The group host, both connected-group hosts, or both Kaki partners approve as appropriate. A saved approval no longer presents another approval action.
6. Confirmed arrangements stay locked. Discussion can request changes; an organizer must explicitly reopen before contributions/proposals change. Weather, parking and scoped transport checks remain available with honest unavailable states.
7. My Meetups collects outstanding participation/approvals, upcoming confirmed plans and history. Return links retain the correct conversation or overview context.

### API and migration details

This audit adds no new endpoint paths or dependencies. Existing list/context/detail responses gain lean scope/concert/status/participation/approval/capability metadata. Creation accepts optional `creationRequestId` and `createAnother`; existing response envelopes remain compatible. The earlier carried-over planner work introduced authorized `GET /meetup-context` and `POST /meetups/:id/reopen`.

An **additive** `meetup_creation_requests` table is created by the existing `migrateMeetups` startup path. It stores a hashed account/scope/request key, board reference and normalized payload fingerprint. This protects lost-response retries even if the board is subsequently cancelled. Existing boards, availability, selections and historical approvals are untouched; there is no destructive single-active-board constraint. No manual migration command is needed beyond normal server startup. Back up a real database using the project's normal process before deployment.

## UI/UX changes

- **Shared surfaces:** semantic base/interactive/floating tokens; opaque working panels; stronger elevation and edges for menus/dialogs. Heavy blur is reserved for appropriate overlays instead of every card.
- **Light/dark readability:** adjusted secondary text/status colors, visible field boundaries, white labels on readable purple action fills, clear disabled states and keyboard focus rings. Tested solid token pairs include 66 text/control comparisons. This is not an assertion that every image or translucent background meets WCAG.
- **Header/notifications:** stable mobile Menu control, visible active destinations, mutually exclusive menu/bell panels, Escape dismissal and focus restoration. Mobile opening focuses the first link. Reduced-motion rules disable descendant transitions to prevent inherited visibility from rejecting focus; leaving overlays become inert. Initial lazy route resolution no longer dismisses an already-open inbox/menu. Explicit destination clicks and subsequent path/query/hash changes still dismiss it; authentication startup is unchanged.
- **Planner:** compact existing-board heading brings working content higher on mobile; the overview retains its page identity. Three named stages, contextual availability summary, progressive journey/transport details and status-aware chat entry preserve the existing workflow.
- **Concerts:** clearer search/date hierarchy, larger filter targets, stronger input boundaries and a guarded discovery retry when live discovery fails. Local available concert data remains usable.
- **Kaki:** readable card content, a more compact portrait, visible Skip/Undo/Like labels and restrained press/exit feedback. The persistence request starts immediately; a card advances only after success and departure. Repeated clicks and non-primary pointers cannot duplicate decisions. A failed request keeps the card and offers safe feedback.
- **Groups/dashboard:** existing request queues, incoming invitations, accepted shared chats and secondary management details keep their hierarchy. A cached meetup attention/upcoming count now links directly to My Meetups. No new per-group request fan-out.
- **Chats:** message action fills use semantic readable colors, while compact meetup cards leave messaging central. Existing composer/send error and authorization behavior is retained.
- **Tickets/calendar:** filter intent, total-price explanation, useful loading/empty states, readable listing actions and saved-selection feedback. Browser-storage failure explicitly reports a visit-only selection rather than claiming persistence. Calendar and floating surfaces have clearer separation; the calendar is constrained to its available container on small screens.
- **Motion:** restrained press depression, short panel transitions and guarded swipe departure; CSS/Vue only. Reduced-motion settings remove nonessential movement. The homepage opening transitions and matching algorithms were preserved. No physical haptics or automatic sounds were added.

## Bundle and performance

All routes except the homepage now use Vue Router's standard lazy imports. Baseline initial JavaScript was **587.09 kB (183.64 kB gzip)**; the final entry is **164.72 kB (59.81 kB gzip)**. The largest lazy route is the planner at **76.41 kB**. The production build's large-chunk warning is resolved. These are build artifact sizes, not measured network, frame-rate or total-application-size improvements.

Three non-home ambient animated blur orbs were replaced by a static restrained backdrop. Homepage visuals remain in their existing implementation. No animation library, provider dependency or extra polling loop was added.

## Verification

| Check | Baseline before audit edits | Complete final run |
|---|---|---|
| Server | 614 passed | **626 passed**, 30 suites, 0 failed/skipped/cancelled; 261.20 s |
| Client | 240 passed, 21 files | **288 passed**, 26 files, 0 failed/skipped; 40.23 s |
| Chromium | 21 passed | **26 passed** in one complete final run, 0 failed/skipped, retries disabled; 2.3 min |
| Production build | Passed with large-chunk warning | **Passed**, 2.18 s; warning resolved |

Final commands, from the indicated directory:

```powershell
# server
npm.cmd test -- --test-concurrency=1

# client
npm.cmd test -- --run --maxWorkers=1
npm.cmd run build
$env:ENCORE_UX_CAPTURE_PHASE='after'
$env:ENCORE_UX_CAPTURE_DIR='C:\Users\aungb\.codex\visualizations\2026\10\16\01a1447a-55bd-7021-bcc5-4d2f8338b7d6\encore-ux-audit'
npm.cmd run test:e2e

# repository root
git diff --check
```

Baseline commands used the same server/build commands, `npm.cmd test -- --run` in client, and `npm.cmd run test:e2e -- community-features.spec.js profile.spec.js ticket-marketplace.spec.js`. Before captures used `ENCORE_UX_CAPTURE_PHASE=before` with `npm.cmd run test:e2e -- ux-visual.spec.js` before responsive cases were added. Focused checks included the new `meetup-navigation.spec.js` browser scenarios, the two responsive visual cases, 97 planner/chat/navigation Vue checks, and swipe/storage/marketplace checks. They supplement the complete final runs.

Local ignored logs are `server/test-results/ux-audit-baseline-{server,client,browser,build}.log` and `ux-audit-final-{server,client,browser,build}.log`. Playwright's HTML report and traces remain under the existing ignored client report directories.

The final Chromium command ran every spec against the frozen final source, including both responsive cases and every planner-stage capture. It was a clean complete run, not a combination of a failed full run and focused reruns. No application changes followed these final results.

### Scope of the checks

- Backend tests exercise real repository SQL/transactions in disposable databases, HTTP authorization, date bypasses, lifecycle locks, approvals/reopening, retry conflicts, privacy redaction, notification authorization and provider failure/fallback behavior.
- Vue tests mount real components with controlled API responses. They test drafts, saving/failure, permission-driven actions, summary-cache races/account changes, route fragments/returns, overlays, contrast tokens, swipe persistence and storage failure.
- Chromium runs the real local Vue app and Express API against disposable SQLite data. Separate authenticated contexts exercise group membership, both connected-group hosts and both Kaki participants. Existing matching, chat, profile and ticket workflows remain in the complete run.
- Visual tests use both themes at **320, 360, 390, 768, 1024 and 1440 px**. Header/planner/heatmap checks cover all six; discovery, tickets, groups, messages, Kaki, dashboard and overview rotate across representative mobile/tablet/desktop sizes. Checks include overflow, popup containment, real pointer paint/erase, keyboard selection/stage navigation, focus restoration, theme switching and reduced motion.
- External HTTPS imagery/fonts are blocked for deterministic browser tests. OneMap/LTA/weather responses come from controlled fixtures or failure mocks, not fabricated “live” observations. No real paid provider request is required. Current real credentials/provider conditions and an actual OS push subscription/popup remain **unable to verify** in this audit.

### Issues encountered during verification

The first client run after navigation changes had four obsolete assertions expecting the old static planner button; these were updated to exercise the real status card and RouterLink destinations, including denied and signed-out cases. The new browser setup initially assumed group membership automatically meant room membership; it now uses the existing host-open/add-member flow, preserving chat authorization.

Responsive checks identified a genuine reduced-motion inherited-visibility/focus issue, and a clipped 320 px calendar. A first complete expanded browser run passed 23 scenarios and failed three: the calendar's newly asserted internal columns still overflowed in both themes, and a real notification click was interrupted by initial lazy route completion. Definite calendar button widths corrected the internal overflow. Trace evidence established the routing race; the overlay watchers now distinguish initial resolution from subsequent navigation, with six additional deferred-route regressions. Existing notification assertions remain intact.

The next complete run passed those cases and 25 of 26 overall. Its older onboarding URL assertion rejected the valid existing auto-selected concert query (`/groups?concertId=…`). It now checks the exact `/groups` pathname while permitting that query. Questionnaire fields, payload, save persistence and public-profile privacy assertions remain unchanged. The complete suite is rerun after this correction; a focused rerun is not substituted for final verification.

A later complete run exposed a setup race in the new multi-user scenario: it waited for the host's availability update, but not the subsequent place update, before saving as the member. The application correctly rejected the stale version and retained the draft. The scenario now waits until the saved place is visible in the member's Places stage before painting/saving. Conflict protection is unchanged; the success assertion remains required.

One intermediate full client run timed out in an existing 5-second rendering test while Chromium checks ran concurrently; subsequent complete client verification uses one worker without overlapping browser work. Tests were corrected where expectations did not reflect valid behavior; assertions were not removed to hide application defects, and timeouts were not relaxed. Final suite results, rather than these intermediate failures, determine completion.

## Screenshot evidence

Durable screenshots are outside the repository, under:

`C:/Users/aungb/.codex/visualizations/2026/10/16/01a1447a-55bd-7021-bcc5-4d2f8338b7d6/encore-ux-audit`

The maintained `client/e2e/ux-visual.spec.js` can reproduce them using `ENCORE_UX_CAPTURE_DIR` and `ENCORE_UX_CAPTURE_PHASE=after`. There are **66 saved images: 16 before and 50 after**.

| Comparison | Files |
|---|---|
| Mobile planner, light | `before-planner-light-390.png` → `after-planner-light-390.png` |
| Desktop planner, dark | `before-planner-dark-1440.png` → `after-planner-dark-1440.png` |
| Discovery, both themes/sizes | `before-concerts-{light,dark}-{390,1440}.png` → corresponding `after-…` |
| Tickets, both themes/sizes | `before-tickets-{light,dark}-{390,1440}.png` → corresponding `after-…` |
| Group chat, both themes/sizes | `before-group-chat-{light,dark}-{390,1440}.png` → corresponding `after-…` |

Additional final captures cover responsive planner states, My Meetups, Kaki, My Groups, calendar and notifications. Places and Review are separately captured at 390 and 1440 px in both themes (`after-planner-places-…`, `after-planner-review-…`). Screens contain synthetic test accounts, not real private locations or credentials. Screenshots support visual inspection; they are not a pixel-diff baseline or proof of complete accessibility compliance.

## Remaining technical debt and limits

- A full manual assistive-technology audit and every contextual text/background combination are outside these targeted accessibility checks. Tested contrast/focus improvements should not be described as full WCAG certification.
- Live OneMap/LTA quota/data access and browser/OS Web Push delivery require deployment/device checks. Existing unavailable states, provider budgets, credential handling and server-side safeguards remain.
- Unsaved availability is intentionally an in-memory draft; Save is required before full navigation/reload. Offline persistence would need a separate privacy/reconciliation design.
- The planner's Places/Review presentation could be split further if future complexity warrants it. This audit does not rewrite working ranking, provider logic or large unrelated repositories.
- My Groups prioritizes group requests/invitations and meetup attention. Messages continues to own unread conversations/ticket inquiries; an all-domain dashboard is not introduced merely for visual uniformity.

## Git review snapshot and changed-file inventory

At audit completion, the branch retained the earlier planner/refactor work alongside this audit. No reset, clean, force push, commit or main merge had been performed. `.agent-local` was not recreated. README documentation, credentials, package manifests and lockfiles were preserved.

The reviewed working tree contained 77 changed/new paths, including the carried-over planner implementation. This inventory includes source, tests and both audit reports; generated test logs, build output and screenshots are ignored or stored outside the repository.

<details>
<summary>Changed and new files</summary>

```text
 M client/e2e/community-features.spec.js
 M client/src/App.vue
 M client/src/api.js
 M client/src/assets/base.css
 M client/src/assets/groups.css
 M client/src/assets/tokens.css
 M client/src/components/ConfirmDialog.vue
 M client/src/components/MeetupAvailabilityGrid.vue
 M client/src/components/MeetupLocationSearch.vue
 M client/src/components/MeetupTransportPanel.vue
 M client/src/components/NotificationBell.vue
 M client/src/components/SiteHeader.vue
 M client/src/components/SwipeDeck.vue
 M client/src/components/kaki/KakiCard.vue
 M client/src/components/market/ConcertSpotlightCard.vue
 M client/src/components/market/DateField.vue
 M client/src/components/market/TicketListingCard.vue
 M client/src/main.js
 M client/src/market.js
 M client/src/views/ConcertsView.vue
 M client/src/views/ConnectionChannelView.vue
 M client/src/views/GroupChannelView.vue
 M client/src/views/GroupConnectionsView.vue
 M client/src/views/GroupExplorerView.vue
 M client/src/views/GroupMembershipView.vue
 M client/src/views/KakiChatListView.vue
 M client/src/views/KakiChatView.vue
 M client/src/views/KakiFinderView.vue
 M client/src/views/MeetupView.vue
 M client/src/views/TicketMarketplaceView.vue
 M client/tests/chat-planner-entry.test.js
 M client/tests/connection-chat.test.js
 M client/tests/group-membership-workspace.test.js
 M client/tests/meetup-planner.test.js
 M client/tests/nearby-transport.test.js
 M server/src/db/concertRepository.js
 M server/src/db/meetupRepository.js
 M server/src/routes/community.js
 M server/src/services/delivery.js
 M server/src/services/meetupIntegrations.js
 M server/src/services/meetupPlanning.js
 M server/test/community.test.js
 M server/test/communityApi.test.js
 M server/test/connectionChannel.test.js
 M server/test/delivery.test.js
 M server/test/meetupCarPlanning.test.js
 M server/test/meetupRealtime.test.js
 M server/test/meetupTransport.test.js
?? client/e2e/meetup-navigation.spec.js
?? client/e2e/ux-visual.spec.js
?? client/src/components/MeetupCreationForm.vue
?? client/src/components/MeetupDiscussionPanel.vue
?? client/src/components/MeetupEntryCard.vue
?? client/src/components/MeetupOverview.vue
?? client/src/composables/useMeetupBoard.js
?? client/src/composables/useMeetupSummaries.js
?? client/src/utils/meetupFeedback.js
?? client/src/utils/meetupNavigation.js
?? client/src/utils/meetupSummaries.js
?? client/src/utils/meetupTime.js
?? client/tests/header-overlays.test.js
?? client/tests/market-saved-feedback.test.js
?? client/tests/meetup-entry.test.js
?? client/tests/meetup-form-panels.test.js
?? client/tests/meetup-location-search.test.js
?? client/tests/meetup-navigation.test.js
?? client/tests/meetup-time.test.js
?? client/tests/swipe-feedback.test.js
?? client/tests/theme-contrast.test.js
?? docs/ENCORE_UX_AUDIT.md
?? docs/MEETUP_PLANNER_GUARDRAILS.md
?? server/src/services/meetupPolicy.js
?? server/src/services/meetupValidation.js
?? server/test/meetupDomain.test.js
?? server/test/meetupGuardrails.test.js
?? server/test/meetupNavigation.test.js
?? shared/
```

</details>
