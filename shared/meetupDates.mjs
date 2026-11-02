// The planner accepts the concert day and the preceding travel day. All wire
// timestamps need an explicit offset; browser-local and rollover dates are unsafe.
export const MEETUP_SLOT_MS = 30 * 60 * 1000;
const DAY_MS = 86400000;
const SINGAPORE = 'Asia/Singapore';

function calendarEpoch(year, month, day, hour = 0, minute = 0, second = 0, millisecond = 0) {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, millisecond);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day && date.getUTCHours() === hour
    && date.getUTCMinutes() === minute && date.getUTCSeconds() === second ? date.getTime() : NaN;
}

export function parseMeetupTimestamp(value) {
  if (typeof value !== 'string') return NaN;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!match) return NaN;
  const [, y, m, d, h, min, sec, ms, zone, sign, offsetH, offsetM] = match;
  const local = calendarEpoch(+y, +m, +d, +h, +min, +(sec ?? 0), +(ms ?? '').padEnd(3, '0'));
  const hours = +(offsetH ?? 0), minutes = +(offsetM ?? 0);
  if (!Number.isFinite(local) || hours > 14 || minutes > 59 || (hours === 14 && minutes !== 0)) return NaN;
  const offset = zone === 'Z' ? 0 : (hours * 60 + minutes) * (sign === '-' ? -1 : 1);
  return local - offset * 60000;
}

function dateEpoch(value) {
  const match = typeof value === 'string' && /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? calendarEpoch(+match[1], +match[2], +match[3]) : NaN;
}

function validTimezone(value) {
  try { new Intl.DateTimeFormat('en', { timeZone: value }).format(0); return typeof value === 'string' && Boolean(value); }
  catch { return false; }
}

// Intl supplies IANA offsets without depending on the machine timezone. Reject
// nonexistent or ambiguous local event times rather than claiming a verified time.
function inTimezone(date, time, timezone) {
  const local = parseMeetupTimestamp(`${date}T${time}Z`);
  if (!Number.isFinite(local)) return NaN;
  if (timezone === SINGAPORE) return local - 8 * 3600000;
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  const asLocal = epoch => {
    const fields = Object.fromEntries(formatter.formatToParts(epoch).map(part => [part.type, part.value]));
    return calendarEpoch(+fields.year, +fields.month, +fields.day, +fields.hour, +fields.minute, +fields.second);
  };
  const offsets = new Set([-36, 0, 36].map(hours => {
    const sample = local + hours * 3600000;
    return asLocal(sample) - sample;
  }));
  const matches = [...offsets].map(offset => local - offset).filter(epoch => asLocal(epoch) === local);
  return matches.length === 1 ? matches[0] : NaN;
}

export function singaporeInputValue(epoch) {
  const date = new Date(Number.isFinite(epoch) ? epoch + 8 * 3600000 : NaN);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 16) : '';
}

export function parseSingaporeInput(value) {
  return typeof value === 'string' ? parseMeetupTimestamp(`${value}+08:00`) : NaN;
}

export function meetupDatePolicy(concert, now = Date.now()) {
  const date = dateEpoch(concert?.event_date);
  const timezone = validTimezone(concert?.event_timezone) ? concert.event_timezone : SINGAPORE;
  const eventDate = Number.isFinite(date) ? concert.event_date : null;
  const earliestDate = eventDate ? new Date(date - DAY_MS).toISOString().slice(0, 10) : null;
  const afterDate = eventDate ? new Date(date + DAY_MS).toISOString().slice(0, 10) : null;
  const earliestAt = eventDate ? inTimezone(earliestDate, '00:00:00', timezone) : NaN;
  const dayEnd = eventDate ? inTimezone(afterDate, '00:00:00', timezone) : NaN;
  const trustworthyTimezone = !concert?.event_timezone || validTimezone(concert.event_timezone);
  const eventStart = eventDate && trustworthyTimezone && typeof concert.event_time === 'string'
    ? inTimezone(eventDate, concert.event_time, timezone) : NaN;
  const verified = Number.isFinite(eventStart);
  const latestAt = verified ? eventStart : dayEnd;
  const min = Math.max(earliestAt, (Math.floor(now / MEETUP_SLOT_MS) + 1) * MEETUP_SLOT_MS);
  // Known concert starts are strict: a meetup ending at the start is too late.
  const maxEnd = Number.isFinite(latestAt)
    ? Math.floor((latestAt - (verified ? 1 : 0)) / MEETUP_SLOT_MS) * MEETUP_SLOT_MS : NaN;
  const sameDay = eventDate ? inTimezone(eventDate, '12:00:00', timezone) : NaN;
  const preferred = verified ? Math.floor((eventStart - 3 * 3600000) / MEETUP_SLOT_MS) * MEETUP_SLOT_MS : sameDay;
  const canSchedule = Number.isFinite(min) && Number.isFinite(maxEnd) && maxEnd - min >= MEETUP_SLOT_MS;
  const defaultStartsAt = canSchedule ? Math.max(min, Math.min(preferred, maxEnd - MEETUP_SLOT_MS)) : null;
  return {
    timezone, eventDate, earliestDate, latestDate: eventDate,
    earliestAt: Number.isFinite(earliestAt) ? earliestAt : null,
    latestAt: Number.isFinite(latestAt) ? latestAt : null,
    minimumStartsAt: Number.isFinite(min) ? min : null,
    maximumEndsAt: Number.isFinite(maxEnd) ? maxEnd : null,
    concertStartAt: verified ? eventStart : null, hasVerifiedStart: verified,
    canSchedule, defaultStartsAt,
    defaultEndsAt: canSchedule ? Math.min(defaultStartsAt + 2 * 3600000, maxEnd) : null,
    message: !eventDate ? 'A valid concert date is needed before planning a meetup.'
      : verified ? 'Plan for the concert day or the day before. Your meetup must finish before the concert starts.'
        : 'Plan for the concert day or the day before. The performance start time is unavailable; check that your chosen time is before the performance.',
  };
}

export function validateMeetupWindow(startsAt, endsAt, concert, now = Date.now()) {
  const starts = parseMeetupTimestamp(startsAt), ends = parseMeetupTimestamp(endsAt);
  let error = null;
  if (!Number.isFinite(starts) || !Number.isFinite(ends)) error = 'invalid_meetup_datetime';
  else if (ends <= starts) error = 'meetup_end_must_follow_start';
  else if (starts % MEETUP_SLOT_MS || ends % MEETUP_SLOT_MS) error = 'meetup_half_hour_required';
  else if (ends - starts < MEETUP_SLOT_MS || ends - starts > 7 * DAY_MS) error = 'invalid_meetup_window';
  else if (starts <= now) error = 'meetup_must_be_future';
  else {
    const policy = meetupDatePolicy(concert, now);
    if (!policy.eventDate || policy.earliestAt === null || policy.latestAt === null) error = 'concert_date_unavailable';
    else if (starts < policy.earliestAt || ends > policy.latestAt) error = policy.hasVerifiedStart && ends >= policy.concertStartAt
      ? 'meetup_must_end_before_concert' : 'meetup_outside_concert_dates';
    else if (policy.hasVerifiedStart && ends >= policy.concertStartAt) error = 'meetup_must_end_before_concert';
  }
  return { starts, ends, error };
}
