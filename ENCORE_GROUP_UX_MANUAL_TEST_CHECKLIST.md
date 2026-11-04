# Group matching and meetup walkthrough

Use separate browser profiles for a seeker, group A's host/member and group B's host/member. This prevents one account's cookies from replacing another's during a screen share. Use an isolated development database and synthetic accounts. Do not share environment files or real credentials on screen.

For each action, ask a person unfamiliar with the app: **What do you think this will do? Who can see the result? What happens next?** Record unexpected answers as usability findings; passing an automated test alone does not prove clarity.

## 1. Browse and request a group

1. Sign in as a seeker with the unchanged private questionnaire completed. Open **Find a group**, choose a future concert, and save concert plans if requested.
2. Open **Browse and choose**. Change to Automatic matching and back. Expected: only the displayed pathway changes; no enrollment, request or matching round is created.
3. Compare two groups. **Keep this group** retains a local comparison choice; **Skip** replaces a card. Neither sends an application or reserves a seat.
4. Choose **Request to join** or use **See all → Ask to join**. Both must open the same review dialog. Try Tab, Shift+Tab and Escape. Expected: focus stays in the dialog; cancelling returns focus and sends nothing.
5. Confirm **Send request** once. Expected: success feedback, a visible pending-request summary and a link to its status. The backend contains one pending request. Queue position, reserved spot and expiry reflect returned facts.
6. In the host profile, open the request notification. Expected: the correct group and record receive focus. Approve or decline. Reload the seeker profile and verify the actual outcome and next group/chat action.

## 2. Automatic matching

1. Open Automatic matching without joining it. Explain the distinction between **Viewing** and **Saved method**. Expected: no enrollment write.
2. Choose **Join automatic matching**. Cancel its confirmation first, then explicitly confirm. Expected: joining becomes active but no search has run.
3. Save a group priority. Expected: the saved name survives a filter/page change and refresh. No direct request, reservation or matching round is created by a priority.
4. Choose **Find a match**. Expected: one durable attempt; either an offer with current approvals or **No suitable group is available.**
5. Refresh. Expected: the latest attempt remains visible, and refresh does not start a new search. If the response was interrupted, use the explicit recovery action; it must reuse the same attempt.
6. With an offer, approve as seeker first. Expected: no membership yet. Approve as host, then verify membership and group chat. Repeat a fresh case with host approving first.
7. With no offer, choose **Browse and choose groups**. Expected: browsing opens while enrollment remains. A separate confirmed **Switch to Browse and choose** is required to activate direct requests.

## 3. Connect two existing groups

1. As host A, open group connections and check the selected source group and concert. Search using a compatibility reason as well as a name. Expected: server count and displayed page agree.
2. Invite group B. Expected: clear waiting state; group membership is unchanged.
3. As host B, open the notification. Expected: received invitation appears before discovery and identifies both groups. Accept it once.
4. Open the acknowledged shared chat from either host and each group's member. Expected: one shared room, current authorized members only, plus its meetup entry. Original group memberships remain separate.
5. In a fresh case decline or withdraw. Expected: explicit final state, no shared room. For an unavailable invitation/room, expect a generic safe explanation without identifying a blocked person or bypassing permissions.

## 4. Plan a meetup together

1. Open **Plan meetup** from the actual pair, group or connected-group conversation. Create/open the plan. Expected: scope and participants refer to that conversation.
2. **Share availability:** select small grid cells using drag, click/tap and keyboard. Paint again to erase. Expected: visible draft state; nothing saved until the save action. Save and verify another participant's board updates.
3. Compare **I can't make any of these times** with leaving the response unanswered. Expected: distinct status/counts after reload. Revise the response and verify the new counts. Never infer unavailable merely from a blank legacy grid.
4. Open the optional **My private starting point — Only you** section. Expected: this helps your journey planning; it is not a shared meeting suggestion or vote, and other members cannot see the private origin.
5. **Suggest places:** add a **meeting place shared with this group**. Other members can vote, change their vote or remove it. Expected: a vote expresses a place preference; it neither selects the final time nor approves a proposal.
6. **Finalise meetup:** as organizer, inspect the leading ranked place/time and reveal alternatives. As member, verify organizer controls are absent. Choosing a dropdown option must not cast a vote.
7. Review the exact place/time and attendance before submitting. If proposing a listed time with nobody available, require a specific acknowledgement; otherwise submission is rejected.
8. Verify confirmation policy: one host for a hosted group; both hosts for connected groups; both people for a pair. Other members contribute availability/votes but are not additional final approvers.
9. Add a participant after a new confirmation. Expected: a clear historical-context note, current authorized participation and no silent cancellation of the confirmed plan.

## 5. Recovery, first impressions and responsive review

- Interrupt one read at a time: discovery, matching, saved priorities, requests, one owned group or recommendations. Other successful sections remain usable; the failed section has its own retry.
- Lose a write response after the server commits. Expected: truthful acknowledged/recovered state; no duplicate request or search. A failed subsequent refresh is shown separately from the successful action.
- Change account/concert/group while a response is delayed, including A → B → A. Expected: no old response, notification focus, success message or private data appears in the new context.
- Test light/dark, desktop and 390px mobile, reduced motion and keyboard-only navigation. No horizontal overflow, inaccessible final action or competing primary buttons.
- After each success identify the visible next action: request status, offer review, group chat, shared chat, availability or final proposal review.

Automated browser tests and screenshots support this walkthrough. Actual independent first-time-user observations and a live group demo require people performing the tasks; do not mark those complete based solely on scripted tests.
