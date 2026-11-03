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

## Final Functional and UI/UX Hardening Audit

Verified on **2026-11-03**. This pass starts from GitHub `main` at `277f0b0`, including the five newer teammate commits after the previous audit. Work is isolated on `fix/encore-final-ux-hardening`. The earlier audit above is historical; its test counts and Git snapshot are not the current results.

### Confirmed defects and improvements

| Issue and status | Reproduction and root cause | Correction and source files | Verification |
| --- | --- | --- | --- |
| **Confirmed defect fixed: leaving unsaved planner drafts** | Paint a time, type a place/discussion, or change unapplied journey inputs, then follow All plans, a return link, another board or browser Back. Only stage state preservation existed; there was no route/unload guard. | `useMeetupBoard.js` now guards changes of board/scope and external planner routes. `MeetupView.vue` reuses `ConfirmDialog.vue`, initially focusing **Keep editing**. Reload/close use native `beforeunload`. Guards/listeners are removed on unmount, and account changes clear private state. | Component tests cover all four draft types, same-board steps, ignored search/filter changes, cancellation/discard and cleanup. Browser checks exercise internal navigation, Back, another board and actual reload cancellation. |
| **Confirmed defect fixed: edited creation retry conflicts** | Submit a valid request rejected with a definite 4xx, edit the submitted intention and retry. A lifetime component token was reused for different payloads. | `MeetupCreationForm.vue` fingerprints normalized title, UTC dates and explicit separate-plan intent. Identical retries retain the identifier; edits after a definite rejection receive a new one. A local pending latch prevents double submission before props update. | Focused component cases cover normalized identity, changed title/dates, pending edits and duplicate clicks. Browser regression posts to the real disposable API. |
| **Confirmed defect fixed: uncertain/created retries** | Lose the response after the API commits, edit inputs and retry; or let a navigation guard cancel opening a successfully created plan. Blindly rotating the token could duplicate a plan. | The form retains the original payload/identifier for **Check previous attempt**. A confirmed attempt offers **Open created plan**. `useMeetupBoard.js` distinguishes API confirmation from navigation, caches a confirmed result in memory and rejects late redirects after scope/session changes. No browser storage or schema changes. | Tests cover network/5xx/malformed responses, a later rejected replay, known-created navigation failure, original-payload replay and changed context. Browser regression deliberately drops a real committed response and checks only one plan exists. |
| **Confirmed defect fixed: misleading save feedback** | Save successfully, edit again or fail validation; stale success remained visible. A successful mutation followed by a failed read was also reported as a failed save. | `useMeetupBoard.js` clears obsolete notices when meaningful inputs change, distinguishes mutation success from refresh failure and preserves failed drafts. `MeetupView.vue` places a save-state message by Save, keeps Continue secondary and explains that Continue does not save. Places explains that recommendations use saved answers. Reapplying unchanged journey data reports that it already matches saved availability. | Component and browser cases verify persistence, failed saves, disabled pending controls, retained drafts, no stale success and an unavailable follow-up read. |
| **Confirmed defect fixed: stale selected addresses** | Select A, edit the query to B, or rename a selected lookup result. The selected label/coordinates could survive under a different apparent intention. | `MeetupLocationSearch.vue` invalidates synchronously on query changes, rejects late/detached results and resets silently for intentional manual entry. Parent handlers in `useMeetupBoard.js` and `MeetupView.vue` clear only lookup-derived draft fields; renaming a lookup requires fresh coordinates. In-session applied lookup provenance also covers individual-period overrides. Saved/applied availability is not cleared merely by editing a search. | Search tests cover out-of-order results, old selection, errors, reset, disabled/unmounted state and stale clicks. Parent tests cover manual overrides, applied periods and per-period name edits. Browser checks inspect both the real submitted coordinates and persisted API data. |
| **Confirmed defect fixed: transport venue mismatch** | Select venue A, switch transport phases and return, then type B. Destroying the selector lost its provenance while the parent retained A. | `MeetupTransportPanel.vue` preserves the selector across phase switches. Query changes clear the override, previous results and automatic refresh; Check waits for a new selection or explicit **Use the concert's venue again**. It cannot silently fall back to the original venue after invalidating A. | Real search child integration tests cover phase switching, query invalidation, paused automatic checks and explicit fallback. |
| **Improvement completed: mobile availability gestures** | Compact desktop cells and immediate touch painting made native swiping awkward. | `MeetupAvailabilityGrid.vue` retains compact fine-pointer desktop cells, uses at least 44px/rem-scaled mobile/coarse targets, and supports tap or a 300ms hold before drag painting/erasing. Movement before the hold stays native scrolling; a second finger releases painting for pinch zoom. Local touch listeners prevent scrolling only after painting is claimed. Timer/listener cleanup, mouse interpolation, keyboard selection, saved counts and half-hour data remain intact. Actual horizontal overflow reveals a sideways-scroll hint. | Unit cases cover touch tap/pan/hold/erase, multitouch and cleanup. Chromium CDP sends real touch streams at 320/360/390 in both themes, including 200% root text. This is browser emulation, not physical-device Safari verification. |
| **Confirmed visual defects fixed: enlarged-text clipping and sticky labels** | At 200% text on a 320px screen, screenshot inspection showed Menu outside the visible header and a focused cell drawn over the sticky Time column. Document scroll-width alone missed the clipped header. | `SiteHeader.vue` permits the narrow header to wrap controls. The grid uses separate stacking levels for sticky row/day/corner headings. No global header/bell z-index change. | Browser checks measure actual header-control bounds, day-label text fit and the hit-tested sticky Time heading after native horizontal scrolling. |
| **Improvement completed: selected, saved and decision hierarchy** | Selected lookup results used error-like rose styling, important meetup statuses/actions were small, and confirmed plans still used a generic proposal heading. | Search selections use the existing brand accent, an explicit Selected label and visible keyboard focus. `MeetupEntryCard.vue`, `MeetupOverview.vue`, `NotificationBell.vue` and `MeetupView.vue` enlarge relevant status/timestamp text. Review distinguishes confirmed/cancelled plans and emphasizes the chosen time/place. | Rendered light/dark screenshots, keyboard checks, contrast checks and the responsive matrix. Existing palettes and transitions remain. |
| **Improvement completed: chat touch targets** | Several chat message actions, dismiss controls and theme choices were smaller than a comfortable touch target. | Small CSS changes in `ConnectionChannelView.vue`, `GroupChannelView.vue` and `KakiChatView.vue` provide 44px/rem targets without changing chat actions or persistence. | Existing chat, notification, profile and public-vibe tests remain in the complete suites; browser workflows check live messaging and planner entry. |
| **Confirmed defect fixed: concurrent listing removals** | Remove A, then remove B while A is pending. A single current-ID flag allowed concurrent work and an earlier completion could unlock the later operation. | `MyListingsView.vue` serializes removal and disables removal controls until it settles. Existing native confirmation, cancellation and failed-removal retry behavior remain. | Two additional marketplace integration cases verify rapid cross-card requests, cancellation, failure retention and retry. |
| **Investigated, no default overlay defect found** | Reopened notification/menu/modal overlays at normal viewport sizes; the original screenshot suspicion was not reproduced as a default header/bell stacking defect. | Existing popover containment, mutually exclusive header disclosures and teleported confirmation remain. Only the independently reproduced enlarged-text header wrap was changed. Native destructive confirmations were retained where replacing them would be cosmetic. | Header overlay/focus tests and real normal-viewport keyboard, Escape, containment and light/dark screenshots. |

### Design and behavior boundaries

- **Drafts:** kept in component memory, never local/session storage. Switching Time → Places → Review does not save or discard. Search queries and comparison filters alone do not trigger a leave warning. Navigation approval does not erase a draft before the router actually commits the navigation.
- **Locations:** a lookup result is a selection; Apply changes selected availability periods; Save persists those periods. Suggested meeting places persist through Add place. Deliberate manual coordinates remain available if search fails. Lookup provenance for per-period name protection is in-session only: the unchanged API does not store lookup/manual origin metadata. Previously saved origins are explicitly editable under manual per-period controls.
- **Async feedback:** no success before mutation confirmation, no input reset on failed persistence, and a failed read after persistence is labeled as a refresh problem. The server still enforces stale-version and membership/organizer permissions.
- **Preserved:** matching/ranking/queue rules, questionnaire fields, meetup scheduling model, approval roles, public API contracts, database schema, authentication, teammate setlist/hero/group-membership changes, current themes and reduced-motion handling.
- **No new feature libraries, integrations, dashboards or notification categories.** No README or other documentation was deleted. `.agent-local` was not recreated.

### Verification results

| Final check | Actual result |
| --- | --- |
| Complete backend suite | **641/641 passed**, 30 suites, zero failed/skipped/cancelled; 236.23 seconds. |
| Complete frontend suite | **369/369 passed**, 31 files; 100.66 seconds. |
| Production build | **Passed**, 6.07 seconds. Initial JS remains 166.55 kB; no new dependencies. |
| Entire Chromium/Playwright suite | **37/37 passed**, zero excluded scenarios, retries remain zero; 5.4 minutes. |
| New component/integration regressions | **41 additional cases** included in the 369 total; seven existing test files. |
| New browser regressions | **Four additional scenarios** included in the 37 total: real touch/scaling, navigation/save states, address consistency and creation retries. |
| Responsive matrix | Seven major page contexts at all six widths in both themes, plus the planner, stage, calendar and overlay checks; mobile native touch and 200% text at 320/360/390. |
| Screenshot evidence | **50 baseline + 69 final PNGs**, outside the repository. |
| Git diff hygiene | `git diff --check` passed; changes are substantive, with no wholesale line-ending rewrite. |

All suites above passed on the final production source. Baseline before this pass: **641 server tests**, **328 client tests**, **33 Playwright scenarios**, and the production build passed. New focused regressions and expanded responsive coverage are included in the final suites, rather than counted separately as extra passes.

Testing iterations are retained in ignored logs. The first complete browser attempt had **35 passed / two failed**: the new lost-response scenario still received SSE and correctly resumed the newly created active plan before its retry button was used; an existing notification selector matched both the unread total and notification metadata. The connection-loss fixture now loses both response and stream, while still asserting identical replay payloads and exactly one persisted board. The notification assertion now targets the same unread state in its metadata rather than a substring elsewhere in the popover. Both corrected files passed **5/5 targeted scenarios** before the complete rerun. An earlier touch-test attempt was interrupted because its harness awaited a page load after deliberately dismissing the native reload warning; that wait is bounded and the actual dialog, URL and retained-draft assertions remain. No scenarios were disabled, retries added or persistence assertions removed.

Commands (run from the indicated folder):

```powershell
# server
npm.cmd test -- --test-concurrency=1
# client
npm.cmd test -- --run --maxWorkers=1
npm.cmd run build
npm.cmd run test:e2e
```

Responsive browser coverage includes 320, 360, 390, 768, 1024 and 1440px in light/dark themes, keyboard/focus/reduced-motion/contrast checks and actual mobile touch streams. Screenshots and browser fixtures use disposable synthetic accounts; external address/transport failures are controlled fixtures. This pass does not claim live production-provider availability or physical-device/OS Web Push verification.

### Screenshot evidence

Artifacts are outside the repository at:

`C:\Users\aungb\.codex\visualizations\2026\10\16\01a1447a-55bd-7021-bcc5-4d2f8338b7d6\encore-final-hardening`

The folder contains `baseline-*` before changes and `final-*` after verification. Representative files:

- `final-hardening-touch-selected-light-320.png` / `final-hardening-touch-selected-dark-390.png`: selected mobile grid.
- `final-hardening-touch-text200-light-320.png` / `final-hardening-touch-text200-dark-390.png`: larger text and horizontal scrolling.
- `final-hardening-availability-saving-disabled-dark-390.png`: pending/disabled controls.
- `final-hardening-availability-failed-dark-390.png`: failed save with draft kept.
- `final-hardening-unsaved-confirmation-dark-390.png`: leave-warning modal.
- `final-hardening-availability-saved-dark-390.png`: confirmed saved state.
- `final-hardening-location-selected-light-390.png` / `final-hardening-location-failed-cleared-light-390.png`: selected result and cleared/error state.
- `final-hardening-creation-uncertain-390.png`: safe retry after a lost response.
- `final-planner-*`, `final-planner-places-*`, `final-planner-review-*`, `final-notifications-*`, `final-calendar-*` and the other responsive page captures cover default/empty/dropdown/mobile light/dark states.

### Security and project hygiene

- Only `server/.env.example` is tracked. Populated environment configuration, client build output and test reports are ignored. No environment values were printed or rotated.
- Final in-memory scan: **4 configured private values**, **354 tracked/nonignored source files** and **101 final build files** checked; **zero private-value matches** in source or public build output. No staged files or credentials. An earlier all-ref check found no committed populated environment-file history.
- Authentication, authorization, API contracts, dependencies and schema were not changed. Existing unauthorized/removed-member and external-provider fallback regressions remain enabled.
- **Unable to verify:** the task states that an older uploaded archive contained a populated `server/.env`; the referenced `proj 3.zip` was not available in the workspace, Downloads or attachments for independent inspection. Git ignore rules do not sanitize ZIP archives. If that archive was distributed, its owner should remove the populated file from shared copies and revoke/rotate the exposed private credentials manually. This pass did not perform rotation.

### Git report

This records the review snapshot before publication. The user subsequently authorized committing and pushing to `main`; Git history records publication status.

- Implementation branch: `fix/encore-final-ux-hardening`; base `277f0b0` from freshly fetched `origin/main`. The five newer teammate commits are retained. No merge conflicts occurred.
- **27 changed/new files:** 15 existing client source files, seven existing component/integration test files, one expanded browser audit, one existing notification browser selector correction, two new browser regression files and this audit document. No server, shared schema, auth/API contract, dependency or README edits.
- Pre-commit working tree: **25 modified tracked files, two untracked browser test files, zero staged files**. Both new regression files belong in the implementation commit.
- **At completion of the hardening audit, changes were uncommitted on the dedicated branch and neither local nor GitHub `main` had been written to.** This review restriction was superseded by the user's subsequent publication authorization.

Changed files:

```text
client/src/components/ConfirmDialog.vue
client/src/components/MeetupAvailabilityGrid.vue
client/src/components/MeetupCreationForm.vue
client/src/components/MeetupEntryCard.vue
client/src/components/MeetupLocationSearch.vue
client/src/components/MeetupOverview.vue
client/src/components/MeetupTransportPanel.vue
client/src/components/NotificationBell.vue
client/src/components/SiteHeader.vue
client/src/composables/useMeetupBoard.js
client/src/views/ConnectionChannelView.vue
client/src/views/GroupChannelView.vue
client/src/views/KakiChatView.vue
client/src/views/MeetupView.vue
client/src/views/MyListingsView.vue
client/tests/availability-grid.test.js
client/tests/confirmation-dialog.test.js
client/tests/market-integration.test.js
client/tests/meetup-form-panels.test.js
client/tests/meetup-location-search.test.js
client/tests/meetup-planner.test.js
client/tests/nearby-transport.test.js
client/e2e/ux-visual.spec.js
client/e2e/notification.spec.js
client/e2e/meetup-hardening.spec.js
client/e2e/meetup-creation-retry.spec.js
docs/ENCORE_UX_AUDIT.md
```

### Publication integration after approval — 2026-11-03

The user authorized committing and pushing to `main` after the review above. The hardening work was committed as `758bc9a`. A fresh fetch found two additional teammate commits, `639647d` and `ea5c6f2`, covering welcome/onboarding, admin proof review and UI improvements. These were merged normally as `f154bac`, preserving their new dependency, routes, styles and tests. The header merged automatically with both its Admin link and mobile wrapping intact.

The combined UI exposed one real CSS integration defect: Bootstrap's global `.row > *` rules stretched Kaki chat message-option buttons to **214px** and wrapped them beneath message bubbles. A new browser regression reproduced the failure at 390px. Renaming only the private message-row classes in `KakiChatView.vue` isolates them from Bootstrap without changing chat behavior or the teammate's Bootstrap layouts. The same regression passed for both participants' incoming/outgoing messages at 390px and 1440px, checking touch-target size, alignment, bounds, scrolling and reachable Reply actions. Evidence: `integration-chat-before-390.png` and `final-integration-chat-{sender,receiver}-{390,1440}.png` in the screenshot directory above.

The local dependency refresh encountered a Windows file lock and an npm certificate-trust failure. The installation was repaired using Windows' trusted CA store with TLS verification enabled. Temporary npm peer-metadata changes were discarded; the teammate's committed lockfile is preserved. Dependency caches/backups remain ignored. No project TLS settings or credentials were changed.

Final combined-source verification:

- Backend: **641/641 passed**, zero failures/skips/cancellations.
- Frontend: **381/381 passed**, 32 files, 87.56 seconds.
- Production build: **passed**, 4.13 seconds; initial JavaScript 166.91 kB.
- Entire Chromium suite: **39/39 passed**, zero retries or excluded scenarios, 4.5 minutes. This includes the incoming welcome/admin workflows and the new chat layout regression.
- Security scan: four configured private values checked only in memory against **356 tracked files** and **105 final build files**; zero matching paths or printed values.
- Git diff check passed. The publication integration adds only the private chat CSS-class isolation, its browser regression and this audit update beyond the reviewed hardening commit and preserved teammate commits.

These publication results supersede the earlier hardening-only counts. No force push or replacement of teammate history is used.

## Teammate Feedback Resolution and Comprehensive Final Verification

Review date: **4 November 2026**. This section supersedes earlier workflow descriptions and test counts where they differ. It records a new verification run, rather than treating earlier audit claims as proof. Production data, credentials, dependency versions, matching algorithms and questionnaire fields were not changed.

### A. Teammate feedback resolution matrix

Paths in this section are relative to the repository root; client view/component names refer to `client/src/views` and `client/src/components` unless specified otherwise.

| Reported issue | Confirmed? / root cause | Files changed | Correction | Evidence | Status |
|---|---|---|---|---|---|
| Pending proposals appear impossible to revise | Yes: contributions were correctly locked, but recovery was hidden in a top menu | `MeetupView.vue`, `useMeetupBoard.js` | Visible **Withdraw proposal and reopen planning** from locked editing stages and Review; confirmation explains preserved contributions and fresh approvals | `meetup-planner.test.js`; authenticated `teammate-workflows.spec.js` in all three scopes; backend `meetupRealtime.test.js` | Corrected; locks retained |
| A sole host must approve their own proposal twice | Yes: all proposals entered the same pending state | `server/src/db/meetupRepository.js`, planner view/composable | **Confirm this time & place** is the sole organizer's explicit approval; selection, approval, version and confirmation notification commit atomically | New sole-host HTTP lifecycle and rollback tests; real hosted browser journey | Corrected; multi-organizer consent preserved |
| New groups can target past concerts | Yes: neither the selector nor repository enforced upcoming dates | `shared/concertEligibility.mjs`, `partyRepository.js`, `concertController.js`, `GroupConnectionsView.vue` | Shared date policy, filtered selector, honest stale-route/empty states; authoritative transactional server check | New `groupCreationEligibility.test.js`, `group-connections-workspace.test.js`, browser creation journey | Corrected; historical reads preserved |
| My Groups → planner → Back opens chat | Yes: origin helper only recognized conversation/overview | `utils/meetupNavigation.js`, `utils/meetupSummaries.js`, planner composable, entry/overview, both group views | Allowlisted origins preserve My Groups, Manage Group, conversation or overview through creation, stages and resume | Helper/component tests; new real group creation/return browser journey; existing chat/pair/connection/notification tests | Corrected |
| Cancel is prominent near planning controls | Yes: top Plan options mixed recovery and destructive actions | `MeetupView.vue` | Remove top dropdown; retain visible recovery; put secondary cancellation at end of Review with confirmation | Planner component test and all three lifecycle browser journeys | Corrected |
| My Groups cards do not align | Yes: variable title/metadata lengths; inline-size containment also prevented shared subgrid rows | `GroupConnectionsView.vue` | Shared content rows, aligned action tracks, wrapping titles and mobile stacking; no fixed card height | Real short/long-title card geometry checks and screenshot; six-width visual suite | Corrected |
| Success contains duplicate checkmarks | Yes: literal checkmark plus shared CSS decoration | `GroupMembershipView.vue` | Remove literal icon; retain one accessible success message; clear old success on a new/failing action | Membership workspace regressions for Save/Publish/Invite | Corrected |
| Completed preferences banner repeats | Yes: nudge rendered even after answers were saved | `GroupPreferencesGate.vue`, group dashboard | Hide completed nudge; keep missing/unavailable guidance and Profile access; do not add a second page-level gate after onboarding | Preferences onboarding and group workspace tests | Corrected; teammate's mandatory onboarding retained |
| Kaki artist disappears when no candidates exist | Yes: options came from `pool.people` instead of existing authorized `pool.concerts` | `KakiFinderView.vue` | Keep joined artist/date context even with zero profiles; honor authorized concert links; distinguish reviewed/filtered/unavailable empty states | New `kaki-concert-context.test.js`; real zero-profile artist/date browser journey | Corrected; ranking unchanged |
| Short calendar windows waste available space | Yes: fixed table width and fit-content wrapper | `MeetupAvailabilityGrid.vue` | Fill allocated width; retain rem-based minimum for scrolling; short windows get 44px row targets | Grid component tests; one/two-day six-width/two-theme browser matrix; legacy many-day rendering check | Corrected |
| A confirmed mutation can look like a failed save | Present in group views; planner already separated mutation from refresh | Both group views; planner verification tests | Report committed outcome separately from refresh warning; retry only the read; preserve edited values; remember known created group ID if setup/navigation fails | New group workspace and planner component regressions; existing creation retry/draft browser tests | Corrected within changed workflows |
| Notification tests report passing assertions but throw | Yes: two mocks returned `undefined` after teammate added promise-based mark-read | Two notification/header test files | Return resolved promises from mocks; production notification behavior retained | Complete client suite with zero unhandled errors | Test fixtures corrected |
| Anonymous catalog writes have no budget | Additional confirmed security defect found during audit | Routes, concert controller, `apiRateLimiter.js`; API/security tests | Require a session for concert creation; bound artist/venue/city to 200/200/100 characters; persistent account/IP budget of 20 writes/hour | New auth/length/API tests and persistent account/IP HTTP rate tests | Corrected; public concert reads retained |

**Past-concert cutoff:** a verified performance start closes creation at that instant. A date-only/unverified-time concert stays eligible until the next midnight in its valid event timezone, with Singapore as fallback. “Already started” is used for a verified start; no concert end time is invented. Missing/invalid dates fail closed. Server errors distinguish `concert_not_found` (404), `concert_date_unavailable` (400), and `concert_no_longer_upcoming` (409). An open browser rechecks at submission; forged client dates cannot override the stored concert.

### B. Previous requirements audit

“Verified complete” below means inspected source and relevant automated tests support the implementation in the tested environment. It does not certify an external provider or every browser/device. This audit reconstructs requirements from the conversation, the attached task, the existing audit, planner guardrails and scoped-testing document.

| Intended behavior | Actual implementation / source | Verification and evidence | Classification |
|---|---|---|---|
| Direct seeker → group: choose, then receiving host decides | `groupDiscoveryRepository.js`, `recommendationRepository.js`, direct comparison UI; comparison alone sends nothing, one pending application, FIFO held-seat admission | `hybridDirect`, `admissionQueue`, `queueLifecycle` tests; direct browser journey | Verified complete |
| Automatic seeker → group: algorithm offer, both approvals | `matchingService.js`, `proposalRepository.js`, capacity ledger; Gale–Shapley remains the two-sided group assignment solver | `galeShapley`, `hybridReservations`, `api`, `community` tests; automatic browser journey | Verified complete |
| Preserve capacity, expiry, queue order, repeated rounds and history | Database constraints, shared capacity/queue helpers and transactional finalization | Reservation, admission, matching, queue, migration and rollback tests in full server suite | Verified complete |
| Kaki supports personal filters, ranked profiles, swiping, undo and mutual consent | `kakiRepository.js`, `companionRecommendations.js`, Kaki view/SwipeDeck; peer matching registry uses Irving stable-roommates when applicable, with score-order fallback | Solver/registry/companion tests; swipe component tests; mutual-like/chat and zero-candidate browser journeys | Verified complete |
| Preferences represent every member, with unchanged questions | `discoveryPreferences.js`/membership aggregation uses active-member denominators, majority preferences and individual vetoes; shared Profile answers remain private | `groupConsensus`, `userPreferences`, preference onboarding and public-profile tests | Verified complete |
| One active concert group per person/host; friends join privately | Membership/group identity rules and single-use invites; publication readiness stays authoritative; normal UI access follows mandatory onboarding | Group identity/discovery/community tests; new browser create→friend invitation→publish journey | Verified complete |
| Group-to-group consent and one shared chat | Connection invitation acceptance, current membership authorization, connection room for both groups | `connectionChannel`, `groupDiscovery` tests; real invitation/chat browser journeys | Verified complete |
| All chats: membership, live delivery, persistence, edit/delete/read | Dedicated pair/group/connection/market repositories; authenticated event stream and scoped unread state | All channel, pagination/catch-up and authorization tests; chat/market/notification browser journeys | Verified complete |
| Visible planner access and useful overview | Chat entry cards, My Groups/Manage Group buttons and My Meetups with stage-aware status | Entry/overview/navigation component tests; real group/connected/pair/overview browser journeys | Verified complete |
| Safe return navigation, never an arbitrary URL | Four-value origin enum; conversation path derives from authorized plan scope | Malformed/array/URL helper cases; browser bookmark/notification and group-origin checks | Verified complete |
| Concert-related, timezone-safe half-hour planning windows | `shared/meetupDates.mjs`, server validation and creation form; stricter concert window overrides generic duration limit | Date/domain/guardrail tests and browser invalid-date checks in UTC actor contexts | Verified complete |
| Paint availability with counts, keyboard, touch and save | Heatmap supports paint/erase, touch hold/native scrolling, focus/Space/arrows, Singapore labels and saved group totals | Grid tests; real CDP touch at 320/360/390, both themes and 200% text; six-width pointer/keyboard matrix | Verified complete in Chromium |
| Wider one/two-day calendar and usable many-day legacy records | Full allocated width with practical minimum/overflow; creation bounds unchanged | New one/two-day browser matrix uses real records; seven-day check substitutes only an authorized read response for legacy rendering | Verified complete for tested layouts |
| Drafts survive stages/live updates and failures | `useMeetupBoard.js` snapshots, guarded refresh, explicit dirty state; all meaningful local drafts covered by internal navigation and beforeunload guard | Planner component tests; failed-save, browser Back, notification navigation and native reload-cancel browser checks | Verified complete |
| Creation is recoverable without duplicate writes | Stable request identity, definitive-rejection handling, uncertain retry replay, known-created identity; group creation also retains its known ID after setup failure | Creation form/parent tests; lost-response and double-click browser journey; group setup recovery component tests | Verified complete |
| Location name and coordinates stay consistent | Lookup generations/provenance; changed query/manual name invalidates only derived coordinates; manual fallback remains | Location-search/planner tests; delayed old-result, edit/query/failure and saved-payload browser checks | Verified complete |
| Suggested places persist independently of recommendations | Repository places and votes rendered separately; adding/voting does not propose a plan | Planner/domain tests; member suggestion before availability browser journey | Verified complete |
| Rank time/place by attendance and fair travel, excluding budget | Shared deterministic comparator; complete-route safeguard, worst-journey tie handling, explicit distance fallback; transit/drive modes | `meetupDomain`, `carTravel`, `meetupIntegrations` tests and travel-fallback browser checks | Verified complete; unchanged |
| Keep private starting locations private | Only caller's availability/origins exposed; aggregation handled server-side; summaries omit private routes/origins | Multi-account repository/API and private-marker browser assertions | Verified complete |
| Coherent proposed/confirmed/withdrawn/cancelled lifecycle | Versioned organizer operations; single-host explicit confirmation; both connected hosts/pair participants separately approve; contributions lock | New HTTP transaction/concurrency/history tests; all three new lifecycle browser journeys | Verified complete |
| Discussion requests changes without mutating approval | Scoped discussion remains open in proposed/confirmed states; no comment auto-proposes/reopens | Component tests and member change-request browser journey | Verified complete |
| Pre-meetup and post-concert travel checks use appropriate locations | `meetupTransport.js`, `MeetupTransportPanel.vue`; meeting point before, concert venue and nearby stations/stops afterward | Nearby transport/service/provider tests; scoped before/after browser journey | Verified complete with controlled responses |
| OneMap, LTA and NEA enrich plans with safe failure states | Server-only provider clients; auth refresh, cache, freshness labels, request budgets, bounds and unavailable fallback | Full provider security/transport/weather tests; deterministic harness responses; no real provider requests in this audit | Implemented but insufficiently verified against live services |
| Inbox and chat notifications, reminders, delivery suppression | Notification repository, durable delivery queue, read/mute/block/access checks; teammate route-resolution behavior preserved | Notification/delivery/account tests; real event/inbox/read/route browser journeys | Verified complete for local inbox/delivery logic |
| Background Web Push produces OS popups | Service worker, subscription ownership and VAPID delivery configured server-side | Push browser-wrapper/worker/delivery tests use controlled boundaries; no real subscription or OS popup exercised here | Implemented but insufficiently verified end to end |
| Account safety, moderation, sessions and permissions | Session ownership, CSRF/origin handling, password recovery, verification, blocking/reporting and operator authorization | Complete account/session/HTTP-security/moderation tests; outsider chat/meetup browser checks | Verified complete for automated paths; real SMTP delivery not verified |
| Catalog and Ticketmaster features | Cached discovery, safe detail refresh, catalog validation; new authenticated/budgeted manual creation | Ticketmaster/provider/catalog API tests; concerts/filter/calendar browser checks | Verified complete locally; live Ticketmaster availability insufficiently verified |
| Marketplace, listing edit/delete and ticket messaging | Existing teammate listing/editor/proof changes preserved; checkout remains deliberately unavailable | Full ticket and market component/integration tests; seller/buyer/edit/remove/admin browser journeys | Verified complete for implemented flows |
| Real ticket payment processing | UI expressly blocks checkout until a payment provider is configured | Existing checkout tests/source; no new paid service | Not applicable to this correction task |
| Public VibeChart and private questionnaire onboarding | Public profile shows existing six vibe ratings; questionnaire answers stay owner-only, editable in Profile. Teammate commit `4845e94` makes Welcome setup mandatory for signed-in navigation | Public-profile/preferences/route-guard tests and registration/profile/browser journeys | Verified complete |
| Feedback/reliability and operator tools | Post-event eligibility, peer feedback, aggregate reliability, operator-only reconciliation and proof review | Feedback/community/account tests; admin proof browser journey; no new live-feedback browser recording | Verified complete for API/component coverage |
| Refactoring preserves interfaces and behavior | `repositories.js` remains a composition/re-export entry; policy, validation, planning, integrations and UI responsibilities remain separated | Entire suites and source/diff review; no algorithm/schema/dependency rewrite in this pass | Verified complete for covered behavior |
| Performance stays practical | Lazy routes and bounded queries, message pagination, durable batches/provider caps remain | Production build; existing bounded-query/budget/worker tests; no production-load benchmark performed | Implemented but insufficiently verified at production scale |
| Optional questionnaire onboarding; unrestricted signed-in browsing/drafts before answering | This earlier requirement conflicts with the newly arrived teammate policy. The user explicitly chose to keep mandatory onboarding. Server APIs retain their existing preference prerequisites; the global UI gate requires setup first | `routeGuards.js`, Welcome and new route-guard tests; mandatory-onboarding browser checks | Superseded by the user's latest choice |
| Completed banner always shows saved preferences / host self-approves after every submission | Earlier presentation and redundant single-host approval descriptions no longer apply | Replaced by missing-only nudge and atomic sole-organizer confirmation | Superseded |
| Unrestricted edits to a live proposal | Would let approvals authorize a different plan; intentionally not implemented | Locked mutation/permission tests; reopen/revise/approve journeys | Not applicable; contrary to approval integrity |

The questionnaire fields/options, direct request limit, scoring, matching solver registry, FIFO seat semantics and group connection consent were inspected and retained. No “infinite custom preference” embedding service, new ranking metric or automatic-matching swipe replacement was added.

### C. Meetup state machine and permissions

| State | Participants | Required organizers | Transition |
|---|---|---|---|
| Planning | Save own availability/journeys; add public places; vote; discuss | Same contributions; deliberately submit a chosen time/place; cancel | Multi-organizer submission → proposed. Sole-host explicit confirmation → confirmed |
| Proposed | Read locked contributions; discuss changes | Each required person can approve their own session/version once; withdraw/reopen or cancel | All current approvals → confirmed; withdraw → planning at a new version |
| Confirmed | Read agreed public time/place; discuss; consult journey/weather information | Reopen planning or cancel | Reopen → planning at a new version |
| Reopened | Same rights as Planning | Select and submit a new proposal | This is a transition back to `planning`, not a separate stored status. Selected choice clears; current approvals reset |
| Cancelled | Read historical contributions; no edits/discussion/approvals | No reopen action | Terminal read-only record |

| Scope | Who contributes? | Who must approve? |
|---|---|---|
| Hosted group | Current authorized group participants | The current host only. **Confirm this time & place** records that host's approval in the proposal transaction. Ordinary members do not all approve |
| Connected groups | Current authorized members from both groups | Both current group hosts, each explicitly; submitting does not approve on either person's behalf |
| Mutual Kaki pair | Both currently authorized mutual participants | Both participants, each explicitly; either may submit first |

Withdrawal/reopening preserves saved availability and private origins, public suggestions, votes, discussion and historical approval rows. The version increments, selection clears, and only approvals for the new current proposal/version can authorize confirmation. Participants receive the existing scoped notification/live invalidation. Repeated/no-op actions, stale versions, outsiders, departed members and transaction rollback remain guarded by the server. Proposal submission is never triggered by voting, saving a place/availability, changing stages or merely opening Review. Existing legacy single-host pending proposals can still be approved explicitly; they are not silently rewritten in a migration.

The UI shows the public place/time, approval progress, whether your approval is still required or saved, and the other organizer wait. It does not label the original board creator as the proposer, because no separate proposer identity is persisted.

### D. UI/UX and screenshot review

- Navigation uses authorized context and preserves unsaved-draft guards. The existing teammate BackArrow design remains; its accessible label identifies the destination.
- Recovery is available from locked Time/Places as well as Review. Cancellation is a separate, lower-priority Review management action. Approval counts and fixed public choice are grouped together.
- My Groups uses shared rows for title, concert information, member count, explanatory text and actions. A real long-title test checks rows, rather than inferring correctness from CSS. Narrow screens stack actions without fixed card heights.
- Completed preference reminders disappear; missing/unavailable information remains actionable. The preserved teammate global guard sends signed-in members with confirmed missing preferences to Welcome before other pages; welcome, login and account security stay accessible. Signed-out public browsing remains available. A failed preference lookup does not lock the member out, and server publishing/automatic requirements still apply. Group forms add no second prerequisite after onboarding.
- Kaki filters describe the viewer's joined concerts. Empty, reviewed-all, filter-excluded, failed-load and rank-empty states give distinct guidance without exposing private reasons why another person was excluded. A request generation guard prevents a slow old ranking response replacing a newly selected concert.
- The calendar fills available space while keeping touch hold/paint/erase, native pan, keyboard focus, count inspection, saved/draft distinction and horizontal overflow. One/two-day records are real API data; the seven-day screenshot is explicitly a legacy rendering fixture.
- Full responsive checks cover **320, 360, 390, 768, 1024 and 1440px**, both themes, reduced motion, keyboard navigation, modal/overlay focus and viewport bounds. Native Chromium touch is exercised at three mobile sizes and 200% text. Physical-device behavior remains a manual boundary.
- Startup transitions and the existing global design system were retained. No new motion library or wholesale redesign was introduced.

Screenshots are real browser captures from disposable authenticated sessions in:

`C:\Users\aungb\.codex\visualizations\2026\10\16\01a1447a-55bd-7021-bcc5-4d2f8338b7d6\encore-teammate-final-audit`

`baseline-*` captures were made before source edits. `final-*` records the completed implementation; `corrected-*` contains intermediate regression evidence. Useful final snippets include `final-calendar-1day-dark-1440.png`, `final-calendar-2day-light-390.png`, `final-kaki-joined-artist-zero-profiles.png`, `final-teammate-connected-pending-partial-approval.png`, `final-teammate-connected-visible-recovery.png`, and `final-teammate-owned-cards-aligned-long-title.png`. No `.agent-local` folder was recreated. Generated browser reports, traces and logs remain ignored; README files were retained.

### E. Test evidence and limitations

Baseline after incorporating teammate commits: **641 backend passes**; **386 client assertions passed but the run failed with two unhandled mock errors**; **37/40 browser scenarios passed**, with three existing hardening failures. The build passed. These are fresh baseline results and supersede assumptions based on older counts.

The native-touch failure came from immediately measuring font size after injecting 200% text CSS: some contexts still reported the old 16px size. The assertion now polls for the required increased size before geometry/native input checks; no target-size or scrolling assertions were relaxed. Baseline draft-notification loading and location-page timeout failures were retained in the log; they did not reproduce in focused or subsequent full runs. They are recorded as transient baseline failures, not assigned an unsupported production root cause.

New test development also caught incomplete synthetic user data in a rate-limit fixture and overly strict/ambiguous browser selectors for native form labels. Fixtures/selectors were corrected without weakening production checks. Final evidence below must come from complete reruns, not sums of isolated passes.

Final complete-source results after the alignment correction:

| Check | Result | Evidence |
|---|---|---|
| Backend, entire suite | **666/666 passed**, 30 suites, zero failures/skips/cancellations; 210.34 seconds | `server/test-results/teammate-audit-final-server.log` |
| Frontend, entire suite | **455/455 passed**, 35 files, **zero unhandled errors**; 115.98 seconds | `server/test-results/teammate-audit-final-client.log` |
| Chromium, entire suite | **48/48 passed**, zero retries/excluded/skipped scenarios; 6.0 minutes | `server/test-results/teammate-audit-final-browser.log`; ignored Playwright HTML report and real screenshots |
| Production build | **Passed**, 5.44 seconds; initial JavaScript 169.03 kB / 61.25 kB gzip | `server/test-results/teammate-audit-final-build.log` |
| Private-value exposure check | Four configured private values compared in memory against **368 source files and 113 build files**; **zero matching paths**; no values printed | Final local scan after teammate integration; ignored environment files remained untracked |
| Repository checks | `git diff --check` clean; no staged files; no temporary `.agent-local` folder | Final Git/filesystem inspection |

This correction adds **25 backend cases, 61 client cases and eight browser scenarios** relative to the fresh baseline. The newly integrated teammate commit contributes another **eight client cases**, producing the final total of 455. Existing assertions were also strengthened. Live-service/device limitations are explicitly listed in section F. The final source was tested again after screenshot review exposed the card containment issue and again after the late teammate onboarding integration. The backend source is unchanged by that client-only teammate commit, so its complete 666-case run remains applicable.

**No final automated tests remain failed or blocked.** The combined-source run retains the incoming mandatory-onboarding assertions and all planner/matching/chat/market regression scenarios. Manual live-service and device checks are separate from this result.

Reproduction commands (separate terminals, repository folders):

```powershell
# server/
npm.cmd test -- --test-concurrency=1

# client/
npm.cmd test -- --run --maxWorkers=1
npm.cmd run build
npm.cmd run test:e2e
```

The whole Chromium suite uses one worker, zero retries and no excluded scenarios in the final run. Tests use an in-memory database, temporary uploads, real signed-in HTTP requests and separate browser contexts for different people. The API/browser harness is loopback-only and never imported by the production app. Provider responses are deterministic test fixtures, including failure/fallback paths; external fonts/images are aborted. Real account credentials and production records are not used.

New regression coverage is stored in the repository: `server/test/groupCreationEligibility.test.js`; added lifecycle cases in `server/test/meetupRealtime.test.js`; added catalog authorization/length/rate tests; `client/tests/kaki-concert-context.test.js`; `client/tests/group-connections-workspace.test.js`; expanded grid/navigation/entry/membership/preferences/planner tests; `client/e2e/teammate-workflows.spec.js`; `client/e2e/kaki-calendar-audit.spec.js`. Existing browser scenarios retain mutual approvals while hosted-group expectations reflect deliberate single-host confirmation.

The requested authenticated browser journey map:

| Journey | Concrete evidence |
|---|---|
| A: future/past group creation, friends and publishing | New `teammate-workflows` group test uses real create, settings, single-use invitation acceptance and publish; forged past-concert POST is rejected |
| B: My Groups / Manage Group → planner → Back | Same new journey checks create/resume, stage changes and both return destinations; existing navigation suite checks conversations and overview |
| C: multi-user proposal/reopen/revise/confirm | New connected-group and Kaki journeys preserve saved availability, places, votes and discussion, invalidate approvals and require fresh approvals |
| D: one host | New hosted journey and updated hosted guardrail scenario confirm directly from the deliberate submission, then reopen and confirm a new version |
| E: two connected hosts | Both real sessions separately approve; member/outsider/stale requests cannot authorize the plan |
| F: mutual Kaki pair | Real participation/likes create the conversation; both participants explicitly approve and retain chat/planner access |
| G: artist with zero candidates | New Kaki/calendar suite creates/join a concert with no other participants and exercises selected artist/date, Reset and reload |
| H: cross-feature navigation | Existing full chat, notification, profile, catalog, ticket market/admin and responsive suites plus new origin tests |
| I: failure, concurrency and persistence | Existing lost-response/double-click creation, native reload-cancel, failed-save, stale lookup and draft browser tests; new stale approval HTTP assertions; backend simultaneous approval/rollback tests and client failed-refresh tests |

Browser scenarios are complemented by API/component checks where a deterministic failure or simultaneous transaction is more directly controlled at that boundary; those are not misrepresented as physical multi-device browser actions.

### F. Remaining issues and manual verification

No unresolved feature defect is claimed fixed without evidence. Automated coverage has practical boundaries:

| Priority / kind | Remaining verification | Impact |
|---|---|---|
| Deployment verification | Real browser subscription, production HTTPS service worker and an actual OS Web Push popup, including OS notification permissions and closed-tab/browser behavior | Local delivery tests cannot prove a real device receives a popup |
| Deployment verification | Live OneMap token/account, LTA response availability/coverage, NEA freshness and Ticketmaster credentials/quota | Controlled tests prove safe parsing, access checks, budgets and fallbacks; they do not establish current live provider uptime |
| Deployment verification | Real SMTP password-reset/verification delivery | Token/session flows are tested; delivery to a real inbox is not exercised |
| Compatibility verification | Physical iOS/Android devices, Safari/Firefox and assistive technology; production multi-process/load behavior | Final interactive browser evidence is Chromium, including CDP touch and increased text; it is not a cross-device certification |
| Optional design choice | Whether to show organizer names or shorten the recovery label further | Current required-status/count guidance is explicit; a persisted proposer identity would be a separate data change |

No live external API, SMTP or OS popup result is inferred from unit tests. No paid provider or dependency was added, and existing keys were not printed or embedded in client code.

### G. Git and preservation report

Working branch: **`fix/encore-teammate-ux-final-audit`**, created from freshly fetched `origin/main` at **`7228938`**. The four commits newer than the initial local main were incorporated before changes began: `c83fbb3`, `2862e27`, `3c8b9a4`, `7228938`. During final verification, a teammate pushed **`4845e94` (Making preferences mandatory)**. All uncommitted work was stashed safely, this review branch alone was fast-forwarded, and the work was restored. The shared browser test file merged automatically without conflicts. HEAD is now **`4845e945c954cf81ade8b4eedbc2a10900bfc400`**. Teammate notification route-resolution changes, listing editing/proof review, BackArrow/BackLink controls, mandatory onboarding and UI updates are retained.

No commit, merge into main or push was performed for this task. Changes remain **uncommitted on the dedicated review branch**, with nothing staged. There were no merge conflicts because work started from the updated remote tip. This task's attached branch-only publication restriction takes precedence over publication authorization for earlier work.

The user explicitly selected **Keep the teammate's mandatory onboarding** after the policy conflict was explained. Guidance and this audit were updated accordingly; the questionnaire fields remain unchanged. Frontend/build/browser verification was repeated on the combined source. This supersedes the earlier optional-onboarding wording and any claim that the review HEAD stayed at `7228938`.

The local review branch has no upstream, avoiding an accidental default push to main. Inventory relative to `4845e94`: **43 changed/new files: 37 modified tracked files and six new files**, zero staged files, no deleted files. No README, schema, lockfile, dependency or production configuration change is included. The six files in the teammate's new commit belong to the new base and are preserved in addition to this inventory.

```text
client/e2e/community-features.spec.js
client/e2e/kaki-calendar-audit.spec.js (new)
client/e2e/meetup-hardening.spec.js
client/e2e/meetup-navigation.spec.js
client/e2e/teammate-workflows.spec.js (new)
client/src/components/GroupPreferencesGate.vue
client/src/components/MeetupAvailabilityGrid.vue
client/src/components/MeetupEntryCard.vue
client/src/components/MeetupOverview.vue
client/src/composables/useMeetupBoard.js
client/src/utils/meetupNavigation.js
client/src/utils/meetupSummaries.js
client/src/views/GroupConnectionsView.vue
client/src/views/GroupMembershipView.vue
client/src/views/KakiFinderView.vue
client/src/views/MeetupView.vue
client/tests/availability-grid.test.js
client/tests/group-connections-workspace.test.js (new)
client/tests/group-membership-workspace.test.js
client/tests/header-overlays.test.js
client/tests/kaki-concert-context.test.js (new)
client/tests/meetup-entry.test.js
client/tests/meetup-navigation.test.js
client/tests/meetup-planner.test.js
client/tests/notification/notification-bell.test.js
client/tests/preferences-onboarding.test.js
docs/ENCORE_UX_AUDIT.md
server/src/controllers/concertController.js
server/src/db/meetupRepository.js
server/src/db/partyRepository.js
server/src/routes/index.js
server/src/services/apiRateLimiter.js
server/test/accountSecurity.test.js
server/test/api.test.js
server/test/community.test.js
server/test/communityApi.test.js
server/test/groupCreationEligibility.test.js (new)
server/test/httpSecurity.test.js
server/test/meetupGuardrails.test.js
server/test/meetupNavigation.test.js
server/test/meetupRealtime.test.js
server/test/userPreferences.test.js
shared/concertEligibility.mjs (new)
```

## Final Cross-Workflow Consistency and Deployment Readiness Audit

Review date: **4 November 2026, Asia/Singapore**. This is a targeted continuation of the previous audit, not another redesign. The 43 pre-existing changed/new files were preserved before editing. The teammate's mandatory preference onboarding remains in place; questionnaire fields, matching scores, solver selection, capacities, FIFO admission and approval rules are unchanged.

### A. Independent verification of previous corrections

Fresh starting-version verification passed **666 server tests, 455 client tests, all 48 Chromium scenarios and the production build**. The browser baseline used a frozen production build while source investigation proceeded. These are newly observed results, not copied previous counts.

| Previous correction | Classification | Fresh evidence and boundary |
|---|---|---|
| My Groups → planner → correct return | Verified correct | `teammate-workflows`, `meetup-navigation`, component origin/URL tests |
| Manage Group → planner → correct return | Verified correct | Same suites cover creation and an existing board, including step/hash changes |
| Secondary Cancel Meetup positioning | Verified correct | Planner component and browser lifecycle/visual checks; destructive confirmation remains explicit |
| Owned-card row/action alignment | Verified correct | Real long-name card geometry assertions in `teammate-workflows`; responsive audit |
| Duplicate success checkmarks removed | Verified correct | Prior component assertions plus both-theme screenshots; no icon framework change |
| Conditional matching-preference guidance | Verified correct | Preferences/onboarding tests, empty and saved-answer states; mandatory onboarding retained |
| Joined artist/date with zero Kaki candidates | Verified correct | `kaki-concert-context`, `kaki-calendar-audit`; no false “nobody joined” inference |
| Historical-concert group creation blocked | Verified correct | Authoritative creation tests and forged browser POST; verified start/date-only rules retained |
| Withdraw/reopen proposal controls visible | Verified correct | Hosted, connected and Kaki browser journeys; exact persisted lifecycle asserted |
| Sole organizer explicitly confirms | Verified correct | Hosted journey and repository tests; ordinary members contribute but do not approve |
| Multiple required organizers approve | Verified correct | Both connected hosts and both Kaki participants; outsiders/stale approvals rejected |
| Reopening preserves contributions | Verified correct | Availability, places, votes and discussion survive; fresh version approvals required |
| Responsive availability calendar | Verified correct | One/two-day grids, legacy long windows, native pointer/touch and all six widths |
| Mutation success versus refresh failure | Confirmed defect in adjacent flows; fixed | Planner/Manage Group behavior passed; direct application/withdrawal, automatic offer and group-chat cases needed the targeted corrections below |
| Unsaved draft navigation protection | Verified correct | Route/back/reload confirmation tests retain drafts when leaving is cancelled |
| Selected location/coordinate consistency | Verified correct | Search input invalidation, manual coordinates, stale lookup guards and journey-save tests |

“Verified correct” refers to these observed local cases, not every possible browser, device or hosted deployment.

### B. Confirmed new issues and corrections

| Severity | Reproduction / root cause | Correction and principal files | Evidence / status |
|---|---|---|---|
| High | Create legitimate future relationships, backdate the concert, then call participation/Kaki/direct/automatic/connection APIs: new coordination was still accepted | Shared local-day eligibility and authoritative repository checks: `shared/concertEligibility.mjs`, `server/src/db/concertEligibility.js`, participation, Kaki, discovery, recommendations, proposals, membership and matching service | New `historicalCoordination.test.js`, real HTTP/browser bypass checks; fixed |
| Medium | Overseas concert feedback used Singapore midnight, allowing feedback before the actual local concert day ended | `feedbackRepository.js` uses the same local-day cutoff and stored event timezone | US/Singapore boundary regression; fixed |
| Medium | Historical groups counted and displayed as upcoming; joined cards assumed missing host/capacity fields | `GroupConnectionsView.vue` presents upcoming/ongoing, past/undated and cancelled records separately; joined cards use actual metadata | New workspace tests and historical browser screen; fixed without changing stored statuses |
| High | Failed/slow catalogue request prevented otherwise successful owned/joined/invitation/application/offer reads | Independent source loading/error state, per-source sequences, account guards and targeted retries in `GroupConnectionsView.vue` | Catalogue-only failure, reverse failure, both failure, delayed/account/route reads and real retry browser test; fixed |
| Medium | Optional group picture failed silently; settings/navigation failure could conceal the saved group | Known-ID recovery, explicit partial-setup warnings and existing Manage Group editing destination | Workspace component tests cover image/settings/navigation combinations; fixed |
| High | A successful group POST lost its response; retry could hit an unexplained uniqueness conflict | Reconcile authoritative hosted groups for the submitted concert; uncertain lookup blocks another POST until resolved; preserve structured membership conflict | Real browser executes POST then aborts its response, recovers one group and opens it; component reload/retry tests; fixed without new idempotency storage |
| Medium | Old concert details/setlist/preview or completed operator request could update a newer concert/account or navigate unexpectedly | Captured page/concert/account generations and unmount guards; preserve saved round separately from navigation failure in `ConcertView.vue` | New `concert-consistency.test.js`; fixed |
| Medium | Historical console/discovery/Manage Group controls offered actions now rejected by server; no-future-window context still offered a new board | Shared timed client eligibility; explicit historical copy, disabled acceptance/new publishing and connection actions; preserve all authorized existing-board/chat links | Concert, workspace, discovery, admission-card, Manage Group and meetup component regressions; fixed |
| Medium | Direct request/withdrawal succeeded, then refresh failed: local request/action could remain obsolete or a failed introduction could be erased | `GroupExplorerView.vue` distinguishes saved outcome from read warning, records successful application/withdrawal locally using captured action scope, retains failed drafts and ignores obsolete account responses | `group-explorer-consistency.test.js` includes the API's actual minimal creation response; fixed |
| Medium | Automatic approval response was discarded; failed parent refresh left Accept available after approval | `MatchProposalCard.vue` immediately applies only returned approval/status fields; later authoritative props replace the local overlay | New regression reproduced the obsolete button, then verifies saved approval without inventing other-side consent; fixed |
| High | Reading a group in one tab did not immediately clear another tab's notification/chat badge | Group open/send/read return `notificationsRead`; reader-only `group-read` invalidation and notification revision; `groupChannelController.js`, repository and `chatLive.js` | Separate signed-in contexts assert both badge types clear; no repeated-read event loop; fixed |
| High | Membership mutation omitted normal-group invalidation; departed user's open room could remain stale | Compare caller's bounded before/after room audiences; send minimal `group-members` invalidation to affected old/new members in `routes/index.js` | Browser departure closes room; later private events absent and direct read returns 404; fixed |
| Medium | Slow old room/account reads could overwrite current group chat; successful send/delete could look failed if refresh failed | Request/account/route/unmount guards, confirmed local message state, scoped refresh warnings and visible/reconnect recovery in `GroupChannelView.vue` | New group-channel component regressions plus full chat/browser suites; fixed |

A deliberate test failure reproduced the automatic-offer bug before its fix. Two old feedback fixtures originally created a new matching round/connection only **after** backdating the event; setup now creates the relationship first, then advances it into history. All feedback assertions remain. No production rule was loosened to make these fixtures pass.

The first integrated browser run passed 53/54 scenarios. Its single card-row check measured two bounding boxes in separate awaited calls; the failure reported 10 px while the settled screenshot showed aligned rows. Independent reads can complete above already usable cards, so the geometry check now snapshots both cards in one browser frame and polls that comparison. The original **one-pixel maximum**, every metadata/action row and matching row counts remain enforced. The subsequent complete 54-scenario run passed; no production layout rule was relaxed to satisfy it.

### C. Cross-feature rules and preserved behavior

- **Completion is not performance start.** The catalogue has no verified end-time field. Prospective participation/search/likes/skips/direct applications/automatic enrollment/new rounds/group connections/publishing close conservatively at the end of the concert's own local day. A valid overseas timezone is honored; invalid/missing dates fail closed. Verified start and doors are not treated as finish.
- **Earlier pre-concert limits stay distinct.** New group creation retains its verified-performance-start cutoff (date-only/doors retain the local day). New meetup boards retain the existing future half-hour, concert/travel-day and pre-performance constraints. UI entry controls now respect that authorized context.
- **History remains history.** Merely passing the date does not delete participation, groups, saved results, feedback, marketplace records, chats or plans, and does not revoke existing chat access. Past group statuses are presentation labels, not database rewrites. Withdraw/decline/leave and historical reads remain available under existing permissions. Friend invitation policy is unchanged; it was not speculatively folded into stranger matchmaking.
- **Acceptance creates new coordination.** Pending direct/automatic membership approvals and group-connection acceptance recheck concert eligibility. Existing consent, one-group-per-concert, one pending direct application, seat holds, shared FIFO, expiry and member/profile snapshots remain authoritative.
- **Meetup consent is unchanged.** The documented, previously agreed hosted-group rule requires its current host alone; connected scopes require both current hosts; Kaki requires both participants. Comments/votes/availability are contributions, never approvals. Reopening preserves contributions, increments version, clears the final selection and needs fresh approvals. Cancellation stays read-only.
- **Realtime is invalidation, not replay.** Each tab has one EventSource; native reconnect and `ready` refetch authoritative HTTP state. Group read acknowledgments go only to that user's sessions. Logout/session revocation and current scope membership remain checked by the server. The event bus is process-local; this does not establish multi-instance compatibility.
- **Representative adjacent workflows were checked.** Full catalogue, profile/onboarding, ticket marketplace, three chat types and notification tests were retained. No questionnaire fields, API keys, external integrations, marketplace behavior, score weights, matching preferences or solver algorithms were changed.

### D. UI review

The existing Encore visual system and opening transitions remain. Changes are scoped explanations, section counts, recovery actions and eligibility-aware controls. Historical groups retain Open group chat, Manage/View group and existing meetup history; they no longer imply an upcoming concert. Creation recovery prominently offers Open created group and explains which optional setup failed.

Both-theme browser checks cover **320, 360, 390, 768, 1024 and 1440 px** across concert calendar, Kaki, direct comparison, My Groups, messages, tickets, meetup overview, planner stages/heatmap, keyboard header controls, overlays, increased text and reduced motion. The new historical group screen is also checked at those twelve theme/width combinations. Actual screenshots use synthetic users; they do not expose local accounts or private API credentials.

Screenshot directory outside Git: `C:/Users/aungb/.codex/visualizations/2026/10/16/01a1447a-55bd-7021-bcc5-4d2f8338b7d6/encore-cross-workflow-readiness/`. Files include `final-cross-workflow-historical-*.png`, `final-cross-workflow-lost-response-recovered.png`, final planner/calendar/card/theme captures, and a separate preserved `baseline-*` set. Desktop historical/recovery captures were visually inspected; final responsive evidence is recorded below.

### E. Fresh test evidence

| Final complete check | Actual result | Evidence |
|---|---|---|
| Backend, requested serial command | **687/687 passed**, 30 suites; zero failures/skips/cancellations; 213.67 seconds | `server/test-results/cross-workflow-final-serial-server.log` |
| Frontend, requested single worker | **527/527 passed**, 39 files; zero unhandled errors; 106.72 seconds | `server/test-results/cross-workflow-final-serial-client.log` |
| Chromium, complete frozen-source run | **54/54 passed**, zero retries/exclusions/skips; 6.3 minutes | `server/test-results/cross-workflow-frozen-browser.log`; ignored HTML report, traces and actual screenshots |
| Production build | **Passed**, 5.42 seconds; initial JS 169.27 kB / 61.34 kB gzip | `server/test-results/cross-workflow-final-build.log` |
| Private-value scan | **Four configured private values**, 378 source files and 114 build files; **zero matching paths**; values never printed | `server/test-results/cross-workflow-private-value-scan.json` |
| Git / cleanup | `git diff --check` clean; zero staged/deleted files; `.agent-local` absent at root and client | Final working-tree inspection |

Compared with the independently rerun starting version, coverage adds **21 backend cases, 72 client cases and six browser scenarios**. All original suites remain included. Full default-concurrency server/client runs also passed before the final requested serial commands. **No final automated failure remains.** Hosted/live-provider/device limits are listed separately in section F.

Exact final regression commands, from the named folders:

```powershell
# server/
npm.cmd test -- --test-concurrency=1

# client/
npm.cmd test -- --run --maxWorkers=1
npm.cmd run build
npm.cmd run test:e2e
```

New checked-in coverage: `server/test/historicalCoordination.test.js`; additions in `server/test/groupChannel.test.js`; `client/tests/concert-consistency.test.js`, `group-workspace-recovery.test.js`, `group-explorer-consistency.test.js`, `chat/group-channel.test.js`; expanded chat-live, matching, Manage Group and meetup tests; `client/e2e/cross-workflow-consistency.spec.js` and `group-realtime-consistency.spec.js`.

Browser tests use the real Vue/Express/API/SQLite stack, isolated authenticated contexts and deterministic external provider responses. The loopback-only, disposable test harness has explicit historical-date and stream-disconnect controls; production imports neither. Ending actual SSE responses was necessary because Chromium's offline simulation alone left an existing TCP stream open. After a real disconnect, persisted missed messages appeared on reconnect, without duplicate old messages. This demonstrates local native reconnect/refetch, not production proxy behavior.

Commands from their respective folders: `npm.cmd test` in `server`; `npm.cmd test`, `npm.cmd run build`, `npm.cmd run test:e2e` in `client`. Full runs use all checked-in suites; the browser configuration uses one worker, zero retries and no scenario exclusions. The initial baseline accidentally included unpacked preservation-copy tests under test discovery; they were archived as an ignored ZIP, the copied directory alone was removed after path verification, and the complete clean baseline was rerun. That invalid attempt is not counted as a product failure or a passing verification.

### F. Deployment readiness and remaining verification

Separate assessment: [DEPLOYMENT_READINESS.md](DEPLOYMENT_READINESS.md). It compares persistent Node/VPS, Railway volumes, paid Render disks, Vercel frontend plus separate backend, and full Vercel using current official hosting documentation. It documents actual relative API/cookie paths, SQLite/uploads, origin/CSRF/proxy rules, SSE, background delivery, production static routing, environment **names only**, build/start commands, consistent backup/restore and rollback.

**Recommended topology:** one persistent Node process with a durable volume and a single public HTTPS origin. **Readiness:** suitable for a controlled demo after the listed operator prerequisites and hosted smoke checks; not a claim of an already deployed or scaled production system. Existing Express does not yet serve `client/dist`; production static/SPA/proxy routing, durable storage and TLS must be configured. Full Vercel does not fit unchanged local SQLite/uploads/process-local events. Vercel's current Daemons beta does not make ephemeral storage durable. No hosting account, infrastructure, paid plan, database engine or deployment configuration was changed.

Still manual/unverified: real hosting-proxy streaming/reconnect, persisted state after hosted redeploy, restore rehearsal, actual SMTP inbox, live OneMap/LTA/NEA/Ticketmaster availability and quota, physical browsers/devices and an actual permitted OS Web Push popup/background behavior. Local controlled fixtures do not prove those outcomes. No new product-rule question remains unresolved; the sole-host meetup rule above is retained from the explicit prior agreement.

Private-value check: four configured private values were compared **in memory** against source and final built assets; no values were printed. Exact scan totals and Git checks are included below. No tracked private environment/database/WAL/SHM/test-report files were found. A normal folder ZIP ignores `.gitignore`: exclude secrets, databases, backups, dependencies, Git internals and local test artifacts before sharing. No automatic credential rotation was attempted.

### G. Git preservation and inventory

Branch: **`fix/encore-cross-workflow-readiness`**. HEAD: **`4845e945c954cf81ade8b4eedbc2a10900bfc400`**, the teammate's “Making preferences mandatory” commit. `origin/main` was fetched at the start and rechecked near the end; it still pointed at that same commit. No merge/conflict, commit, push, reset or deployment was performed. Changes remain uncommitted, with nothing staged and no branch upstream configured.

An ignored starting-work ZIP (`server/test-results/cross-workflow-start-4257058d.zip`) preserves the initial 43 files and inventory. Comparisons normalize CRLF/LF; this task has substantive source/test/document changes, not a line-ending-only cleanup. Previous uncommitted work remains alongside this task's corrections. No README/document deletion, schema migration, dependency, lockfile, production configuration or `.agent-local` folder was added.

Combined inventory relative to HEAD: **74 changed/new files (58 modified tracked, 16 new), zero staged, zero deleted**. The previous 43-file inventory above remains applicable. This task touches 31 additional paths and further edits 16 of the preserved paths; unchanged preserved paths were not rewritten. CRLF-normalized comparison uses the starting ZIP.

Additional paths touched by this audit (some are existing tracked files):

```text
client/e2e/cross-workflow-consistency.spec.js
client/e2e/group-realtime-consistency.spec.js
client/src/chatLive.js
client/src/components/GroupApplicationCard.vue
client/src/components/MatchProposalCard.vue
client/src/composables/useConcertEligibility.js
client/src/views/ConcertView.vue
client/src/views/GroupChannelView.vue
client/src/views/GroupExplorerView.vue
client/tests/chat/chat-live.test.js
client/tests/chat/group-channel.test.js
client/tests/concert-consistency.test.js
client/tests/group-explorer-consistency.test.js
client/tests/group-matching.test.js
client/tests/group-workspace-recovery.test.js
docs/DEPLOYMENT_READINESS.md
server/src/controllers/groupChannelController.js
server/src/db/concertEligibility.js
server/src/db/concertRepository.js
server/src/db/feedbackRepository.js
server/src/db/groupChannelRepository.js
server/src/db/groupDiscoveryRepository.js
server/src/db/kakiRepository.js
server/src/db/membershipRepository.js
server/src/db/proposalRepository.js
server/src/db/recommendationRepository.js
server/src/db/seekerRepository.js
server/src/services/matchingService.js
server/test-support/e2eServer.mjs
server/test/groupChannel.test.js
server/test/historicalCoordination.test.js
```

Preserved paths further edited in this audit:

```text
client/e2e/teammate-workflows.spec.js
client/src/components/MeetupEntryCard.vue
client/src/composables/useMeetupBoard.js
client/src/views/GroupConnectionsView.vue
client/src/views/GroupMembershipView.vue
client/src/views/KakiFinderView.vue
client/src/views/MeetupView.vue
client/tests/group-membership-workspace.test.js
client/tests/kaki-concert-context.test.js
client/tests/meetup-entry.test.js
client/tests/meetup-planner.test.js
docs/ENCORE_UX_AUDIT.md
server/src/controllers/concertController.js
server/src/routes/index.js
server/test/community.test.js
shared/concertEligibility.mjs
```

## Test folder consolidation (4 November 2026)

All project-owned test suites, configuration, helpers, synthetic benchmarks,
scoped runners and dedicated testing documentation are now under root `test/`.
The layout, current commands and complete old-to-new map are in
[the test guide](../test/README.md). Older audit sections above intentionally
retain the paths that existed when those measurements and Git inventories were
recorded. Their logs were preserved under `test/results/server/` and
`test/results/client/`; generated reports remain ignored by Git.

### Scope and preservation

- Moved 127 maintained files, including backend, Vue, browser and comparison tests;
  moved existing generated result directories without deleting their contents.
- Renamed broad suites to describe concert APIs, community domain/HTTP workflows,
  ticket marketplace, group/meetup lifecycle, responsive UI and notifications.
- Updated every relocated source/mock/schema/worker import, test configuration,
  harness path, script and current documentation link. Removed only empty old
  test/tooling directories after checking their absolute paths.
- Existing `npm test` commands in server/client still work. Root `npm test` now
  runs backend plus client; `npm run test:e2e` runs browsers; `npm run test:all`
  runs all layers. Extra client flags reach Vitest rather than the Node runner.
- Configurations and test adapters reuse the existing client/server installations;
  no dependency, lockfile, runtime API, production configuration or application
  behavior was changed. No node_modules symlink or extra installation is needed.
- A starting ZIP and SHA-256 manifest preserve all 166 relevant working files.
  All 127 moved destinations exist. Assertion-call counts are unchanged across
  114 test/spec files. All 36 already-modified application files in that snapshot
  have identical hashes after consolidation, preserving the prior audit work.
- Explicit Node discovery excludes helper modules, frontend/browser suites and
  old report copies. The earlier 687 backend result included `helpers.js` as an
  empty discovered test; the relocated suite has 686 actual cases. The seven
  existing comparison cases in the old `client/test/` were outside Vitest's
  include pattern; the client test command now includes them after Vitest.

### Verification

| Check | Result | Evidence |
|---|---|---|
| Complete backend through the relocated runner | **686/686 actual tests passed**, 30 suites, zero failures/skips; final default run 29.25 seconds; serial run also passed in 188.19 seconds | `test/results/organization-server-final.log`, `test/results/organization-server.log` |
| Existing client command with forwarded single-worker flags | **527/527 Vitest tests passed** in 39 files; 118.44 seconds; then **7/7 Node comparison cases passed** | `test/results/organization-client.log` |
| Complete relocated Chromium suite | **54/54 passed**, zero retries, failures or skipped scenarios; 6.3 minutes | `test/results/organization-e2e-final.log` |
| Production build | **Passed**, 5.81 seconds; same initial JS asset and size as before reorganization, 169.27 kB / 61.34 kB gzip | `test/results/organization-build.log` |
| Demo/root discovery | All **54 browser scenarios** and **four demo scenarios** still discovered; root option forwarding works | Discovery logs under `test/results/` |
| Scoped runner and benchmark | All 34 scoped file references resolve; four benchmark scenarios complete with zero Gale-Shapley blocking pairs | `test/results/organization-benchmark.json`, scoped discovery check |
| Preservation and repository checks | 127 moved destinations, 114 unchanged assertion counts, 36 unchanged prior application-file hashes; `git diff --check` clean; reports ignored | `test/results/organization-preservation.json`, final Git checks |

The initial relocated Vue run found an unsupported HTTP-style `import.meta.url`
for the CSS fixture in jsdom. The original cwd-relative fixture was restored;
all nine contrast assertions remain, and the client launcher fixes cwd explicitly.
The first relocated browser run passed 53/54; one chat layout check read its
three bounding boxes at different times while planner status loaded above it.
Its screenshot showed aligned controls. The check now captures all three boxes
in one browser frame, retaining every original width, height, two-pixel alignment,
overlap and overflow assertion. All four chat scenarios passed after this
measurement-only correction; the complete final browser result is recorded above.
Sandbox-only esbuild startup failures were rerun with authorized child-process
access. Neither issue required application changes or relaxed assertions.

No commits, staging, pushes, merges or deployment were performed. The working
branch remains `fix/encore-cross-workflow-readiness` at `4845e94`; earlier local
feature corrections remain alongside these file moves.
