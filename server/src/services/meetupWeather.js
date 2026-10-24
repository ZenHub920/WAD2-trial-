import { distanceKm } from './meetupPlanning.js';
import { createProviderCache, providerJson, providerError, singaporeCoordinates } from './providerCache.js';
import { createProviderBudget } from './providerBudget.js';
const BASE = 'https://api-open.data.gov.sg/v2/real-time/api';
const covered = (period, start) => Date.parse(period?.start) <= start && Date.parse(period?.end) >= start + 30 * 60000;
const rain = (value) => /rain|shower|thunder/i.test(value);
const unavailable = (reason) => ({ status: 'unavailable', reason });
const safeText = (value, limit = 500) => typeof value === 'string' ? value.slice(0, limit) : '';
const period = (value) => ({ start: safeText(value?.start, 50), end: safeText(value?.end, 50) });
const range = (value, minimum, maximum) => value && Number.isFinite(value.low) && Number.isFinite(value.high)
  && value.low >= minimum && value.high <= maximum && value.low <= value.high ? { low: value.low, high: value.high } : null;
const warning = (forecast, horizon) => rain(forecast)
  ? `${horizon}: rain or thunderstorms are forecast; discuss a sheltered meeting place.`
  : `${horizon}: no rain indicated. Check again nearer the meeting; conditions can change.`;

export function createMeetupWeather({ db, fetchImpl = globalThis.fetch, now = Date.now, env = process.env } = {}) {
  const cache = createProviderCache({ now, dailyLimit: Infinity, requestsPerMinute: Infinity });
  const budget = createProviderBudget({ db, provider: 'nea', now, dailyLimit: 1000, requestsPerMinute: 30 });
  async function retrieve(endpoint, ttl = 5 * 60000) {
    return cache.read(endpoint, async () => {
      budget.consume();
      let json;
      try { json = await providerJson(fetchImpl, `${BASE}/${endpoint}`, { headers: env.DATA_GOV_SG_API_KEY ? { 'x-api-key': env.DATA_GOV_SG_API_KEY } : {} }); }
      catch (error) { budget.block(error.reason); throw error; }
      if (json?.code !== 0 || !json.data || typeof json.data !== 'object') throw providerError('invalid_weather_response');
      if (endpoint === 'two-hr-forecast' && (!Array.isArray(json.data.items) || !Array.isArray(json.data.area_metadata))) throw providerError('invalid_weather_response');
      if (['twenty-four-hr-forecast', 'four-day-outlook'].includes(endpoint) && !Array.isArray(json.data.records)) throw providerError('invalid_weather_response');
      if (endpoint === 'rainfall' && (!Array.isArray(json.data.stations) || !Array.isArray(json.data.readings))) throw providerError('invalid_weather_response');
      for (const key of ['records', 'items', 'area_metadata', 'stations', 'readings']) if (Array.isArray(json.data[key])) json.data[key] = json.data[key].filter((r) => r && typeof r === 'object' && !Array.isArray(r));
      return { status: 'available', data: json.data };
    }, { ttl, staleFor: 15 * 60000 });
  }
  function response(result, forecast, extra) {
    return { status: 'available', provider: 'NEA via data.gov.sg', forecast, rainWarning: rain(forecast), cached: result.cached, stale: result.stale, fetchedAt: result.fetchedAt, ...extra };
  }
  return {
    async forecast({ latitude, longitude, startsAt }) {
      if (!singaporeCoordinates({ latitude, longitude })) return unavailable('outside_singapore_forecast_area');
      if (!Number.isFinite(startsAt) || startsAt < now() - 30 * 60000 || startsAt > now() + 5 * 86400000) return unavailable('outside_forecast_window');
      let shortReason = null;
      if (startsAt <= now() + 2 * 3600000) {
        const result = await retrieve('two-hr-forecast');
        if (result.status === 'available') {
          const data = result.data;
          const item = data.items.filter((i) => covered(i?.valid_period, startsAt)).sort((a, b) => Date.parse(b.update_timestamp) - Date.parse(a.update_timestamp))[0];
          const area = data.area_metadata.filter((a) => singaporeCoordinates(a?.label_location)).sort((a, b) => distanceKm({ latitude, longitude }, a.label_location) - distanceKm({ latitude, longitude }, b.label_location))[0];
          const forecast = Array.isArray(item?.forecasts) ? item.forecasts.find((f) => f?.area === area?.name)?.forecast : null;
          if (typeof forecast === 'string') return response(result, safeText(forecast), { horizon: '2-hour', precision: 'local_area', area: safeText(area.name, 150), validPeriod: period(item.valid_period), updatedAt: safeText(item.update_timestamp, 50), message: warning(forecast, '2-hour local forecast') });
          shortReason = item ? 'area_forecast_missing' : 'meeting_not_covered_by_forecast';
        }
      }
      if (startsAt <= now() + 24 * 3600000) {
        const result = await retrieve('twenty-four-hr-forecast', 15 * 60000);
        const record = result.data?.records?.filter((r) => covered(r.general?.validPeriod, startsAt)).sort((a, b) => Date.parse(b.updatedTimestamp) - Date.parse(a.updatedTimestamp))[0];
        const forecast = record?.general?.forecast?.text;
        // National outlook: do not invent coordinate-to-region boundaries.
        if (result.status === 'available' && typeof forecast === 'string') return response(result, safeText(forecast), { horizon: '24-hour', precision: 'national_outlook', area: 'Singapore', validPeriod: period(record.general.validPeriod), updatedAt: safeText(record.updatedTimestamp, 50), temperature: range(record.general.temperature, -100, 100), relativeHumidity: range(record.general.relativeHumidity, 0, 100), message: warning(forecast, '24-hour Singapore outlook') });
      }
      const result = await retrieve('four-day-outlook', 30 * 60000);
      const date = new Date(startsAt + 8 * 3600000).toISOString().slice(0, 10);
      const record = [...(result.data?.records || [])].sort((a, b) => Date.parse(b.updatedTimestamp) - Date.parse(a.updatedTimestamp))[0];
      const day = Array.isArray(record?.forecasts) ? record.forecasts.find((f) => typeof f?.timestamp === 'string' && Number.isFinite(Date.parse(f.timestamp)) && new Date(Date.parse(f.timestamp) + 8 * 3600000).toISOString().slice(0, 10) === date) : null;
      const forecast = day?.forecast?.summary || day?.forecast?.text;
      if (result.status === 'available' && typeof forecast === 'string') return response(result, safeText(forecast), { horizon: '4-day', precision: 'national_daily_outlook', area: 'Singapore', date, updatedAt: safeText(record.updatedTimestamp, 50), temperature: range(day.temperature, -100, 100), message: warning(forecast, 'Daily Singapore outlook (timing is approximate)') });
      return unavailable(shortReason || (result.status === 'unavailable' ? 'weather_provider_unavailable' : 'meeting_not_covered_by_forecast'));
    },
    async rainfall({ latitude, longitude }) {
      if (!singaporeCoordinates({ latitude, longitude })) return unavailable('outside_singapore_forecast_area');
      const result = await retrieve('rainfall');
      if (result.status !== 'available') return unavailable('weather_provider_unavailable');
      const latest = [...(result.data.readings || [])].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))[0];
      if (!latest || !Number.isFinite(Date.parse(latest.timestamp)) || Math.abs(now() - Date.parse(latest.timestamp)) > 30 * 60000) return unavailable('no_recent_rainfall_reading');
      const readings = Array.isArray(latest.data) ? latest.data : [];
      const stations = (result.data.stations || []).filter((s) => singaporeCoordinates(s.location)).map((s) => ({ ...s, distance: distanceKm({ latitude, longitude }, s.location), reading: readings.find((r) => r?.stationId === s.id)?.value })).filter((s) => Number.isFinite(s.reading) && s.distance <= 10).sort((a, b) => a.distance - b.distance);
      const station = stations[0];
      if (!station) return unavailable('nearby_rainfall_reading_missing');
      return { status: 'available', provider: 'NEA via data.gov.sg', station: safeText(station.name, 150), distanceKm: Math.round(station.distance * 10) / 10, millimetres: station.reading, observedAt: safeText(latest.timestamp, 50), stale: result.stale, message: 'A nearby station measurement of recent rainfall, not a forecast for your meeting.' };
    },
  };
}
