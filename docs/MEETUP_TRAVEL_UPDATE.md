# Meetup travel update

The planner now supports a group whose members use different travel methods. It keeps the existing separate planning page, discussion and host/Kaki approval rules.

## User workflow

1. Open **Plan meetup** from a group, accepted group connection or mutual Kaki chat.
2. Select available half-hour periods. Choose **Public transport** or **Car**, press **Apply travel method to selected times**, and save availability. Starting places are optional and can be found through OneMap. Individual periods can have different methods or origins.
3. Add suggested meeting places and press **Compare travel options**. The server uses each available participant's saved method for OneMap routing. Existing availability defaults to public transport.
4. Recommendations prioritise attendance, combined journey minutes, the longest journey, then votes. There is no monetary budget, journey-time allowance or distance threshold in ranking. Incomplete route data uses the labelled distance fallback. Standalone walking is removed from planner controls.
5. Vote, discuss and propose a time/place. Required hosts or both Kaki participants approve it. Changes to availability, places or votes require fresh approval.
6. On the selected proposal, **Check nearby parking** shows current reporting car parks within 1.5 km, approximate distance and available car lots. It does not reserve parking or predict future availability.
7. **Travel and the journey home** shows current train advisories, station crowd levels and bus loads. Enter a bus stop code and optionally filter the service. Compare alternative stops/lines manually; the app does not automatically reroute anyone.

## API and data flow

`Own availability + private origin + saved travel method → authorised backend → bounded OneMap routes → aggregate recommendations → proposal and human approval`.

| Integration | Purpose and limit |
| --- | --- |
| OneMap Search | Fill approximate starting places and meeting-place coordinates. |
| OneMap Routing | Driving or public-transport duration for each available member. Transit uses a fixed departure one hour before the meeting for comparison, independent of ranking; it is not an arrive-by itinerary. Driving does not predict future traffic. |
| LTA Bus Arrival v3 | Its `Load` fields provide **Seats available**, **Standing available** and **Limited standing space** for up to three approaching vehicles. Arrival timestamps are hidden in the planner, while the backend retains its compatible arrival fields. These are stop/vehicle observations rather than entire-route or future crowd predictions. |
| LTA Passenger Crowd Density | Current **station** crowd levels, not occupancy of individual train carriages. |
| LTA Train Service Alerts | Current service advisories. |
| LTA CarParkAvailabilityv2 | Shared cached snapshot of reporting car lots. At most six pages are fetched per snapshot, and the nearest five car parks are returned. Partial/stale results are identified. It does not cover every Singapore car park or supply fees/reservations. |
| NEA/data.gov.sg | Existing forecasts and recent rainfall remain available. |

Origin coordinates and individual methods are returned only to their owner. Aggregate method counts are public to board participants. External routing receives the coordinates required for calculation; credentials remain on the backend. Provider limits, access checks, stale-result checks and approval checks remain in force.

The migration adds `meetup_availability.travel_mode` without deleting existing availability. Only `transit` and `drive` can be saved. Provider calls and snapshots use the existing server-only credentials and quotas; no new provider account, SDK key or paid service was added.

## Shared chat for connected groups

Once a group-to-group invitation is accepted, current members of both groups can use a shared room. They can find it under **Messages → Groups** or through the accepted connection's **Open shared chat** button. Existing accepted connections also gain a room without a new invitation. Room membership follows the two groups; their original group channels and attendance memberships stay separate.

The room has live messages, replies, editing/deleting one's own messages, read indicators, older-message loading and a personal chat background. **Plan meetup** opens the existing connection-scoped planner, where both hosts still approve the meetup. Chat options link to the existing notification preferences. Messages create the same inbox and durable browser-push jobs as other chats.

Every read/write and queued popup rechecks the accepted connection and current group membership. Departed members and outsiders cannot read or send, cancelled groups/connections lose access, and a blocked pair freezes the room under the shared-board privacy policy. Read-state/background records do not grant membership. Starting locations stay private within the planner.

Messages and their notifications are saved in one transaction. Reading clears the conversation's grouped chat alert. Push uses existing VAPID settings and browser permission; creating a shared room does not automatically enable notifications on a device.

## Setup and verification

Use the existing `ONEMAP_EMAIL`/`ONEMAP_PASSWORD` (or a valid token) and `LTA_ACCOUNT_KEY` in ignored `server/.env`. Restart the backend and visit the planner. See [TEAM_CREDENTIALS_SETUP.md](TEAM_CREDENTIALS_SETUP.md) for local versus shared-backend arrangements.

Verification on 24 October 2026:

- Full backend suite: **555 tests passed**, zero failures or skipped tests.
- Three additional frontend message-state regression tests passed, covering quotes of edited/deleted originals outside the visible history.
- Frontend production build passed with **168 modules**.
- Live OneMap driving and LTA parking checks passed using public Singapore points and ignored local credentials; five nearby reporting car parks were returned. No real user database was changed.
- Scoped source/build/reachable-history credential scan reported zero findings; `git diff --check` passed. The scan is not a guarantee against all possible prior exposure.
- Actual browser push popup delivery still needs its previously documented browser/device check.

Regression coverage includes migration preservation, mixed travel modes, budget-independent ranking, private origins, invalid-duration fallback, parking validation/caching/pagination, bus load semantics, room-scoped replies/history, transaction rollback, queued push suppression, and membership/version changes during requests. Existing accepted connections gain rooms through additive schema changes; no accounts, memberships, messages or seats are reset.

Official references: [OneMap routing](https://www.onemap.gov.sg/apidocs/routing), [LTA API guide](https://datamall.lta.gov.sg/content/dam/datamall/datasets/LTA_DataMall_API_User_Guide.pdf).
