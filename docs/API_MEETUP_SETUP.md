# Meetup travel and weather: setup and flow

The planner now helps a Kaki pair, one group, or two connected groups compare public meeting places. Participants still discuss, vote, propose and approve the final plan themselves; the planner does not confirm a meetup for them.

## What users do

1. Open a meetup from their group, connected-groups shared chat or mutual Kaki conversation. Select the half-hour periods when they are available. Accepted group connections have a shared room in **Messages → Groups**, with a **Plan meetup** link using the same connection scope.
2. Select **Public transport** or **Car** for each available time. Optionally search OneMap for an **approximate public starting place**, such as an MRT station. Apply the location and travel method to selected times and save. Different times can have different origins and travel methods. Existing answers default to public transport. The API exposes only the caller's own origin rows; route responses contain group totals, never other members' origin coordinates or labels.
3. Search for a public meeting place and add it to the board. The “Sheltered” checkbox is a participant's suggestion, not a verified property supplied by the mapping API.
4. Optionally filter for sheltered places, then press **Compare travel options**. The server compares a bounded shortlist of saved meeting places and time slots using each person's saved car/public-transport method. Where every shortlisted option has fresh routes for all available participants, it ranks attendance first, then combined journey minutes and the longest journey. Votes break ties. Journey budgets and distance thresholds are not ranking factors; standalone walking is no longer a planner option.
5. If the complete route matrix is unavailable, the whole shortlist keeps a clearly labelled straight-line-distance ranking. Supplementary route times can still appear. Missing locations, outside-Singapore origins, exhausted budgets or provider failures do not become zero-minute journeys. This compares the submitted alternatives; it is not an exhaustive global optimum across Singapore.
6. Vote or propose a time and place. Existing version checks and required approvals remain: a group host, both connected-group hosts, or both Kaki participants. Editing the plan requires fresh approvals.
7. On the selected proposal, check NEA weather, recent rainfall and **nearby car parks** with available car lots. “Travel and the journey home” checks LTA train advisories, optional bus crowd levels at a selected stop and optional station crowds. Bus service filtering helps compare alternatives. Arrival timestamps are not displayed; LTA's Bus Arrival API remains the source of its bus load fields.

**Timing matters:** OneMap public-transport routes use schedules. The planning query uses a fixed departure one hour before the meeting solely for comparison; it is not an arrive-by itinerary or a user budget. Driving estimates do not predict future traffic. LTA crowds and parking counts describe current conditions, including when used to consider the journey home. Bus loads describe up to three approaching vehicles at the selected stop, not an entire route. Parking is not reserved and the provider does not cover every car park. A nearby rainfall station measurement describes recent rain, not future rain. NEA's 24-hour and four-day results are labelled national outlooks, rather than precise rain forecasts for that place and minute. No rain percentages are invented.

## Accounts and server configuration

Register for the provider accounts, then put the issued values in **`server/.env` locally**, using the fields below. Real values are intentionally absent from committed examples and frontend code. Restart the server after changes. Do not use a `VITE_` prefix for these fields or paste their values in chat. The VAPID public key used by browser push is intentionally public; these travel-provider credentials are private.

```dotenv
# Preferred: automatic token renewal on the server
ONEMAP_EMAIL=
ONEMAP_PASSWORD=
# Alternative: manually issued token; normally expires after 3 days
ONEMAP_TOKEN=
LTA_ACCOUNT_KEY=
# Optional for local testing; recommended by data.gov.sg for production
DATA_GOV_SG_API_KEY=
# Request-attempt budgets stored in the existing SQLite database, not paid upgrades
ONEMAP_DAILY_LIMIT=1000
LTA_DAILY_LIMIT=1000
```

| Provider | How to enable | Used for |
| --- | --- | --- |
| OneMap / Singapore Land Authority | [Register](https://www.onemap.gov.sg/apidocs/register), verify the account, then configure the registered email and password. The backend obtains a token and renews it using its expiry timestamp. A manually configured token alone must be replaced when it expires. | Authenticated address search, driving and public-transport journey durations. [Authentication](https://www.onemap.gov.sg/apidocs/authentication), [search](https://www.onemap.gov.sg/apidocs/search), [routing](https://www.onemap.gov.sg/apidocs/routing). |
| LTA DataMall | Complete [Request for API Access](https://datamall.lta.gov.sg/content/datamall/en/request-for-api.html), accept the provider's terms, then put the Account Key issued to your registered account in `LTA_ACCOUNT_KEY`. | Bus load fields from `v3/BusArrival`, `TrainServiceAlerts`, `PCDRealTime`, and `CarParkAvailabilityv2` (car lots only). The [official guide](https://datamall.lta.gov.sg/content/dam/datamall/datasets/LTA_DataMall_API_User_Guide.pdf) checked for this implementation is v6.10, dated 1 October 2026. |
| NEA through data.gov.sg | Works without a key for local testing. For production, follow the [official API overview and registration links](https://guide.data.gov.sg/developer-guide/api-overview) and configure the optional server key. | [2-hour forecast](https://api-open.data.gov.sg/v2/real-time/api/two-hr-forecast), [24-hour forecast](https://api-open.data.gov.sg/v2/real-time/api/twenty-four-hr-forecast), [four-day outlook](https://api-open.data.gov.sg/v2/real-time/api/four-day-outlook), and [rainfall observations](https://api-open.data.gov.sg/v2/real-time/api/rainfall). |

The LTA REST integrations use only `LTA_ACCOUNT_KEY` in the `AccountKey` header. An LTA SDK key is not required or stored by this application. OneMap needs the account's registered email as well as its password for automatic renewal; supplying only a token enables requests until that token expires. JWT expiry is used only as a local cache hint: OneMap remains responsible for authenticating the token. A known expired token is not sent, and the server never returns it to the browser.

These integrations use public government APIs and do not add a paid provider, payment method, paid fallback, or automatic paid upgrade. OneMap's [official workshop](https://www.onemap.gov.sg/apidocs/static/media/OneMap_API_Workshop_Presentation_260825.04f72136081dd249c5ee.pdf) describes its APIs as free to use. LTA offers account registration for its public [dynamic datasets](https://datamall.lta.gov.sg/content/datamall/en/dynamic-data.html); check the terms shown when registering. This implementation does not accept terms or incur account charges on your behalf. Hosting, connectivity and any separately chosen SMTP service remain your own deployment arrangements.

## Backend data flow and guardrails

`Authenticated planner → current meetup membership check → validate inputs → server provider adapter/cache → normalized aggregate results → recheck membership and board version → UI`.

- Credentials go only to the provider's fixed HTTPS host, in server headers or the OneMap authentication POST. Browser responses never contain provider tokens, account passwords, raw route geometry or individual origin rows.
- Provider requests use fixed HTTPS origins and paths, time out after five seconds, reject redirects, cap streamed JSON at two MiB, coalesce identical reads and use bounded in-memory caches. OneMap search caches one day, routes fifteen minutes; LTA bus load data twenty seconds, train advisories and parking one minute, station crowds ten minutes. Parking uses one shared provider snapshot with at most six pages, returning the nearest five reporting car parks within 1.5 km; partial coverage and stale data are labelled. Weather caches match its slower updates.
- One refresh uses at most six places, twelve time/place alternatives and twenty-four route calls, with four simultaneous routes and a ten-second scheduling deadline. Larger boards or partial matrices fall back to distance. OneMap can additionally require authentication and at most one retry for a rejected token. Every actual HTTP attempt, including authentication and retries, consumes the provider budget; cache hits do not. Counters and one-minute authentication/rate-limit backoffs survive a restart in the same SQLite database. They do not override provider quotas. Separate databases or independent replicas do not share these counters.
- Provider limits are conservative: OneMap sixty attempts/minute; LTA thirty/minute; each defaults to one thousand attempts per UTC day. NEA has thirty attempts/minute and a one-thousand-attempt/day guard. A provider 429 pauses fresh reads for one minute. Failed OneMap authentication also backs off rather than trying the password on every search. A cached fallback is explicitly marked `stale` with its fetch time; stale routes never determine the travel ranking. The provider budget tables retain only provider names, counts and deadlines, never tokens, queries, origin coordinates or route geometry.
- Missing credentials return `onemap_not_configured` / `lta_not_configured`; an expired token without renewal credentials returns `onemap_token_expired`. Availability, votes and ordinary distance suggestions keep working. Provider failure messages use fixed reasons and do not expose upstream bodies or credentials.
- Meetup lists now query the caller's candidate groups/connections/Kaki threads in SQL, then recheck live membership and block rules. A former member cannot retain access through a historical match.
- API source attribution is displayed in the planner. Keep the source links when reusing these results elsewhere, and follow the providers' licences and attribution requirements.

## Added endpoints

All are authenticated and participant-scoped; responses use `Cache-Control: private, no-store`.

| Endpoint | Purpose |
| --- | --- |
| `GET /api/meetups/:id/locations?q=City%20Hall` | Search public addresses with OneMap. |
| `GET /api/meetups/:id/travel-suggestions?shelteredOnly=false` | Compare saved places and availability using each member's car/public-transport routes where complete, or labelled distance fallback. Legacy global mode/budget query values do not influence ranking. |
| `GET /api/meetups/:id/transport?busStopCode=83139&trainLine=NSL` | Train advisories, optional stop bus loads and line crowd levels, plus nearby car parking for the selected proposal. |
| `GET /api/meetups/:id/environment` | Forecast for the selected meetup and recent nearby rainfall. |

Existing meetup endpoints remain compatible. `GET /api/meetups/:id/weather` also supports the longer NEA horizons. `planningInput(user,id)` is an internal repository method and must never be returned directly from an HTTP handler.

## Verification

The tests use mock credentials, injected provider responses and temporary databases to check expired-token handling, concurrent renewal, bounded retries, authentication backoff, exact HTTP-attempt budgets across restarts, headers, response bounds, fixed upstream origins, caching, labelled stale fallback, malformed provider responses, timezone handling, forecast coverage, rainfall freshness, ranking, origin privacy, authentication and membership changes during a provider request. Existing community/API tests cover the original planning and approval flows. Live API checks and manual browser checks are recorded separately in the security report; mocked results are never substituted for a live failure in the application.
