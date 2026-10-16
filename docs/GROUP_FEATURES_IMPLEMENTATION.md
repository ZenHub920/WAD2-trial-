# Encore group discovery and connections — implementation report

Date: 16 October 2026 (Singapore).

## Repository and audit

Started on `main` at `21c9a1988b616254cbb910d907f44bb247a698ee`. Pulled `origin/main` with a fast-forward to `3481b67` before implementation. The first pull correctly refused to overwrite local edits. Local work was temporarily stashed, the pull completed, and `git stash apply` restored it without conflicts. The stash named `codex-preserve-local-before-encore-pull-2026-10-16` remains as a backup. No commit or push was made.

Pre-existing work preserved: edits in `client/src/api.js` and `client/src/views/ConcertView.vue`, and the untracked `FeedbackForm.vue` and `MatchProposalCard.vue`. The large ConcertView diff against GitHub includes those earlier edits; this implementation adds only contextual group navigation there.

Inspected schema/bootstrap/migrations, repository factory and row hydration, parties and seekers, compatibility constraints and directional scoring, preference construction, solver registry and Gale–Shapley, stability snapshots, matching orchestration/idempotency, operational proposals/declines/expiration, blocks, sessions/authorization, controllers/routes, API helpers, Vue routing/header/profile/concert/Kaki views, ticket and conversation boundaries, package scripts, tests, README and algorithm documentation. No AGENTS.md was found in the project.

Confirmed integration defects:

- Preview retrieved declined pairs without passing them to preference construction; live explanations also omitted them.
- `api.runMatch` discarded the batch key already supplied by the locally edited ConcertView.
- Some capacity queries counted time-expired proposals until a sweep ran.
- The schema's one-host/one-concert uniqueness constraint prevented multiple hosted groups.
- Existing API tests still expected the pre-proposal historical-result contract and did not send idempotency keys.

`enhancementRepository.js` is empty, but no current module imports or consumes it. The functioning proposal repository is registered directly. No dummy repository or unnecessary export was added.

## Feature A: Find a Group

`/groups?concertId=...` loads concerts, authenticated eligible groups, the current user's seeker request and persisted preferences. Users can create a request through the existing validated request endpoint or reopen a withdrawn request when it has no active proposal. Matched requests cannot be reopened. Enrollment does not insert or change Kaki participation.

Cards show public host names, concert/tour/date, seating, total and remaining places, spending, arrival, activities, host vibe, published notes, compatibility and preference status. Filters cover text, seating, minimum remaining capacity, spending, arrival, activities, vibe and preferred-only results. Sorting supports compatibility, capacity and host name. A separate saved list allows removal after a group fills, closes, becomes blocked, or becomes otherwise ineligible. Concert changes invalidate earlier response generations; mutations disable duplicate clicks and refresh authoritative state after success or failure.

Preferences use `(seeker_request_id, party_id)` uniqueness and foreign keys. All identities come from the session. New preferences require an open request, matching concert, available group, no block or prior decline, and the existing hard compatibility constraints. Saving a preference changes neither proposals nor capacity.

For feasible pairs, seeker ranking is **preferred first → compatibility descending → ID ascending**. Unpreferred feasible groups remain alternatives. Group rankings retain their independent directional compatibility scores and deterministic ties. Preview, execution and live explanations use the same persisted preferred pairs and decline exclusions. The existing Gale–Shapley solver, solver registry, rank maps and stability checks remain in place; historical re-verification uses each round's saved preference snapshot.

## Feature B: Connect Groups

`/groups/connect?concertId=...` loads all groups hosted by the session's account, supports concert and source-group selection, and provides a host-group form using the existing party creation endpoint. Groups can discover other hosts' groups at the same concert, including groups with all matching places reserved. Capacity is not a group-connection eligibility condition.

Hosts can send invitations, view incoming and outgoing pending invitations, accept/decline incoming invitations, and view accepted and declined connections. Discovery includes the invitation state for the selected pair. The inbox contains the account's invitations across all hosted groups.

The server verifies source ownership, same concert, distinct groups/hosts, availability and mutual block restrictions. Acceptance rechecks cancellation and blocks against current state. Only the receiving host may answer, and only a pending invitation may be answered. Declining remains possible after cancellation/blocking so recipients can resolve stale invitations. Declined invitations are final in this implementation.

Connections store canonical party ordering, require the initiator to be one of the two groups, and enforce a unique pair. Immediate transactions and conditional updates protect creation and response. Accepted connections are visible to both hosts. Invitation code never changes party capacity, seeker memberships, proposals, matching results or tickets, and never runs matching.

## Data flow and database integration

Feature A: **Vue → existing API client → session-authenticated Express routes → registered group repository → SQLite preferences → matching service → existing preference builder/Gale–Shapley → immutable round snapshot/results and operational proposals**.

Feature B: **Vue → existing API client → authenticated Express routes → source/recipient authorization → SQLite pending invitation → authorized recipient response → accepted/declined connection visible to both hosts**.

The two flows share the existing SQLite connection, users, concerts and hosted groups. Their state tables and lifecycles remain independent. Kaki mutual swipes and marketplace conversations are unchanged.

`migrateGroups` runs from both production bootstrap and test bootstrap, following the repository's existing repeatable migration convention. New tables are created on existing databases as well as new ones. Fresh parties allow multiple groups per host/concert. An older parties table is reconstructed transactionally only when its inline uniqueness restriction is detected: columns, rows, IDs, explicit indexes and triggers are preserved; foreign keys are checked before commit and their enforcement is restored afterward. This is an internal table upgrade, not deletion/recreation of the database file. No development database was opened or migrated during verification.

One shared SQL predicate defines a reservation: confirmed, or proposed with a future expiration. Discovery and matching use proposal-based capacity; saved preferences and historical match results do not reserve places. Expiration sweeps reopen requests/groups. Matching's existing immediate transaction contains current-capacity loading, solver verification, history and proposal writes; proposal insertion additionally checks capacity. A failed proposal write rolls the whole round back. Confirmed proposals and historical rounds survive later matching operations.

The frontend retains the existing sessionStorage key per concert across retries. `api.runMatch(concertId, batchKey)` now sends `Idempotency-Key`. The existing “Prepare new batch” action deliberately creates a new key.

## File-by-file changes

Paths below are relative to the repository root. CREATE means a new implementation file; MODIFY means a focused change to an existing file.

| Path | Action | Change and purpose | Consumers and regression protection |
| --- | --- | --- | --- |
| `server/src/db/groupMigrations.js` | CREATE | Repeatable preference/connection tables, indexes and multiple-group upgrade. | Database bootstrap; preserves IDs, dependent history and FK integrity; rollback tests. |
| `server/src/db/capacity.js` | CREATE | Shared time-aware active reservation SQL. | Existing repositories and proposal repository; avoids contradictory capacity definitions. |
| `server/src/db/groupDiscoveryRepository.js` | CREATE | Discovery, saved preferences, reopening, hosted groups, invitations and responses. | Group routes and matching; session ownership, feasibility, canonical uniqueness and immediate transactions. |
| `server/src/db/connection.js` | MODIFY | Run group migration for production and test databases. | App/tests; no second database connection. |
| `server/src/db/schema.sql` | MODIFY | Remove one-host/one-concert party uniqueness for fresh databases. | Party creation; existing databases upgraded by migration. |
| `server/src/db/repositories.js` | MODIFY | Register groups repository and share live capacity calculations, including hydrated party details. | Existing controllers, group repository and matching; existing repository names/contracts retained. |
| `server/src/db/proposalRepository.js` | MODIFY | Use shared reservation predicate and check capacity before proposal insertion. | Existing proposal lifecycle and matching transaction; prevents overbooking and rolls back failed rounds. |
| `server/src/matching/preferences.js` | MODIFY | Apply explicit preference priority to seeker candidates only. | All solvers and stability rank maps; hard gates, group scores and deterministic ties preserved. |
| `server/src/services/matchingService.js` | MODIFY | Pass declines/preferences consistently and process expiration before loading inputs. | Preview, official rounds and explanations; historical snapshots unchanged. |
| `server/src/controllers/concertController.js` | MODIFY | Process expiration before public concert/capacity reads. | Existing concert/listing APIs; elapsed proposals no longer hide available groups. |
| `server/src/controllers/matchController.js` | MODIFY | Expire proposals before returning current operational results. | Existing private result API; prevents expired assignments appearing active. |
| `server/src/routes/groupDiscovery.js` | CREATE | Authenticated group/preference/invitation endpoints and input validation. | Existing router/API client; session identity and repository status/error handling. |
| `server/src/routes/index.js` | MODIFY | Register new routes using existing auth middleware. | Express app; preserves all existing route declarations. |
| `server/test/groupDiscovery.test.js` | CREATE | 20 real SQLite/session/Express tests plus pure ranking/filter assertions. | Test runner; covers migrations, authorization, concurrency, lifecycle and state isolation. |
| `server/test/api.test.js` | MODIFY | Supply matching keys and update stale expectations/fixtures for operational proposals. | Existing regression suite; retains privacy/history coverage and explicitly checks confirmed matches survive later rounds. |
| `client/src/api.js` | MODIFY | Add group methods/host creation and forward supplied matching key. | New views and existing ConcertView; preserves pre-existing local edits and all prior methods. |
| `client/src/groupFilters.js` | CREATE | Shared pure filters and sorting. | Both discovery views and Node tests; consistent filter behavior without mutating input arrays. |
| `client/src/components/GroupFilters.vue` | CREATE | Responsive labeled filters. | Both new views; common enum labels and meaningful controls. |
| `client/src/components/GroupListingCard.vue` | CREATE | Public group details and action slot. | Both new views; no emails, messages or ticket details. |
| `client/src/assets/groups.css` | CREATE | Responsive group layouts using existing tokens. | New views/cards/filters; no new visual framework. |
| `client/src/views/GroupExplorerView.vue` | CREATE | Concert selection, enrollment, discovery and saved preferences. | `/groups`; loading/error/empty states, generation checks and stale-state refreshes. |
| `client/src/views/GroupConnectionsView.vue` | CREATE | Hosting, source selection, candidates, invitation inbox and connections. | `/groups/connect`; multiple-group support, recipient actions and authoritative refreshes. |
| `client/src/main.js` | MODIFY | Register both authenticated routes before the catch-all. | Vue Router; all existing routes remain. |
| `client/src/components/SiteHeader.vue` | MODIFY | Three experience labels and group links; earlier mobile collapse with scrollable navigation. | Global navigation; retains account/operator/market/chat links. |
| `client/src/views/ConcertView.vue` | MODIFY | Add contextual Kaki/group/connection links carrying the concert ID. | Concert journey; prior local proposal/idempotency work preserved. |
| `client/src/views/ProfileView.vue` | MODIFY | Add preference and invitation/connection entry points. | Profile journey; preference editing unchanged. |
| `docs/GROUP_FEATURES_IMPLEMENTATION.md` | CREATE | This audit, architecture, change log, verification record, commands and acceptance checklist. | Maintainers and reviewers; separates executed checks from unverified browser behavior. |

The pre-existing untracked `FeedbackForm.vue` and `MatchProposalCard.vue` were restored and preserved, not created by this implementation. No package/lockfile changes or new dependencies were needed. Dependency caches, archived baseline source and execution logs are under ignored `server/node_modules/.encore-verification/`.

## Executed testing

| Check | Command/context | Result |
| --- | --- | --- |
| Initial baseline | `npm.cmd test` before installation | 90 passed; 9 test-file failures due to missing dependencies. Frontend lacked Vite. Bare `npm` also hit the local PowerShell script policy. |
| Untouched GitHub baseline | Archived `3481b67`, executed its `*.test.js` files with installed dependencies | 160 tests: 148 passed, 12 failed, 0 skipped. Failures were stale API expectations, reproduced independently of new code. |
| Existing API regression suite after updates | `node --test test/api.test.js` | 22 passed, 0 failed, 0 skipped. |
| New feature tests | `node --test test/groupDiscovery.test.js` | 20 passed, 0 failed, 0 skipped. Included real authenticated HTTP requests, SQLite persistence, logout/login, concurrency, matching rollback and migrations. |
| Full final suite | `npm.cmd test` in `server` | 181 passed, 0 failed, 0 skipped. Includes existing Kaki/chat/realtime, auth/sessions, profile/participation, matching/solvers/stability, market/tickets and Ticketmaster tests. |
| JavaScript syntax | `node --check` across 17 changed/new JS files | All passed. Vue compilation checked by Vite. |
| Production frontend | `npm.cmd run build` in `client` | Passed; 143 modules transformed. |
| Patch hygiene | `git diff --check` | Passed. |

The full Node discovery count includes the existing helper module; the explicit archived baseline `*.test.js` run does not. There are 20 new feature tests. Existing negative-path ticket tests intentionally log a simulated SQLite trigger error while passing rollback assertions.

Migration coverage includes fresh initialization, upgrading a legacy parties table with existing historical results and a confirmed proposal, repeated execution, preference persistence and uniqueness, indexes, FK enforcement, and rollback/restored FK settings on an invalid legacy relationship. All database tests use isolated in-memory databases; the user's development SQLite file was not deleted, recreated or used for destructive testing.

The normal install initially failed because Node did not trust the environment's certificate chain. Retrying with `NODE_USE_SYSTEM_CA=1` succeeded, without disabling TLS verification. Vite's esbuild configuration resolution needed an approved run outside the filesystem sandbox. These are local environment constraints, not application code changes.

## Exact Windows PowerShell commands

Use `npm.cmd` to avoid the machine's `npm.ps1` execution-policy restriction.

```powershell
Set-Location 'C:\Users\aungb\Documents\WAD2\wad2 project\WAD2-trial-'
# Required in the environment used for verification; keeps TLS verification enabled.
$env:NODE_USE_SYSTEM_CA = '1'
Push-Location server
npm.cmd ci
Pop-Location
Push-Location client
npm.cmd ci
Pop-Location
```

Database migration verification uses temporary test databases:

```powershell
Set-Location 'C:\Users\aungb\Documents\WAD2\wad2 project\WAD2-trial-\server'
node --test --test-name-pattern='migration' test/groupDiscovery.test.js
```

There is no standalone migration npm script. Normal backend startup applies repeatable migrations to the configured database. It does not seed or replace it:

```powershell
Set-Location 'C:\Users\aungb\Documents\WAD2\wad2 project\WAD2-trial-\server'
npm.cmd run dev
# Or: npm.cmd start
```

In another terminal:

```powershell
Set-Location 'C:\Users\aungb\Documents\WAD2\wad2 project\WAD2-trial-\client'
npm.cmd run dev
# Open http://localhost:5173
```

Tests and build:

```powershell
Set-Location 'C:\Users\aungb\Documents\WAD2\wad2 project\WAD2-trial-\server'
# Algorithms, compatibility, registry and stability
node --test test/compatibility.test.js test/galeShapley.test.js test/registry.test.js test/stableRoommates.test.js
# Group repository, migrations, lifecycle, filters and real session/API integration
node --test test/groupDiscovery.test.js
# Existing API regression suite and new group API coverage
node --test test/api.test.js test/groupDiscovery.test.js
# Full backend suite
npm.cmd test
Set-Location ..\client
npm.cmd run build
```

The project does not have separate `test:repository` or `test:api` npm scripts. The commands above use its actual Node test files. For local manual testing only, an existing account can be granted operator access with the existing script:

```powershell
Set-Location 'C:\Users\aungb\Documents\WAD2\wad2 project\WAD2-trial-\server'
npm.cmd run operator:grant -- operator@example.com
```

Replace the example with an existing local account email; no operator account was granted during implementation.

## Manual browser acceptance checklist — not yet executed

1. Start backend/frontend with the commands above. Register or sign in as host A, host B, and a seeker in separate browser profiles. Expected: sessions are independent; profile/onboarding flows remain available.
2. Open a concert and follow Find a Group. Expected: `/groups?concertId=...` retains the selected concert. Signed-out visitors are directed to sign-in and returned to the page.
3. As host A, open Connect Groups, expand “Host a new group,” choose that concert and publish a group with seating, budget, arrival, activities and notes. Repeat as host B. Expected: hosted-group selectors and candidate cards show the created groups.
4. As the seeker, open Find a Group and create a request. Expected: valid fields are required, status becomes open, compatibility is shown, and Kaki participation is unchanged.
5. Search by host/artist and exercise seating, capacity, spending, arrival, activity and vibe filters and each sort. Expected: displayed groups match the selected controls, with a clear empty state when none qualify.
6. Prefer one or more groups. Expected: button changes to Remove Preference and saved list updates; available capacity does not change. Refresh, navigate away/back, and log out/in. Expected: preferences persist.
7. Switch concerts quickly. Expected: only the latest concert's groups/request/preferences appear. Try repeated clicks while saving. Expected: one mutation at a time.
8. Use an existing operator account on the concert page to preview, then prepare a new batch and run a matching round. Expected: operator-only execution, stable results relative to the saved final lists, capacity-respecting proposals, and immutable round history. Retrying the same batch returns the original round; preparing a new batch starts a new logical operation.
9. As the seeker, review the proposal on the concert page, then confirm it. Expected: status is confirmed, capacity remains reserved, and a later round leaves the confirmation intact. Use another request/proposal to decline. Expected: request/space reopen and that exact declined group is excluded from later matching.
10. Fill a saved group or close it through an established workflow. Expected: it disappears from eligible results but its saved preference remains removable from the saved list. A stale Prefer action refreshes and reports the server error.
11. As host A, select one source group in Connect Groups and send an invitation to host B's group. Expected: pending outgoing entry for A and pending incoming entry for B; no immediate connection or capacity change.
12. Refresh/log in as host B and accept. Expected: only B can respond, both hosts see the accepted connection, repeat responses are rejected, and neither direction can create a duplicate invitation.
13. Use a different pair of groups to decline. Expected: declined history is visible and that pair cannot be reinvited. With multiple groups owned by A, select another source. Expected: invitation state belongs to that selected pair rather than the first group.
14. Between sending and accepting, block a host or cancel a group through an existing supported workflow. Expected: acceptance is rejected against current state. An unrelated account's connection list contains no entries for this pair.
15. Compare capacities, matching proposals, round history/results, and ticket ownership before/after sending/accepting/declining invitations. Expected: all stay unchanged by connection actions.
16. Check Find a Kaki mutual swipes/history/chat, ticket listings/purchase/seller conversations, profile changes, proposal confirmation/decline, and mobile navigation. Expected: existing experiences work; group pages reflow without horizontal overflow and navigation can scroll on short screens.

## Limitations and roadmap status

**Completed and automated checks passed:** both backend/frontend implementations, real session/API/SQLite flows, ranking/stability integration, persistence, capacity rules, invitation lifecycle, migrations, rollback/concurrency tests, all existing regression tests and production compilation.

**Implemented but not browser-verified:** interactive layouts, actual click/keyboard journeys, mobile rendering, rapid switching in a live browser and the full multi-account browser checklist above. No automated browser framework was present in the repository; no browser acceptance pass is claimed. Concurrency tests issue concurrent HTTP requests to the application; they are not a multi-process SQLite stress benchmark.

**Not implemented:** unrelated roadmap work, group mergers, group messaging, automatic invitations, reinvitations of declined pairs, or a new matching algorithm. Vibe is the existing host profile vector, not a new independent group-vibe model. Search remains local to the server-authorized selected concert.

The complete specifications and numbering for roadmap improvements #5–16 were not present in README/docs. Existing source demonstrates operational proposals/declines (#5/#6), historical explanation snapshots (#12), profile/onboarding schema additions (#11), and local ConcertView manual preview (#16); their related paths were preserved and tested where covered. Existing Kaki messaging, marketplace/tickets, safety and reliability infrastructure also exists, but its exact mapping to unspecified roadmap numbers cannot be established. The locally present feedback UI calls `/feedback`, which has no current registered backend route; that unrelated pre-existing gap was not represented as complete or silently replaced. No claim is made that the entire #5–16 roadmap is finished.

## Backend-focused remaining work

The owner of this work is responsible for backend features, with client changes limited to integration for those features. Browser automation, mobile/layout verification and general frontend work are team QA/frontend responsibilities, not missing backend features. The unexecuted browser checklist above remains a verification limitation rather than an implementation assignment.

Candidate backend enhancements, not yet implemented or committed to scope:

1. **Compatibility-ranked group connections:** score eligible group pairs and return ranked, paginated recommendations. Start with existing group plans/arrival/spending and host-profile vibe; do not call that an average of all members. Using confirmed-member aggregates would require an explicit membership and consent policy. Gale-Shapley is an assignment algorithm and is not needed to produce a top-N recommendation list.
2. **Notifications:** persist notifications for proposals, invitation responses and meetup updates; provide account-scoped list/unread/read APIs, duplicate-event protection and transactional event creation. Live delivery can build on the existing authenticated realtime infrastructure.
3. **Connection coordination:** for accepted connections, store structured meetup proposals (time, place, notes, proposing host and response status), authorize both hosts, and record revisions/acceptance. This can precede optional connection-specific messaging. Keep memberships, matching capacity and tickets independent.
4. **Feedback:** implement the missing backend for the existing feedback entry point. Define eligibility from genuine confirmed participation after the event, prevent duplicate/self feedback, validate ratings and authorize reads. Reuse the existing reliability infrastructure only after checking its actual schema and calculation rules. Group-connection feedback needs a separate attendance/eligibility policy before inclusion.

Request/group lifecycle controls are an audit item, not a confirmed missing implementation: inspect existing endpoints before deciding whether backend edit/withdraw/cancel operations are needed. Preserve defined transitions, release reservations atomically where appropriate, and retain history.

The unspecified roadmap #5-16, group mergers, automatic invitations, declined-pair reinvitation and a new matching algorithm are not part of this remaining backend feature list. Their absence does not make the delivered search/invitation features incomplete. Browser automation and UI polishing have also been removed from the owner's remaining feature list.
