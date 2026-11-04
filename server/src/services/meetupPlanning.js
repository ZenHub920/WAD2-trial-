import { MEETUP_SLOT_MS } from '../../../shared/meetupDates.mjs';
export const SLOT_MS = MEETUP_SLOT_MS;
export function compareMeetupOptions(a, b, { routeTimes = false } = {}) {
  return b.availableCount - a.availableCount
    || (!routeTimes && (a.distanceCoverageComparable === false || b.distanceCoverageComparable === false)
      ? b.locationRespondents - a.locationRespondents : 0)
    || (routeTimes
      ? a.totalTravelMinutes - b.totalTravelMinutes || a.maximumTravelMinutes - b.maximumTravelMinutes
      : a.distanceCoverageComparable === false || b.distanceCoverageComparable === false ? 0
      : (a.totalDistanceKm ?? Infinity) - (b.totalDistanceKm ?? Infinity)
        || (a.maximumDistanceKm ?? Infinity) - (b.maximumDistanceKm ?? Infinity))
    || b.votes - a.votes || a.startsAt - b.startsAt || a.placeId.localeCompare(b.placeId);
}
export function distanceKm(a, b) {
  const rad = (d) => (d * Math.PI) / 180,
    dlat = rad(b.latitude - a.latitude),
    dlon = rad(b.longitude - a.longitude);
  const h =
    Math.sin(dlat / 2) ** 2 +
    Math.cos(rad(a.latitude)) *
      Math.cos(rad(b.latitude)) *
      Math.sin(dlon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}
export function rankMeetupOptions({
  startsAt,
  endsAt,
  availability,
  places,
  participantCount,
  durationMinutes = 30,
  limit = 20,
  shelteredOnly = false,
}) {
  const duration = durationMinutes * 60000,
    options = [];
  for (let start = startsAt; start + duration <= endsAt; start += SLOT_MS) {
    const people = new Map();
    for (const row of availability)
      if (row.starts_at <= start && row.ends_at >= start + duration)
        people.set(row.user_id, row);
    if (!people.size) continue;
    const origins = [...people.values()].filter((p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude));
    for (const place of places.filter(p => !shelteredOnly || p.sheltered)) {
      const distances = origins.map((p) => distanceKm(p, place));
      const travelModes = { transit: 0, drive: 0 };
      for (const person of people.values()) travelModes[person.travel_mode === 'drive' ? 'drive' : 'transit']++;
      options.push({
        placeId: place.id,
        label: place.label,
        startsAt: start,
        endsAt: start + duration,
        availableCount: people.size,
        participantCount,
        locationRespondents: distances.length,
        missingLocationCount: people.size - distances.length,
        // Internal only: equal-sized totals from different partial respondent
        // sets are not interchangeable. Never expose identities in recommendations.
        _locationCohort: origins.map(p => p.user_id).sort().join('\u0000'),
        travelModes,
        totalDistanceKm: distances.length
          ? Math.round(distances.reduce((a, b) => a + b, 0) * 100) / 100
          : null,
        maximumDistanceKm: distances.length
          ? Math.round(Math.max(...distances) * 100) / 100
          : null,
        votes: place.votes ?? 0,
      });
    }
  }
  const tiers = new Map();
  for (const option of options) {
    const tier = tiers.get(option.availableCount) ?? [];
    tier.push(option);
    tiers.set(option.availableCount, tier);
  }
  for (const tier of tiers.values()) {
    // Within an attendance tier compare all journeys, or the same observed
    // subset. Otherwise omit distance for the entire tier, preserving a
    // transitive ordering instead of treating an unknown journey as zero.
    const comparable = tier.every(o => o.locationRespondents > 0)
      && (tier.every(o => o.missingLocationCount === 0)
        || new Set(tier.map(o => o._locationCohort)).size === 1);
    for (const option of tier) {
      option.distanceCoverageComparable = comparable;
      option.basis = comparable ? 'straight_line_distance' : 'insufficient_journey_data';
      delete option._locationCohort;
    }
  }
  return options.sort(compareMeetupOptions).slice(0, limit);
}

export function meetupRankingContext(options, { routeTimes = false } = {}) {
  const rankingBasis = routeTimes ? 'route_times'
    : options.some(o => !o.distanceCoverageComparable) ? 'insufficient_journey_data' : 'straight_line_distance';
  const rankingMessage = routeTimes
    ? 'Ranked by attendance, combined journey time, longest individual journey, then place votes. Earlier times and place IDs break remaining ties.'
    : rankingBasis === 'insufficient_journey_data'
      ? 'Attendance comes first. Where starting-location coverage differs, prefer more complete coverage without comparing unequal journey totals, then use place votes, earlier times and place IDs. Comparable options use combined distance and longest individual distance before votes.'
      : 'Ranked by attendance, approximate combined straight-line distance, longest individual distance, then place votes. Earlier times and place IDs break remaining ties. Distance does not account for car or public-transport methods.';
  return { rankingBasis, rankingMessage };
}
