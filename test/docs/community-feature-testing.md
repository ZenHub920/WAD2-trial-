# Scoped refactoring and feature testing

Current locations and commands: see [the test guide](../README.md). The dated results below are retained as historical evidence; test code and reports have moved under root `test/`.

## Navigation and group workspaces — 3 November 2026

Concert browsing now distinguishes concert details, official purchases and fan inventory, with removable search/date cues and short list transitions. Group workspaces prioritise chat/planning and show clearer request/invitation states. Secondary host settings remain mounted inside native disclosures, reopen on invalid saves and clear only the local validation message after correction. Existing preference fields, routes, pricing, matching, approvals and backend sources are unchanged.

New regression files are `test/client/confirmation-dialog.test.js`, `navigation-disclosure.test.js` and `group-membership-workspace.test.js`. Their nine cases cover modal focus containment/restoration and busy guards; arrow/Home/End tab navigation; preserved filter values and inert hidden controls; menu focus after Escape/resize; and group validation feedback without clearing API errors. Additional browser previews exercise normal-motion concert filtering, mobile labels, host disclosures, public member links and actual confirmation focus. The group-name label remains stable while its error is supplied separately to assistive technology.

Verification passed **173 Vue tests, all 20 checked-in Chromium workflows and three local visual/interaction previews**, plus the production build. The group preview initially caught the changing accessible name after a validation error; the field label/error association was fixed and that workflow reran successfully. The six affected dialog/group component cases and production build also passed again after the final accessibility fixes. The existing bundle-size warning remains. The preview uses synthetic accounts and controlled external discovery data; no live purchase, real provider credential or production data is involved. Backend sources were unchanged in this UI pass.

## UI, public profiles and private preferences — 2 November 2026

The planner now uses compact half-hour cells and three mounted steps: time, places and review. Optional journeys, weather and parking are disclosed when needed; switching steps preserves drafts and pauses hidden transport polling. A visible **Plan meetup** action beneath each pair, group and connected-group chat header opens the corresponding planner; existing group dashboard actions remain. Public `/people/:id` profiles show public identity details and the existing six self-rated concert interests, never questionnaire answers. Mutual blocks and suspended accounts produce the same unavailable response.

Registration offers a skippable private questionnaire setup in Profile. Existing users edit the same questionnaire there; its fields, options and server question deck are unchanged. Other members cannot read raw answers or dealbreakers. Group concept preferences use equal member votes divided by all active members, with top-three strict-majority labels and answer coverage. Existing quiz scoring is retained: numeric traits average answered dimensions, and categorical traits use the existing plurality and tie rules. Direct discovery, automatic rounds and group connections share this aggregate; individual hard vetoes remain effective.

New regression checks cover public-field allowlists, blocks, private application snapshots, cross-path whole-group ranking, unchanged signup/questionnaire payloads, saved questionnaire progress, compact-grid details, step/draft persistence and hidden transport refresh. The real-browser suite now also demonstrates Kaki mutual likes and registration through private setup.

### Reproducible multi-user demo

From `client`, run `pnpm.cmd demo:matching` after installing dependencies and Chromium as below. To watch the browsers, use `pnpm.cmd exec playwright test --config ../test/config/playwright.demo.config.mjs --headed`. This records four asserted workflows: Kaki mutual likes, direct seeker joining, an automatic round with both approvals, and connected groups opening their shared room.

Each actor has an isolated browser context and synthetic session, so switching roles never overwrites another actor's login. Clips are stored by actor under ignored `test/results/matching-demo`; the report is under `test/results/playwright-report/matching-demo`. These are raw actor clips for an edited, narrated presentation, not a single polished film. Label roles when combining clips and show the request, receiving decision and persisted outcome in each chapter.

The standalone harness seeds an in-memory database and triggers a real matching round through a local-only test endpoint. It never loads production credentials or real accounts. Provider responses are controlled fixtures; these recordings do not demonstrate live third-party API or OS notification delivery. Never deploy the test harness or use it as production account setup.

Current verification: **382 backend tests, 164 Vue tests and 13 checked-in Chromium workflows passed**, plus a separate real-browser multi-day painting/visual-preview check and the production build. The teammate's newly pulled profile tests are included. Its slider locator now explicitly selects the slider, because the new accessible chart also describes Singalong. Save/reload assertions remain intact. The build retains the existing non-fatal bundle-size warning.

The four recording workflows also passed with normal motion enabled and produced ten non-empty actor clips. Light/dark planner and public-profile captures were reviewed. A configured-private-value scan found no matches in pending files, build output or reachable history. These checks remain bounded to the data and environments described below.

A subsequent presentation pass strengthens discovery context, expands optional Kaki section/age filters on demand, distinguishes public profile controls from private matching answers, and clarifies inbox/unread actions. Native sliders and buttons have pressed/focused feedback; non-home entrances are shorter and accent rules are reserved for section anchors. Home opening transitions, questionnaire wording/fields, API calls, ranking and approvals are unchanged. Existing browser workflows were rerun, including notification read/open actions after preserving the panel's stable accessible name. Fresh synthetic-account snippets cover the chat entry, planner steps/grid, public profile, private questionnaire, inbox and discovery, with a 390-pixel filter layout checked for overflow. Reduced-motion mode disables the added movement and press scaling.

The results below retain the earlier 30 October baseline.

## Scope and result

Work dated **30 October 2026** covers seeker-to-group joining (direct and automatic), group connections, chats, meeting planning and notifications. Other feature suites were excluded. Login sessions are test setup, not an account-feature test campaign.

GitHub changes were pulled first: the working branch fast-forwarded to **233dc58** without conflicts. Hash checks confirmed that all 28 pre-existing local paths survived the pull intact. Incoming frontend source changes were retained. Integration was prepared on `refactor/backend-repository-modules`; the earlier `ded71ac` refactoring commit is already an ancestor of this base, so its work was retained.

| Level | Tool / environment | Result |
| --- | --- | --- |
| Backend unit and integration | Existing Node test runner; disposable SQLite; real HTTP where applicable | **367 passed** |
| Vue component and parent-child integration | Vitest + Vue Test Utils + jsdom | **37 passed** |
| Browser end-to-end | Playwright + Chromium + real Vue, Express and SQLite | **8 passed** |
| Build and compatibility | Production Vite build; repository export/interface check | Passed |

The earlier refactor-only run passed 345 backend, 18 Vue and six browser cases. Its initial backend failure did not recur and remains unexplained. The expanded heatmap/live-planner run adds five backend cases, ten Vue cases and one browser workflow. The runner preserves full logs under ignored `test/results/server/community/` (archived; new scoped runs use `test/results/community/`). The frontend build retains a non-fatal bundle-size warning.

The subsequent nearby-transport update adds provider/orchestration cases, component tests and one browser workflow. It verifies meeting-place versus concert-venue anchors, bounded nearby lookups, exact/ambiguous geocoding, relevant line-cluster filtering, station-only crowd reports, no bus ETA/private-origin leakage, partial outages, access/version checks and visible-panel refresh cleanup. A regression case ensures that fresh metadata for the same venue does not reset the post-concert panel during live refresh. Vitest and backend file batches use at most two workers to keep development-machine resource use bounded.

An initial concurrent publication run exceeded its batch timeout and exposed a short worker-startup timing assumption. The runner's batch allowance was expanded, checks were separated, and the wake-up test now explicitly finishes initial setup before waiting for observable delivery. Its delivery assertion still precedes the sixty-second idle reconciliation interval. The complete backend rerun passed all 367 cases; production worker logic was not changed to satisfy the test.

Final publication verification passed **367 backend tests, 37 Vue tests and all eight Chromium workflows**, plus the production build, fourteen-export/twenty-two-repository compatibility check and local documentation-link check. Earlier browser attempts reached the sixty-second workflow limit during machine slowdown. The final run passed sequentially with a three-minute workflow allowance, now the configuration default; individual actions still allow twenty seconds and assertions ten seconds, with no retries. Its eight workflows completed in five minutes. The configured-private-value scan also passed for pending source, build output and reachable history.

## How the lecture approach was applied

The supplied Week 10a slides informed representative, invalid and boundary inputs and regression checks. Week 10b informed component interactions, observable output/emitted events and tests using real parent-child components. Week 10c informed browser workflows, accessible locators, automatic waiting and assertions on persisted results. Lecture exercises were treated as teaching examples, not instructions to modify the application.

Tool references: [Vitest guide](https://vitest.dev/guide/), [Vue Test Utils guide](https://test-utils.vuejs.org/guide/), [Playwright test servers](https://playwright.dev/docs/test-webserver).

Tests check public behaviour rather than private Vue state or exact CSS. Existing backend unit tests cover the algorithm and rules; new Vue tests use Vitest. Real child components are retained in the comparison deck and planner search integration tests. API, push and realtime boundaries are mocked for isolated component tests; browser tests use the real application API.

## What is tested

| Feature | Important checks |
| --- | --- |
| Direct group search | Instructions precede comparison; preferring a card sends no application; an explicit join request creates one pending application and holds a place; only host approval creates membership. Existing backend tests also exercise the one-application limit, eligibility, withdrawal and shared FIFO queue. Failed saves keep the card available. |
| Automatic group matching | Selecting automatic mode joins matching; an actual Gale–Shapley round creates an offer. Seeker approval alone creates no membership; host approval confirms the same proposed group. Queue priority, capacity, expiry, repeated rounds and saved explanations are covered by backend cases. Waiting/stale offers show the correct controls/errors. |
| Group connections | A host sends an invitation and the receiving host accepts. Both groups and their friends gain the shared room; an outsider cannot open it. Existing tests check membership changes, invitation eligibility and connection-scoped planner access. |
| Chats | Cross-user messages, replies, edits and deletion persist. Deleted content becomes a tombstone; failed sends retain drafts. Existing suites cover Kaki, single-group, connected-group and marketplace chats, pagination/catch-up, live events, read receipts, access boundaries, message limits and validation order. |
| Meeting planner | A user creates a connection-scoped plan, saves car availability and approximate origin, adds a place, compares travel and proposes a time/place. One host's approval leaves it pending; both hosts confirm it, including after reload. Vue tests exercise both car/transit modes and real child OneMap selection. Backend tests cover private origins, stale revisions, discussion, ranking, route estimates, weather, parking/crowding adapters, caching and provider failures. |
| Notifications | Real chat events enter the inbox. Reading a chat alert removes it and a later message can create a new one; its link opens the correct room. Vue tests cover category preferences, permission denial, no permission prompt on mount, badges and group-alert read state. Backend tests cover subscriptions, recipient scoping, worker retries, duplicate prevention, expired devices, muted/read alerts, meetup/weather reminders and service-worker click handling. |
| Heatmap and live planning | Real browser dragging paints three cells, starting on a selected cell erases, saved counts update another member without reload, and their unsaved selection/discussion remain. Reload verifies persistence. Component cases cover touch cancellation, skipped-cell interpolation, keyboard controls, disabled/outside-grid interaction, same-version events and stale saves. Backend cases verify minimal authorized SSE payloads, failed-write silence, scoped lists, stale-save rollback and full seven-day coverage. |

Browser chat checks prove cross-user persistence; the existing backend tests exercise chat SSE events. The new planner browser workflow additionally checks live SSE updates across two sessions and actual mouse drag painting. Matching-card physical swipe gestures remain outside the browser test scope. A narrow viewport/keyboard check and component touch-event cases are included; this is not a physical-device campaign.

## Test data and external services

The browser harness lives in `test/support/e2e-server.mjs` and is never imported by the production server. It starts an **in-memory database**, creates synthetic users/sessions/groups, binds only to `127.0.0.1:3105` and uses temporary image directories. Vite uses port **5175** and proxies real application requests to that server. Real user data and `.env` credentials are not loaded. The standalone harness has fixture/round setup endpoints; production routes have no such endpoints.

The browser harness supplies controlled OneMap venue/nearby-stop and LTA crowd/advisory/bus responses at the server's provider boundary, using synthetic credentials. Route responses remain unavailable to exercise the planner's labelled distance fallback. Backend adapter tests inject successful and failed OneMap, LTA and NEA responses to check their contracts without calling live services. Optional remote fonts/images are blocked during browser tests; local application API requests are not intercepted.

Browser contexts deliberately use a UTC device timezone. The planner still displays Singapore slots, and creating a 16:00 Singapore board is checked against its persisted 08:00 UTC timestamp. Desktop/narrow-viewport heatmap screenshots are saved under ignored Playwright results for visual review.

Push transports and browser-push interfaces are controlled test doubles. Worker/service-worker results do **not** establish that a real browser subscription receives an OS popup. That last check still requires a real device, configured VAPID keys, explicit permission and enabled OS notifications. Live provider availability and real-world route accuracy were not tested by this suite.

A separate bounded live smoke check on 30 October confirmed OneMap exact venue lookup and both nearby-stop endpoints, plus LTA advisory, crowd and bus-load responses. It printed only statuses/counts and did not expose credentials. This confirms that configuration worked at that moment, not future provider availability or forecast accuracy. A local scan compared configured private values against pending files, the frontend build and reachable Git history and found no matches; it is not a universal guarantee against every possible secret format.

## Run the same checks

Use the installed Node version compatible with the test tools (this run used **24.12.0**). No public API credentials are required. Keep ports 3105 and 5175 free; normal development ports are unaffected.

From `server`:

```powershell
npm.cmd ci
npm.cmd run test:community
# Inspect the exact file batches/name filters:
node ../test/scripts/scoped-feature-tests.mjs --list
```

From `client`:

```powershell
pnpm.cmd install --frozen-lockfile
pnpm.cmd test
pnpm.cmd exec playwright install chromium
pnpm.cmd test:e2e
pnpm.cmd build
```

Playwright starts/stops its test servers automatically. Failure screenshots/traces and its HTML report are ignored by Git. Use `pnpm.cmd test:e2e:report` to view the browser report. Both existing client lockfiles are updated; avoid mixing npm/pnpm installations in the same `node_modules` directory.

## Refactoring baseline before the heatmap update

This latest pass removes **172 physical backend-source lines**: 142 repetitive comment lines in the matching service, plus 30 lines from unused Kaki readers/queries and duplicate proposal snapshot parsing. No new production source files were added in this pass. The parser confirmed the matching service's **2,373 executable tokens** are unchanged.

Across the refactor snapshot, `server/src` JavaScript changes from **14,929 to 14,267 lines: 662 fewer (4.4%)**. Earlier repository extraction changes file count from 94 to 105 and reduces `repositories.js` from 1,618 to 69 lines. Extraction is organisation; implementations still exist in the feature modules. These figures exclude tests, lockfiles and documentation, which intentionally grew to support regression checking.

The earlier cleanup intended no feature/business-rule changes. Its removed internal reader methods had no callers; active pagination/unread paths remain. The subsequent, separately requested heatmap work changes planner UI/live behaviour and adds optional scope/version inputs, while retaining approval, matching and travel-ranking rules. It requires no new runtime dependency or database migration. The compatibility check retains all 14 named exports and 22 repository properties, with only the deliberately removed unused readers excluded. Passing tests provide regression evidence, not proof of every possible execution.
