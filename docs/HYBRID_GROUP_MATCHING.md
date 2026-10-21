# Encore: hybrid group matching

This is the current guide to **Find a Group**. It replaces the older distinction between managed-group host requests and legacy automatic placement. Group formation, Kaki Finder, group connections, notifications, planning and marketplace features remain separate.

The latest GitHub integration also preserves account-wide preference setup, group names/pictures, Back links and the refined Manage group layout. These upstream controls work alongside the hybrid methods below.

## What the two methods do

| Method | Who chooses the group? | What confirms membership? | When is a place reserved? |
| --- | --- | --- | --- |
| **Browse groups** (direct joining) | The seeker applies directly | Host approval; the application already records seeker consent | When the request has a place in the group's shared queue |
| **Find my group** (automatic matching) | Gale–Shapley considers both sides' preferences | **Both host and seeker approve**, in either order | When the proposal has a place in that same queue |

Both methods share concert enrollment, search filters, compatibility, blocks, previous declines, capacity and the one-active-group-per-person-per-concert rule. A group place is **not a concert ticket**. Direct joining creates no matching round or artificial matching result.

**Kaki Finder is separate:** it loads eligible people at shared concerts, applies the user's filters and records like/skip decisions. Two likes form a mutual match and allow chat. Kaki currently uses neither Gale–Shapley nor a compatibility-ranked top-10 feed; Gale–Shapley belongs to automatic seeker-to-group batches.

### One queue for each group

Direct applications and automatic proposals enter **one first-in, first-out queue**, ordered by server arrival. If two companion places remain unconfirmed, the first two pending entries may hold those places; later entries wait without a seat. **The host can approve or decline only the first entry**, even if a later entry already holds another place. An automatic seeker can approve only a held proposal at the front, but can decline at any position. A direct seeker can withdraw at any position.

An automatic request enters a particular group's queue when its proposal is created by a batch, rather than when the seeker first joins the general matching pool. Neither source has priority over an earlier queue entry.

Every pending entry expires **48 hours after its creation**, including time spent waiting. Promotion does not restart the clock. When a held request is withdrawn, declined or expires, its place passes to the next waiting request in the same transaction; a new arrival cannot take it in between. Acceptance turns the same hold into confirmed membership. Once confirmed members fill the group, remaining pending entries close with reason `group_full`, which is not a permanent compatibility decline.

## Walkthrough: what to click and what happens

### 1. Prepare a hosted group

1. Sign in and open Groups. If no account preferences exist, **Before we start, let's get to know you** appears first. Choose at least one About/Wants/Avoid answer and press **Save and unlock groups**. This is answered once per account; saved answers are shared automatically with groups the person creates or joins.
2. Open **Create group**. Enter the group name, optional picture, concert, companion places, seating, budget and arrival details. **Create draft group** opens Manage group.
3. Manage group preserves the name/picture editor, friend/place steppers and bottom **Save changes** bar. Save changes before making invitation links or publishing. The host and invited friends do not consume companion places. Friends accept their private links after completing their own account preference setup.
4. Press **Publish group** when the expected friends and required answers are complete. **Open to meeting other groups** is a separate connection setting. Back links return to the previous in-app screen, with My groups as the fallback.

### 2. A seeker chooses direct joining

1. Complete Profile, then open **Groups → Browse groups** (`/groups`). Complete **Save and unlock groups** if prompted; existing account answers appear in a compact **Your preferences** summary. After this required setup, the friendly choice cards are available. Select a concert and press **Set up group request** to open seating, maximum spending, arrival and activity fields.
2. Under **Already know what you’re looking for?**, press **Browse groups**, then **Save group request**. The helper explains: “Browse groups and choose who to join.” New enrollment saves the selected method atomically. For an existing automatic request, press **Use direct joining** explicitly.
3. Use **Your preferences → Edit** to review the shared account answers if needed. They apply across group pages rather than being entered again for each concert. Standard meanings and confirmed aliases are shared; unknown custom wording uses normalized text matching. Changing answers after applying requires withdrawal and resubmission to renew consent.
4. Use **Search groups**, **Refine results** and sorting. The server filters before returning a page of 20 compatibility-ranked cards. Cards show available places, queue length, member count, group details and supported match reasons. A group with all its places temporarily held can still accept waiting requests; a group filled by confirmed members cannot.
5. Direct results default to **Compare two**. Before the cards appear, an introduction separately explains **Compare** and **Request to join**. Press **Start comparing** to fade into two side-by-side cards; **How this works** reopens the instructions. Reduced-motion settings remove the animations.
6. Tap a card or **Prefer this group**: that card stays on its side while the other slides left and the next unseen group replaces it. This is a local comparison, not an application or an automatic-matching preference. Swipe either card left to skip it. Skipped groups can be reviewed again; when the page runs out, the remaining favorite stays available.
7. Swipe either card right or press **Request to join** / **Join waiting queue** to submit the application. One pending direct application per concert still applies. **List view** remains available and offers the existing optional message field (maximum 500 characters) before **Send application**. Comparing does not send a message; the direct comparison action applies without an optional note.
8. **Your applications** shows the server queue position, whether a place is held and the fixed expiry deadline. Waiting is not confirmed membership and does not itself occupy a seat. To choose another group, press **Withdraw application**; any held place passes to the next request, then you may apply again. History is retained.

Comparisons survive same-page refreshes, failed applications and switching to List view. New concert/filter/page results start a new comparison. Newly unavailable groups disappear on refresh; a failed submission never silently advances to another group. The backend rechecks eligibility and the one-pending limit for every application.

### 3. The receiving host reviews the application

1. Open **Groups → My groups** (`/groups/connect`), then **Join requests**. Manage group also has a **Review join applications** link. Each group has one chronological list combining **Direct application** and **Automatic proposal** cards.
2. Review the public profile, preferences, message, match reasons, date and capacity. Cards show **Next to review** or **Waiting · position N**, whether a seat is held and the expiry deadline. Later entries' host decision controls are disabled. Private account information is not exposed.
3. On the first held direct application, press **Approve group place** or **Decline request**. Approval rechecks eligibility and the live hold inside one transaction. It converts the **same reserved place** into confirmed membership, without reserving a second place. Zero additional available places does not prevent approving the head's existing hold.
4. The seeker refreshes Browse groups and sees their confirmed group card, showing its name/picture, membership origin and links to **View your group** and **Plan meetup**. My groups also lists the membership. No second seeker acceptance is required.
5. Declining the head records the declined pairing and hands its held place to the next waiting request. Withdrawal or expiry also advances the queue, without classifying either as a compatibility decline. Group cancellation releases pending holds and closes waiting entries too.

If the group or submitted preferences changed after applying, approval requests renewed consent: the seeker withdraws, reviews and reapplies. Expired/cancelled holds or conflicting assignments cannot be approved, and failures leave no partial writes.

### 4. A seeker uses automatic matching

1. On the same `/groups` page, the **Meet new concert friends.** choice says “Let us suggest a compatible group.” Press **Find my group** to inspect it. For an existing direct request, first withdraw its pending application, then press **Use automatic matching**.
2. Press **Prefer group** on suitable cards; **Remove preference** reverses this. Saved groups appear in the shortlist. Preferred eligible groups are considered first; other eligible groups remain alternatives.
3. The status panel shows that the open algorithm-mode request is waiting in the pool. **Join matching pool**, when shown, enrolls it. **Refresh status** retrieves authoritative state.
4. An **operator** opens the concert page, uses **Preview matching** if desired, then **Prepare new batch → Run matching round**. Normal seekers cannot run a global round. Enrollment does not start a background scheduler.
5. Gale–Shapley builds independent seeker and group preference orders, uses capacity remaining after confirmed members, verifies supported stability guarantees, and writes the real round, results, proposals and queue claims atomically. A proposal can wait behind existing held requests; a matching result does not bypass queue order.
6. The seeker sees the proposal under Browse groups or **Concert & proposal history**. The host sees its **Automatic proposal** card in **My groups → Join requests**, interleaved with direct applicants in arrival order. The result card shows the group name/picture, saved match reasons, held/waiting state, queue position, reply deadline and each person's approval. The concert page prioritizes active proposals and collapses previous ones. **Why this group match?** expands the saved explanation.
7. Once the proposal is first in line with a held place, the seeker presses **Accept offer** and the host presses **Approve match**, in either order. **The first approval keeps it at the front, pending and reserved; it creates no final membership. The second approval confirms membership.** The first approver sees a waiting-for-the-other-person message.
8. The seeker can **Decline proposal** at any queue position. The host can decline only the head. Decline or expiry advances the queue, passing a released hold to the next request. Once confirmed, the place remains occupied until an authorized membership lifecycle ends it.

Gale–Shapley stability applies to its supported automatic subproblem after confirmed memberships consume capacity. Admission also follows the shared request queue; the entire hybrid arrangement is not claimed to be globally stable.

### 5. Switching, leaving and cancelling

The two view buttons only change the screen being inspected. They never withdraw an application or decline an offer.

- Direct → automatic: withdraw the pending application, then explicitly activate automatic matching. Both waiting and held requests block conflicting assignments; operationally occupied does **not** mean membership is confirmed. Pending position, status and withdrawal controls remain visible.
- Automatic → direct: resolve an active offer first. A first approval is still pending; wait for the other approval or decline. **Leave matching pool** does not silently decline an offer.
- A confirmed membership blocks another assignment for the same concert. Non-host members use **View your group → Leave group**; history remains and the occupied place is released. The screen returns to Browse groups.
- Hosts use **Manage group → Cancel group**. Cancellation ends the group's active assignments and reservations consistently. Hosting elsewhere for that concert requires resolving the existing group first.
- Closed seeker requests use **Reopen group request** when eligible. Saved preferences and historical rounds/applications are retained.

Existing data may contain older parallel applications. Confirming an assignment closes remaining pending alternatives as **superseded**; the new direct workflow permits only one pending application.

### 6. Demonstrate shared capacity

Use separate signed-in browser sessions for the host and two seekers, with the same concert and compatible profiles.

1. Publish a group with **one companion place**. Seeker A applies directly: A is first, the place is held and remaining capacity becomes zero.
2. Seeker B chooses automatic mode and prefers that group. An operator runs a round that assigns B there. B's proposal enters behind A as **Waiting · position 2**, without an additional seat. The host's B controls and B's accept control are disabled; B can still decline.
3. A withdraws, the host declines A, or A expires. The existing hold passes to B atomically. The queue refresh shows B first with a held place; no intervening newcomer can take that place.
4. Host and B approve in either order. The first approval keeps the seat held and creates no membership; the second confirms B. Remaining capacity stays zero throughout this handoff and confirmation.
5. Repeat using direct A approval instead: A's same hold becomes confirmed. Since the one-place group is now filled by a confirmed member, B's pending entry closes with reason `group_full`, without a compatibility decline.
6. For two companion places, the first two pending entries can hold places, but the host still processes only position 1. After it resolves, position 2 becomes actionable. Saved preferences, waiting entries and historical results do not occupy seats; confirmed memberships and live held entries do.

### 7. Quick regression demonstration

- **Kaki:** use two concert participants to like one another; confirm the mutual match and existing chat still work independently of group mode.
- **Connect groups:** publish two opted-in groups, send an invitation, accept from the receiving host and open shared planning. Groups stay separate; connection consumes no companion places.
- **Marketplace:** view/search tickets, open ticket details, save/manage an owned listing and send a permitted buyer inquiry. Existing ticket ownership and chat authorization still apply. Online checkout remains unavailable until a payment provider is configured; this feature does not add payments.

## Backend and data flow

**Direct:** session identity → enrolled direct seeker → shared eligibility/scoring → pending application + proposed queue claim → hold if within the group's available queue places, otherwise wait → head-only host approval converts the same hold to confirmed + membership. Withdrawal/decline/expiry/cancellation advances the queue.

**Automatic:** algorithm-mode seekers + capacity after confirmed members → shared eligibility/scoring + saved preferences → two-sided preference lists → solver/stability verification → real round/results/proposals → same proposed queue claims → when held at the head, both approvals → confirmed claim + membership.

The session supplies identity. The server checks ownership, concert, blocks, declined pairs, profile constraints, current assignment and live capacity again on writes. SQLite IMMEDIATE transactions and database guards prevent competing approvals or a round and direct approval from taking the same final place.

The result UI reads additive public proposal fields `groupName`, `imageUrl`, `reasons` and `confidence`. Identity reflects the current group; reasons come from the immutable matching-result snapshot, so editing preferences later cannot rewrite the explanation. This presentation change does not alter Gale–Shapley, its rankings, the queue or mutual approval.

### Schema and migration

| Change | Purpose |
| --- | --- |
| `seeker_requests.joining_mode` (`direct`/`algorithm`) | Stores the per-concert method. Legacy requests default to algorithm; new enrollment accepts the chosen method. |
| Expanded `group_join_requests` | Preserves separate application history, seeker-request foreign key, optional note, responding host and lifecycle status/reason. Pending, accepted, rejected, withdrawn, expired, superseded and cancelled records remain traceable. |
| `active_seat_claims` | Shared queue/occupancy ledger: source `direct`/`algorithm`, source record, seeker/user/concert/group, `proposed`/`confirmed`/`released`, `queue_order`, `seat_held`, expiry and timestamps. Proposed waiting entries block another assignment but do not occupy seats. |
| Proposal approval timestamps, `approval_policy` and `resolution_reason` | Records each side's real decision and explains automatic closure when a group fills. Public fields include `hostApproved`, `seekerApproved` and `resolutionReason`. |

Unique active-claim indexes prevent multiple assignments for a seeker or user/concert; unique `queue_order` values establish arrival order. Source guards validate the corresponding application/proposal and historical result. Capacity counts confirmed claims plus as many live pending entries as there are unconfirmed places; additional waiting entries consume no extra seats. This remains accurate even before an expiry sweep promotes a waiting entry. Head guards enforce response order. Acceptance confirms the existing hold; lifecycle and capacity-increase triggers promote eligible waiting entries in the same transaction. Released claims remain history.

Startup runs a repeatable migration. Existing entries receive deterministic chronological queue positions and available holds; later pending entries wait without forced seats. This preserves applications and rounds instead of deleting overflow requests. Confirmed memberships are grandfathered without inventing host approval. Pending older automatic host requests become mutual-approval proposals linked to their **existing** round/result, with the old application superseded for migration. Ambiguous assignments or confirmed occupancy exceeding capacity produce reconciliation errors. Migration tests use temporary/in-memory databases.

### API controls

All paths below have the `/api` prefix and use cookie-backed sessions.

| Request | Effect |
| --- | --- |
| `POST /concerts/:id/requests` | Enroll with existing profile fields and optional `joining_mode`. |
| `GET /groups/discover/:concertId` | Shared filtered/ranked/paginated cards, including `queueablePlaces`, `queueLength`, `canJoinQueue` and actual free `remainingCapacity`. |
| `GET /me/seeker-request/:concertId` | Request, joining mode and direct application limit. |
| `PUT /me/seeker-requests/:concertId/joining-mode` `{mode}` | Explicit validated mode transition. |
| `POST /groups/:id/join-requests` `{note?}` | Direct application plus queue entry; holds a place if available, otherwise waits. Deadline is 48 hours after creation. |
| `GET /me/group-join-requests?scope=own&concertId=...` | Own application history. |
| `GET /me/hosted-group-join-requests` | Authorized host inbox. |
| `POST /group-join-requests/:id/withdraw` | Applicant withdraws at any position; any held place passes to the next entry. |
| `POST /group-join-requests/:id/respond` `{action}` | Head-only host `accept`/`reject` (`decline` alias); existing applicant `withdraw` remains supported. |
| `GET /me/current-group-memberships` | Confirmed memberships from both sources, public members and available capacity. |
| `GET/POST/DELETE /me/concerts/:id/matching` | Inspect, enroll or leave the caller's pool; POST retains UUID-v4 `Idempotency-Key` validation. Does not run a global round. |
| `PUT/DELETE /group-preferences/:partyId` | Save/remove a matching preference. |
| `POST /concerts/:id/match` | Operator-only official batch, using an idempotency key. |
| `GET /me/proposals`; `POST /proposals/:id/accept` or `/decline` | Review and respond as the authorized seeker or host. |
| `POST /groups/:id/leave` or `/cancel` | Authorized membership/group lifecycle, preserving history. |

Applications, proposals and application creation return `queueOrder`, `queuePosition`, `queueStatus` (`held`, `waiting`, `confirmed`, `released`), `seatReserved` and `canHostRespond`. The client uses these server values; it does not calculate order from browser timestamps. `canHostRespond` requires position 1 and a live held place. Both approval controls follow this rule; seekers may still withdraw/decline their own entry while waiting.

### File map

Paths are relative to the repository root. Existing matching engines, Kaki and marketplace implementations are retained.

| File | Change and reason |
| --- | --- |
| `server/src/db/hybridMigrations.js` | New repeatable upgrade, claim ledger, source/capacity guards, backfill and approval-policy migration. |
| `server/src/db/admissionQueue.js` | Returns authoritative shared queue position, held/waiting state and head-response permissions. |
| `server/src/db/connection.js` | Runs the upgrade for production and test databases. |
| `server/src/db/capacity.js` | Makes seat claims the shared occupancy source; expires operational reservations. |
| `server/src/db/repositories.js` | Hydrates/persists joining mode and loads accurate remaining group capacity. |
| `server/src/db/recommendationRepository.js` | Shared individual scoring/eligibility, mode checks, application history/approval and current memberships. |
| `server/src/db/groupDiscoveryRepository.js` | Aligns saved preferences, reopening and automatic eligibility with both mechanisms. |
| `server/src/db/proposalRepository.js` | Transactional mutual approval, final membership and proposal decline/expiry/cancellation integration. |
| `server/src/db/membershipRepository.js` | Membership visibility and authorized leave/cancel release; prevents competing assignments. |
| `server/src/db/notificationRepository.js` | Notifies both participants of offers and the other participant after the first approval, with existing deduplication and opt-outs. |
| `server/src/services/matchingService.js` | Uses algorithm-mode unassigned seekers and shared capacity; preserves solver, stability, history and idempotency; enrollment no longer runs global matching. |
| `server/src/controllers/concertController.js` | Validates atomic enrollment mode. |
| `server/src/controllers/matchController.js` | Allows authorized participants' proposal decisions and returns safe caller matching state. |
| `server/src/routes/community.js` | Authenticated application, mode and membership endpoints. |
| `server/src/routes/groupDiscovery.js` | Returns mode/limit metadata with existing discovery controls. |
| `client/src/api.js` | Client methods for mode, applications, host inbox, withdrawal and memberships. |
| `client/src/views/GroupExplorerView.vue` | Shared discovery with two explicit methods, notes, statuses, shortlist, offers and stale-response protection; preserves account preference setup and group identities. |
| `client/src/components/GroupApplicationCard.vue` | Public-profile application review with queue position, held/waiting state, deadline and head-only host controls. |
| `client/src/components/MatchProposalCard.vue` | Role-aware mutual approval and queue gating; seekers can decline while waiting. |
| `client/src/components/GroupListingCard.vue` | Displays waiting-queue availability and length alongside actual free places. |
| `client/src/components/GroupComparisonDeck.vue` | Instruction intro, two-card direct comparison, gestures/buttons, transitions and safe async application. |
| `client/src/utils/groupComparison.js` | Local comparison snapshot and replacement logic; does not write server preferences. |
| `client/src/views/ConcertView.vue` | Clearer automatic result section, active offers, previous proposals and refresh/empty states. |
| `client/src/views/GroupConnectionsView.vue` | My groups combines both mechanisms into each group's chronological request queue; invitation mechanics are preserved. |
| `client/src/views/GroupMembershipView.vue` | Member origins/capacity, inbox link and safe leave navigation; retains upstream name/picture editing, global preferences, Back link and save bar. |
| `server/test/hybridDirect.test.js` | New direct/mode/authorization/history/cross-mechanism regression coverage. |
| `server/test/hybridReservations.test.js` | Migration/ledger regressions: installed-trigger upgrades, legacy queue backfill, mutual-approval conversion, history, rollback, corruption detection and capacity defenses. |
| `server/test/admissionQueue.test.js` | Mixed direct/automatic FIFO, head-only decisions, partial approvals, waiting candidates and history. |
| `server/test/queueLifecycle.test.js` | Capacity increases and natural expiry before a sweep; confirms a queued place never briefly appears free. |
| `server/test/managedMatching.test.js` | Automatic enrollment, operator rounds, shared capacity and mutual-approval checks. |
| `server/test/managedJoinLifecycle.test.js` | Historical managed requests and lifecycle/migration compatibility. |
| `server/test/api.test.js` | Existing HTTP proposal authorization/approval expectations. |
| `server/test/community.test.js` | Existing community repository expectations for explicit direct mode. |
| `server/test/communityApi.test.js` | Authenticated community flow regression checks. |
| `server/test/groupDiscovery.test.js` | Existing discovery/preferences/capacity regression expectations. |
| `server/test/proposalPresentation.test.js` | Public group identity and immutable saved reasons, including legacy fallback. |
| `client/test/groupComparison.test.js` | Comparison position, replacement, exhaustion, skip and refresh regressions. |
| `docs/HYBRID_GROUP_MATCHING.md` | This architecture, integration and demonstration guide. |
| `docs/TEAMMATE_FEATURE_GUIDE.md` | Short pointer to the superseding hybrid behaviour. |

## Verification and local commands

Executed verification on 22 October 2026 (Singapore):

| Check | Result |
| --- | --- |
| Baseline backend suite before changes | 286 passed, zero failures/skips |
| Final complete backend suite including FIFO and proposal presentation: `npm.cmd test` | **352 passed, 30 suites, zero failures/skips** |
| Migration/seat-ledger suite | 17 passed, zero failures/skips |
| Mixed FIFO and queue lifecycle suites | 10 passed, zero failures/skips |
| Direct comparison state tests | 7 passed, zero failures/skips |
| Real-component server-render checks | 22 passed; no Vue warnings |
| Real-component setup interaction checks | 12 passed, including duplicate requests, failure/retry and context/reset cleanup |
| Final production frontend build | Passed; 152 modules |
| JavaScript syntax checks for the UI/presentation update | Changed/new helper and presentation modules passed |
| Production bootstrap against explicit `:memory:` storage, with repeated hybrid migrations | 48 tables; zero foreign-key violations |
| `git diff --check` | Passed |

The existing ticket rollback test intentionally logs a simulated SQLite error while its assertions pass. All database verification used isolated databases; the development database was not reset or migrated during these checks.

The original hybrid result passed 322 tests, integrating upstream group identity/preferences raised that to 330, and the shared queue update passed 350. The result-presentation update raises the backend total to 352. Coverage includes concurrent arrivals, mixed request sources, both approval orders, queue rollback, installed-trigger upgrades, capacity increases, natural expiry and saved explanation history. Account preference changes invalidate pending direct consent, including when the original answers are later restored.

Browser verification in this environment is unavailable: native computer-use reported a missing pipe, and browser inventory contained no browsers/apps. The walkthrough above is a manual acceptance checklist, not a claim that it has been executed here. There is no new scheduler, email/push provider, paid API or payment integration.

Use two PowerShell terminals for development:

```powershell
Set-Location 'C:\Users\aungb\Documents\WAD2\wad2 project\WAD2-trial-\server'
npm.cmd run dev
```

```powershell
Set-Location 'C:\Users\aungb\Documents\WAD2\wad2 project\WAD2-trial-\client'
npm.cmd run dev
```

Open `http://localhost:5173`; the API normally listens on port 3000. Normal server startup applies migrations to the configured database. For verification, use isolated tests instead of resetting your development data:

```powershell
Set-Location 'C:\Users\aungb\Documents\WAD2\wad2 project\WAD2-trial-\server'
npm.cmd test
node --test test/hybridDirect.test.js test/hybridReservations.test.js test/admissionQueue.test.js test/queueLifecycle.test.js test/managedMatching.test.js test/managedJoinLifecycle.test.js
node --input-type=module -e "import { createTestDb } from './src/db/connection.js'; import { migrateHybrid } from './src/db/hybridMigrations.js'; const verificationDb = createTestDb(); migrateHybrid(verificationDb); migrateHybrid(verificationDb); console.log(verificationDb.pragma('foreign_key_check')); verificationDb.close();"
```

The last command bootstraps an in-memory test database, repeats the migration and should print `[]` for foreign-key violations. It does not open your development database. For the operator demo, grant an **existing local test account** access deliberately:

```powershell
npm.cmd run operator:grant -- your-existing-test-account@example.com
```

Build and inspect changes:

```powershell
Set-Location 'C:\Users\aungb\Documents\WAD2\wad2 project\WAD2-trial-\client'
npm.cmd run build
Set-Location '..'
git status --short --branch
git diff --check
git diff --stat
git diff
```

Work began on `hybrid-seeker-group-matching` and was integrated on `feature/hybrid-group-matching`. The two pre-existing local documentation deletions are preserved. The latest instruction authorizes publishing the completed work to `main`. Consult the final implementation report for the resulting Git status and final test totals.
