# Web Push costs and safe deployment

Verified **24 October 2026, Asia/Singapore**. All hosting prices below are **US dollars**, before tax, currency conversion, domains and optional services. Prices can change; check the linked provider pages before purchasing. No infrastructure was deployed or purchased for this task.

## What Encore uses

Encore uses native browser Push/Notifications APIs, a service worker, VAPID, the open-source `web-push` library and its existing Express server. Subscriptions and durable delivery jobs live in the existing SQLite database. There is no OneSignal subscription, Firebase SDK, Redis queue or separate paid notification database.

A legitimate backend event writes an inbox notification and a delivery job in the same database transaction. The worker checks the recipient's current permission/preferences and resource access, then sends a compact encrypted payload to each enrolled device. The service worker retrieves an authorised, generic preview; private chat text, member names and precise meetup locations do not appear in lock-screen previews. Browsers and operating systems still decide when notifications can be delivered and displayed. See [Microsoft's Edge implementation guide](https://learn.microsoft.com/en-us/microsoft-edge/progressive-web-apps/how-to/push) and the [`web-push` project](https://github.com/web-push-libs/web-push).

| Component | Free or paid? | Potential cost | Recommendation |
| --- | --- | --- | --- |
| VAPID key generation | Free | None for generating/retaining a key pair | Generate once locally; retain the private key in server secrets. Rotation requires deliberate handling of existing subscriptions. |
| Browser Push API | Free browser capability | No Encore licence fee | Request permission after an explicit user action. |
| `web-push` library | Free, open source | Existing server CPU and network use | Keep the current implementation; no notification SaaS is necessary. |
| Standard browser push delivery | No per-message fee in this native architecture | Browser/provider quotas and acceptable-use rules still apply | Do not interpret this as unlimited capacity or guaranteed delivery. |
| Express hosting | Local: no hosting bill; public: host dependent | CPU/RAM/instance uptime | Reuse one appropriately sized server. |
| SQLite persistence | Local disk: existing resources; hosted durable disk can cost money | Disk capacity and backups | Mount persistent storage and protect backups. |
| Bandwidth | Often included up to a limit | Push requests, APIs, assets, uploads and retries | Keep payloads short; monitor total outbound traffic. |
| Scheduled notifications | No separate scheduler service required | The existing process must remain running to execute timers/jobs | Accept delayed reminders on sleeping hosts or choose an always-on host explicitly. |
| Optional third-party platforms | Not installed or required | Provider-specific fees if adopted later | Require a separate decision before adding a recurring service. |

These are messaging-service costs, not a promise of free unlimited application hosting. Internet access, electricity and the user's existing computer are outside the local hosting estimate.

## Delivery safeguards that keep resource use bounded

- Jobs are deduplicated by stable event/device keys; the same event is not repeatedly inserted as a new delivery. Thread notifications are coalesced while unread.
- Device subscriptions are unique, authenticated and limited per account. Registering the same device again updates its existing record. One person can intentionally have several devices.
- Sending rechecks unread status, notification preferences, account status and relevant access. Already-read, stale or inaccessible notifications are suppressed.
- Invalid subscriptions are removed individually on HTTP 404/410. Permanent request/configuration failures are not retried indefinitely. Temporary errors use bounded attempts and delayed backoff.
- The worker processes a bounded batch, uses database leases, and avoids overlapping scans. Local event wakeups supplement reconciliation for events written by database triggers or other processes. A periodic reconciliation remains necessary for crash recovery and reminders; no frontend notification polling loop was introduced for push.
- Completed/dead jobs are retained for a limited period and pruned. There is no infinite retry loop, external paid queue or unlimited log of provider response bodies.

At-least-once jobs can still repeat a delivery if a process crashes after the push provider accepts it and before SQLite records completion. Database deduplication reduces repeats; it cannot make an external network side effect exactly-once. Browser notification tags help replace a repeated visible notification.

## Three practical scenarios

| Scenario | Illustrative monthly hosting expense | What works | Limits and reliability |
| --- | --- | --- | --- |
| **A. Local development**: Vue/Vite, Express, local SQLite, Microsoft Edge | **US$0 in new hosting or push-provider charges** using the existing computer/network | Native push on `localhost`, in-app events and reminders while Express runs | Express and the device need connectivity. Timers stop when the computer/server stops. Edge notification permission, Windows settings and browser background behaviour affect display. |
| **B. Small public deployment**: one Express instance and durable SQLite storage | Render example **US$7.25/month**: US$7 web service + illustrative 1 GB disk; bandwidth/build/domain/backup overages extra | Requests and the in-process worker run on one always-on service; no second paid worker is needed | Capacity must be measured. Keep one SQLite writer deployment and persistent uploads. A restart briefly interrupts service; jobs recover after restart. |
| **B alternative. Railway Hobby**: one container plus volume | **At least US$5/month**; actual usage can exceed the included credit | Same architecture with a mounted durable volume | Example only: average 0.25 GB RAM + 0.02 vCPU + 1 GB volume + 1 GB egress = US$3.10 usage, so the US$5 plan minimum applies. These utilisation assumptions are not measurements of Encore. |
| **C. Larger deployment**: more users/devices/messages | **No fixed estimate without measurements** | Free native push delivery remains usable | RAM, CPU, API traffic, uploads, database size, retained jobs/backups and concurrent SSE connections can grow. Measure request latency, queue delay, SQLite contention and disk use before changing infrastructure. A database/architecture change requires separate review. |

Render's current smallest paid web compute is `0.5c-512mb` (formerly Starter), **US$7/month**, and persistent disks cost **US$0.25/GB/month**. This makes US$7.25 an arithmetic example for that service and 1 GB disk, not a complete guaranteed bill. [Render pricing](https://render.com/pricing), [official compute example](https://render.com/articles/production-rails-hosting-guide).

Railway Hobby's US$5 minimum includes US$5 of usage; it is not US$5 plus the first US$5 of resources. Published container rates are RAM **US$10/GB-month**, CPU **US$20/vCPU-month**, volume storage **US$0.15/GB-month**, and service egress **US$0.05/GB**. Usage beyond the credit is chargeable. Railway's Free plan currently provides a small monthly resource credit and a 0.5 GB volume after the trial; that is not a promise that this complete app runs continuously for free. [Railway pricing](https://railway.com/pricing), [resource rates](https://docs.railway.com/pricing), [included-credit explanation](https://docs.railway.com/pricing/understanding-your-bill).

## Sleeping hosts and scheduled work

Render Free web services sleep after 15 minutes without inbound traffic and can take about a minute to wake. Their writable filesystem is ephemeral: a restart, redeploy or spin-down can lose SQLite and uploaded files. They cannot attach persistent disks. **Render Free is unsuitable for Encore's real SQLite accounts/messages/subscriptions.** Use it only with disposable demo data if explicitly desired. [Render Free limitations](https://render.com/docs/free).

Railway's optional serverless mode sleeps a service after ten minutes without outbound packets, then wakes it on an incoming request. Disabling it avoids this specific auto-sleep behaviour but does not make uptime cost-free. Periodic external API refreshes can themselves prevent sleep and keep resource charges running. [Railway serverless behaviour](https://docs.railway.com/guides/cut-idle-costs-serverless).

An incoming application request can wake a sleeping server, generate an event and trigger push after the server starts. An in-process timer cannot wake its own sleeping/stopped host. Overdue durable jobs can catch up after restart, but expired notifications may be deliberately suppressed; a 6 pm reminder is not reliable if no process runs until 8 pm. Hosting availability is separate from successful browser delivery.

For development, run the existing server locally. For a small public app requiring punctual reminders, keep the same worker inside an always-on server with persistent storage. A free external scheduler could invoke a separately reviewed authenticated job endpoint on a schedule, but adds quotas, credentials, wake latency and persistence requirements; none was installed. Repeated keep-alive pings are not a reliability guarantee or a substitute for durable storage.

## Notification traffic estimates

These assumptions are deliberately explicit and are **not measured Encore traffic or exact invoices**:

- 5 logical events per user per day, 30 days/month.
- 1.5 enrolled device subscriptions per user on average; one delivery per eligible device/event.
- 200 bytes of average application JSON per attempt. Actual ID-only payloads may be smaller.
- 2 KiB (2,048 bytes) per attempt for an illustrative allowance covering HTTP/TLS/encryption/protocol overhead. Connection reuse, headers, padding, provider responses and host metering vary.
- 20% extra attempts for temporary failures: multiply planned device deliveries by 1.2. This is an estimate, not the configured maximum retry count.
- No reductions assumed for read suppression, disabled preferences, stale events or coalescing.

`events = users × 5 × 30`; `attempts = events × 1.5 × 1.2`; `estimated bytes = attempts × (200 + 2048)`.

| Users | Logical events/month | Device deliveries before retries | Attempts including 20% retry allowance | JSON only | Estimated transfer including overhead |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 15,000 | 22,500 | 27,000 | 5.4 MB | 60.7 MB / 0.061 GB |
| 1,000 | 150,000 | 225,000 | 270,000 | 54 MB | 607 MB / 0.607 GB |
| 10,000 | 1,500,000 | 2,250,000 | 2,700,000 | 540 MB | 6.07 GB |

MB/GB here are decimal. These numbers exclude normal page/API/chat traffic, images, authorised preview fetches, backups and other providers. They are network planning figures; billable outbound may differ. For illustration, 6.07 GB at Railway's published US$0.05/GB is about **US$0.30 of metered egress**, before credits or unrelated usage. It is not a per-notification charge. At 10,000 users, queue latency and database retention may matter earlier than push bandwidth; load-test real event bursts before relying on the small-service example.

## SQLite persistence and backups

1. Use a persistent local volume. Point `ENCORE_DB` at an absolute file under the mounted directory, for example `/var/data/encore.db`. Set `ENCORE_TICKET_IMAGE_DIR` and `ENCORE_AVATAR_DIR` under persistent storage too. The directory must allow the database, `-wal` and `-shm` files to be created together.
2. Restrict filesystem/service-account access. The database contains account/session information, private messages, locations and push subscriptions. Treat backups as private data; do not put them in Git, frontend assets or a public bucket.
3. Do not copy only the live `.db` file while writes are occurring in WAL mode. Use SQLite's online backup facility through `better-sqlite3`'s `db.backup(destination)` to make a consistent snapshot. Copy the completed backup to separately protected storage; keep encryption keys separate. Alternatively, stop every writer cleanly before an offline copy. [Backup API](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md#backupdestination-options---promise), [SQLite WAL considerations](https://sqlite.org/wal.html).
4. Check backup integrity (`PRAGMA quick_check` or `integrity_check`) and practise a restore into a separate temporary database. A backup file existing does not prove recovery works. Do not restore over the live database during testing.
5. Keep several dated backups with a retention limit and an off-host copy. Choose a recovery interval suitable for the data; monitor failed backups and available disk space. Offline/self-managed backup storage can use existing resources; paid storage must be approved separately.
6. Keep a single application instance for the current local-SQLite design. Do not put separate replicas on independent SQLite files or assume a persistent volume is a distributed database. Scaling the app needs a deliberate storage and coordination design.

Render preserves only paths under the disk mount, and an attached disk restricts scaling/deployment behaviour. Its snapshots are not a replacement for application-consistent database backups. Railway volumes preserve a mounted directory; use the volume rather than the container's ephemeral writable layer. [Render disks](https://render.com/docs/disks), [Railway volumes](https://docs.railway.com/volumes/reference).

## Production and spending controls

- Store private credentials in the host's server-side secret/environment configuration. Never use `VITE_` variables for secrets. Keep the public VAPID key public by design; protect the private key. Configure HTTPS, explicit application origins and the reverse proxy settings described in the security report before public use.
- Keep `ENABLE_BACKGROUND_JOBS` enabled when reminders are required. Use the configured bounded reconciliation interval; do not tune it to continuous polling to compensate for sleeping infrastructure. Monitor pending/dead jobs and oldest due-job delay using private operational access.
- Use host CPU/RAM/disk/network graphs first. Avoid adding paid monitoring solely for push. Log safe error codes and counts instead of provider bodies, tokens, subscription endpoints or exact origins.
- Render's current Hobby workspace includes **5 GB/month** outbound, with **US$0.15/GB** overage. Legacy workspaces can have different allowances. Watch combined frontend/API/provider traffic and build minutes. Render's build-pipeline spending limit is not a general cap on every charge; adding a payment method can allow bandwidth overages. [Current workspace allowances](https://render.com/docs/new-workspace-plans), [billing FAQ](https://render.com/docs/faq).
- Railway separates email alerts from compute hard limits. An email threshold only warns; a configured compute hard limit takes workloads offline. This can delay notifications and application access. Set resource limits and appropriate usage controls explicitly, and check their scope and account eligibility. [Railway cost controls](https://docs.railway.com/pricing/cost-control).
- No hosting plan, paid storage, billing setting or external scheduler was created or changed. A public deployment with durable storage and reliable scheduled execution may require a recurring bill; native push delivery does not.

## Manual verification before relying on push

Configure stable VAPID keys and the public contact, restart Express, then sign in to Encore in Edge and enable notifications from the UI. Test with the tab active, backgrounded and closed; test account switching, device unsubscribe, disabled categories, blocked contacts, expired sessions, Windows notification settings and server restart recovery. Use a legitimate app event between two test accounts. An API/mock test cannot verify Windows actually displayed a popup.

Keys/passwords pasted into chat should be treated as exposed and rotated through the provider's controls before production use. No credentials are reproduced here and none were automatically rotated. Follow the security report's provider-specific actions. Keep the old VAPID key only for an intentional transition; switching it without a subscription migration can stop existing devices receiving messages.
