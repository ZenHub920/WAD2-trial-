import { createProviderCache, providerJson, providerError, singaporeCoordinates, boundedLimit } from './providerCache.js';

const ONEMAP = 'https://www.onemap.gov.sg/api';
const LTA = 'https://datamall2.mytransport.sg/ltaodataservice';
const unavailable = (reason) => ({ status: 'unavailable', reason });
const text = (value, length = 200) => typeof value === 'string' ? value.slice(0, length) : '';
export function createSingaporeTravel({ fetchImpl = globalThis.fetch, now = Date.now, env = process.env } = {}) {
  const oneCache = createProviderCache({ now, dailyLimit: boundedLimit(env.ONEMAP_DAILY_LIMIT, 1000, 10000), requestsPerMinute: 60 });
  const ltaCache = createProviderCache({ now, dailyLimit: boundedLimit(env.LTA_DAILY_LIMIT, 1000, 10000), requestsPerMinute: 30 });
  let token = env.ONEMAP_TOKEN || '', tokenExpiry = token ? Infinity : 0, authenticating = null;
  const credentials = Boolean(env.ONEMAP_EMAIL && env.ONEMAP_PASSWORD);
  const configured = Boolean(token || credentials);
  async function authenticate() {
    if (token && tokenExpiry > now() + 60000) return token;
    if (!credentials) throw providerError('onemap_not_configured');
    if (!authenticating) authenticating = (async () => {
      const json = await providerJson(fetchImpl, `${ONEMAP}/auth/post/getToken`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: env.ONEMAP_EMAIL, password: env.ONEMAP_PASSWORD }) });
      if (typeof json.access_token !== 'string' || !Number.isFinite(Number(json.expiry_timestamp))) throw providerError('provider_authentication_failed');
      token = json.access_token; tokenExpiry = Number(json.expiry_timestamp) * 1000;
      return token;
    })().finally(() => { authenticating = null; });
    return authenticating;
  }
  async function oneRead(path) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const json = await providerJson(fetchImpl, `${ONEMAP}${path}`, { headers: { Authorization: await authenticate() } });
        if (json.error) throw providerError('provider_authentication_failed');
        return json;
      } catch (e) {
        if (e.reason !== 'provider_authentication_failed' || !credentials || attempt) throw e;
        token = ''; tokenExpiry = 0;
      }
    }
  }
  async function ltaRead(path, key, ttl, normalise) {
    if (!env.LTA_ACCOUNT_KEY) return unavailable('lta_not_configured');
    return ltaCache.read(key, async () => {
      const json = await providerJson(fetchImpl, `${LTA}${path}`, { headers: { AccountKey: env.LTA_ACCOUNT_KEY, accept: 'application/json' } });
      return { status: 'available', provider: 'LTA DataMall', ...normalise(json) };
    }, { ttl, staleFor: ttl * 2 });
  }
  return {
    configured,
    async search(query) {
      if (typeof query !== 'string' || query.trim().length < 2 || query.length > 100) return unavailable('invalid_location_query');
      if (!configured) return unavailable('onemap_not_configured');
      const q = query.trim();
      return oneCache.read(`search:${q.toLowerCase()}`, async () => {
        const json = await oneRead(`/common/elastic/search?${new URLSearchParams({ searchVal: q, returnGeom: 'Y', getAddrDetails: 'Y', pageNum: '1' })}`);
        if (!Array.isArray(json.results)) throw providerError('invalid_provider_response');
        const locations = json.results.slice(0, 20).map((row) => ({ label: text(row.SEARCHVAL || row.ADDRESS, 150), address: text(row.ADDRESS), latitude: Number(row.LATITUDE), longitude: Number(row.LONGITUDE), postalCode: /^\d{6}$/.test(row.POSTAL) ? row.POSTAL : null })).filter(singaporeCoordinates);
        return { status: 'available', provider: 'OneMap / Singapore Land Authority', locations };
      }, { ttl: 86400000, staleFor: 7 * 86400000 });
    },
    async route({ origin, destination, mode = 'transit', startsAt }) {
      if (!singaporeCoordinates(origin) || !singaporeCoordinates(destination) || !['walk', 'transit'].includes(mode) || !Number.isFinite(startsAt)) return unavailable('invalid_route');
      if (!configured) return unavailable('onemap_not_configured');
      const key = `route:${mode}:${origin.latitude},${origin.longitude}:${destination.latitude},${destination.longitude}:${Math.floor(startsAt / 1800000)}`;
      return oneCache.read(key, async () => {
        const params = new URLSearchParams({ start: `${origin.latitude},${origin.longitude}`, end: `${destination.latitude},${destination.longitude}`, routeType: mode === 'walk' ? 'walk' : 'pt' });
        if (mode === 'transit') {
          const local = new Date(startsAt + 8 * 3600000).toISOString();
          params.set('date', `${local.slice(5, 7)}-${local.slice(8, 10)}-${local.slice(0, 4)}`); params.set('time', local.slice(11, 19)); params.set('mode', 'transit'); params.set('numItineraries', '1'); params.set('maxWalkDistance', '1000');
        }
        const json = await oneRead(`/public/routingsvc/route?${params}`);
        const itinerary = json.plan?.itineraries?.filter((r) => Number.isFinite(r.duration)).sort((a, b) => a.duration - b.duration)[0];
        const seconds = mode === 'walk' ? Number(json.route_summary?.total_time) : Number(itinerary?.duration);
        if (!Number.isFinite(seconds) || seconds < 0 || seconds > 86400) throw providerError('route_not_found');
        return { status: 'available', provider: 'OneMap / Singapore Land Authority', durationMinutes: Math.ceil(seconds / 60), mode, departureReference: new Date(startsAt).toISOString(), basis: mode === 'walk' ? 'walking_route' : 'scheduled_public_transport' };
      }, { ttl: 15 * 60000, staleFor: 15 * 60000 });
    },
    busArrivals(code) {
      if (typeof code !== 'string' || !/^\d{5}$/.test(code)) return Promise.resolve(unavailable('invalid_bus_stop'));
      return ltaRead(`/v3/BusArrival?BusStopCode=${code}`, `bus:${code}`, 20000, (json) => {
        if (!Array.isArray(json.Services)) throw providerError('invalid_provider_response');
        return { busStopCode: code, services: json.Services.slice(0, 80).map((s) => ({ service: text(s.ServiceNo, 10), arrivals: [s.NextBus, s.NextBus2, s.NextBus3].filter((b) => b && Number.isFinite(Date.parse(b.EstimatedArrival))).map((b) => ({ estimatedArrival: b.EstimatedArrival, load: ['SEA', 'SDA', 'LSD'].includes(b.Load) ? b.Load : null, wheelchairAccessible: b.Feature === 'WAB' })) })) };
      });
    },
    trainAlerts() {
      return ltaRead('/TrainServiceAlerts', 'train-alerts', 60000, (json) => {
        const value = Array.isArray(json.value) ? json.value[0] : json.value;
        if (!value || typeof value !== 'object' || !['1', '2'].includes(String(value.Status))) throw providerError('invalid_provider_response');
        return { serviceStatus: String(value.Status) === '1' ? 'normal' : 'disrupted', messages: (Array.isArray(value.Message) ? value.Message : []).slice(0, 20).map((m) => ({ content: text(m.Content, 1000), createdAt: text(m.CreatedDate, 50) })), affectedSegments: (Array.isArray(value.AffectedSegments) ? value.AffectedSegments : []).slice(0, 30).map((s) => ({ line: text(s.Line, 10), stations: text(s.Stations, 300), direction: text(s.Direction, 80) })) };
      });
    },
    crowding(line) {
      if (!['CCL', 'CEL', 'CGL', 'DTL', 'EWL', 'NEL', 'NSL', 'TEL'].includes(line)) return Promise.resolve(unavailable('invalid_train_line'));
      return ltaRead(`/PCDRealTime?TrainLine=${line}`, `crowd:${line}`, 600000, (json) => {
        if (!Array.isArray(json.value)) throw providerError('invalid_provider_response');
        return { line, stations: json.value.slice(0, 100).map((s) => ({ station: text(s.Station, 20), level: text(s.CrowdLevel, 20), observedAt: text(s.StartTime, 50), endsAt: text(s.EndTime, 50) })) };
      });
    },
  };
}
