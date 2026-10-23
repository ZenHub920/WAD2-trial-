import { communityError } from '../db/membershipRepository.js';
import { rankMeetupOptions, SLOT_MS } from './meetupPlanning.js';
import { createSingaporeTravel } from './singaporeTravel.js';
import { createMeetupWeather } from './meetupWeather.js';
import { singaporeCoordinates } from './providerCache.js';

export function createMeetupIntegrations({ repos, fetchImpl = globalThis.fetch, now = Date.now, env = process.env, travel = createSingaporeTravel({ fetchImpl, now, env }), weather = createMeetupWeather({ fetchImpl, now, env }) } = {}) {
  const assertCurrent = (user, id, version) => {
    const current = repos.meetups.access(user, id);
    if (version !== undefined && current.version !== version) throw communityError('stale_meetup_version');
  };
  return {
    weather,
    async locations(user, id, query) {
      assertCurrent(user, id);
      if (typeof query !== 'string' || query.trim().length < 2 || query.length > 100) throw communityError('invalid_location_query', 400);
      const result = await travel.search(query);
      assertCurrent(user, id);
      return result;
    },
    async suggestions(user, id, { mode = 'transit', maxTravelMinutes = 60, shelteredOnly = false } = {}) {
      if (!['transit', 'walk'].includes(mode) || !Number.isInteger(maxTravelMinutes) || maxTravelMinutes < 5 || maxTravelMinutes > 180) throw communityError('invalid_travel_options', 400);
      const input = repos.meetups.planningInput(user, id);
      if (input.status === 'cancelled') throw communityError('meetup_cancelled');
      const places = input.places.filter((p) => !shelteredOnly || p.sheltered);
      const baseline = rankMeetupOptions({ startsAt: input.starts_at, endsAt: input.ends_at, availability: input.availability, places, participantCount: input.participantCount, limit: 1000 });
      // Bounded shortlist: six public places and up to twelve time/place options.
      const placeIds = [...new Set(baseline.map((s) => s.placeId))].slice(0, 6);
      const grouped = placeIds.map((pid) => baseline.filter((s) => s.placeId === pid));
      const candidates = [];
      const optionLimit = Math.max(1, Math.min(12, Math.floor(24 / Math.max(1, input.participantCount))));
      for (let round = 0; candidates.length < optionLimit && grouped.some((g) => g[round]); round++) {
        for (const group of grouped) if (group[round] && candidates.length < optionLimit) candidates.push(group[round]);
      }
      const jobs = [], matrices = [];
      let remaining = 24;
      for (const option of candidates) {
        const people = [...new Map(input.availability.filter((r) => r.starts_at <= option.startsAt && r.ends_at >= option.startsAt + SLOT_MS && singaporeCoordinates(r)).map((r) => [r.user_id, r])).values()];
        const entry = { option, results: [], people: people.length };
        matrices.push(entry);
        if (people.length && people.length <= remaining && travel.configured !== false) {
          remaining -= people.length;
          const destination = places.find((p) => p.id === option.placeId);
          for (const origin of people) jobs.push(async () => {
            const result = await travel.route({ origin, destination, mode, startsAt: option.startsAt - maxTravelMinutes * 60000 });
            entry.results.push(result);
          });
        }
      }
      let jobIndex = 0;
      const deadline = now() + 10000;
      await Promise.all(Array.from({ length: Math.min(4, jobs.length) }, async () => {
        while (jobIndex < jobs.length && now() <= deadline) {
          assertCurrent(user, id, input.version);
          await jobs[jobIndex++]();
        }
      }));
      assertCurrent(user, id, input.version);
      const options = matrices.map(({ option, results, people }) => {
        const complete = people > 0 && people === option.locationRespondents && results.length === people && results.every((r) => r.status === 'available' && Number.isFinite(r.durationMinutes) && !r.stale);
        const durations = complete ? results.map((r) => r.durationMinutes) : [];
        return { ...option, mode, basis: complete ? 'route_times' : 'straight_line_distance', reachableCount: complete ? durations.filter((d) => d <= maxTravelMinutes).length : option.reachableCount, totalTravelMinutes: complete ? durations.reduce((a, b) => a + b, 0) : null, maximumTravelMinutes: complete ? Math.max(...durations) : null, routedRespondents: results.filter((r) => r.status === 'available' && !r.stale).length, missingLocationCount: option.availableCount - people, fallbackReason: complete ? null : travel.configured === false ? 'onemap_not_configured' : people === 0 ? 'starting_locations_not_supplied' : results.find((r) => r.status !== 'available')?.reason || 'route_budget_or_freshness_limit' };
      });
      // Compare travel durations only when the entire shortlist has a complete matrix.
      // Partial provider availability must never make an unknown journey look shorter.
      const routeRanking = options.length > 0 && options.every((o) => o.basis === 'route_times' && o.missingLocationCount === 0);
      options.sort((a, b) => b.availableCount - a.availableCount || (routeRanking ? b.reachableCount - a.reachableCount || a.totalTravelMinutes - b.totalTravelMinutes || a.maximumTravelMinutes - b.maximumTravelMinutes : (a.totalDistanceKm ?? Infinity) - (b.totalDistanceKm ?? Infinity) || (a.maximumDistanceKm ?? Infinity) - (b.maximumDistanceKm ?? Infinity)) || b.votes - a.votes || a.startsAt - b.startsAt || a.placeId.localeCompare(b.placeId));
      return { status: 'available', version: input.version, rankingBasis: routeRanking ? 'route_times' : 'straight_line_distance', options, maxTravelMinutes, shortlistedPlaces: placeIds.length, routesRequested: jobIndex, message: routeRanking ? 'Ranked by attendance, journeys within the time budget, combined journey time, then the longest journey. Transit times use schedules for a departure one travel budget before the meeting; confirm the actual journey nearer the day.' : 'Ranked by attendance and straight-line distance. Complete fresh routes were unavailable for every shortlisted option; any route times shown are supplementary estimates. Add more places to compare alternatives.' };
    },
    async transport(user, id, { busStopCode, trainLine } = {}) {
      assertCurrent(user, id);
      if (busStopCode !== undefined && (typeof busStopCode !== 'string' || !/^\d{5}$/.test(busStopCode))) throw communityError('invalid_bus_stop', 400);
      if (trainLine !== undefined && !['CCL', 'CEL', 'CGL', 'DTL', 'EWL', 'NEL', 'NSL', 'TEL'].includes(trainLine)) throw communityError('invalid_train_line', 400);
      const [trains, buses, crowding] = await Promise.all([travel.trainAlerts(), busStopCode ? travel.busArrivals(busStopCode) : null, trainLine ? travel.crowding(trainLine) : null]);
      assertCurrent(user, id);
      return { trains, buses, crowding, message: 'Live transport information is for travel now, not a prediction for a future meetup.' };
    },
    async environment(user, id) {
      const m = repos.meetups.detail(user, id), place = m.places.find((p) => p.id === m.selected_place_id);
      if (!place || !Number.isFinite(m.selected_start)) return { forecast: { status: 'unavailable', reason: 'choose_a_meeting_place_and_time_first' }, rainfall: null };
      const [forecast, rainfall] = await Promise.all([weather.forecast({ ...place, startsAt: m.selected_start }), weather.rainfall(place)]);
      assertCurrent(user, id, m.version);
      return { forecast, rainfall };
    },
  };
}
