# Encore: group features and teammate integration guide

This guide explains the original implementation and final behaviour, now integrated into `main`. For endpoint details, see [BACKEND_COMMUNITY_FEATURES.md](BACKEND_COMMUNITY_FEATURES.md); [GROUP_FEATURES_IMPLEMENTATION.md](GROUP_FEATURES_IMPLEMENTATION.md) is historical and contains superseded rules.

## 1. What was added, and what changed later?

Initially, **Find a Group** provided filters and saved preferences for automatic matching. **Connect Groups** introduced host-to-host invitations and connection status.

The expansion added memberships, friend links, shared preferences, recommendations, host-approved joining, notifications, planning, weather and feedback. **Managed groups use seeker choice and receiving-host approval.** Legacy automatic placement remains separate.

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
5. The seeker chooses a group and sends a join request. Only one pending choice per concert is allowed; withdrawal allows another choice. Pending requests do not reserve places.
6. The host reviews the seeker profile/preferences and accepts or rejects. Acceptance transactionally rechecks eligibility/capacity, creates membership and consumes one stranger place.

There is **no second seeker acceptance**. Changed membership/settings/preferences invalidate the original choice; the seeker must review, withdraw and resubmit before approval.

Ranking uses **60% structured compatibility** (vibe, language, logistics, reliability) and **40% mutual concepts**. Profiles incorporate member data, not averaged complete compatibility scores. Custom wants have capped influence; sparse evidence receives limited confidence.

**Flow:** saved preferences → eligibility → mutual ranking → selected request → host decision → membership/capacity update → notifications.

## 4. Group → group recommendations and invitations

1. Both groups form, publish and opt into connections.
2. At `/groups/connect`, the host selects their group. Candidates share the concert; self/same-host, cancelled and blocked pairs are excluded, including active-member blocks.
3. Ranking combines **70% mutual concept compatibility** and **30% shared logistics**: section, arrival and spending. The default page contains 20 candidates with reasons and invitation status.
4. The host sends an invitation. Database uniqueness prevents duplicate/reversed invitations.
5. Only the receiving host can accept or decline. Acceptance rechecks current eligibility. Both groups remain separate and gain access to shared planning.

Declines are final; filled capacity does not prevent connections.

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

Legacy saved preferences prioritize feasible groups; Gale–Shapley produces proposals for confirmation/decline. Managed groups are excluded so automatic placement cannot bypass approval. Kaki's swipe/mutual-chat flow remains separate.

Backend fixes aligned decline handling, matching retry keys, proposal expiry, shared capacity checks and transaction rollback on matching-write failure.

Migrations upgrade the schema at startup without resetting data. Conflicting historical memberships are recorded for deliberate resolution.

| Teammate task | Main integration points |
| --- | --- |
| Discovery and invitations | `groupDiscovery.js`, `groupDiscoveryRepository.js`; `/groups`, `/groups/connect` |
| Formation and joining | `community.js`, `membershipRepository.js`, `recommendationRepository.js`; `/groups/:id/members` |
| Preference meaning/scoring | `services/discoveryPreferences.js`, `PreferenceEditor.vue` |
| Notifications/planning/feedback | Corresponding repositories; `/notifications`, `/meetups/:id`, `/feedback` |
| Frontend requests/navigation | Existing `client/src/api.js` and `client/src/main.js` |

Actions use session identity and backend authorization. Backend tests and frontend build passed; browser/mobile acceptance remains outstanding.
