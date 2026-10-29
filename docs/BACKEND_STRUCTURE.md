# Backend structure after repository cleanup

This refactor organises existing functionality. API URLs, response shapes, database schema, matching rules and permissions stay the same. No database reset, migration or new runtime dependency is needed.

Before the separately requested live-planner/heatmap feature, the combined cleanup changed backend JavaScript from **94 files / 14,929 lines** to **105 files / 14,267 lines**: eleven additional modules and 662 fewer physical lines (about 4.4%). The earlier passes organised the repositories and consolidated duplicated implementations. The final cleanup pass kept the production file count at 105 and removed another **172 lines**: 142 lines of repetitive matching-service commentary and 30 lines of unused/redundant repository definitions. These are refactoring snapshot counts, not a claim that adding features costs no code. They cover `server/src` JavaScript; test code, configuration and documentation are counted separately. `repositories.js` changes from 1,618 to 69 lines; its implementations still exist in the feature modules below.

## Where to work

| Responsibility | File under `server/src/` |
| --- | --- |
| Assemble all repositories | `db/repositories.js` |
| Users, shared questionnaire reads and login-session persistence | `db/userRepository.js` |
| Concerts and Kaki attendance | `db/concertRepository.js` |
| Attendance groups and seeker requests | `db/partyRepository.js`, `db/seekerRepository.js` |
| Ticket listings, number formatting, issued numbers and orders | `db/ticketRepository.js` |
| Marketplace conversations | `db/marketplaceConversationRepository.js` |
| Matching round history, snapshots and idempotency | `db/roundRepository.js` |
| Compatibility endpoint's current matching-state lookup | `db/operationalMatchQueries.js` |
| Kaki candidate discovery and likes | `db/kakiRepository.js` |
| Shared row mapping | `db/rowMappers.js` |
| Shared chat validation, background IDs and pagination | `db/messagePage.js` |
| Group image response URLs | `presentation/groupIdentity.js` |

The existing membership, proposal, recommendation, notification, meetup, feedback and chat repositories retain their own files. Algorithms remain in `matching/`, coordination in `services/`, and HTTP handling in `controllers/` and `routes/`.

## How a request flows

`HTTP route → controller/service → relevant repository → SQLite → explicit result mapping → HTTP response`.

`createRepositories(db)` remains the composition point. It constructs independent repositories first, then repositories that share the same `repos` object. All use the same database connection so transactions can still roll back a matching round, offers, seat claims and notifications together.

Existing imports such as `import { createRepositories, createUserRepo } from './db/repositories.js'` keep working through compatibility exports. New code can import the focused module directly. The `repos` properties used by controllers and services keep their existing names.

`repos.rounds.resultForUser()` still returns its existing response; its operational query now lives separately from historical round storage. Its compatibility behaviour and legacy safeguards are retained.

## Cleanup boundaries

- Removed repetitive historical comment banners while keeping explanations of transactions, consent, capacity and private fields.
- Removed the unused single-group prepared message query, legacy marketplace message reader and Kaki `messages()`/`unread()` readers with their dedicated queries. Current HTTP callers use pagination and unread totals.
- Moved the shared group image URL helper out of the controller layer. Database repositories no longer import that controller for presentation utilities.
- Kept each chat's membership rules explicit; sharing pagination does not make Kaki, marketplace, individual-group and connected-group access interchangeable.
- Kept migrations, runtime dependency versions and frontend behaviour intact. Test-only development dependencies and regression tests were added separately.
- Grouped small related factories by feature: sessions stay with users, attendance with concerts, and issued-ticket/order helpers with ticket listings. This avoids separate files for tiny helpers.

## Duplication removed in the second pass

- One message-body validator supplies the same trim/type/2,000 UTF-16-unit rules to Kaki, marketplace, group and connected-group chats. Existing authorization and HTTP error ordering remain in their callers. Background IDs share the existing message utility module.
- Local Kaki helpers replace repeated read acknowledgements, own-message checks and edit/delete broadcasts. Sending retains its distinct read/event handling, and reply/tombstone response differences are preserved.
- Kaki's conversation gate and unread count reuse the same mutual-like/attendance SQL fragment. Only fixed server-side SQL identifiers are interpolated; user values remain bound parameters.
- Planner detail and internal travel input share availability/place loading. Public detail still exposes only the caller's starting locations. Active-member vote counting is aggregated in SQL instead of repeating a JavaScript query per place.
- Matching history hydration and operational host lookup each have one local implementation rather than two copies.

No additional files, dependencies or migrations were introduced in this pass. Regression assertions were added to existing tests for invalid message types, trimming, Unicode limits and authorization/ownership error ordering.

## Latest cleanup and scoped testing — 30 October 2026

- Proposal explanations parse their saved compatibility snapshot once, after authorization, and reuse it for the response. The serialized result is unchanged.
- Kaki's unused transcript/per-conversation unread readers were removed after checking callers. Shared message projections, active pagination and unread totals remain.
- Matching-service commentary was shortened while retaining transaction, queue and consent explanations. A parser comparison verified all **2,373 executable tokens** are identical to `HEAD`.
- Existing fourteen named exports and twenty-two repository properties remain compatible, apart from the three deliberately removed unused internal reader methods across the earlier and latest passes.
- GitHub `main` was fast-forwarded into the working branch to `233dc58` before this work. All 28 pre-existing local paths were verified intact after the pull; no merge conflicts occurred. The incoming frontend source changes remain untouched.

See [SCOPED_FEATURE_TESTING.md](SCOPED_FEATURE_TESTING.md) for the requested feature tests, isolated test environment, commands and verification limits. Test files and development dependencies increase the test infrastructure size; they are excluded from the production cleanup figures above.

## Validation

For the requested feature scope, run `npm.cmd run test:community` from `server`, then `pnpm.cmd test`, `pnpm.cmd test:e2e` and `pnpm.cmd build` from `client`. The full pre-existing `npm.cmd test` command remains available, but includes unrelated features.

Historical verification on 26 October 2026: **558 backend tests passed** across the broader application. Current scoped results are recorded in the testing guide; no claim is made that unrelated suites were rerun on 30 October. The refactor and subsequent planner features were prepared together on `refactor/backend-repository-modules` for integration into `main`.
