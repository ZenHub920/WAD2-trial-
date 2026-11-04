import { test } from 'node:test';
import assert from 'node:assert/strict';
import { meetupActionError, meetupCapabilities, requiredMeetupApprovers } from '../../server/src/services/meetupPolicy.js';
import { coordinates, normalizeMeetupAvailability, normalizeMeetupPlace, normalizeMeetupTitle } from '../../server/src/services/meetupValidation.js';
import { compareMeetupOptions, rankMeetupOptions, meetupRankingContext, SLOT_MS } from '../../server/src/services/meetupPlanning.js';

test('pure meetup policy distinguishes participants, organizers and each explicit lifecycle stage', () => {
  const allowed = {
    planning: { participant: ['contribute', 'discuss'], organizer: ['contribute', 'discuss', 'propose', 'cancel'] },
    proposed: { participant: ['discuss'], organizer: ['discuss', 'approve', 'reopen', 'cancel'] },
    confirmed: { participant: ['discuss'], organizer: ['discuss', 'reopen', 'cancel'] },
    cancelled: { participant: [], organizer: [] },
  };
  for (const [status, roles] of Object.entries(allowed)) for (const [role, actions] of Object.entries(roles))
    for (const action of ['contribute', 'discuss', 'propose', 'approve', 'reopen', 'cancel'])
      assert.equal(meetupActionError(action, status, role === 'organizer') === null, actions.includes(action), `${status}/${role}/${action}`);
  assert.deepEqual(meetupActionError('reopen', 'confirmed', false), { code: 'meetup_organizer_required', status: 403 });
  assert.equal(meetupActionError('contribute', 'confirmed', false).code, 'meetup_reopen_required');
  assert.equal(meetupActionError('reopen', 'cancelled', true).code, 'meetup_cancelled');
});

test('pure organizer identities and exposed capabilities use every required host or both Kaki participants', () => {
  assert.deepEqual(requiredMeetupApprovers({ party_id: 'p' }, ['host', 'host']), ['host']);
  assert.deepEqual(requiredMeetupApprovers({ connection_id: 'c' }, ['hostA', 'hostB']), ['hostA', 'hostB']);
  assert.deepEqual(requiredMeetupApprovers({ kaki_conversation_id: 'k' }, ['untrusted'], ['a', 'b']), ['a', 'b']);
  assert.equal(meetupCapabilities('planning', ['host'], 'member').canPropose, false);
  assert.equal(meetupCapabilities('planning', ['host'], 'member').canContribute, true);
  const proposed = meetupCapabilities('proposed', ['hostA', 'hostB'], 'hostB');
  assert.equal(proposed.canApprove, true); assert.equal(proposed.canReopen, true); assert.equal(proposed.canContribute, false);
  const cancelled = meetupCapabilities('cancelled', ['host'], 'host');
  assert.equal(cancelled.canCancel, false); assert.equal(cancelled.canDiscuss, false);
});

test('availability normalization preserves different slot journeys, optional origins and exact repeat comparison', () => {
  const start = Date.parse('2030-01-01T10:00:00+08:00');
  const periods = [
    { startsAt: '2030-01-01T10:30:00+08:00', endsAt: '2030-01-01T11:00:00+08:00' },
    { startsAt: '2030-01-01T10:00:00+08:00', endsAt: '2030-01-01T10:30:00+08:00', travelMode: 'drive', latitude: 1.3, longitude: 103.8, label: 'Public place' },
  ];
  assert.deepEqual(normalizeMeetupAvailability(periods, start, start + 2 * SLOT_MS), [
    { start, end: start + SLOT_MS, latitude: 1.3, longitude: 103.8, label: 'Public place', travelMode: 'drive' },
    { start: start + SLOT_MS, end: start + 2 * SLOT_MS, latitude: null, longitude: null, label: null, travelMode: 'transit' },
  ]);
  assert.deepEqual(normalizeMeetupAvailability([], start, start + SLOT_MS), []);
  assert.equal(periods[0].latitude, undefined, 'normalization cannot mutate a draft or insert a default location');
  for (const extra of [{ travelMode: 'walk' }, { latitude: null, longitude: null }, { latitude: 91, longitude: 103 }, { longitude: undefined }, { startsAt: '2030-02-30T10:00:00+08:00' }])
    assert.throws(() => normalizeMeetupAvailability([{ ...periods[1], ...extra }], start, start + 2 * SLOT_MS), { message: 'invalid_availability', status: 400 });
  assert.throws(() => normalizeMeetupAvailability([periods[1], periods[1]], start, start + 2 * SLOT_MS), /overlapping_availability/);
});

test('place and title normalization reject malformed coordinates and preserve existing limits', () => {
  assert.equal(normalizeMeetupTitle('  Our meetup  '), 'Our meetup');
  for (const title of ['', ' ', null, 'x'.repeat(121)]) assert.throws(() => normalizeMeetupTitle(title), /invalid_title/);
  assert.deepEqual(normalizeMeetupPlace({ label: '  Station  ', latitude: 1.3, longitude: 103.8, sheltered: true }),
    { label: 'Station', latitude: 1.3, longitude: 103.8, sheltered: 1 });
  for (const place of [null, [], {}, { label: 'Station', latitude: '1.3', longitude: 103.8 }, { label: 'Station', latitude: 1.3, longitude: Infinity }])
    assert.throws(() => normalizeMeetupPlace(place), { message: 'invalid_place', status: 400 });
  assert.equal(coordinates(90, 180), true); assert.equal(coordinates(NaN, 103), false);
});

const option = (placeId, values = {}) => ({ placeId, availableCount: 2, totalDistanceKm: 10, maximumDistanceKm: 6,
  totalTravelMinutes: 30, maximumTravelMinutes: 20, votes: 0, startsAt: 1000, ...values });

test('shared baseline comparator keeps attendance, distance, worst journey, votes, time and ID ordering', () => {
  const options = [
    option('unknown', { totalDistanceKm: null, maximumDistanceKm: null, votes: 99, totalTravelMinutes: 0 }),
    option('last-id-b'), option('last-id-a'), option('earlier', { startsAt: 500 }), option('voted', { votes: 1 }),
    option('fairer', { maximumDistanceKm: 5 }), option('nearer', { totalDistanceKm: 9 }),
    option('more-people', { availableCount: 3, totalDistanceKm: null, maximumDistanceKm: null }),
  ];
  assert.deepEqual(options.sort(compareMeetupOptions).map(row => row.placeId),
    ['more-people', 'nearer', 'fairer', 'voted', 'earlier', 'last-id-a', 'last-id-b', 'unknown']);
});

test('shared complete-route comparator preserves combined time then longest journey without changing attendance priority', () => {
  const options = [option('longer-total', { totalTravelMinutes: 40, maximumTravelMinutes: 20, totalDistanceKm: 0 }),
    option('longer-worst', { totalTravelMinutes: 30, maximumTravelMinutes: 25 }),
    option('balanced'), option('voted-balanced', { votes: 1 }), option('earlier-balanced', { startsAt: 500 }),
    option('more-people', { availableCount: 3, totalTravelMinutes: 90, maximumTravelMinutes: 90 })];
  assert.deepEqual(options.sort((a, b) => compareMeetupOptions(a, b, { routeTimes: true })).map(row => row.placeId),
    ['more-people', 'voted-balanced', 'earlier-balanced', 'balanced', 'longer-worst', 'longer-total']);
  const incomplete = [option('short-unmeasured', { totalDistanceKm: null, maximumDistanceKm: null, totalTravelMinutes: 0 }), option('measured', { totalDistanceKm: 10, totalTravelMinutes: 99 })];
  assert.equal(incomplete.sort(compareMeetupOptions)[0].placeId, 'measured', 'the caller retains the all-complete-matrix gate; fallback ignores supplemental route times');
});

const time = Date.parse('2030-01-01T10:00:00+08:00');
const period = (user_id, offset, origin = {}) => ({ user_id, starts_at: time + offset * SLOT_MS,
  ends_at: time + (offset + 1) * SLOT_MS, ...origin });
const near = { latitude: 1.3, longitude: 103.8 };
const far = { latitude: 1.4, longitude: 103.9 };
const rank = (availability, places, options = {}) => rankMeetupOptions({ startsAt: time,
  endsAt: time + 2 * SLOT_MS, participantCount: 3, availability, places, ...options });

test('attendance precedes unanimous votes and travel, while equal journeys let group votes matter', () => {
  const places = [{ id: 'near', label: 'Nearby', ...near, votes: 0 }, { id: 'voted', label: 'Preferred', ...far, votes: 3 }];
  const options = rank([period('a', 0, near), period('a', 1, near), period('b', 1, near)], places);
  assert.equal(options[0].availableCount, 2);
  assert.equal(options[0].placeId, 'near', 'documented fair travel precedes place votes');
  const equal = rank([period('a', 0, near)], places.map(p => ({ ...p, ...near })));
  assert.equal(equal[0].placeId, 'voted');
  const removed = rank([period('a', 0, near)], places.map(p => ({ ...p, ...near, votes: 0 })));
  assert.equal(removed[0].placeId, 'near', 'removing a vote changes the travel tie deterministically');
});

test('unknown journeys are never zero: different partial origin coverage skips distance for the whole attendance tier', () => {
  const availability = [period('a', 0, near), period('b', 0), period('a', 1, near), period('b', 1, near)];
  const result = rank(availability, [{ id: 'meeting', label: 'Meeting', ...far }]);
  assert.ok(result.every(option => option.distanceCoverageComparable === false));
  assert.ok(result.every(option => option.basis === 'insufficient_journey_data'));
  assert.equal(result[0].startsAt, time + SLOT_MS, 'prefer complete coverage rather than the lower partial total');
  assert.equal(result[0].locationRespondents, 2); assert.equal(result[0].missingLocationCount, 0);
  assert.equal(result[1].locationRespondents, 1);
  assert.equal(meetupRankingContext(result).rankingBasis, 'insufficient_journey_data');
  assert.doesNotMatch(JSON.stringify(result), /user_id|_locationCohort/);
});

test('equal respondent counts from different partial cohorts are not treated as comparable', () => {
  const result = rank([period('a', 0, near), period('b', 0), period('a', 1), period('b', 1, far)],
    [{ id: 'meeting', label: 'Meeting', ...far }]);
  assert.equal(result[0].startsAt, time);
  assert.ok(result.every(option => option.distanceCoverageComparable === false));
});

test('same partial origin cohort permits honest subset distance comparisons and zero origins uses votes', () => {
  const places = [{ id: 'a', label: 'A', ...near, votes: 0 }, { id: 'b', label: 'B', ...far, votes: 2 }];
  const partial = rank([period('a', 0, near), period('b', 0), period('a', 1, near), period('b', 1)], places);
  assert.ok(partial.every(option => option.distanceCoverageComparable));
  assert.equal(partial[0].placeId, 'a'); assert.equal(partial[0].locationRespondents, 1);
  const none = rank([period('a', 0), period('b', 0)], places);
  assert.equal(none[0].placeId, 'b'); assert.equal(none[0].totalDistanceKm, null);
  assert.equal(none[0].missingLocationCount, 2);
});

test('same location at several times remains a time-specific deterministic recommendation', () => {
  const rows = [period('a', 0, near), period('a', 1, near)];
  const places = [{ id: 'b', label: 'B', ...near }, { id: 'a', label: 'A', ...near }];
  const result = rank(rows, places);
  assert.deepEqual(result.map(option => [option.startsAt, option.placeId]), [[time, 'a'], [time, 'b'], [time + SLOT_MS, 'a'], [time + SLOT_MS, 'b']]);
  assert.deepEqual(rank([...rows].reverse(), [...places].reverse()), result);
});
