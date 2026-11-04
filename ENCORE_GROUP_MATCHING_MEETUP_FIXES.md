# Group matching and meetup reliability review

Developed on `fix/encore-groups-matching-meetup-ux`, preserving the previous batch's uncommitted work. The user subsequently authorised committing and pushing the combined changes to `main`, excluding dummy databases and seed material. The latest upstream baseline was fetched before work and checked again before publication; teammate changes remain ancestors of this work.

## Scope and consent

This pass addresses the comprehensive behavioural brief and the subsequent requests to find additional verified bugs and make similar-looking controls easier to understand. The shared questionnaire fields, matching scores, Gale–Shapley allocation, one-request limit, queue order, capacity, approval rules and safety checks remain in place. Teammate work is retained. Private configuration, local/demo databases and seeds are excluded.

The important consent change is that **viewing a pathway is separate from joining it**. Find a group opens discovery. Browse and choose and Automatic matching change the visible workspace only. Joining automatic matching or switching the active method requires an explicit confirmation. Only Find a match starts a matching round. Each automatic offer still requires seeker and host approval.

## Twenty finding groups

The brief describes overlapping issues across several numbered sections. The table groups them into twenty traceable findings; section references retain coverage of the complete brief. Statuses below reflect the implemented code and executed verification; the complete run record explains overlapping tests and targeted reruns.

| # / brief | Original issue and root cause | Implementation / principal files | Verification | Status |
|---|---|---|---|---|
| 1 · 1.1, 1.5 | Navigation doubled as enrollment, obscuring consent. | Separate displayed mode from saved method; confirmed enrollment/switch; neutral Find a group navigation. `GroupExplorerView.vue`, `GroupNavigation.vue`. | Explorer, navigation and browser consent tests. | Fixed |
| 2 · 1.2 | A discovery empty list could conceal an offer, membership or request. | Current authoritative participation takes precedence; distinguish filters, eligibility, unavailability and failed reads without revealing hidden groups. `groupDiscoveryRepository.js`, Explorer. | Discovery and Explorer state regressions. | Fixed |
| 3 · 1.3 | Joining, prioritising and running matching appeared interchangeable. | Explicit next action, optional process explanation and concert-wide batch disclosure. No score or allocation change. Explorer. | Component and actual browser journeys. | Fixed |
| 4 · 1.4 | Refresh lost search results; a lost response risked another round. | Durable authenticated attempt receipts and scoped retry UUID; refresh uses reads, explicit recovery reuses the UUID. `matchingSearchMigrations.js`, `matchingService.js`, controller, Explorer. | Full backend/frontend suites and durable-attempt browser recovery checks passed. | Fixed |
| 5 · 1.6 | One failed read hid unrelated valid information. | Independently guarded reads and section-specific retries; preserve successful sections and reject late account/concert responses. Explorer. | Partial-failure and stale-response component tests. | Fixed |
| 6 · 2.1 | List and comparison requests used inconsistent review and cancellation. | Shared accessible review dialog; no request before confirmation; explicit cancellation and ambiguous-write recovery. `ConfirmDialog.vue`, Explorer, comparison deck. | Both layouts, keyboard, cancel, failed/recovered send tests. | Fixed |
| 7 · 2.2 | Saved priorities depended on the current results page for their name. | Authoritative saved group name, generic unavailable identity, removable saved entry. `groupDiscoveryRepository.js`, Explorer. | Off-page name and unavailable/deleted-group regressions. | Fixed |
| 8 · 2.3 | Pending requests were buried; queue details could be guessed. | Top summary links to actual request status; show real expiry/seat/queue data only. Explorer. | Request tracking component/browser checks. | Fixed |
| 9 · 3.1 | A second frontend filter removed server-ranked candidates after pagination. | Server filtering is authoritative, including compatibility-reason search. Connection repository and `GroupConnectionsView.vue`. | Reason-only match and paginated count regression. | Fixed |
| 10 · 3.2, 6.2 | Invalid invitations looked actionable; shared-room failures lacked context. | Privacy-safe actionability fields and generic unavailable coordination guidance; backend permission checks remain authoritative. Connection repository/routes/views. | Eligibility, safety, role and room recovery tests. | Fixed |
| 11 · 3.3–3.4 | Discovery obscured invitations needing attention and the next step. | Source group/concert context; received, accepted and sent invitations ahead of discovery; distinct invitation, separate membership and shared-chat states. Connections view. | Host-to-host browser journey and component tests. | Fixed |
| 12 · 4.1, 4.5 | Final decisions appeared in the place-suggestion stage. | Share availability → Suggest places → Finalise meetup; preserve existing stage hashes and allow authorized inspection with contextual explanations. Meetup view/composable. | Stage placement, deep-link and browser-back tests. | Fixed |
| 13 · 4.2 | Organizer guidance could prioritize their own availability over a ready decision. | Capability-driven primary action; personal response remains a secondary reminder. Meetup guidance/summary utilities. | Organizer/member role regression tests. | Fixed |
| 14 · 4.3 | Empty availability conflated unavailable with unanswered. | Explicit response status and current-participant counts; only nonempty legacy intervals are backfilled. Additive meetup migration/repository, availability endpoint and UI. | Migration, idempotence, privacy and save/reload tests. | Fixed |
| 15 · 4.4 | Grid selection, erasure and unsaved changes were hard to interpret. | Clear paint/erase/keyboard guidance, truthful unselected labels, response-aware drafts and live refresh. Availability calendar and meetup composable. | Pointer/keyboard/touch and draft/live-update tests. | Fixed |
| 16 · 4.6 | Alternatives competed visually with the leading recommendation. | Prominent first-ranked choice; alternatives disclosed on demand; organizer-only decision controls in Finalise. Meetup view. | Ranking, permissions, alternative-selection regressions. | Fixed |
| 17 · 4.7 | Zero-attendance proposal policy differed across client and server. | Deliberate override requires explicit acknowledgement on both client and server; positive recommendation ranking is unchanged. Meetup repository/service/view. | Reject missing acknowledgement, accept explicit override, preserve approval atomicity. | Policy decision — implemented |
| 18 · 4.8 | People joining after confirmation could misread the plan's history. | Minimal confirmation context for new confirmations; legacy context stays unknown; joining never silently invalidates the plan. Meetup migration/repository/view. | Existing, late-joining and rejoining participant tests. | Fixed |
| 19 · 5.1–5.3 | One owned-group read could erase other groups and produce misleading counts. | Per-group recovery; role-aware summaries and truthful unknown states; preserve readiness/publication checks. Connections/membership views. | Partial-load, retry, publication and host/member tests. | Fixed |
| 20 · 6.1, 6.3 | Generic notification destinations obscured the action and record. | Contextual request, offer, invitation, shared-chat and meetup routes, safe legacy/unavailable fallbacks, acknowledged-success next actions. Notification triggers and destination views. | Route, focus, unavailable-record and refresh-failure tests. | Fixed |

## Additional verified defects

- A direct request could succeed while its response was lost. Recovery now checks authoritative own requests before offering another send.
- An unresolved search followed by a rate-limited recovery must retain its retry UUID: the rate limit does not prove the earlier request failed.
- Returning A → B → A could allow an old asynchronous write acknowledgement to pass an account/concert-only guard. A navigation generation now rejects it.
- Failed searches with new filters must not display old-filter cards as current results. Same-filter refresh failures may retain clearly marked previously loaded cards.
- Deliberately cancelling the comparison request review must say no request was sent, rather than report a failed submission.
- Cancelling a comparison review could try to restore keyboard focus while its original button was still disabled. Release the comparison's pending state before the dialog closes.
- A transition finishing late could move keyboard focus away from a card action or review dialog. Respect the user's newer focus; a cancelled comparison restores its opener after the card enables it again.
- Cached offer data could resurrect approval controls after a newer response confirmed or retired the offer. Current offers now follow the latest successful status source; failed reads and retry starts do not promote old snapshots. Critical refreshes temporarily disable writes.
- Changing source groups A → B → A could revive an earlier invitation's success feedback. A context generation prevents that late acknowledgement from changing the current workspace.
- An accepted-connection acknowledgement must survive a failed refresh, but a later successful response denying coordination access must disable its old chat/planner shortcut.
- A failed owned-group setup or queue read could incorrectly say Draft, zero requests or no pending requests. Unknown information is now explicitly incomplete and independently recoverable.
- Participant changes do not necessarily change the meetup's ordinary version. An opaque participant revision now invalidates cached recommendations and reviewed proposals, including equal-size member replacements.
- A place save could succeed while the following read failed, leaving an empty list and a cleared draft. The real returned place ID and version now retain the acknowledged suggestion.
- Availability saves can update the version before a full refreshed grid is available. Manual proposal review now waits for canonical details; returned recommendation version/participant metadata must match before use.

## Previous batch retained in this publication

The earlier batch is described in the historical `ENCORE_GROUP_MEETUP_UX_AUDIT.md`. Its changes include seeker-initiated **Find a match**, reversible group priorities, matching progress and consent guidance, confirmed-group/chat/planner next actions, role-aware meetup guidance, optional alternatives, invitation success recovery, and host publication-readiness guidance. Existing mandatory onboarding, avatar checks, questionnaire options, teammate navigation/concert/ticket visuals and organizer Place/Time dropdowns remain.

Two earlier behaviours are deliberately superseded: pathway navigation is now view-only, and actual finalisation controls now live in Stage 3. The new explicit response model also replaces the earlier limitation that empty availability could not distinguish unanswered from unavailable.

## Verification record

Tests use isolated temporary/in-memory databases and the dedicated browser harness. They do not load the ordinary server environment file, seed a real database, send real notifications or contact public providers. Provider responses in browser tests are controlled fixtures; real API availability and actual OS push delivery are not claimed by these runs.

| Run | Result / evidence |
|---|---|
| Phase 1 backend: self-service matching, managed matching, discovery | **77 passed, 0 failed.** `test/results/comprehensive-phase1-server-verified.log`. The initial run exposed one foreign-key-invalid deletion fixture; the fixture was corrected without relaxing production constraints. |
| Updated matching/discovery backend | **78 passed.** `test/results/comprehensive-results-server-verified.log`; includes two accounts sharing a global count of one but receiving different eligible results. |
| Matching/connection interface subsets | Latest pre-final-guard subset: **131 passed + 7 comparison tests.** `test/results/comprehensive-matching-authority-client.log`. Final guards are included in the complete rerun below. |
| Phase 2 connection reliability | **115 backend passed**; initial **102 interface + 7 comparison passed**; last changed files **61 + 7 passed**. `test/results/comprehensive-connections-*.log`. |
| Phase 3 meetup | **150 backend, 246 interface and 7 comparison tests passed.** `test/results/comprehensive-meetup-backend.log`, `comprehensive-meetup-client.log`. |
| New matching browser journeys | **8 passed.** `test/results/comprehensive-matching-browser.log`; personalised results, mobile themes, real keyboard traversal, response-loss recovery and partial-read preservation. |
| Complete backend regression | **748 passed, zero failed/skipped.** `test/results/comprehensive-full-server.log`. |
| Complete interface regression | **734 passed across 45 files, plus 7 comparison tests; zero failed/skipped.** `test/results/comprehensive-full-client-verified.log`. The first full run's single recovery-fixture failure was corrected and the complete suite rerun. |
| Production build | **Passed**, 4.47 seconds. `test/results/comprehensive-build.log`. |
| Complete browser coverage | **All 81 distinct scenarios have passing executions on the final production code.** The full run recorded 74 passes and 7 outdated test-contract failures (`comprehensive-full-browser.log`). After updating wording, organizer-stage navigation and one transport fixture, all **16 tests in the affected files passed** (`comprehensive-browser-updated-contracts.log`). Application code did not change between these browser runs; these overlapping counts are not added together. |
| Credentials/data boundary | Four configured private values checked against **402 publishable text files and 108 built files: zero matches**. This is a scoped comparison, not a general guarantee of secret detection. Environment files, dummy databases, seed tools and generated test artifacts remain ignored and excluded. |
| Git checks | `git diff --check` passes; no unmerged paths. Latest upstream checked before publication; ordinary fast-forward integration/push preserves teammate ancestry. |

This report distinguishes current runs from earlier task results. Previous full-suite counts do not establish that the present changes pass.

Focused runs overlap the complete suites; their counts must not be added as unique tests. Test-fixture corrections retain production constraints: invalid foreign-key deletion fixtures remove their own synthetic dependent membership, ordinary participation fixtures satisfy the existing avatar requirement, intentional zero-attendance fixtures acknowledge that policy explicitly, and recovery mocks include the real endpoint they intend to keep healthy.

The browser assertions still check real saved intervals and private origins, role permissions, queue/reservation state, explicit review, version conflicts, required approvals, notification destinations and membership persistence. Updating an intentional button/status label did not remove those checks. Browser coverage also includes real touch selection/scrolling, 200% text, light/dark themes, six viewport widths, keyboard traversal, live refresh and interrupted responses. Captured UI images are under the ignored `test/results/comprehensive/screenshots/` directory.

## Limits and manual verification

- No guaranteed match, background matching schedule or guaranteed time to receive an offer is introduced.
- Private exclusion reasons are intentionally not disclosed. Group counts are concert-wide; search results are personalised and availability may change.
- Existing confirmed plans without confirmation snapshots retain unknown historical context. Second-resolution membership timestamps cannot reliably identify an existing participant's same-second rejoin; no historical notice is shown in that ambiguous case. Authorization and required approvals are unaffected.
- Controlled provider responses and simulated push delivery do not verify live OneMap/LTA/NEA availability or an actual operating-system push popup.
- Scripted browser workflows and screenshot inspection support the manual checklist; they do not substitute for independent first-time-user observations.
