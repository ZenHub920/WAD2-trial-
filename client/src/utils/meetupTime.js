export const MEETUP_TIMEZONE = 'Asia/Singapore';
const dateTime = new Intl.DateTimeFormat('en-SG', { dateStyle: 'medium', timeStyle: 'short', timeZone: MEETUP_TIMEZONE });
const day = new Intl.DateTimeFormat('en-SG', { weekday: 'short', day: 'numeric', month: 'short', timeZone: MEETUP_TIMEZONE });
const clock = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: MEETUP_TIMEZONE });
const observation = new Intl.DateTimeFormat('en-SG', { timeZone: MEETUP_TIMEZONE, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const dayKey = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: MEETUP_TIMEZONE });

export const formatMeetupDateTime = epoch => dateTime.format(epoch);
export const formatMeetupDay = epoch => day.format(epoch);
export const formatMeetupClock = epoch => clock.format(epoch);
export const singaporeDayKey = epoch => dayKey.format(epoch);
export const utcDiscussionTimestamp = value => /(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? value : `${value.replace(' ', 'T')}Z`;

// Shared with the server so browser checks and persistence use the same calendar rules.
export { parseSingaporeInput, singaporeInputValue, validateMeetupWindow, MEETUP_SLOT_MS } from '../../../shared/meetupDates.mjs';

export function formatMeetupObservationTime(value) {
  if (value === null || value === undefined || value === '') return 'Time not reported';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? observation.format(date) : 'Time not reported';
}
