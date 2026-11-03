import { meetupDatePolicy } from './meetupDates.mjs';

// A performance start is not its finish. With no verified end in the catalogue,
// new participation remains available through the complete local concert day.
// This does not govern historical reads or the planner's pre-performance window.
export function concertParticipationEligibility(concert, now = Date.now()) {
  const policy = meetupDatePolicy({ ...concert, event_time: null }, now);
  if (!policy.eventDate || policy.latestAt === null || !Number.isFinite(now))
    return { eligible: false, reason: 'concert_date_unavailable', cutoffAt: null };
  const eligible = now < policy.latestAt;
  return { eligible, reason: eligible ? null : 'concert_finished', cutoffAt: policy.latestAt };
}

// Group creation needs an upcoming performance, not a guessed concert end.
// Unverified times (including doors) retain the complete local event day.
export function concertGroupCreationEligibility(concert, now = Date.now()) {
  const policy = meetupDatePolicy(concert, now);
  if (!policy.eventDate || policy.latestAt === null || !Number.isFinite(now))
    return { eligible: false, reason: 'concert_date_unavailable', cutoffAt: null, hasVerifiedStart: false };
  const eligible = now < policy.latestAt;
  return { eligible, reason: eligible ? null : policy.hasVerifiedStart ? 'concert_started' : 'concert_day_ended',
    cutoffAt: policy.latestAt, hasVerifiedStart: policy.hasVerifiedStart };
}
