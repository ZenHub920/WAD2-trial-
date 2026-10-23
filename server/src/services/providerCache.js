// Bounded, coalesced provider reads. Errors never contain upstream bodies or credentials.
export function providerError(reason) {
  return Object.assign(new Error(reason), { reason });
}
export function createProviderCache({ now = Date.now, maxEntries = 500, dailyLimit = 1000, requestsPerMinute = 60 } = {}) {
  const cache = new Map(), pending = new Map();
  let day = '', used = 0, minute = 0, minuteUsed = 0, blockedUntil = 0;
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
          if (time < blockedUntil || used >= dailyLimit || minuteUsed >= requestsPerMinute) throw providerError('provider_rate_limited');
          used++; minuteUsed++;
          const value = await retrieve();
          if (cache.size >= maxEntries) cache.delete(cache.keys().next().value);
          const fetchedAt = new Date(now()).toISOString();
          cache.set(key, { value, expires: now() + ttl, staleUntil: now() + ttl + staleFor, fetchedAt });
          return { ...value, cached: false, stale: false, fetchedAt };
        } catch (error) {
          const reason = error.reason || 'provider_unavailable';
          // A 429 stops fresh upstream reads for a minute; cached reads still work.
          if (reason === 'provider_rate_limited') blockedUntil = now() + 60000;
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
  const res = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(5000), redirect: 'error' });
  if (!res.ok) throw providerError(res.status === 429 ? 'provider_rate_limited' : res.status === 401 || res.status === 403 ? 'provider_authentication_failed' : 'provider_unavailable');
  try { return await res.json(); } catch { throw providerError('invalid_provider_response'); }
}
export const singaporeCoordinates = (point) => Number.isFinite(point?.latitude) && Number.isFinite(point?.longitude) && point.latitude >= 1.1 && point.latitude <= 1.5 && point.longitude >= 103.5 && point.longitude <= 104.1;
export const boundedLimit = (value, fallback, maximum) => Number.isFinite(Number(value)) && Number(value) >= 1 ? Math.min(Math.floor(Number(value)), maximum) : fallback;
