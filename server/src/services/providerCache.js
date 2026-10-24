// Bounded, coalesced provider reads. Errors never contain upstream bodies or credentials.
export function providerError(reason) {
  return Object.assign(new Error(reason), { reason });
}
const safeReasons = new Set(['provider_unavailable', 'provider_rate_limited', 'provider_authentication_failed',
  'invalid_provider_response', 'invalid_weather_response', 'route_not_found', 'onemap_not_configured', 'onemap_token_expired']);
export const safeProviderReason = (error) => safeReasons.has(error?.reason) ? error.reason : 'provider_unavailable';
export function createProviderCache({ now = Date.now, maxEntries = 500, dailyLimit = 1000, requestsPerMinute = 60 } = {}) {
  const cache = new Map(), pending = new Map();
  let day = '', used = 0, minute = 0, minuteUsed = 0, blockedUntil = 0, blockedReason = 'provider_rate_limited';
  return {
    async read(key, retrieve, { ttl = 300000, staleFor = 3600000 } = {}) {
      const time = now(), entry = cache.get(key);
      if (entry && entry.expires > time) return { ...entry.value, cached: true, stale: false, fetchedAt: entry.fetchedAt };
      if (pending.has(key)) return pending.get(key);
      const task = (async () => {
        try {
          const today = new Date(time).toISOString().slice(0, 10), thisMinute = Math.floor(time / 60000);
          if (today !== day) { day = today; used = 0; }
          if (thisMinute !== minute) { minute = thisMinute; minuteUsed = 0; }
          if (time < blockedUntil) throw providerError(blockedReason);
          if (used >= dailyLimit || minuteUsed >= requestsPerMinute) throw providerError('provider_rate_limited');
          used++; minuteUsed++;
          const value = await retrieve();
          if (cache.size >= maxEntries) cache.delete(cache.keys().next().value);
          const fetchedAt = new Date(now()).toISOString();
          cache.set(key, { value, expires: now() + ttl, staleUntil: now() + ttl + staleFor, fetchedAt });
          return { ...value, cached: false, stale: false, fetchedAt };
        } catch (error) {
          const reason = safeProviderReason(error);
          // A 429 stops fresh upstream reads for a minute; cached reads still work.
          if (['provider_rate_limited', 'provider_authentication_failed'].includes(reason) && blockedUntil <= now()) { blockedUntil = now() + 60000; blockedReason = reason; }
          if (entry && entry.staleUntil > now()) return { ...entry.value, cached: true, stale: true, reason, fetchedAt: entry.fetchedAt };
          return { status: 'unavailable', reason };
        }
      })().finally(() => pending.delete(key));
      pending.set(key, task);
      return task;
    },
  };
}
export async function providerJson(fetchImpl, url, options = {}) {
  // Providers and paths are fixed in server code. No caller-supplied upstream is accepted.
  const target = new URL(url);
  const paths = { 'https://www.onemap.gov.sg': '/api/', 'https://datamall2.mytransport.sg': '/ltaodataservice/',
    'https://api-open.data.gov.sg': '/v2/real-time/api/', 'https://app.ticketmaster.com': '/discovery/v2/' };
  if (!paths[target.origin] || !target.pathname.startsWith(paths[target.origin]) || target.username || target.password || target.hash)
    throw providerError('provider_unavailable');
  let res;
  try { res = await fetchImpl(target.href, { ...options, signal: AbortSignal.timeout(5000), redirect: 'error' }); }
  catch { throw providerError('provider_unavailable'); }
  if (!res.ok) {
    try { await res.body?.cancel(); } catch { /* No response body is logged or returned. */ }
    const reason = res.status === 429 ? 'provider_rate_limited' : res.status === 401 || res.status === 403 ? 'provider_authentication_failed' : 'provider_unavailable';
    throw Object.assign(providerError(reason), { upstreamStatus: res.status });
  }
  const maximum = 2 * 1024 * 1024;
  try {
    if (Number(res.headers?.get('content-length')) > maximum) { await res.body?.cancel(); throw new Error(); }
    if (res.body?.getReader) {
      const reader = res.body.getReader(), chunks = []; let length = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          length += value.byteLength;
          if (length > maximum) { await reader.cancel(); throw new Error(); }
          chunks.push(Buffer.from(value));
        }
      } finally { reader.releaseLock(); }
      return JSON.parse(Buffer.concat(chunks, length).toString('utf8'));
    }
    // Test transports may expose json() only. Native fetch takes the bounded stream path.
    const body = typeof res.text === 'function' ? JSON.parse(await res.text()) : await res.json();
    if (Buffer.byteLength(JSON.stringify(body)) > maximum) throw new Error();
    return body;
  } catch { throw providerError('invalid_provider_response'); }
}
export const singaporeCoordinates = (point) => Number.isFinite(point?.latitude) && Number.isFinite(point?.longitude) && point.latitude >= 1.1 && point.latitude <= 1.5 && point.longitude >= 103.5 && point.longitude <= 104.1;
export const boundedLimit = (value, fallback, maximum) => Number.isFinite(Number(value)) && Number(value) >= 1 ? Math.min(Math.floor(Number(value)), maximum) : fallback;
