# Encore: group features and teammate integration guide

This guide records the earlier community-feature implementation. For the current person-to-group workflow and integration details, read [HYBRID_GROUP_MATCHING.md](HYBRID_GROUP_MATCHING.md).

> The hybrid guide supersedes the older matching behaviour in sections 3 and 8 below: direct joining allows one pending application per concert; automatic proposals need both host and seeker approval and come from operator-run rounds. The earlier managed-versus-legacy placement restriction no longer applies. Group formation, group connections and the other community features remain as described.

## 1. What was added, and what changed later?

Initially, **Find a Group** provided filters and saved preferences for automatic matching. **Connect Groups** introduced host-to-host invitations and connection status.

The expansion added memberships, friend links, shared preferences, recommendations, host-approved joining, notifications, planning, weather and feedback. Managed groups support **Find my group** using Gale–Shapley as well as manual choice; both require receiving-host approval. Legacy operator placement remains separate.

Connections never merge memberships, consume stranger places or transfer tickets.

## 2. Form a group and collect everyone's preferences

1. The host creates a concert group, then configures **expected friends** and **additional stranger places**. The host already belongs to the group; friends do not consume stranger places.
2. The host answers preferences and creates private friend links: single use, hashed and valid for seven days.
3. Friends sign in, accept and answer preferences. Membership, blocks and friend quota are checked.
4. The host publishes after the expected friends have joined and every active member has answered. Connections require a separate opt-in. Friends-only groups can connect with zero stranger places.

**One active attendance group per person per concert**, including hosting. Leaving/cancelling preserves history; hosts cancel before replacing their group. Changed expected membership or a departing friend returns it to draft.

Preferences have three intents: **About** (what I enjoy), **Wants** (what I want in companions), and **Avoid** (soft dislikes). Standard concepts include singalong, quiet listening, dancing, queueing, merchandise, food, transport and photography.

Aliases such as “supper” and “late-night makan” share one concept. Users confirm suggested meanings or keep custom wording. Unknown phrases match normalized text; there is no AI synonym interpretation.

Each member contributes one vote per concept per intent: three of four choosing supper gives 75% support. Public recommendations use aggregate fractions, keeping individual answers private.

## 3. Individual seeker → group search and joining

1. At `/groups`, the seeker selects a concert, creates an ordinary seeker request and saves preferences. This does not enroll them in Kaki.
2. The server finds published groups with stranger places, checking eligibility, blocks, rejections and hard compatibility against active members.
3. It compares seeker wants with group About preferences, and group wants with seeker About preferences. Avoid overlap reduces the score.
4. Filtering precedes pagination: **20 ranked results per page**, maximum 30, with qualitative compatibility and up to three supported reasons.
5. The seeker can choose **Find my group** to opt into a real Gale–Shapley batch across eligible enrolled seekers and published managed groups, or choose a group manually. Only one pending request per concert is allowed.
6. An algorithm-selected request reserves a place for up to 48 hours. The host reviews the seeker profile/preferences and accepts or rejects. Acceptance converts the reservation into exactly one membership. Manual pending requests do not reserve places.
7. A user without a suitable assignment stays queued and can retry or leave. Withdrawing an algorithm-selected request releases its place and stops automatic enrollment. Rejected pairs are excluded from later rounds; expired requests release their places.

There is **no second seeker acceptance**: Find my group explicitly authorizes a request to the selected group, and manual choice authorizes that group. Settings/member-preference or submitted seeker-answer changes invalidate consent and require review, withdrawal and resubmission. Approving another algorithm request from the same batch does not invalidate the remaining batch requests solely by changing membership counts.

Ranking uses **60% structured compatibility** (vibe, language, logistics, reliability) and **40% mutual concepts**. Profiles incorporate member data, not averaged complete compatibility scores. Custom wants have capped influence; sparse evidence receives limited confidence.

**Flow:** saved preferences → explicit matching enrollment → directional preference lists → Gale–Shapley and stability verification → persisted round and reserved request → host decision → membership/capacity update → notifications. Manual choice skips the batch and uses the existing approval path.

## 4. Group → group recommendations and invitations

1. Both groups form, publish and opt into connections.
2. Open My groups at `/groups/connect` and use Connect groups on an owned-group card. Creation has its own Create group page (`?view=create`); My groups also lists active joined groups. The selected group's connection view uses `?view=connections&groupId=...`. Candidates share the concert; self/same-host, cancelled and blocked pairs are excluded, including active-member blocks.
3. Ranking combines **70% mutual concept compatibility** and **30% shared logistics**: section, arrival and spending. The default page contains 20 candidates with reasons and invitation status.
4. The host sends an invitation. Database uniqueness prevents duplicate/reversed invitations.
5. Only the receiving host can accept or decline. Acceptance rechecks current eligibility. Both groups remain separate and gain access to shared planning.

Declines are final; filled capacity does not prevent connections. Senders can withdraw pending invitations; withdrawn invitations can be sent again.

## 5. Notifications and the future chat integration

Join requests, invitations, proposals, Kaki/marketplace messages, meetup activity and feedback create persistent notifications. Transactions keep event/notification writes together; event keys prevent duplicates. Users control categories and read state; the client polls every 30 seconds.

Future chat must authorize membership, then call `repos.notifications.chatMessage({ messageId, conversationPath, senderId, recipientIds })` in the message-write transaction. Supply authorized recipients, a unique ID and actual chat route. The hook excludes senders and honors opt-outs. Existing chats already have triggers: avoid duplicate calls.

This supplies in-app notifications, not the teammate's chat backend, email or mobile push.

## 6. Plan a meetup and check weather

1. Create a board for one group, an accepted connection or a valid Kaki pair.
2. Participants select 30-minute slots and optional starting coordinates per interval. Raw submissions stay private; others see aggregate results.
3. Participants nominate real places, vote and discuss alternatives.
4. Ranking prioritizes available people, people within 15 km, total straight-line distance, worst distance, then votes. Missing locations do not count as zero distance.
5. Propose a plan: approval requires the group host, both connected-group hosts or both Kaki participants. Changed availability/places/votes invalidate approval; comments do not.

Access follows current membership/blocks. Boards support seven-day windows and coordinate entry, without map search or transit routing. Optimization covers submitted places only.

Singapore's public NEA/data.gov.sg two-hour forecast provides rain advisories for the selected place/time. Outside coverage/horizon or on failure, weather is unavailable. Checks are cached and on demand, without scheduled alerts.

## 7. Post-concert feedback

After the concert day ends in Singapore, genuine confirmed co-members can report attendance, rate and comment. Self-feedback, duplicates, unrelated users and post-event joins cannot manufacture eligibility. A group connection alone is insufficient.

Feedback updates existing reliability using both legacy and direct-group records. History/comments are private to author and recipient. Attendance is participant-reported, not ticket-scan verified.

## 8. Legacy matching, backend safeguards and integration points

Normal-user managed matching is available through GET/POST/DELETE `/api/me/concerts/:id/matching`; POST needs a UUID-v4 Idempotency-Key and returns only the caller's state. Managed assignments use reserved join requests so host approval cannot be bypassed. Legacy operator rounds retain their proposal-confirmation lifecycle. Kaki's swipe/mutual-chat flow remains separate.

Backend fixes aligned decline handling, matching retry keys, proposal expiry, shared capacity checks and transaction rollback on matching-write failure.

Migrations upgrade the schema at startup without resetting data. Conflicting historical memberships are recorded for deliberate resolution.

| Teammate task | Main integration points |
| --- | --- |
| Discovery and invitations | `groupDiscovery.js`, `groupDiscoveryRepository.js`; `/groups`, `/groups/connect` |
| Formation and joining | `community.js`, `membershipRepository.js`, `recommendationRepository.js`; `/groups/:id/members` |
| Preference meaning/scoring | `services/discoveryPreferences.js`, `PreferenceEditor.vue` |
| Notifications/planning/feedback | Corresponding repositories; `/notifications`, `/meetups/:id`, `/feedback` |
| Frontend requests/navigation | Existing `client/src/api.js` and `client/src/main.js` |

Actions use session identity and backend authorization. On 20 October 2026, the managed matching integration passed all 284 backend tests and the frontend production build. An isolated desktop/mobile browser scenario exercised normal-user Gale–Shapley matching, host approval, membership access, reservation release, budget exclusion and opt-out. Full application browser/mobile coverage is not claimed.
