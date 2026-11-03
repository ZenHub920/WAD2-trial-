import { MEETUP_SLOT_MS, parseMeetupTimestamp, validateMeetupWindow } from '../../../shared/meetupDates.mjs';

const invalid = code => Object.assign(new Error(code), { status: 400 });
export const coordinates = (latitude, longitude) => Number.isFinite(latitude) && Math.abs(latitude) <= 90
  && Number.isFinite(longitude) && Math.abs(longitude) <= 180;

export function requireMeetupWindow(startsAt, endsAt, concert, now = Date.now()) {
  const result = validateMeetupWindow(startsAt, endsAt, concert, now);
  if (result.error) throw invalid(result.error);
  return result;
}

export function normalizeMeetupTitle(value) {
  const title = typeof value === 'string' ? value.trim() : '';
  if (!title || title.length > 120) throw invalid('invalid_title');
  return title;
}

export function normalizeMeetupPlace(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || !coordinates(input.latitude, input.longitude) || typeof input.label !== 'string'
    || !input.label.trim() || input.label.length > 150) throw invalid('invalid_place');
  return { label: input.label.trim(), latitude: input.latitude, longitude: input.longitude, sheltered: input.sheltered === true ? 1 : 0 };
}

export function normalizeMeetupAvailability(input, startsAt, endsAt) {
  if (!Array.isArray(input) || input.length > (endsAt - startsAt) / MEETUP_SLOT_MS)
    throw invalid('invalid_availability');
  const rows = input.map(row => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw invalid('invalid_availability');
    const start = parseMeetupTimestamp(row.startsAt), end = parseMeetupTimestamp(row.endsAt);
    const hasCoordinates = row.latitude !== undefined || row.longitude !== undefined;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < startsAt || end > endsAt
      || end <= start || start % MEETUP_SLOT_MS || end % MEETUP_SLOT_MS
      || (row.travelMode !== undefined && !['transit', 'drive'].includes(row.travelMode))
      || (hasCoordinates && !coordinates(row.latitude, row.longitude))) throw invalid('invalid_availability');
    return { start, end, latitude: hasCoordinates ? row.latitude : null, longitude: hasCoordinates ? row.longitude : null,
      label: typeof row.label === 'string' ? row.label.slice(0, 100) : null, travelMode: row.travelMode ?? 'transit' };
  }).sort((a, b) => a.start - b.start);
  if (rows.some((row, index) => index && row.start < rows[index - 1].end)) throw invalid('overlapping_availability');
  return rows;
}
