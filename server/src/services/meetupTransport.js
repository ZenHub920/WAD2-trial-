import { communityError } from '../db/membershipRepository.js';
import { singaporeCoordinates } from './providerCache.js';

const unavailable = reason => ({ status: 'unavailable', reason });
const nameKey = value => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const lineAliases = { SLRT: 'STL', PLRT: 'PTL' };

function scopedAlerts(alerts, stations) {
  if (alerts.status !== 'available') return alerts;
  const lines = new Set(stations.flatMap(s => s.lines).flatMap(line => [line, lineAliases[line]].filter(Boolean)));
  const codes = new Set(stations.flatMap(s => s.codes));
  const affectedSegments = (alerts.affectedSegments ?? []).filter(segment => lines.has(segment.line)
    || String(segment.stations).split(/[,|/\s]+/).some(code => codes.has(code)));
  // Cluster-bound messages avoid showing an unrelated city's/line's disruption.
  const messages = [...new Map(affectedSegments.flatMap(s => s.messages ?? [])
    .map(message => [message.content, message])).values()];
  const known = alerts.serviceStatus === 'normal' || (alerts.affectedSegments ?? []).length > 0;
  return { ...alerts, affectedSegments, messages,
    serviceStatus: affectedSegments.length ? 'disrupted' : known ? 'normal' : 'unknown', scope: 'nearby_lines' };
}

function nearbyCrowds(results, stations) {
  const available = results.filter(result => result.status === 'available');
  const reports = available.flatMap(result => (result.stations ?? []).map(station => ({ ...station, stale: Boolean(result.stale) })));
  const levels = { l: 1, m: 2, h: 3 };
  return { status: available.length ? 'available' : 'unavailable',
    reason: available.length ? undefined : results[0]?.reason ?? 'crowding_not_reported',
    stale: available.some(result => result.stale), stations: stations.map(station => {
      const matches = reports.filter(row => station.codes.includes(row.station));
      matches.sort((a, b) => (levels[b.level] ?? 0) - (levels[a.level] ?? 0));
      const reported = matches[0];
      return { station: station.id, name: station.name, codes: station.codes, distanceKm: station.distanceKm,
        level: reported?.level ?? null, observedAt: reported?.observedAt ?? null, endsAt: reported?.endsAt ?? null,
        stale: reported?.stale ?? false };
    }) };
}

export function createMeetupTransport({ repos, travel, now, assertCurrent }) {
  return async (user, id, options) => {
    const current = repos.meetups.detail(user, id);
    const participants = [...repos.meetups.participants(current)].sort();
    const { phase } = options;
    if (!['pre', 'post'].includes(phase)) throw communityError('invalid_transport_phase', 400);
    const venueName = current.concert?.venue ?? '';
    const check = () => assertCurrent(user, id, current.version, participants);
    let anchor = null;
    if (phase === 'pre') {
      const place = current.places.find(p => p.id === current.selected_place_id);
      if (place) anchor = { label: place.label, latitude: place.latitude, longitude: place.longitude, source: 'meeting_place' };
    } else if (options.latitude !== undefined || options.longitude !== undefined) {
      const number = value => typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
      const point = { latitude: number(options.latitude), longitude: number(options.longitude) };
      if (!singaporeCoordinates(point) || (options.label !== undefined && (typeof options.label !== 'string' || options.label.length > 150)))
        throw communityError('invalid_venue_location', 400);
      anchor = { ...point, label: options.label?.trim() || venueName || 'Confirmed concert venue', source: 'confirmed_venue' };
    } else if (venueName && ['singapore', 'sg'].includes(String(current.concert?.city).toLowerCase())) {
      const found = await travel.search(venueName.slice(0, 100));
      check();
      const exact = (found.locations ?? []).filter(location => singaporeCoordinates(location) && nameKey(location.label) === nameKey(venueName));
      // Ambiguous geocoding needs a person's confirmation, never an arbitrary first hit.
      if (exact.length === 1) anchor = { label: exact[0].label, latitude: exact[0].latitude, longitude: exact[0].longitude, source: 'concert_venue' };
    }
    if (!anchor) return { phase, anchor: null, venueName, reason: phase === 'pre' ? 'choose_a_meeting_place_first' : 'venue_location_required',
      nearby: { ...unavailable('location_required'), stations: [], busStops: [] },
      trains: unavailable('location_required'), crowding: { ...unavailable('location_required'), stations: [] },
      buses: { ...unavailable('location_required'), stops: [] }, checkedAt: new Date(now()).toISOString(),
      message: phase === 'pre' ? 'Propose a meeting place first, then check transport around it.' : 'Confirm the concert venue location to find nearby stations and bus stops.' };

    const nearby = await travel.nearbyStops(anchor);
    check();
    const stations = (nearby.stations ?? []).slice(0, 3), stops = (nearby.busStops ?? []).slice(0, 3);
    const lines = [...new Set(stations.flatMap(station => station.lines))].slice(0, 4);
    const [alerts, crowds, busResults] = await Promise.all([
      stations.length ? travel.trainAlerts() : unavailable(nearby.rail?.reason ?? 'no_nearby_stations'),
      Promise.all(lines.map(line => travel.crowding(line))),
      Promise.all(stops.map(stop => travel.busArrivals(stop.code))),
    ]);
    check();
    const buses = { status: busResults.some(result => result.status === 'available') ? 'available' : 'unavailable',
      stops: stops.map((stop, index) => ({ code: stop.code, name: stop.name, distanceKm: stop.distanceKm,
        status: busResults[index].status, reason: busResults[index].reason, stale: Boolean(busResults[index].stale),
        services: (busResults[index].services ?? []).map(service => ({ service: service.service, crowdLevels: service.crowdLevels ?? [] })) })) };
    return { phase, anchor, venueName,
      nearby: { ...nearby, stations, busStops: stops, stationsStatus: nearby.rail?.status, busStopsStatus: nearby.bus?.status },
      trains: scopedAlerts(alerts, stations), crowding: nearbyCrowds(crowds, stations), buses,
      checkedAt: new Date(now()).toISOString(),
      message: 'Current conditions near this location, not a forecast for the concert date. Station crowds describe the station rather than individual trains, and LTA updates them about every ten minutes. Distances are straight-line estimates.' };
  };
}
