# Encore: hybrid group matching

This is the current guide to **Find a Group**. It replaces the older distinction between managed-group host requests and legacy automatic placement. Group formation, Kaki Finder, group connections, notifications, planning and marketplace features remain separate.

## What the two methods do

| Method | Who chooses the group? | What confirms membership? | When is a place reserved? |
| --- | --- | --- | --- |
| **Browse groups** (direct joining) | The seeker applies directly | Host approval; the application already records seeker consent | When the host approves |
| **Find my group** (automatic matching) | Gale–Shapley considers both sides' preferences | **Both host and seeker approve**, in either order | As soon as the proposal is created |

Both methods share concert enrollment, search filters, compatibility, blocks, previous declines, capacity and the one-active-group-per-person-per-concert rule. A group place is **not a concert ticket**. Direct joining creates no matching round or artificial matching result.

## Walkthrough: what to click and what happens

### 1. Prepare a hosted group

1. Sign in and open **Groups → Create group**. Choose the concert, companion places, seating, budget and arrival details. **Create draft group** opens Manage group.
2. Set the expected friends and additional companion places. The host and invited friends do not consume companion places. Friends accept their private links and every active member saves preferences.
3. Press **Publish group**. It becomes discoverable when the required members and answers are complete. Enabling **Open to meeting other groups** is a separate connection setting.

### 2. A seeker chooses direct joining

1. Complete Profile, then open **Groups → Browse groups** (`/groups`) and select a concert. Press **Set up group request** to open seating, maximum spending, arrival and activity fields.
2. Under **Already know what you’re looking for?**, press **Browse groups**, then **Save group request**. The helper explains: “Browse groups and choose who to join.” New enrollment saves the selected method atomically. For an existing automatic request, press **Use direct joining** explicitly.
3. Open **Your preferences**, choose About/Wants/Avoid answers and save. Standard meanings and confirmed aliases are shared; unknown custom wording uses normalized text matching.
4. Use **Search groups**, **Refine results** and sorting. The server filters before returning a page of 20 compatibility-ranked cards. Cards show available places, member count, group details and supported match reasons.
5. Press **Request to join** on a card. An optional message field opens, limited to 500 characters. Press **Send application** to submit it.
6. **Your applications** shows the pending request. It persists after refresh and does **not** reserve a place. There is **one pending direct application per concert**. To choose another group, press **Withdraw application**, then apply again. History is retained.

### 3. The receiving host reviews the application

1. Open **Groups → My groups** (`/groups/connect`), then **Join requests**. Manage group also has a **Review join applications** link.
2. Review the applicant's name, public profile, submitted preferences, optional message, match reasons, application date and current remaining capacity. Private account information is not exposed.
3. Press **Approve group place** or **Decline request**. Approval rechecks eligibility and live capacity inside one transaction; a stale card cannot overbook the group.
4. Approval immediately confirms membership. The seeker refreshes Browse groups and sees **Your confirmed group**, its origin and links to **View your group** and **Plan meetup**. My groups also lists the membership. No second seeker acceptance is required.
5. Declining releases no seat because none was reserved. It records the declined pairing for subsequent discovery/matching exclusions. Withdrawal is not a compatibility decline.

If the group or submitted preferences changed after applying, approval requests renewed consent: the seeker withdraws, reviews and reapplies. If another action consumed the place or the seeker joined elsewhere, approval fails without partial writes.

### 4. A seeker uses automatic matching

1. On the same `/groups` page, the **Meet new concert friends.** choice says “Let us suggest a compatible group.” Press **Find my group** to inspect it. For an existing direct request, first withdraw its pending application, then press **Use automatic matching**.
2. Press **Prefer group** on suitable cards; **Remove preference** reverses this. Saved groups appear in the shortlist. Preferred eligible groups are considered first; other eligible groups remain alternatives.
3. The status panel shows that the open algorithm-mode request is waiting in the pool. **Join matching pool**, when shown, enrolls it. **Refresh status** retrieves authoritative state.
4. An **operator** opens the concert page, uses **Preview matching** if desired, then **Prepare new batch → Run matching round**. Normal seekers cannot run a global round. Enrollment does not start a background scheduler.
5. Gale–Shapley builds independent seeker and group preference orders, solves against remaining capacity, verifies supported stability guarantees, and writes the real round, results, proposals and seat claims atomically.
6. The seeker sees the offer under Browse groups or **Concert & proposal history**. The host sees it under **My groups → Automatic match proposals**, or on the concert page. Both cards show the two approval states and deadline.
7. The seeker presses **Accept offer** and the host presses **Approve match**, in either order. **The first approval keeps the proposal pending and the seat reserved; it creates no final membership. The second approval confirms membership.** The first approver sees a waiting-for-the-other-person message.
8. Either person can **Decline proposal** while it is pending, including after their own first approval. Decline or expiry releases the reservation. Once confirmed, the place remains occupied until an authorized membership lifecycle ends it.

Gale–Shapley stability applies to its supported automatic subproblem **after direct memberships consume capacity**. The entire hybrid arrangement is not claimed to be globally stable.

### 5. Switching, leaving and cancelling

The two view buttons only change the screen being inspected. They never withdraw an application or decline an offer.

- Direct → automatic: withdraw the pending application first, then explicitly activate automatic matching.
- Automatic → direct: resolve an active offer first. A first approval is still pending; wait for the other approval or decline. **Leave matching pool** does not silently decline an offer.
- A confirmed membership blocks another assignment for the same concert. Non-host members use **View your group → Leave group**; history remains and the occupied place is released. The screen returns to Browse groups.
- Hosts use **Manage group → Cancel group**. Cancellation ends the group's active assignments and reservations consistently. Hosting elsewhere for that concert requires resolving the existing group first.
- Closed seeker requests use **Reopen group request** when eligible. Saved preferences and historical rounds/applications are retained.

Existing data may contain older parallel applications. Confirming an assignment closes remaining pending alternatives as **superseded**; the new direct workflow permits only one pending application.

### 6. Demonstrate shared capacity

Use separate signed-in browser sessions for the host and two seekers, with the same concert and compatible profiles.

1. Publish a group with **two companion places**. Seeker A applies directly: remaining capacity stays two.
2. Host approves A: remaining capacity becomes one and A has a direct membership.
3. Seeker B chooses automatic mode. An operator runs a round: B's proposal reserves the final place, so remaining capacity becomes zero.
4. One side approves B: capacity remains zero, but B has no confirmed membership yet. The second approval confirms B without consuming another place.
5. Repeat with a fresh eligible seeker/group to decline or expire an automatic proposal: its seat becomes available again. Leaving a direct membership also frees exactly one place.
6. Try a stale approval against a filled group or another assignment: the server rejects it and preserves the previous valid state. Pending applications, saved preferences and historical results never count as occupied places.

### 7. Quick regression demonstration

- **Kaki:** use two concert participants to like one another; confirm the mutual match and existing chat still work independently of group mode.
- **Connect groups:** publish two opted-in groups, send an invitation, accept from the receiving host and open shared planning. Groups stay separate; connection consumes no companion places.
- **Marketplace:** view/search tickets, open ticket details, save/manage an owned listing and send a permitted buyer inquiry. Existing ticket ownership and chat authorization still apply. Online checkout remains unavailable until a payment provider is configured; this feature does not add payments.

## Backend and data flow

**Direct:** session identity → enrolled direct seeker → shared eligibility/scoring → pending application → host's atomic approval → confirmed seat claim + membership → updated capacity/status/notifications.

**Automatic:** algorithm-mode seekers + unoccupied group capacity → shared eligibility/scoring + saved preferences → two-sided preference lists → existing solver/stability verification → persisted round/results/proposals → proposed seat claims → independent approvals → confirmed claim + membership.

The session supplies identity. The server checks ownership, concert, blocks, declined pairs, profile constraints, current assignment and live capacity again on writes. SQLite IMMEDIATE transactions and database guards prevent competing approvals or a round and direct approval from taking the same final place.

### Schema and migration

| Change | Purpose |
| --- | --- |
| `seeker_requests.joining_mode` (`direct`/`algorithm`) | Stores the per-concert method. Legacy requests default to algorithm; new enrollment accepts the chosen method. |
| Expanded `group_join_requests` | Preserves separate application history, seeker-request foreign key, optional note, responding host and lifecycle status/reason. Pending, accepted, rejected, withdrawn, expired, superseded and cancelled records remain traceable. |
| `active_seat_claims` | Authoritative occupancy ledger: source `direct`/`algorithm`, source application/proposal, seeker/user/concert/group, `proposed`/`confirmed`/`released`, expiry and timestamps. |
| Proposal approval timestamps and `approval_policy` | Records each side's real decision. Public proposal fields include `hostApproved` and `seekerApproved`. |

Unique active-claim indexes prevent multiple assignments for a seeker or user/concert. Source guards validate the corresponding application/proposal and historical result; capacity guards prevent overbooking. Lifecycle triggers keep claims, availability and source records aligned. Released claims remain history. All discovery, matching and membership views use the shared capacity calculation.

Startup runs a repeatable migration. Valid existing reservations are backfilled without duplicating seats or rewriting match history. Existing confirmed memberships are grandfathered without inventing host approval. Pending older automatic host requests become mutual-approval proposals linked to their **existing** round/result; the old application is superseded with a migration reason. Inconsistent ownership, capacity or assignments cause a reconciliation error instead of silent data loss. Migration tests use temporary/in-memory databases.

### API controls

All paths below have the `/api` prefix and use cookie-backed sessions.

| Request | Effect |
| --- | --- |
| `POST /concerts/:id/requests` | Enroll with existing profile fields and optional `joining_mode`. |
| `GET /groups/discover/:concertId` | Shared filtered/ranked/paginated cards. |
| `GET /me/seeker-request/:concertId` | Request, joining mode and direct application limit. |
| `PUT /me/seeker-requests/:concertId/joining-mode` `{mode}` | Explicit validated mode transition. |
| `POST /groups/:id/join-requests` `{note?}` | Direct application; no seat reservation. |
| `GET /me/group-join-requests?scope=own&concertId=...` | Own application history. |
| `GET /me/hosted-group-join-requests` | Authorized host inbox. |
| `POST /group-join-requests/:id/withdraw` | Applicant withdraws a pending application. |
| `POST /group-join-requests/:id/respond` `{action}` | Host `accept`/`reject` (`decline` alias); existing `withdraw` action remains supported. |
| `GET /me/current-group-memberships` | Confirmed memberships from both sources, public members and available capacity. |
| `GET/POST/DELETE /me/concerts/:id/matching` | Inspect, enroll or leave the caller's pool; POST retains UUID-v4 `Idempotency-Key` validation. Does not run a global round. |
| `PUT/DELETE /group-preferences/:partyId` | Save/remove a matching preference. |
| `POST /concerts/:id/match` | Operator-only official batch, using an idempotency key. |
| `GET /me/proposals`; `POST /proposals/:id/accept` or `/decline` | Review and respond as the authorized seeker or host. |
| `POST /groups/:id/leave` or `/cancel` | Authorized membership/group lifecycle, preserving history. |

### File map

Paths are relative to the repository root. Existing matching engines, Kaki and marketplace implementations are retained.

| File | Change and reason |
| --- | --- |
| `server/src/db/hybridMigrations.js` | New repeatable upgrade, claim ledger, source/capacity guards, backfill and approval-policy migration. |
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
| `client/src/views/GroupExplorerView.vue` | Shared discovery with two explicit methods, notes, statuses, shortlist, offers and stale-response protection. |
| `client/src/components/GroupApplicationCard.vue` | New public-profile host application review card. |
| `client/src/components/MatchProposalCard.vue` | Role-aware two-sided approval and waiting status. |
| `client/src/views/GroupConnectionsView.vue` | My groups shows direct applications, automatic proposals and current assignments without changing invitation mechanics. |
| `client/src/views/GroupMembershipView.vue` | Member origins/capacity, inbox link and safe leave navigation. |
| `server/test/hybridDirect.test.js` | New direct/mode/authorization/history/cross-mechanism regression coverage. |
| `server/test/hybridReservations.test.js` | Fourteen migration/ledger regressions: existing offers, mutual-approval conversion, history, rollback, corruption detection and capacity defenses. |
| `server/test/managedMatching.test.js` | Automatic enrollment, operator rounds, shared capacity and mutual-approval checks. |
| `server/test/managedJoinLifecycle.test.js` | Historical managed requests and lifecycle/migration compatibility. |
| `server/test/api.test.js` | Existing HTTP proposal authorization/approval expectations. |
| `server/test/community.test.js` | Existing community repository expectations for explicit direct mode. |
| `server/test/communityApi.test.js` | Authenticated community flow regression checks. |
| `server/test/groupDiscovery.test.js` | Existing discovery/preferences/capacity regression expectations. |
| `docs/HYBRID_GROUP_MATCHING.md` | This architecture, integration and demonstration guide. |
| `docs/TEAMMATE_FEATURE_GUIDE.md` | Short pointer to the superseding hybrid behaviour. |

## Verification and local commands

Executed verification on 22 October 2026 (Singapore):

| Check | Result |
| --- | --- |
| Baseline backend suite before changes | 286 passed, zero failures/skips |
| Final complete backend suite: `npm.cmd test` | **322 passed, 30 suites, zero failures/skips** |
| New migration/seat-ledger suite | 14 passed, zero failures/skips |
| Final production frontend build | Passed; 142 modules |
| JavaScript syntax checks | 23 files passed |
| Production bootstrap against explicit `:memory:` storage, with repeated hybrid migrations | 47 tables; zero foreign-key violations |
| `git diff --check` | Passed |

The existing ticket rollback test intentionally logs a simulated SQLite error while its assertions pass. All database verification used isolated databases; the development database was not reset or migrated during these checks.

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
node --test test/hybridDirect.test.js test/hybridReservations.test.js test/managedMatching.test.js test/managedJoinLifecycle.test.js
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

Work began on `hybrid-seeker-group-matching` and is isolated on `feature/hybrid-group-matching`. The two pre-existing documentation deletions were preserved. The latest instruction permits committing/pushing feature branches; main/master remain outside the authorized implementation scope. Consult the final implementation report for the resulting Git status and final test totals.
