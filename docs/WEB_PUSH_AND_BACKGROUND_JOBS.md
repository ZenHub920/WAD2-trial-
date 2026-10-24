# Browser notifications and background work

## What a user sees

In **Profile → Notification preferences**, category checkboxes control chat, groups,
matches, meetups and feedback. **Enable browser notifications** requests the browser's
permission only after a click. Enabling is per browser/device; logging out unsubscribes
that browser. Messages never appear in a permission prompt or push-provider payload.

The browser can show a system notification while Encore is in the background or
its tab is closed. Delivery still depends on browser/OS support, connectivity and
device settings. Production requires HTTPS; localhost works during development.
On iPhone/iPad, install Encore with **Add to Home Screen** and enable notifications
from the installed web app. A manifest is included; this does not make pages available offline.

## Message-to-popup flow

1. An authorized chat write saves its message. A SQLite trigger inserts a grouped
   inbox item for each eligible recipient. Group chat now does this in the same
   transaction as the message, matching the existing Kaki and ticket-chat behavior.
2. Another trigger inserts one durable delivery job per registered device. A rollback
   removes the message, inbox entry and jobs together. Muted categories create no item.
3. The background worker leases a job, then rechecks unread state, preference,
   suspension and current conversation access. Read/deleted notifications and items
   older than one day are skipped.
4. `web-push` encrypts a payload containing only notification and subscription IDs.
   The browser's service worker then fetches the current title through the authenticated
   API. Logged-out accounts, switched accounts and revoked memberships cannot retrieve it.
5. The worker shows the title and clicking opens the same-origin Encore route. The
   notification tag replaces repeated deliveries of that item. Private pages/API
   responses are never cached by the service worker.

Each chat conversation contributes one inbox item while unread, so messages do not
produce a burst of duplicate popups. Reading removes that chat item, allowing a later
message to create a fresh one. Group chats notify only members granted access to the
channel, rather than everyone in the concert group.

## Durable jobs and reminders

`background_jobs` stores job identity, schedule, attempts and lease state in SQLite.
Workers claim jobs inside an immediate transaction, renew active leases and recover
abandoned leases after a crash. Failures retry with backoff, including provider
`Retry-After`; six failed attempts leave an inspectable `dead` job. Successful and
dead jobs are pruned after 30 days. Provider errors retain a short code, never response
bodies, endpoints or credentials. Delivery is at least once; popup tags reduce duplicates.

The server starts the worker explicitly; creating an Express app in a test starts no timer.
It performs these tasks even when nobody opens the website:

- Every minute: expire pending direct applications and automatic proposals, advance
  existing FIFO seat-queue transitions, and clear expired sessions.
- Every five minutes: remind undecided parties about offers/applications expiring
  within six hours, confirmed meetup participants about a meeting within an hour,
  and eligible recent attendees about feedback. Event keys prevent repeated reminders.
- When weather checks are registered: recheck confirmed meetings within two hours
  every 30 minutes. Fresh rain warnings notify current participants once per plan
  version. Stale/unavailable forecasts do not trigger warnings; changed/cancelled
  plans are rechecked after the provider responds.

This worker does not launch Gale–Shapley matching rounds or change the operator-run
matching policy. Additional handlers, such as concert sync and SMTP delivery, can be
registered without a second scheduler.

## Server integration

Run `migrateDelivery(db)` after group channels and inbox notification migrations.
Construct `createDeliveryService({ db, repos, env })`, then register authenticated
routes using `registerPushRoutes(router, { delivery, requireUser })`.

Call `delivery.registerWeatherChecks(integrations.weather)` to share the weather
cache. Other periodic jobs use `registerTask(name, handler, { intervalMs })`; explicit
one-off jobs use `enqueue({ key, type, payload, availableAt })`. Start with
`delivery.start({ intervalMs: 60000 })` after application setup and `await delivery.stop()`
before closing the database. Completed schedule-bucket keys prevent duplicate runs.

Configure server-only `VAPID_PRIVATE_KEY`, plus `VAPID_PUBLIC_KEY` and a valid contact
`VAPID_SUBJECT` (`mailto:you@example.org` or HTTPS URL). The public key is intentionally
returned by the API so browsers can subscribe. No hosted push provider account or paid
push service is needed. Keep private keys, environment files and the SQLite database
out of Git. Browser subscription endpoints/keys are also private server-side data.

Authenticated endpoints:

| Method and path | Purpose |
| --- | --- |
| `GET /api/me/push/config` | Availability and public VAPID key only |
| `POST /api/me/push/status` | Whether this account owns this device subscription |
| `POST /api/me/push/subscriptions` | Register or renew a validated subscription |
| `DELETE /api/me/push/subscriptions` | Detach this account's device |
| `GET /api/me/push/notifications/:id?subscriptionId=…` | Retrieve an authorized unread popup |

Subscription registration accepts only HTTPS endpoints at the supported browser push
providers (FCM, Mozilla, Apple and Windows), validates key shapes and limits each
account to ten devices. It cannot be used as an arbitrary outbound URL proxy.

## Verification and references

`node --test test/delivery.test.js test/pushWorker.test.js` covers atomic rollback,
private payloads, account switching, authorization, muted/read/stale suppression,
retry/410 cleanup, leases, expiry, reminder deduplication, weather and safe popup clicks.
Live delivery still needs configured VAPID keys and a browser permission grant.

- [Web Push library](https://github.com/web-push-libs/web-push)
- [MDN Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API)
- [WebKit: Web Push for Home Screen web apps](https://webkit.org/blog/13878/)
