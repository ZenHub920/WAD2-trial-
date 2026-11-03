# Encore tests

All maintained test code and test-only tooling live here. Application code stays
in `client/`, `server/` and `shared/`. The suites use the dependencies already
installed in `client/node_modules` and `server/node_modules`; do not install a
second dependency tree in `test/`.

| Folder | Contents |
|---|---|
| `server/` | Node unit, repository, security and real HTTP integration tests |
| `client/` | Vitest/Vue component and frontend integration tests, setup and helpers |
| `client-node/` | Seven pure group-comparison cases using Node's test runner |
| `e2e/` | Playwright workflows and browser helpers |
| `config/` | Vitest, Playwright and matching-demo configuration |
| `support/` | Disposable E2E API and adapters to the existing package dependencies |
| `scripts/` | Explicit suite discovery, client test launcher and scoped feature runner |
| `bench/` | Synthetic matching data and algorithm evaluation |
| `docs/` | [Detailed feature-testing history](docs/community-feature-testing.md) |
| `results/` | Generated output; ignored by Git |

## Run tests

Install server and client dependencies using the main README first. From the
repository root:

```powershell
npm.cmd test                  # server + client, including comparison logic
npm.cmd run test:server       # backend only
npm.cmd run test:client       # Vue/integration tests + seven Node cases
npm.cmd run test:e2e          # all browser workflows
npm.cmd run test:all          # all three layers
```

The original package commands remain supported, including extra runner options:

```powershell
npm.cmd --prefix server test -- --test-concurrency=1
npm.cmd --prefix client test -- --run --maxWorkers=1
npm.cmd --prefix client run test:watch
npm.cmd --prefix client run test:e2e -- --list
npm.cmd --prefix client run test:e2e -- group-and-meetup-lifecycle.spec.js
npm.cmd --prefix client run demo:matching
npm.cmd --prefix client run test:e2e:report
npm.cmd --prefix server run test:community
npm.cmd --prefix server run bench
npm.cmd --prefix server run bench:scale
```

Use `npm` instead of `npm.cmd` on macOS/Linux. The browser suite requires the
client's Playwright Chromium installation. It starts a loopback-only disposable
API and Vite on ports 3105 and 5175; stop conflicting services before running it.
It uses synthetic users, an in-memory database and controlled provider responses,
and never loads `server/.env`. Do not deploy `support/e2e-server.mjs`.

The client launcher forwards extra flags to Vitest only, then runs the independent
Node cases after success. Watch mode watches Vitest tests; run `test` to include
the Node comparison cases. The backend runner discovers only `server/*.test.js`,
so helper modules, browser specs, Vue tests and archived reports cannot be mistaken
for backend tests.

## Reports and discovery

Playwright writes screenshots/traces to `results/e2e/`, its HTML report to
`results/playwright-report/`, and demo recordings to `results/matching-demo/`.
Vitest cache/coverage output and scoped community logs also stay beneath
`results/`. Previous server/client reports were preserved in `results/server/`
and `results/client/` rather than deleted. Do not commit or share generated
traces/reports without checking their contents.

The old Node default discovery counted `server/test/helpers.js` as an empty
passing test file. Explicit discovery omits that helper but retains every actual
case. The seven comparison cases previously lived in `client/test/`, outside
Vitest's include pattern; `npm test` in the client now runs them too.

## Relocation map

| Previous location | Current location |
|---|---|
| `server/test/` | `test/server/` |
| `client/tests/` | `test/client/` |
| `client/test/groupComparison.test.js` | `test/client-node/group-comparison.test.js` |
| `client/e2e/` | `test/e2e/` |
| `server/test-support/e2eServer.mjs` | `test/support/e2e-server.mjs` |
| `client/vitest.config.js` | `test/config/vitest.config.mjs` |
| `client/playwright.config.js` | `test/config/playwright.config.mjs` |
| `client/playwright.demo.config.js` | `test/config/playwright.demo.config.mjs` |
| `server/scripts/scoped-feature-tests.mjs` | `test/scripts/scoped-feature-tests.mjs` |
| `server/bench/` | `test/bench/` |
| `docs/SCOPED_FEATURE_TESTING.md` | `test/docs/community-feature-testing.md` |
| `server/test-results/`, `client/test-results/` | `test/results/server/`, `test/results/client/` |
| `client/playwright-report/` | `test/results/playwright-report/` |

Several broad filenames now describe their actual scope:

| Previous filename | Current filename |
|---|---|
| `api.test.js` | `server/concert-api.test.js` |
| `community.test.js` | `server/community-domain-workflows.test.js` |
| `communityApi.test.js` | `server/community-http-workflows.test.js` |
| `market.test.js` | `server/ticket-marketplace.test.js` |
| `community-features.spec.js` | `e2e/community-workflows.spec.js` |
| `teammate-workflows.spec.js` | `e2e/group-and-meetup-lifecycle.spec.js` |
| `kaki-calendar-audit.spec.js` | `e2e/kaki-and-availability-calendar.spec.js` |
| `meetup-hardening.spec.js` | `e2e/meetup-interactions-and-drafts.spec.js` |
| `ux-visual.spec.js` | `e2e/responsive-ui.spec.js` |
| `notification.spec.js` | `e2e/notifications.spec.js` |

Historical audit sections retain their original paths and measurements; use this
map to locate the same suites and archived logs after consolidation. Assertions,
application rules and production source are unchanged by this reorganization.
