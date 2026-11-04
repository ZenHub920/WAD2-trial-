# Encore deployment readiness

Assessment: **suitable for a controlled demonstration after the deployment configuration and smoke checks below**. The current development setup is not a production hosting configuration. Nothing was deployed, no hosting account was changed, and no database was migrated or replaced during this assessment. Hosting documentation was checked on **4 November 2026 (Singapore time)**; prices and platform limits can change.

## Recommended architecture

Use **one persistent Node.js process**, one durable local volume, and one public HTTPS origin. Railway with a volume, a paid Render web service with a disk, or an existing university/VPS server can support this arrangement. For a short demonstration, use synthetic accounts and an intentionally prepared demonstration database rather than uploading the developer's database.

```text
Browser: https://your-encore-domain/
  /assets/*, /sw.js, other static files, SPA routes -> built client/dist
  /api/* -> one long-running Express process
               |-> durable SQLite database, sessions and jobs
               |-> durable ticket images and avatars/group images
               |-> server-only external API and SMTP credentials
               |-> in-process SSE bus and notification worker
```

The frontend currently requests `/api` and `/api/kaki/stream` relative to its own origin; the push worker does the same. Retaining that public origin avoids changing the authentication and realtime transports. There is no production API URL switch in the client.

Choose either a reverse proxy that serves the built client and forwards `/api`, or a small, reviewed Express static/SPA handler placed **after API routes and before the current JSON 404 handler**. The latter is a required code change if a managed Node host is expected to serve the whole site itself: `app.js` currently serves API images, not `client/dist`. Neither configuration has been installed by this audit.

## Hosting options

| Option | Fit for this code | Changes and operational considerations | Demonstration verdict |
|---|---|---|---|
| Single persistent Node service on a university server/VPS | SQLite, uploaded files, sessions, SSE and existing jobs can remain together | Add static/SPA routing or a reverse proxy; provide a writable durable directory, TLS, process restart supervision, backups and one instance. The operator manages OS maintenance and certificates | Lowest application change when suitable infrastructure already exists; cost depends on the actual host |
| Railway with a persistent volume | Same single-process arrangement | Mount one volume and point all three storage settings at it. Keep one replica, review filesystem ownership and disable sleeping for timely background work. Expect a short interruption during a volume-backed redeploy | Good managed option; the checked Hobby listing has a USD 5 monthly minimum with usage credits, and additional usage can cost more. Free allowances are limited, so a zero-cost always-on demo is not guaranteed. [Railway pricing](https://railway.com/pricing), [volume caveats](https://docs.railway.com/volumes/reference) |
| Render with a persistent disk | Same single-process arrangement | Use a **paid** web service and mount a disk. Only paths beneath that mount survive. Preserve the single instance and test restart recovery | Good managed option. Free web services cannot attach a persistent disk and can lose SQLite/uploads when restarted or spun down. Compute and disk charges are separate; verify the selected current plan before provisioning. [Render disks](https://render.com/docs/disks), [free limitations](https://render.com/docs/free), [compute plans](https://render.com/docs/compute-plans), [pricing](https://render.com/pricing) |
| Vercel frontend plus separately persistent backend | Frontend is a static Vite build; backend keeps the recommended Node/volume arrangement | Configure an external `/api/:path*` rewrite **before** the SPA fallback. Preserve the `/api` prefix, cookies, headers and streaming. Mirror frontend security headers and prevent API/SSE caching. Verify the actual proxy's stream timeout/reconnection behavior | Viable, with two services to configure. Static hosting does not remove the backend/storage cost. [Vercel rewrites](https://vercel.com/docs/routing/rewrites) |
| Full Vercel, including this backend | Current local persistence and in-process event delivery do not fit unchanged | Functions have bounded invocations and ephemeral storage. Durable external database/image storage, a cross-instance event mechanism and a background execution redesign would be needed. Those are substantial architecture changes outside this audit | Do not choose for the unchanged application. Vercel now also offers **Daemons beta**, but its documented storage is still ephemeral; workers alone do not make the local SQLite/files durable. [SQLite guidance](https://vercel.com/kb/guide/is-sqlite-supported-in-vercel), [function limits](https://vercel.com/docs/functions/limitations), [Daemons](https://vercel.com/docs/daemons) |

Vercel can stream responses, so the problem is not a blanket lack of SSE support. A function's duration still bounds its stream, and independent instances do not share Encore's subscriber map. Current Hobby cron scheduling is daily, which cannot replace the application's minute-scale lifecycle sweeps and prompt push delivery. [Function duration](https://vercel.com/docs/functions/limitations), [cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing).

Do not enable multiple Node workers/PM2 cluster mode, replicas or multiple backend regions for this deployment. Durable job leases do not make the in-memory SSE bus distributed. A separate worker on a different service also cannot access a host-local SQLite volume unless the storage architecture is changed. SQLite WAL requires processes using the database to share the same host's coordination mechanism. [SQLite WAL](https://www.sqlite.org/wal.html).

## Current implementation and prerequisites

| Concern | Current source behavior | Deployment requirement |
|---|---|---|
| Runtime | `server/src/server.js` starts Express using `PORT`, starts delivery and handles SIGTERM/SIGINT | Use a supported Node runtime; Node 24 matches current local verification. Install native `better-sqlite3` dependencies on the target OS, not by copying Windows `node_modules` |
| Database | `connection.js` uses `ENCORE_DB`, WAL, foreign keys and startup schema/additive migrations | Store the database and its adjacent WAL/SHM on the durable mount; ensure directory write permissions. Never use `:memory:` for persisted demo data |
| Uploaded images | `ticketImages.js` validates supported image bytes and writes generated filenames. Ticket images and avatars/group images use separate directories | Set both storage directories beneath the mount, outside publicly served source/config directories. Preserve files together with the database references |
| Sessions | Session token hashes, user IDs and expiries are stored in SQLite; raw tokens are HttpOnly cookies | Database persistence preserves sessions across ordinary restarts. Current cookie is host-only, `Path=/api`, `SameSite=Lax`, and Secure in production; retain HTTPS and same-origin API requests |
| Trusted origins | Production startup requires `APP_ORIGIN`; exact CORS/CSRF checks reject other origins | Set the canonical public HTTPS origin, without an application path/query/fragment. Allow only specifically approved additional origins. Configure `TRUST_PROXY` for the actual proxy path, not a blanket trust of client headers |
| API routing | Express serves `/api`, images and JSON errors; Vite proxies only in development | Add production API routing and SPA deep-link fallback. `/api` errors must stay JSON, never return `index.html` |
| Static headers | `client/securityHeaders.js` is applied by Vite dev/preview | Apply its production headers on the real static host/reverse proxy as well. Vite configuration does not automatically configure a CDN. Retain Spotify frame permission and required font/image sources |
| SSE | `realtime.js` has one process-local user subscriber map, 25-second heartbeats and no replay log | Forward `text/event-stream` without buffering/transformation/cache. Configure a practical long read timeout and test reconnects through the chosen production proxy |
| Notification delivery | SQLite-backed jobs, unique keys, leases, bounded batches, retries and expired-subscription cleanup; `server.js` starts the loop | Keep the service running and background jobs enabled. Do not replace `npm start` with an export of `createApp()` that never starts delivery |
| Scheduled work | Lifecycle sweep, reminders, job cleanup, account cleanup, weather checks and optional Ticketmaster sync | Existing scheduler runs inside the same service; no platform cron is required for this topology. Monitor stalled/dead jobs and disk growth. A sleeping/stopped process cannot deliver on time |
| SMTP | Reset/verification emails use server-side TLS SMTP; graceful shutdown awaits pending sends | Configure allowed outbound SMTP and perform a real inbox test. In-flight email sends are not a durable email queue; a process crash may require the user to request another email |
| Web Push | Profile user gesture creates a browser subscription; `/sw.js` rechecks the current session, preferences and membership before showing a generic notification | HTTPS, correct worker scope/content type, persistent VAPID pair and server-side credentials are required. Browser/OS permission, device/background policy and push provider reachability must be tested on the actual device |
| Health | `/api/health` confirms an answering process and timestamp | Also verify persisted reads/writes, worker progress and provider availability; this endpoint alone does not prove volume durability, live APIs or an OS popup |

## Environment variable names

Configure these on the **backend host's secret/environment settings**, not in frontend code or `VITE_*` variables. Names below come from source, not copied local secret values.

| Purpose | Names |
|---|---|
| Core runtime/security | `NODE_ENV`, `PORT`, `APP_ORIGIN`, `TRUST_PROXY`, `CORS_ALLOWED_ORIGINS` |
| Durable paths | `ENCORE_DB`, `ENCORE_TICKET_IMAGE_DIR`, `ENCORE_AVATAR_DIR` |
| Worker controls | `ENABLE_BACKGROUND_JOBS`, `BACKGROUND_JOB_INTERVAL_MS` |
| Web Push | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` |
| OneMap | `ONEMAP_EMAIL`, `ONEMAP_PASSWORD`, optional `ONEMAP_TOKEN`, `ONEMAP_DAILY_LIMIT` |
| LTA DataMall | `LTA_ACCOUNT_KEY`, `LTA_DAILY_LIMIT` |
| NEA/data.gov.sg | optional `DATA_GOV_SG_API_KEY` |
| Ticketmaster | `TICKETMASTER_API_KEY`, `TICKETMASTER_DAILY_LIMIT`, `TICKETMASTER_MAX_PAGES`, `TICKETMASTER_MIN_INTERVAL_MS`, `CONCERT_CACHE_TTL_MS`, `CONCERT_SYNC_INTERVAL_MS` |
| Email | `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM`, `SMTP_USER`, `SMTP_PASS` |
| Optional institutional CA support | `ENCORE_USE_SYSTEM_CA` |

`API_URL` is used by the **Vite development proxy**, not by the production client. A Vercel static frontend needs routing configuration, not an assumed runtime `API_URL` setting. The VAPID public key is intentionally available through the authenticated push configuration endpoint; the private key stays server-side. The LTA SDK key is not used by this backend integration.

Missing optional provider credentials should produce the existing unavailable/fallback states, not fake transport/weather results. OneMap email/password enable token refresh; a token alone eventually expires. Keep budgets conservative. API/hosting usage remains subject to provider quotas and chosen account billing settings; this document does not promise unlimited free hosting or third-party service usage.

## Build and start commands

From the repository root, on the deployment builder:

```sh
npm --prefix client ci
npm --prefix client run build
npm --prefix server ci --omit=dev
```

Start the production API process with:

```sh
npm --prefix server start
```

On Windows terminals use `npm.cmd` where needed. The server currently has no transpilation/build step. Retain the sibling `shared/` directory: both client build and server imports depend on it. A monorepo host configured with `client/` as its root must still make those shared files available during the build.

Serve `client/dist` with the selected production static routing. Preserve real files such as `/sw.js` and `/push-icon.svg`; only non-file, non-API application routes should fall back to `index.html`. Keep `/sw.js` revalidation practical so an old worker does not survive indefinitely. Never use `vite dev` or `vite preview` as the intended public production server.

## Deployment checklist

1. **Prepare the reviewed release.** Preserve current uncommitted audit work; build from an explicitly selected review commit once approved. Do not accidentally deploy a GitHub branch that lacks the local corrections. Pin the Node runtime and install from the checked-in npm locks on the target platform.
2. **Prepare storage before starting.** Allocate a persistent mount, choose absolute database/ticket-image/avatar paths beneath it, and verify the app's UID can create files and SQLite sidecars. Keep secrets, the database and backups outside the static web root. Use least-privilege permissions; investigate ownership instead of making all files world-writable.
3. **Configure origin and HTTPS.** Set production mode and the canonical application origin; configure only actual proxy trust. Verify the Secure/HttpOnly/SameSite cookie and its API path after login. Check requests with a forged Origin/forwarded host are rejected or handled according to the trusted proxy configuration.
4. **Configure routing and headers.** Verify API prefix forwarding, static files, worker scope and direct refresh of `/groups`, `/messages`, `/meetups/...` and `/account/security`. Mirror frontend security headers and retain API no-store/SSE no-cache behavior. Test authenticated image URLs through the same public API routing.
5. **Configure server-only credentials.** Use the host secret store, separate demo/production accounts where practical, and give teammates only the access they need. Keep the VAPID pair stable across restarts; deliberate rotation requires subscriptions to be re-enabled. Do not copy a local `.env` into the build artifact.
6. **Run lifecycle/realtime smoke checks below through the public URL.** Use separate browser contexts/accounts, not cookies manually copied into a single shared login. Check expired/withdrawn access, not only successful delivery.
7. **Prove durability.** Create a synthetic account, group, chat message, availability save and image; restart/redeploy the service; verify all survive and a valid session remains usable. Verify a queued retry resumes after restart. Confirm the service has one instance and no accidental sleeping policy during the demonstration.
8. **Prove external features honestly.** Verify real OneMap lookup/routing, LTA availability/coverage and NEA timestamps; confirm missing-key/quota-failure states. Test SMTP to a real controlled inbox. Enable push by user gesture, background/close the tab as the browser supports, trigger a real message and inspect an actual OS popup. Repeat after logout to verify private delivery is suppressed.
9. **Set monitoring and spending controls.** Monitor process restarts, disk/WAL growth, HTTP failures, job backlog/dead jobs and provider rate limits. Configure the host's available budget controls/alerts before starting a paid plan. Avoid access logs that expose tokens, request bodies or push endpoints.
10. **Take a restorable backup and record rollback.** Store release identity, data backup timestamp and upload archive together. Rehearse restoring to an isolated environment before the public demo.

## Realtime and consent verification

The source already uses one EventSource per signed-in tab, native reconnect and authoritative HTTP refetch on `ready`. It does **not** replay missed events. Clients deduplicate message IDs or refetch authoritative state; the event stream should be treated as an invalidation signal, not a durable event ledger. The server rechecks the cookie-backed session before every send and heartbeat, and chat/planner routes recheck current membership.

Required public-URL smoke checks:

- Open one user's account in two contexts and a second user in another. Send, read, edit/delete where supported, navigate away and return. Verify message deduplication, unread counts and notification resolution across the user's tabs.
- Disconnect one context, send messages and change a meetup in another, reconnect and verify all persisted changes appear after the new `ready`; no message needs to be resent.
- Leave a group/channel or revoke a scope while a former member has it open. Verify subsequent private messages/board data do not reach that member and direct reads/writes fail. A previously displayed screenshot cannot be retroactively erased, but new unauthorized information must not be delivered.
- Log out/revoke the session with an SSE stream open, then trigger another event. Verify the old stream closes without its payload. Switch accounts while a request is pending and verify no previous account's room, unread count or draft appears in the new session.
- Save availability concurrently, propose, withdraw/reopen and approve with the correct users. Hosted groups require the host alone; connected groups require both hosts; a Kaki pair requires both people. Reopening preserves contributions and needs fresh version approvals. Do not add member approvals or change this consent rule as a deployment workaround.

Automated regression evidence, including newly corrected realtime cases, is recorded with actual current suite results in [ENCORE_UX_AUDIT.md](ENCORE_UX_AUDIT.md). Existing coverage lives in `test/server/kakiRealtime.test.js`, `test/server/groupChannel.test.js`, `test/server/connectionChannel.test.js`, `test/server/meetupRealtime.test.js`, `test/server/delivery.test.js`, `test/client/chat/`, notification tests and browser chat/community workflows. Controlled local tests do not establish hosted proxy behavior, multi-instance compatibility, live provider uptime or OS push delivery.

## Git, ZIP and credential review

A path-only review found no tracked private `.env`, SQLite/WAL/SHM, secret directories, test-results or Playwright-report files; `server/.env.example` is intentionally tracked. `.gitignore` covers the actual local environment file, data directory, SQLite sidecars, generated build output and test artifacts. This checks filenames/index membership; it is not proof that no credential was ever pasted into arbitrary source or a historical commit. The main audit separately records its private-value scan and boundaries.

**An ordinary ZIP does not obey `.gitignore`.** Build a source allowlist or inspect the archive contents before sharing or uploading. Exclude `.env`/private environment variants, `server/secrets`, `server/data`, every SQLite database/sidecar, backups, `.git`, `node_modules`, browser reports/traces, screenshots/logs and local agent folders. Keep `.env.example` only after checking it contains placeholders. Git metadata is not normally a tracked project file, but a raw folder ZIP can still include it.

If an earlier ZIP or chat exposed private credentials to people outside their intended trusted recipients, the account owner should review the recipients and rotate the affected provider password/key/token as appropriate, then update only the backend secret store. Deleting the local file or adding an ignore rule does not revoke an already shared credential. No credential values were printed, and no automatic rotation was performed here.

## Backup and rollback

Back up SQLite through its consistent online backup mechanism, such as `better-sqlite3`'s `backup()` API, or stop the app cleanly and take a consistent offline backup. **Do not copy only a live `.db` while ignoring its WAL**. Include the separate image directories and protect backups as private data. Keep an off-volume copy; provider snapshots can supplement, rather than replace, a tested application-aware backup. [SQLite backup API](https://www.sqlite.org/backup.html), [better-sqlite3 backup](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md#backupdestination-options---promise).

Railway provides scheduled volume backups, with its documented limits and storage billing. Render documents daily disk snapshots and specifically cautions against using a raw disk restore as a custom-database recovery strategy. Use a SQLite-consistent backup and verify restoration. [Railway backups](https://docs.railway.com/volumes/backups), [Render recovery guidance](https://render.com/docs/disks).

For rollback: stop new writes, preserve a backup of the failing release's data, redeploy the previously approved source/runtime configuration, and verify schema compatibility before starting it against the current database. If compatibility is uncertain, restore the matching database/upload backup in maintenance mode and acknowledge that writes since that backup are lost. Do not delete WAL/SHM files from an active database or overwrite the running volume with an old ZIP. Run SQLite integrity/foreign-key checks and the authenticated smoke journey on the restored copy first.

## Remaining release gates

The production static/SPA/proxy configuration, durable volume and permissions, host credentials, backup restore rehearsal, hosted SSE recovery, real SMTP and OS push verification are still operator tasks. No hosting configuration, infrastructure mutation, paid resource, deployment or database conversion was created by this audit. Passing local tests supports a controlled demonstration; it does not certify a scaled or multi-region production service.
