# API security hardening and native Web Push report

Verification date: **24 October 2026, Asia/Singapore**. Base commit: `0452cee`. Working branch: `security/api-integration-hardening`.

This is the historical report for the security task. Its Git-state and verification statements describe that task's completion before the subsequently authorised publication and mixed-transport planner update. See [MEETUP_TRAVEL_UPDATE.md](MEETUP_TRAVEL_UPDATE.md) and [API_MEETUP_SETUP.md](API_MEETUP_SETUP.md) for the current planner and publication handoff.

**No commit, push, merge, deployment, paid-service provisioning or credential rotation was performed.** Existing uncommitted deletions of `docs/BACKEND_COMMUNITY_FEATURES.md` and `docs/GROUP_FEATURES_IMPLEMENTATION.md` were preserved. This report contains no real credentials.

## Findings, ranked by severity

| Severity | Finding and risk | Resolution |
| --- | --- | --- |
| Critical | No critical application vulnerability or committed private credential was confirmed by this scoped review. This is not a guarantee that the application is vulnerability-free. | Residual exposure and test limits are listed below. |
| High | Push registration could delete/rebind an endpoint already owned by another account, allowing subscription disruption or reassignment when an endpoint was known. | Fixed: cross-account conflicts return409; owners cannot silently replace encryption keys. Browser account switching unsubscribes its local capability and obtains a fresh subscription. |
| High | Passwords, private VAPID material and provider credentials supplied in chat must be treated as exposed. | **Manual action remains:** replace/revoke through provider controls before broader/production use. They were configured only in ignored local backend settings, with a user-only Windows file ACL; no automatic rotation was performed. |
| High | npm audit identified vulnerable transitive `body-parser`, `source-map-js` and Vite versions, including denial-of-service/development-server advisories. | Compatible lockfile updates applied; both complete dependency audits now report zero known vulnerabilities. No major dependency upgrade or new paid package/service was introduced. |
| Medium | Cookie-backed mutations had no explicit Origin/Fetch Metadata guard, and CORS used a broad default. Bodyless actions need protection in addition to cookie SameSite. | Fixed: exact configured origins, credentialed allowlisted CORS, Fetch Metadata/Referer checks, and JSON/custom-header fallback for originless cookie POSTs. Existing first-party requests remain compatible. |
| Medium | Provider quotas were process-local and could undercount authentication/retries, permitting more traffic after a restart. | Fixed: SQLite minute/day budgets count each actual HTTP attempt; authentication and429 backoffs persist. Cache hits do not spend the upstream request budget. |
| Medium | Upstream JSON bodies were unbounded and nested provider fields could forward unnecessary/untrusted data. | Fixed: fixed HTTPS origins/paths, no redirects, five-second provider timeout, streamed2MiB cap, schema checks and explicit output projection. Ticketmaster uses the same bounded reader. |
| Medium | Raw errors could expose internal messages, provider diagnostics or secrets through logs or response wrappers. | Fixed: API-wide machine-code error sanitisation, removal of raw500 details and structured error logs containing only request ID, HTTP method and safe error code. |
| Medium | Inbox display names were reused in lock-screen previews. | Fixed: generic category previews; private chat text, personal names, credentials and exact locations are omitted. Authenticated in-app content keeps its existing access rules. |
| Low | Invalid push endpoints/keys and repeated attempts could waste resources. | Fixed: canonical keys, real P-256 points, fixed HTTPS push-host allowlist, stored-target revalidation, scoped404/410 deletion, no retry for permanent400/401/403/413 responses and at most six transient attempts. |
| Low | Idle polling, unbounded job arguments and infrequent bulk retention work could increase overhead. | Fixed: event wake-up, adaptive timers, maximum60-second reconciliation by default, bounded100-job runs,16KiB job payloads and hourly1000-row retention batches. Full batches schedule deduplicated follow-ups after60 seconds until caught up, so larger installations can clear retention backlogs. No separate worker service, queue or database is required. |

## Implemented controls and compatibility

- Authentication still uses random opaque cookie tokens, hashed in SQLite. There is no JWT session or shared `SESSION_SECRET` to distribute. Cookies remain HttpOnly, SameSite=Lax and Secure in production; login rotates the token. Production now requires an HTTPS `APP_ORIGIN`.
- Unsafe requests with foreign/null/lookalike Origin are rejected. Cross-site metadata also blocks cookie-backed private reads, including GET endpoints that advance read markers. Originless JSON/custom-header requests use preflight restrictions; non-simple DELETE remains available to CLI clients. Cookie-backed form/text/plain/bodyless POSTs without a trusted source or custom header are rejected. The frontend sends JSON and `X-Requested-With: Encore`; old custom scripts making bodyless cookie POSTs must do the same.
- CORS allows exact origins only. `APP_ORIGIN` and optional `CORS_ALLOWED_ORIGINS` identify trusted frontends; request Host and forwarded Host are not accepted as authority. Development permits localhost/127.0.0.1 on5173. Prefer the existing same-origin Vite/reverse-proxy arrangement.
- API headers deny framing, MIME sniffing and unnecessary permissions; responses use no-referrer and private/no-store by default. Public avatar/ticket images retain public embedding/caching compatibility. Production TLS requests receive HSTS when proxy trust is configured correctly.
- Vite development/preview now sends frontend CSP and related headers. Script/worker sources are same-origin; the existing Google fonts, HTTPS images and inline styles remain supported. Development allows HMR WebSockets. A separately hosted production frontend must apply the same headers on its own static host; Express's API headers cannot configure another host.
- Compressed request bodies are rejected, while the existing4MiB JSON upload limit remains. This reduces decompression abuse without changing the application's JSON/base64-image requests.
- This machine initially reported `UNABLE_TO_VERIFY_LEAF_SIGNATURE` with Node's bundled roots. Local `ENCORE_USE_SYSTEM_CA=true` opts into roots already trusted by the operating system while retaining bundled/default roots and certificate/hostname verification. Normal startup was then live-tested successfully. The optional setting requires modern Node TLS CA APIs (verified on24.12); unsupported runtimes fail safely only if opted in. No certificates were installed and TLS verification was never disabled. [Node TLS CA configuration](https://nodejs.org/api/tls.html).
- Per-IP and authenticated-user limits cover sensitive actions and push/provider reads. Missing/spoofed forwarded addresses are handled according to the configured Express proxy trust, rather than trusting every proxy.
- Push subscriptions stay in existing SQLite, maximum10 per user. Endpoints are capabilities and are never listed publicly. Native PushManager endpoint/key possession is the subscription model; no extra paid provider or registration challenge roundtrip was added.
- Legitimate backend events insert inbox rows and durable jobs atomically. A successful mutating API response wakes the started worker; periodic reconciliation recovers external/process events and abandoned leases. `createApp()` does not start worker timers. Native delivery remains sequential and bounded, with lease renewal, idempotency, preferences, stale/read/block/suspension checks and multi-device ownership.
- OneMap tokens are backend-only, expiry is recognised and concurrent refreshes coalesce. One rejected cached token gets at most one refresh/retry; invalid credentials back off. Auth refresh is normal token renewal, not password/key rotation. Private starting locations remain in memory for route calculations and are not added to provider-budget records.
- Meeting recommendations keep the labelled straight-line fallback when complete fresh journey data is unavailable. LTA information represents current transport conditions, not predictions for a future meetup. No fake result replaces a failed live call.
- Existing accounts, messages, votes, memberships, notification preferences and application records were preserved. Additive provider counter tables and job indexes use `CREATE IF NOT EXISTS`; no database reset occurred.

## Credential/configuration inventory

| Names | Visibility | Requirement and purpose |
| --- | --- | --- |
| `VAPID_PUBLIC_KEY` | Public by design | Required for enabled browser push; returned to the authenticated browser. |
| `VAPID_PRIVATE_KEY` | Private, backend only | Required for enabled push; stable signing key, never regenerated at startup. |
| `VAPID_SUBJECT` | Public contact | Required with push keys; real mailto or HTTPS contact. |
| `ONEMAP_EMAIL`, `ONEMAP_PASSWORD` | Private, backend only | Enable automatic token renewal; use the registered account. |
| `ONEMAP_TOKEN` | Private, backend only | Optional existing access token; token-only configuration cannot renew itself. |
| `LTA_ACCOUNT_KEY` | Private, backend only | Required for the implemented LTA REST endpoints. The supplied SDK key is not needed and was not stored. |
| `TICKETMASTER_API_KEY` | Private, backend only | Optional concert imports/refreshes; not needed for existing stored concerts. |
| `DATA_GOV_SG_API_KEY` | Private, backend only | Optional higher-limit NEA/data.gov.sg access. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Private server configuration; sender may be public | Optional verification/reset mail delivery. No SMTP credentials were supplied for live testing. |
| `APP_ORIGIN`, `CORS_ALLOWED_ORIGINS`, `NODE_ENV`, `TRUST_PROXY` | Nonsecret deployment configuration | Exact allowed origins; HTTPS/Secure cookies/proxy trust. Production requires HTTPS APP_ORIGIN. |
| `ONEMAP_DAILY_LIMIT`, `LTA_DAILY_LIMIT`, `TICKETMASTER_DAILY_LIMIT`, cache/sync settings | Nonsecret controls | Conservative request budgets; these are not substitutes for provider quotas. |
| `ENABLE_BACKGROUND_JOBS`, `BACKGROUND_JOB_INTERVAL_MS`, `ENCORE_DB` | Nonsecret server configuration | Worker execution/reconciliation and persistent database path. |
| `ENCORE_USE_SYSTEM_CA` | Optional nonsecret local setting | Trust existing OS-managed CA roots in addition to Node defaults on supported Node versions; needed for this machine's institutional TLS chain. |

`server/.env` contains the supplied local settings, is ignored by Git, and was not printed or committed. Existing private configuration did not exist, so no pre-existing `.env` was replaced. Only blank/example values belong in `server/.env.example`. Production should use the host's backend secret store/environment settings. Never use `VITE_` variables for private values. On Windows, the local `.env` ACL was restricted to the current user's SID; administrators/malware with sufficient machine access are outside that protection boundary.

The custom source/build/history scanner found no configured private value, JWT/PEM pattern or tracked private `.env` in its scope. It checked current nonignored files, the fresh frontend build and reachable Git history. It does not prove that no earlier secret exists in remote/deleted/unreachable history, backups, developer machines or other chats. `.gitignore` does not remove previously committed secrets; none was identified here. No Git history rewrite was attempted.

## Web Push costs, hosting and traffic

See [WEB_PUSH_COST_AND_DEPLOYMENT.md](WEB_PUSH_COST_AND_DEPLOYMENT.md) for the complete component cost table, verified Render/Railway plans/currency/date, local/small/large scenarios and calculations for100/1000/10000 users. Standard native browser push, VAPID generation and the open-source library require no per-message paid notification subscription. Backend compute, storage, egress and uptime can still cost money; local use adds no hosting/provider bill beyond existing equipment/connectivity.

No Firebase SDK/project, OneSignal plan, Redis, PostgreSQL, paid queue, external scheduler, monitoring subscription or deployment was added. A sleeping/stopped host cannot execute in-process reminders. SQLite/accounts/messages/subscriptions and uploads require durable storage and application-consistent backups; an ephemeral free container is unsuitable for real data. Billing alerts do not automatically enforce a spending cap. All these limitations and concrete persistent-storage/backup recommendations are in the cost guide.

## Teammate access and manual actions

See [TEAM_CREDENTIALS_SETUP.md](TEAM_CREDENTIALS_SETUP.md) for the exact local setup and shared-backend options. Each local developer can generate their own VAPID pair for free. Prefer individual provider credentials; use an authorised development vault when sharing is allowed, and keep production credentials restricted. GitHub Actions secrets are for controlled automation, not a way to download teammates' `.env` files.

Before production/wider credential sharing:

1. **OneMap:** change the exposed account password through OneMap account controls, obtain replacement access credentials and remove the old local token. Ask OneMap about revocation if an existing JWT cannot be revoked; a password change must not be assumed to invalidate every issued token immediately.
2. **LTA:** replace/revoke the exposed Account Key and unused SDK key through the issuing portal/support, then update only private server configuration.
3. **VAPID:** plan a manual key change and browser re-enrolment. The current pair was preserved. To replace it intentionally, securely retain any needed rollback material, edit/remove only the old pair locally, then use the existing key generator; it refuses accidental replacement. Existing subscriptions are tied to their application-server key and need renewal.
4. Restart the local backend after configuration changes. For Edge, enable notifications in Profile, accept permission, and test legitimate messages/meetups with another test account. Test active/background/closed tabs, logout/account switching, muted categories, blocked users and Windows notification settings. Do not promise popups if the browser/OS blocks background execution.
5. Configure production HTTPS, exact frontend origins, scoped reverse-proxy trust, durable database/upload paths, backups and usage controls. No hosting or paid infrastructure was provisioned.

## Verification status and remaining limits

- **Live verified:** OneMap public location search, walking route and public-transport route; LTA Bus Arrival v3, Train Service Alerts and crowding; NEA near-term forecast and rainfall. Live authenticated planner tests returned200 for OneMap locations and LTA transport,401/404 before upstream calls for unauthenticated/outsider access, and no credential matches in responses. Synthetic users and an in-memory database were used; no real user data was changed.
- **Mock verified:** missing/invalid credentials, token expiry/refresh coalescing, authentication backoff, invalid coordinates, malformed/oversized JSON, API limits/restart persistence, ownership, endpoint SSRF restrictions, push preference/read/block suppression, duplicate subscriptions,404/410 cleanup, bounded retries, CSRF/CORS, safe errors/logs and existing feature regressions.
- **Browser manual test remains:** no browser surface was available to the computer-use tool (`apps:[]`, `browsers:[]`). No operating-system notification popup was claimed or sent. A valid supplied VAPID pair was checked locally; real PushManager permission/subscription/delivery still needs Edge.
- **Not live verified:** SMTP delivery (no local SMTP credentials supplied), OneMap email/password renewal (the supplied token sufficed), new24-hour/four-day live weather coverage (schema/fallback tests use mocks), production host/proxy behaviour and load capacity.
- **Residual risks:** exposed chat credentials still require manual replacement; trusted developers with local backend credentials can read them; counters are shared only by processes using the same SQLite database; SSE remains in-process; a long outage can accumulate a legitimate queued backlog despite deduplication/rate limits/retention; capacity and persistent-disk use need monitoring. No global drop cap was added that would silently discard legitimate notifications.

<!-- FINAL_VERIFICATION -->
## Final verification results

- Full backend suite: **518 tests passed,0 failed,0 skipped**.
- Frontend: **npm production build passed**; **pnpm frozen installation and production build passed** with Vite6.4.5.
- Full npm dependency audits: **0 known vulnerabilities** for server and client. pnpm client audit: **0 known vulnerabilities**.
- Secret scan: **0 findings** across current nonignored source, fresh build and1,178 reachable history blobs; configured private values were compared in memory without printing them.
- `git diff --check`: passed.
- Live provider/planner results and remaining Edge/SMTP/production limitations are detailed above. The Windows CA opt-in also passed a normal-startup live OneMap request with no command-line certificate override.

The initial regression run identified first-party test helpers making originless cookie POSTs without browser-style headers. Their helpers now send `X-Requested-With: Encore`, as the frontend does; adversarial tests separately prove form/text/plain/bodyless CSRF attempts are rejected. A mixed npm/pnpm dependency layout also blocked an initial pnpm run. Its ignored client dependency directory was kept in a reversible `.agent-local/client-dependencies-before-pnpm-repair` backup, and a clean frozen pnpm installation/build then passed. No application source/data was discarded.

## Per-file change inventory

The inventory covers 44 modified or new repository files, with paths relative to the repository root. Generated dependencies, build outputs and ignored local artifacts are excluded.

| Path | Status | Change and security/cost purpose | Compatibility implications |
| --- | --- | --- | --- |
| `client/package-lock.json` | Modified | Locks patched Vite/source-map dependencies for npm. | Use npm installation in an npm-managed folder. |
| `client/package.json` | Modified | Raises the compatible Vite6 minimum to6.4.5. | No major upgrade; patched installer resolution. |
| `client/pnpm-lock.yaml` | Modified | Locks the same patched Vite version for pnpm. | Fresh frozen pnpm installation verified. |
| `client/public/sw.js` | Modified | Validates compact push/lookup payloads and same-origin navigation. | Does not cache private data; native notification flow retained. |
| `client/securityHeaders.js` | New | Defines frontend CSP, framing, referrer and MIME headers. | Allows existing Google fonts, images, styles and same-origin workers. |
| `client/src/api.js` | Modified | Adds the first-party custom request header. | Existing method/data contracts preserved. |
| `client/src/browserPush.js` | Modified | Handles immutable ownership/key bindings and safe account switching. | Old local capability is unsubscribed before fresh enrolment. |
| `client/vite.config.js` | Modified | Applies security headers to development/preview. | HMR allowed in development; mirror headers on production host. |
| `docs/API_MEETUP_SETUP.md` | Modified | Refreshes API budget, authentication and privacy documentation. | Documentation only; no infrastructure provisioned. |
| `docs/API_SECURITY_HARDENING_REPORT.md` | New | Records findings, file inventory, configuration, verification and manual actions. | Documentation only; no infrastructure provisioned. |
| `docs/BACKEND_INTEGRATIONS_AND_OPERATIONS.md` | Modified | Corrects budget/live-verification status and links the current report. | Documentation only; no infrastructure provisioned. |
| `docs/TEAM_CREDENTIALS_SETUP.md` | New | Explains local versus shared-backend access and safe teammate onboarding. | Documentation only; no infrastructure provisioned. |
| `docs/WEB_PUSH_AND_BACKGROUND_JOBS.md` | Modified | Updates the documented worker reconciliation default. | Documentation only; no infrastructure provisioned. |
| `docs/WEB_PUSH_COST_AND_DEPLOYMENT.md` | New | Records verified pricing, scenarios, traffic calculations and SQLite deployment limits. | Documentation only; no infrastructure provisioned. |
| `server/.env.example` | Modified | Documents CORS, production settings, system CA opt-in and60s reconciliation. | Placeholders only; private values stay local. |
| `server/package-lock.json` | Modified | Locks patched body-parser dependency. | Existing Express major version retained. |
| `server/src/app.js` | Modified | Wires guards, headers, safe responses/logs, user/IP limits, persistent provider budgets and event wake. | Originless cookie form/bodyless POSTs now need JSON/custom header or trusted source. |
| `server/src/config/loadEnv.js` | Modified | Applies explicit local system-CA opt-in after loading private environment. | Default remains unchanged unless opted in. |
| `server/src/config/systemCa.js` | New | Adds OS-trusted roots without disabling TLS or dropping bundled/default trust. | Unsupported Node fails only when explicitly opted in. |
| `server/src/db/deliveryRepository.js` | Modified | Bounds jobs/payloads/pruning, adds retention index and next-due lookup. | Additive tables/indexes; application records preserved. |
| `server/src/routes/push.js` | Modified | Marks private responses no-store and bounds lookup identifiers. | Route contracts retained; ownership conflicts return409. |
| `server/src/server.js` | Modified | Uses60s maximum reconciliation instead of15s fixed polling. | Mutation wake-up provides prompt active-server delivery. |
| `server/src/services/apiRateLimiter.js` | Modified | Adds user budgets alongside IP budgets and dedicated push read/write policies. | No raw account identifiers stored in rate buckets. |
| `server/src/services/concertProvider.js` | Modified | Uses bounded safe provider reader for individual event refreshes. | 404 still does not imply cancellation; cache/day budget retained. |
| `server/src/services/delivery.js` | Modified | Protects ownership, validates endpoints/keys, hides preview names, bounds retries and adapts scheduling/retention catch-up. | Native Web Push, multi-device support and human approvals retained. |
| `server/src/services/httpSecurity.js` | New | Exact-origin CORS/CSRF, headers, API-wide error sanitisation and safe structured logging. | Trusted first-party JSON and non-simple CLI requests supported. |
| `server/src/services/meetupIntegrations.js` | Modified | Passes SQLite to adapters and strictly validates shelteredOnly. | Membership checks and explicit distance fallback retained. |
| `server/src/services/meetupWeather.js` | Modified | Persists HTTP-attempt budgets and projects documented provider fields. | Forecast precision and rainfall observation labels retained. |
| `server/src/services/providerBudget.js` | New | Persists provider minute/day counters and backoff deadlines. | No token, URL or precise location stored in counters. |
| `server/src/services/providerCache.js` | Modified | Sanitises failures and restricts HTTPS targets, redirects, timeout and2MiB response size. | Cache/coalescing and visibly stale fallback retained. |
| `server/src/services/sessions.js` | Modified | Uses injected environment for production Secure-cookie configuration. | Opaque hashed sessions, rotation, HttpOnly/Lax/path rules retained. |
| `server/src/services/singaporeTravel.js` | Modified | Adds JWT expiry hints, shared auth refresh, bounded retry/backoff, actual-attempt budgets and schema validation. | OneMap/LTA routes and private-origin behaviour retained. |
| `server/src/services/ticketmaster.js` | Modified | Rejects custom URLs and uses bounded redirect-free provider JSON. | Preserves normalized event output and URL-object mock contract. |
| `server/test/browserPush.test.js` | New | Device ownership/account-switch and explicit browser-permission flow. | Test changes only; no real credentials/provider calls. |
| `server/test/delivery.test.js` | Modified | Ownership, real P-256 validation, preview privacy, cleanup, bounded retries/jobs and retention catch-up. | Test changes only; no real credentials/provider calls. |
| `server/test/httpSecurity.test.js` | New | CSRF/CORS, secure cookies, headers, safe errors/logs and per-user/IP limits. | Test changes only; no real credentials/provider calls. |
| `server/test/kakiChat.test.js` | Modified | Updates the legitimate first-party helper to send the same custom header as the frontend. | Test changes only; no real credentials/provider calls. |
| `server/test/kakiRealtime.test.js` | Modified | Updates the legitimate first-party helper to send the same custom header as the frontend. | Test changes only; no real credentials/provider calls. |
| `server/test/market.test.js` | Modified | Updates the legitimate first-party helper to send the same custom header as the frontend. | Test changes only; no real credentials/provider calls. |
| `server/test/providerSecurity.test.js` | New | Expiry/refresh, persistent attempt budgets, malformed responses and private diagnostic safety. | Test changes only; no real credentials/provider calls. |
| `server/test/pushWorker.test.js` | Modified | Malformed payload handling and authenticated safe service-worker lookup/navigation. | Test changes only; no real credentials/provider calls. |
| `server/test/sessions.test.js` | Modified | Updates the legitimate first-party helper to send the same custom header as the frontend. | Test changes only; no real credentials/provider calls. |
| `server/test/systemCa.test.js` | New | Opt-in, retained default trust and safe unsupported-runtime handling. | Test changes only; no real credentials/provider calls. |
| `server/test/ticketmasterSecurity.test.js` | New | Fixed targets, redirects/body bounds,429/cache/budget and404 semantics. | Test changes only; no real credentials/provider calls. |

Local-only `server/.env` was newly configured with the supplied values and an owner-only Windows ACL; it is ignored and absent from Git status. It must remain private. The source example remains blank. Ignored `.agent-local` audit/smoke scripts contain no embedded real secrets; the dependency backup is retained for reversibility.

## Final Git status

- Branch: `security/api-integration-hardening`.
- HEAD remains `0452cee`, the starting commit; nothing was staged, committed, pushed or merged.
- Modified files are the Modified rows above; untracked source/docs/tests are the New rows above.
- Existing deletions of `docs/BACKEND_COMMUNITY_FEATURES.md` and `docs/GROUP_FEATURES_IMPLEMENTATION.md` remain unchanged and were not caused or staged by this task.
- No real database reset, user-data deletion, credential rotation, deployment or paid infrastructure action occurred.
