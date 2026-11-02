# Meetup planner implementation and verification

Implementation review branch: `feature/meetup-planner-ux-guardrails`. No commits, pushes or merges were made during that review. The working tree was clean before that task. GitHub references were fetched; the starting UI branch already contained all current `origin/main` changes. The user subsequently authorized publishing this work together with the UX audit to `main`; the original verification history below is retained.

## What changed

- Creation shows the authorized scope's concert, date and venue. Both client and server validate real dates, future times, half-hour alignment, ordering and the existing 30-minute–7-day duration limit.
- New boards use the concert day or preceding travel day. When the performance start is verified, the window must end strictly before it. Otherwise, the interface explicitly asks users to verify the performance time. Unverified doors times are not treated as performance times. Singapore input conversion is explicit; concert bounds respect a valid event timezone. Old records remain readable.
- **Your journey to the meetup** has one apply action for public transport/car and an optional starting place. Empty inputs preserve existing origins. Coordinates and individual-period overrides remain under advanced controls. Apply changes a private draft; save persists it. Both actions have nearby, distinct feedback.
- OneMap search visibly reports loading, results, selection, unavailable service and empty results. Selecting an address does not claim it is saved. Manual entry remains available. Results and inputs support keyboard navigation and mobile layouts.
- **Suggested meeting places** comes from persisted `board.places` and appears without availability. Recommendations remain separate and require saved availability. Duplicate place retries are idempotent; failed submissions preserve inputs.
- Recommendation copy is shorter, with optional explanations and attendance/journey/distance labels. Ranking, incomplete-route fairness, deterministic tie-breakers and provider request budgets are preserved.
- Transport keeps pre-meetup and post-concert checks, venue confirmation, MRT advisories, station crowds and bus loads. Its longer freshness/coverage explanation is collapsed. Missing credentials or locations produce honest unavailable states.
- **Group discussion & change requests** shows authors, timestamps and submission feedback. Discussion never counts as approval or changes the selected plan.

## Permissions and lifecycle

| Scope | Organizers / required approvers | Other participants |
|---|---|---|
| Hosted group | Current group host | Contribute their availability, places, votes and discussion |
| Connected groups | Both current group hosts | Same contribution rights across both groups |
| Mutual Kaki pair | Both participants | Equal organizer rights |

Membership and organizer identity are checked server-side. An old creator flag or user-supplied organizer flag cannot grant authority. Outsiders, departed members and blocked scopes retain the existing access restrictions. Only the caller's private origins appear in their board response; ranking uses origins internally.

1. **Planning:** contributions are open; organizers may propose a final time and place.
2. **Proposed:** contributions are locked while required organizers approve. The proposal is stable.
3. **Confirmed:** the selected arrangement stays stable; participants may discuss changes.
4. **Reopen planning:** an organizer confirms an explicit action. One transaction advances the version, clears the selection and notifies participants. Availability, places, votes, discussion and historical approvals remain stored. A new proposal needs fresh approvals.
5. **Cancelled:** read-only; reopening is prohibited.

Exact unchanged retries do not reset a plan or increment its version. Stale-version checks remain. Proposal and approval also recheck the selected time, including a concert that has been rescheduled since creation.

## API and database compatibility

New endpoints, relative to `/api`:

- `GET /meetup-context?partyId=…` (or one `connectionId` / `kakiConversationId`): authorized concert, date policy, participant count and capabilities for creation.
- `POST /meetups/:id/reopen` with `{version}`: organizer-only explicit reopening.

Existing detail responses additionally include date policy, capabilities, expanded concert time context and the caller's current vote. Existing place and vote endpoints accept an optional version; the frontend supplies it. Existing paths and response envelopes remain compatible. The requested organizer/date/lifecycle restrictions intentionally tighten previously permissive behavior.

No schema migration, dependency or timestamp-storage change was needed. Concert creation now preserves supplied optional `event_time` and `event_timezone` using existing columns.

## Meetup Planner Refactoring Summary

The revised flow is:

**Presentation components → `useMeetupBoard` state/actions → existing API client → authorized routes → pure policy/validation/ranking helpers → repository SQL transactions → existing external integrations.**

- Creation and discussion presentation were extracted from the page. The heatmap, search and transport components remain in use.
- `useMeetupBoard` owns scoped loading, live invalidation, draft preservation, action feedback, version conflicts and stale-result protection. Weather, parking and travel reads share one guarded asynchronous helper.
- Shared calendar parsing supplies both frontend and backend validation. Frontend display formatting and error messages each have one module.
- Nine meetup navigation buttons across six views share one scope-aware route builder, with no extra per-card API calls.
- Backend policy and payload normalization are independently testable. SQL, notifications and transaction boundaries remain in the repository.
- Both rankers reuse one comparator; the travel-aware caller still requires a sufficiently complete route matrix before using journey times.

`MeetupView.vue` decreased from **957 to 567 lines**. Much of that code moved to focused modules; it was not deleted functionality. Overall code increases because validation, permissions and regression coverage were added. The simplification removes duplicated rules, formatting, route construction and asynchronous guards.

Availability indexing and broader provider consolidation were deliberately deferred: there was no demonstrated need to risk changing ranking or provider behavior. A synthetic historical seven-day case with 4,032 availability rows and 50 places measured 39.26 ms median over ten ranking runs. This is a current measurement, not a before/after performance improvement. Further presentation extraction can follow if new features make the remaining page harder to maintain.

## Verification

- Server: `npm.cmd --prefix server test -- --test-concurrency=1` — **614 passed**. A final focused helper/guardrail follow-up passed **27/27**.
- Client: run `npm.cmd test` in `client` — **240 tests across 21 files passed**.
- Production: run `npm.cmd run build` in `client` — passed; the existing large-bundle warning remains.
- Browser: all **21 Chromium workflows** verified. The initial full baseline passed 21/21. After refactoring, 20 passed in a full run; the final acceptance test was corrected to await its asynchronous proposal save and then passed on focused rerun, including a 390px no-overflow check. No application behavior was changed to address that test race.

After the final mobile badge/help-text adjustment, the affected planner/search tests passed **49/49**, the focused multi-account browser acceptance passed again, and the production build passed again.

Coverage includes date/time boundaries and bypassed frontend validation; host/member/pair/connected-group permissions; preserved historical approvals; locked proposed/confirmed plans; atomic reopen rollback; stale versions; private origins; one-person and shared recommendations; routing fallback/fairness; search failure; preserved form and availability drafts; duplicate submissions; real pointer dragging; multi-account persistence and discussion. Existing matching, chat, profile and marketplace regressions also ran.

The initial unrestricted server run encountered HTTP connection resets under concurrent local test load. Two older HTTP tests also expected ordinary members to create/propose boards; those were updated to exercise the requested host permissions. The final complete sequential run passed. No failing assertions were removed to hide a regression.

Browser screenshots use synthetic accounts and controlled provider responses against the real local app/API and SQLite test database. They do not certify current live OneMap/LTA conditions or an OS push popup. Existing server credentials and provider availability still determine live data access.

Seven screenshot files are preserved outside the repository under the Codex visualization directory `meetup-planner-guardrails`. Screenshots were shown before cleanup. Both root `.agent-local` and `client/.agent-local` have now been deleted. The three clean temporary Git worktrees were unregistered; their branches were retained. Current client/server dependencies and all checked-in tests remain intact.

Cleanup exposed stale transitive dependency links into the old backup. The client installation was repaired using `pnpm --dir client install --frozen-lockfile --offline --force`, with no downloads or manifest/lockfile changes. After cleanup and repair, all **240 client tests**, the production build and the cold-start host/member browser acceptance passed again.

## Manual check

Start the server and client with their normal development commands. Use separate browser profiles for a host and a current group member, with a future concert:

1. Press **Plan meetup** from that group's chat or dashboard. The host creates a valid concert-related window; the member can open the same board.
2. Add a searched or manually entered public place before saving availability. It should immediately appear under Suggested meeting places.
3. Paint half-hour availability, apply a car/transit journey, observe the unsaved notice, then save. Reload and confirm persistence; the other account should receive live saved counts.
4. Compare options and vote. Only an organizer can propose. Approve with the required organizer(s).
5. Confirm ordinary contributions are disabled after proposal/confirmation while discussion remains usable.
6. Request a change in discussion. The organizer explicitly reopens planning, then proposes again and obtains fresh approvals.
7. Use Review to check weather, parking and scoped pre/post transport; test unavailable states if credentials are absent.

## Files changed

The following list includes source, tests and this report; temporary folders are excluded because they are ignored by Git.

- `client/e2e/community-features.spec.js`
- `client/src/api.js`
- `client/src/components/MeetupAvailabilityGrid.vue`
- `client/src/components/MeetupCreationForm.vue`
- `client/src/components/MeetupDiscussionPanel.vue`
- `client/src/components/MeetupLocationSearch.vue`
- `client/src/components/MeetupTransportPanel.vue`
- `client/src/composables/useMeetupBoard.js`
- `client/src/utils/meetupFeedback.js`
- `client/src/utils/meetupNavigation.js`
- `client/src/utils/meetupTime.js`
- `client/src/views/ConnectionChannelView.vue`
- `client/src/views/GroupChannelView.vue`
- `client/src/views/GroupConnectionsView.vue`
- `client/src/views/GroupExplorerView.vue`
- `client/src/views/GroupMembershipView.vue`
- `client/src/views/KakiChatView.vue`
- `client/src/views/MeetupView.vue`
- `client/tests/meetup-form-panels.test.js`
- `client/tests/meetup-location-search.test.js`
- `client/tests/meetup-navigation.test.js`
- `client/tests/meetup-planner.test.js`
- `client/tests/meetup-time.test.js`
- `client/tests/nearby-transport.test.js`
- `docs/MEETUP_PLANNER_GUARDRAILS.md`
- `server/src/db/concertRepository.js`
- `server/src/db/meetupRepository.js`
- `server/src/routes/community.js`
- `server/src/services/meetupIntegrations.js`
- `server/src/services/meetupPlanning.js`
- `server/src/services/meetupPolicy.js`
- `server/src/services/meetupValidation.js`
- `server/test/community.test.js`
- `server/test/communityApi.test.js`
- `server/test/connectionChannel.test.js`
- `server/test/meetupCarPlanning.test.js`
- `server/test/meetupDomain.test.js`
- `server/test/meetupGuardrails.test.js`
- `server/test/meetupRealtime.test.js`
- `server/test/meetupTransport.test.js`
- `shared/meetupDates.mjs`
