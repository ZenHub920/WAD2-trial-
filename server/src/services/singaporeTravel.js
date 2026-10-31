import { createProviderCache, providerJson, providerError, singaporeCoordinates, boundedLimit } from './providerCache.js';
import { createProviderBudget } from './providerBudget.js';
import { distanceKm } from './meetupPlanning.js';

const ONEMAP = 'https://www.onemap.gov.sg/api';
const LTA = 'https://datamall2.mytransport.sg/ltaodataservice';
const unavailable = (reason) => ({ status: 'unavailable', reason });
const text = (value, length = 200) => typeof value === 'string' ? value.slice(0, length) : '';
const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
const busLoads = { SEA: 'Seats available', SDA: 'Standing available', LSD: 'Limited standing' };
const numeric = (value) => typeof value === 'number' || (typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value)) ? Number(value) : NaN;
const railLines = { NS: 'NSL', EW: 'EWL', CG: 'CGL', NE: 'NEL', CC: 'CCL', CE: 'CEL', DT: 'DTL', TE: 'TEL', BP: 'BPL', SE: 'SLRT', SW: 'SLRT', STC: 'SLRT', PE: 'PLRT', PW: 'PLRT', PTC: 'PLRT' };
const stationCodes = (value) => typeof value === 'string' && value.length <= 100
  ? [...new Set(value.trim().toUpperCase().split(/[|/,\s-]+/).filter(code => /^(?:[A-Z]{1,3}\d{1,2}[A-Z]?|STC|PTC)$/.test(code)))] : [];
const lineForCode = (code) => railLines[code.replace(/\d.*$/, '')];
function nearbyRecords(rows, point, kind, radiusMeters) {
  if (!Array.isArray(rows) || rows.length > 1000) throw providerError('invalid_provider_response');
  const records = new Map(); let validRows = 0;
  for (const row of rows) {
    if (!object(row)) continue;
    const location = { latitude: numeric(row.lat), longitude: numeric(row.lon) };
    const name = text(row.name, 150).trim(), codes = kind === 'rail' ? stationCodes(row.id) : [];
    const rawCode = typeof row.id === 'string' ? row.id : Number.isSafeInteger(row.id) && row.id > 0 ? String(row.id) : '';
    const code = /^\d{1,5}$/.test(rawCode) && Number(rawCode) > 0 ? rawCode.padStart(5, '0') : '';
    if (!singaporeCoordinates(location) || !name || (kind === 'rail' ? !codes.length : !code)) continue;
    validRows++;
    const distance = distanceKm(point, location);
    if (!Number.isFinite(distance) || distance * 1000 > radiusMeters) continue;
    const key = kind === 'rail' ? name.toUpperCase().replace(/\s+/g, ' ') : code;
    const previous = records.get(key);
    const allCodes = kind === 'rail' ? [...new Set([...(previous?.codes ?? []), ...codes])].sort() : [];
    const closest = previous && previous.distance < distance ? previous : { name, ...location, distance };
    records.set(key, kind === 'rail'
      ? { ...closest, id: allCodes.join('|'), codes: allCodes, lines: [...new Set(allCodes.map(lineForCode).filter(Boolean))] }
      : { ...closest, code });
  }
  if (rows.length && !validRows) throw providerError('invalid_provider_response');
  return [...records.values()].sort((a, b) => a.distance - b.distance || a.name.localeCompare(b.name)).slice(0, 3)
    .map(({ distance, ...record }) => ({ ...record, distanceKm: Math.round(distance * 100) / 100 }));
}
function expiryOf(value, fallback) {
  try {
    // An expiry hint only: signature/authentication remains the provider's responsibility.
    const payload = JSON.parse(Buffer.from(value.split('.')[1], 'base64url').toString('utf8'));
    return Number.isFinite(payload.exp) ? payload.exp * 1000 : fallback;
  } catch { return fallback; }
}
export function createSingaporeTravel({ db, fetchImpl = globalThis.fetch, now = Date.now, env = process.env } = {}) {
  // Logical cache misses can perform auth + retries; count actual HTTP attempts instead.
  const oneCache = createProviderCache({ now, dailyLimit: Infinity, requestsPerMinute: Infinity });
  const ltaCache = createProviderCache({ now, dailyLimit: Infinity, requestsPerMinute: Infinity });
  const oneBudget = createProviderBudget({ db, provider: 'onemap', now, dailyLimit: boundedLimit(env.ONEMAP_DAILY_LIMIT, 1000, 10000), requestsPerMinute: 60 });
  const ltaBudget = createProviderBudget({ db, provider: 'lta', now, dailyLimit: boundedLimit(env.LTA_DAILY_LIMIT, 1000, 10000), requestsPerMinute: 30 });
  let token = typeof env.ONEMAP_TOKEN === 'string' ? env.ONEMAP_TOKEN : '', tokenExpiry = token ? expiryOf(token, now() + 12 * 3600000) : 0, authenticating = null;
  const credentials = Boolean(env.ONEMAP_EMAIL && env.ONEMAP_PASSWORD);
  const configured = Boolean(token || credentials);
  async function request(budget, url, options) {
    budget.consume();
    try { return await providerJson(fetchImpl, url, options); }
    catch (error) { budget.block(error.reason); throw error; }
  }
  async function authenticate() {
    if (token && tokenExpiry > now() + 60000) return token;
    if (!credentials) throw providerError(token ? 'onemap_token_expired' : 'onemap_not_configured');
    if (!authenticating) authenticating = (async () => {
      let json;
      try { json = await request(oneBudget, `${ONEMAP}/auth/post/getToken`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: env.ONEMAP_EMAIL, password: env.ONEMAP_PASSWORD }) }); }
      catch (error) {
        // OneMap documents 404 for an unregistered account/invalid credential input.
        if ([400, 404].includes(error.upstreamStatus) || error.reason === 'invalid_provider_response') {
          oneBudget.block('provider_authentication_failed'); throw providerError('provider_authentication_failed');
        }
        throw error;
      }
      if (!object(json) || typeof json.access_token !== 'string' || !json.access_token || json.access_token.length > 8192 || /\s/.test(json.access_token)
        || !Number.isFinite(Number(json.expiry_timestamp)) || Number(json.expiry_timestamp) * 1000 <= now() + 60000) {
        oneBudget.block('provider_authentication_failed'); throw providerError('provider_authentication_failed');
      }
      token = json.access_token; tokenExpiry = Math.min(Number(json.expiry_timestamp) * 1000, expiryOf(token, Infinity));
      if (tokenExpiry <= now() + 60000) { oneBudget.block('provider_authentication_failed'); throw providerError('provider_authentication_failed'); }
      return token;
    })().finally(() => { authenticating = null; });
    return authenticating;
  }
  async function oneRead(path, { allowArray = false } = {}) {
    for (let attempt = 0; attempt < 2; attempt++) {
      let usedToken;
      try {
        usedToken = await authenticate();
        // A single rejected cached token may be refreshed below. Backoff is set only
        // after that bounded recovery fails, so a valid refresh remains possible.
        oneBudget.consume();
        const json = await providerJson(fetchImpl, `${ONEMAP}${path}`, { headers: { Authorization: usedToken } });
        if (!object(json) && !(allowArray && Array.isArray(json))) throw providerError('invalid_provider_response');
        if (json.error) throw providerError(/token|auth|unauthori[sz]ed|expired/i.test(String(json.error)) ? 'provider_authentication_failed' : 'invalid_provider_response');
        return json;
      } catch (e) {
        if (e.reason !== 'provider_authentication_failed' || !credentials || attempt || !usedToken) { oneBudget.block(e.reason); throw e; }
        if (token === usedToken) { token = ''; tokenExpiry = 0; }
      }
    }
  }
  async function ltaRead(path, key, ttl, normalise) {
    if (!env.LTA_ACCOUNT_KEY) return unavailable('lta_not_configured');
    return ltaCache.read(key, async () => {
      const json = await request(ltaBudget, `${LTA}${path}`, { headers: { AccountKey: env.LTA_ACCOUNT_KEY, accept: 'application/json' } });
      if (!object(json)) throw providerError('invalid_provider_response');
      return { status: 'available', provider: 'LTA DataMall', ...normalise(json) };
    }, { ttl, staleFor: ttl * 2 });
  }
  return {
    configured,
    async nearbyStops(point) {
      const invalid = !singaporeCoordinates(point) ? 'invalid_transport_location' : !configured ? 'onemap_not_configured' : null;
      if (invalid) return { ...unavailable(invalid), stations: [], busStops: [], rail: unavailable(invalid), bus: unavailable(invalid), partial: false };
      const read = (kind, radiusMeters, endpoint) => oneCache.read(`nearby:${kind}:${point.latitude},${point.longitude}`, async () => {
        const query = new URLSearchParams({ latitude: String(point.latitude), longitude: String(point.longitude), radius_in_meters: String(radiusMeters) });
        const rows = await oneRead(`/public/nearbysvc/${endpoint}?${query}`, { allowArray: true });
        return { status: 'available', stops: nearbyRecords(rows, point, kind, radiusMeters) };
      }, { ttl: 86400000, staleFor: 7 * 86400000 });
      const [rail, bus] = await Promise.all([
        read('rail', 1500, 'getNearestMrtStops'), read('bus', 800, 'getNearestBusStops'),
      ]);
      const summary = ({ status, reason, stale, cached, fetchedAt }) => ({ status, ...(reason ? { reason } : {}), ...(fetchedAt ? { stale, cached, fetchedAt } : {}) });
      const available = rail.status === 'available' || bus.status === 'available';
      return { status: available ? 'available' : 'unavailable', provider: 'OneMap / Singapore Land Authority',
        ...(available ? {} : { reason: rail.reason ?? bus.reason }),
        stations: rail.stops ?? [], busStops: bus.stops ?? [], rail: summary(rail), bus: summary(bus),
        partial: (rail.status === 'available') !== (bus.status === 'available'), stale: Boolean(rail.stale || bus.stale),
      };
    },
    async search(query) {
      if (typeof query !== 'string' || query.trim().length < 2 || query.length > 100) return unavailable('invalid_location_query');
      if (!configured) return unavailable('onemap_not_configured');
      const q = query.trim();
      return oneCache.read(`search:${q.toLowerCase()}`, async () => {
        const json = await oneRead(`/common/elastic/search?${new URLSearchParams({ searchVal: q, returnGeom: 'Y', getAddrDetails: 'Y', pageNum: '1' })}`);
        if (!Array.isArray(json.results)) throw providerError('invalid_provider_response');
        const locations = json.results.slice(0, 20).filter(object).map((row) => ({ label: text(row.SEARCHVAL || row.ADDRESS, 150), address: text(row.ADDRESS), latitude: Number(row.LATITUDE), longitude: Number(row.LONGITUDE), postalCode: /^\d{6}$/.test(row.POSTAL) ? row.POSTAL : null })).filter(singaporeCoordinates);
        return { status: 'available', provider: 'OneMap / Singapore Land Authority', locations };
      }, { ttl: 86400000, staleFor: 7 * 86400000 });
    },
    async route({ origin, destination, mode = 'transit', startsAt }) {
      if (!singaporeCoordinates(origin) || !singaporeCoordinates(destination) || !['walk', 'transit', 'drive'].includes(mode) || !Number.isFinite(startsAt) || !Number.isFinite(new Date(startsAt + 8 * 3600000).getTime())) return unavailable('invalid_route');
      if (!configured) return unavailable('onemap_not_configured');
      const key = `route:${mode}:${origin.latitude},${origin.longitude}:${destination.latitude},${destination.longitude}:${Math.floor(startsAt / 1800000)}`;
      return oneCache.read(key, async () => {
        const params = new URLSearchParams({ start: `${origin.latitude},${origin.longitude}`, end: `${destination.latitude},${destination.longitude}`, routeType: mode === 'transit' ? 'pt' : mode });
        if (mode === 'transit') {
          const local = new Date(startsAt + 8 * 3600000).toISOString();
          params.set('date', `${local.slice(5, 7)}-${local.slice(8, 10)}-${local.slice(0, 4)}`); params.set('time', local.slice(11, 19)); params.set('mode', 'transit'); params.set('numItineraries', '1'); params.set('maxWalkDistance', '1000');
        }
        const json = await oneRead(`/public/routingsvc/route?${params}`);
        const itinerary = Array.isArray(json.plan?.itineraries) ? json.plan.itineraries.filter((r) => object(r) && Number.isFinite(r.duration)).sort((a, b) => a.duration - b.duration)[0] : null;
        const seconds = mode === 'transit' ? numeric(itinerary?.duration) : numeric(json.route_summary?.total_time);
        if (!Number.isFinite(seconds) || seconds < 0 || seconds > 86400) throw providerError('route_not_found');
        const metres = mode === 'transit' ? NaN : numeric(json.route_summary?.total_distance);
        return { status: 'available', provider: 'OneMap / Singapore Land Authority', durationMinutes: Math.ceil(seconds / 60), distanceKm: Number.isFinite(metres) && metres >= 0 && metres <= 1000000 ? Math.round(metres / 10) / 100 : null, mode, departureReference: new Date(startsAt).toISOString(), basis: mode === 'walk' ? 'walking_route' : mode === 'drive' ? 'driving_route' : 'scheduled_public_transport' };
      }, { ttl: 15 * 60000, staleFor: 15 * 60000 });
    },
    busArrivals(code) {
      if (typeof code !== 'string' || !/^\d{5}$/.test(code)) return Promise.resolve(unavailable('invalid_bus_stop'));
      return ltaRead(`/v3/BusArrival?BusStopCode=${code}`, `bus:${code}`, 20000, (json) => {
        if (!Array.isArray(json.Services)) throw providerError('invalid_provider_response');
        return { busStopCode: code, services: json.Services.slice(0, 80).filter((s) => object(s) && typeof s.ServiceNo === 'string' && /^[\w/-]{1,10}$/.test(s.ServiceNo)).map((s) => {
          const buses = [s.NextBus, s.NextBus2, s.NextBus3];
          const crowd = (b) => {
            const load = Object.hasOwn(busLoads, b.Load) ? b.Load : null;
            return { load, loadLabel: load ? busLoads[load] : 'Not reported', wheelchairAccessible: b.Feature === 'WAB' };
          };
          return { service: s.ServiceNo,
            arrivals: buses.filter((b) => object(b) && typeof b.EstimatedArrival === 'string' && Number.isFinite(Date.parse(b.EstimatedArrival))).map((b) => ({ estimatedArrival: b.EstimatedArrival, ...crowd(b) })),
            // Load can be present without a usable ETA. Never invent a percentage.
            crowdLevels: buses.map((b, index) => ({ bus: b, position: index + 1 })).filter(({ bus }) => object(bus) && (Object.hasOwn(busLoads, bus.Load) || Number.isFinite(Date.parse(bus.EstimatedArrival)))).map(({ bus, position }) => ({ position, ...crowd(bus) })),
          };
        }) };
      });
    },
    async parking({ latitude, longitude, radiusKm = 1.5, limit = 5 } = {}) {
      const point = { latitude, longitude };
      if (!singaporeCoordinates(point) || !Number.isFinite(radiusKm) || radiusKm < 0.2 || radiusKm > 5 || !Number.isInteger(limit) || limit < 1 || limit > 10) return unavailable('invalid_parking_location');
      if (!env.LTA_ACCOUNT_KEY) return unavailable('lta_not_configured');
      // One shared city snapshot avoids fetching the same pages for every meetup.
      // The queried point never appears in the upstream request or persisted data.
      const snapshot = await ltaCache.read('parking:city', async () => {
        const records = new Map(), seenPages = new Set(); let pagesFetched = 0, complete = false;
        for (let page = 0; page < 6; page++) {
          const json = await request(ltaBudget, `${LTA}/CarParkAvailabilityv2?${new URLSearchParams({ $skip: String(page * 500) })}`, { headers: { AccountKey: env.LTA_ACCOUNT_KEY, accept: 'application/json' } });
          if (!object(json) || !Array.isArray(json.value) || json.value.length > 500) throw providerError('invalid_provider_response');
          pagesFetched++;
          const pageKey = JSON.stringify(json.value.map((row) => object(row) ? [text(row.Agency, 10), text(String(row.CarParkID), 80), text(row.LotType, 5)] : null));
          // Some gateways ignore pagination. Stop repeated pages, retain an honest
          // bounded-coverage label and never count the same lots more than once.
          if (seenPages.has(pageKey)) break;
          seenPages.add(pageKey);
          for (const row of json.value) {
            if (!object(row) || row.LotType !== 'C' || !['HDB', 'LTA', 'URA'].includes(row.Agency) || typeof row.Location !== 'string') continue;
            const parkId = typeof row.CarParkID === 'string' ? row.CarParkID : Number.isSafeInteger(row.CarParkID) && row.CarParkID >= 0 ? String(row.CarParkID) : '';
            if (!parkId || parkId.length > 80) continue;
            const parts = row.Location.trim().split(/[\s,]+/), availableLots = numeric(row.AvailableLots);
            const location = { latitude: numeric(parts[0]), longitude: numeric(parts[1]) };
            if (parts.length !== 2 || !singaporeCoordinates(location) || !Number.isSafeInteger(availableLots) || availableLots < 0 || availableLots > 1000000) continue;
            const id = `${row.Agency}:${parkId}`;
            // Duplicate provider records are the same stock, not additional lots.
            records.set(id, { id, name: text(row.Development, 200) || parkId, ...location, availableLots, lotType: 'C', agency: row.Agency });
          }
          if (json.value.length < 500) { complete = true; break; }
        }
        return { status: 'available', provider: 'LTA DataMall', carparks: [...records.values()], coverage: complete ? 'complete_snapshot' : 'bounded_snapshot', pagesFetched };
      }, { ttl: 60000, staleFor: 120000 });
      if (snapshot.status !== 'available') return snapshot;
      const carparks = snapshot.carparks.map((park) => ({ ...park, distanceKm: Math.round(distanceKm(point, park) * 100) / 100 }))
        .filter((park) => park.distanceKm <= radiusKm).sort((a, b) => a.distanceKm - b.distanceKm || a.id.localeCompare(b.id)).slice(0, limit);
      return { ...snapshot, carparks, radiusKm };
    },
    trainAlerts() {
      return ltaRead('/TrainServiceAlerts', 'train-alerts', 60000, (json) => {
        const values = Array.isArray(json.value) ? json.value.slice(0, 30) : [json.value];
        if (!values.length || values.some(value => !object(value) || !['1', '2'].includes(String(value.Status)))) throw providerError('invalid_provider_response');
        const messages = [], affectedSegments = [];
        for (const value of values) {
          const notices = (Array.isArray(value.Message) ? value.Message : []).slice(0, 20).filter(object)
            .map(message => ({ content: text(message.Content, 1000), createdAt: text(message.CreatedDate, 50) }));
          messages.push(...notices);
          for (const segment of (Array.isArray(value.AffectedSegments) ? value.AffectedSegments : []).slice(0, 30).filter(object))
            affectedSegments.push({ line: text(segment.Line, 10), stations: text(segment.Stations, 300), direction: text(segment.Direction, 80), messages: notices });
        }
        return { serviceStatus: values.some(value => String(value.Status) === '2') ? 'disrupted' : 'normal',
          messages: [...new Map(messages.map(message => [`${message.createdAt}:${message.content}`, message])).values()].slice(0, 20),
          affectedSegments: affectedSegments.slice(0, 30) };
      });
    },
    crowding(line) {
      if (![...new Set(Object.values(railLines))].includes(line)) return Promise.resolve(unavailable('invalid_train_line'));
      return ltaRead(`/PCDRealTime?TrainLine=${line}`, `crowd:${line}`, 600000, (json) => {
        if (!Array.isArray(json.value)) throw providerError('invalid_provider_response');
        return { line, stations: json.value.slice(0, 100).filter(object).map((s) => ({ station: text(s.Station, 20), level: text(s.CrowdLevel, 20), observedAt: text(s.StartTime, 50), endsAt: text(s.EndTime, 50) })) };
      });
    },
  };
}
