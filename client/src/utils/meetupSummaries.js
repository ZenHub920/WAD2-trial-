import { meetupRouteForBoard, meetupRouteForScope, meetupScopeOf, normalizeMeetupScope } from './meetupNavigation.js';
import { formatMeetupDateTime } from './meetupTime.js';

export function isMeetupHistorical(plan, now = Date.now()) {
  if (plan.status === 'cancelled') return true;
  if (typeof plan.isHistorical === 'boolean') return plan.isHistorical;
  return plan.status === 'cancelled' || (Number.isFinite(plan.endsAt) && plan.endsAt <= now);
}

export function meetupNeedsAttention(plan) {
  return !isMeetupHistorical(plan) && ((plan.status === 'proposed' && plan.capabilities?.canApprove)
    || (plan.status === 'planning' && !plan.hasAvailability));
}

export function meetupsForScope(plans, scope) {
  const key = JSON.stringify(normalizeMeetupScope(scope));
  return plans.filter(plan => JSON.stringify(meetupScopeOf(plan)) === key);
}

export function preferredMeetup(plans) {
  return plans.find(plan => meetupNeedsAttention(plan)) ?? plans.find(plan => !isMeetupHistorical(plan)) ?? plans[0] ?? null;
}

export function meetupPresentation(plan) {
  if (plan.status === 'cancelled') return { label: 'Cancelled', action: 'View cancelled plan', detail: 'This plan is read-only. It is not an active meetup.', stage: 'review' };
  if (plan.status === 'confirmed') return { label: isMeetupHistorical(plan) ? 'Past · Confirmed' : 'Confirmed', action: 'View meetup details', detail: 'The agreed time and place are confirmed.', stage: 'review' };
  if (plan.status === 'proposed') return { label: isMeetupHistorical(plan) ? 'Past · Proposed' : 'Awaiting approval', action: plan.capabilities?.canApprove && !isMeetupHistorical(plan) ? 'Review and approve' : 'View proposed meetup',
    detail: `${plan.approvalCount ?? 0} of ${plan.requiredApprovalCount ?? 0} required approvals${plan.hasApproved ? ' · Your approval is saved' : ''}.`, stage: 'review' };
  return { label: isMeetupHistorical(plan) ? 'Past · Planning' : 'Planning in progress', action: plan.hasAvailability ? 'View planning board' : 'Share availability',
    detail: `${plan.availabilityParticipantCount ?? 0} of ${plan.participantCount ?? 0} participants shared availability.`, stage: plan.hasAvailability ? 'places' : 'availability' };
}

export function meetupSelectedDetails(plan) {
  const parts = [plan.selectedPlace?.label];
  if (Number.isFinite(plan.selectedStart)) parts.push(`${formatMeetupDateTime(plan.selectedStart)} (Singapore)`);
  return parts.filter(Boolean).join(' · ');
}

export function meetupDestination(plans, scope, { from } = {}) {
  const plan = preferredMeetup(meetupsForScope(plans, scope));
  return plan ? meetupRouteForBoard(plan, { from, stage: meetupPresentation(plan).stage }) : meetupRouteForScope(scope, { from });
}

export function meetupActionForScope(plans, scope) {
  const plan = preferredMeetup(meetupsForScope(plans, scope));
  return plan ? meetupPresentation(plan).action : 'Plan meetup';
}
