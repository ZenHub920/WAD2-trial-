import { searchTicketmaster, normalizeTicketmasterEvent } from './ticketmaster.js';
import { importTicketmasterConcerts } from '../db/ticketmasterConcerts.js';
import { migrateProviders } from '../db/providerMigrations.js';
import { providerJson } from './providerCache.js';

const bounded = (value, fallback, min, max) => Number.isFinite(Number(value))
  ? Math.max(min, Math.min(max, Number(value))) : fallback;

/** One bounded, cached server-side gateway shared by HTTP requests and scheduled sync. */
export function createConcertProvider({ db, env = process.env, fetchImpl = fetch, now = Date.now,
  pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  migrateProviders(db);
  const pending = new Map();
  let serial = Promise.resolve(), lastRequest = -Infinity, blockedUntil = 0;
  const ttl = bounded(env.CONCERT_CACHE_TTL_MS, 15 * 60000, 1000, 86400000);
  const dailyLimit = bounded(env.TICKETMASTER_DAILY_LIMIT, 100, 1, 5000);
  const interval = bounded(env.TICKETMASTER_MIN_INTERVAL_MS, 1000, 1000, 60000);
  const budget = db.transaction(() => {
    const day = new Date(now()).toISOString().slice(0, 10);
    const used = db.prepare("SELECT requests FROM provider_budget WHERE provider='ticketmaster' AND day=?").get(day)?.requests ?? 0;
    if (used >= dailyLimit) throw new Error('concert_daily_budget_exhausted');
    db.prepare(`INSERT INTO provider_budget(provider,day,requests) VALUES('ticketmaster',?,1)
      ON CONFLICT(provider,day) DO UPDATE SET requests=requests+1`).run(day);
    db.prepare("DELETE FROM provider_budget WHERE day < date(?, '-7 day')").run(day);
  });
  const request = (url, options) => {
    const run = serial.then(async () => {
      if (blockedUntil > now()) throw new Error('concert_provider_backoff');
      await pause(Math.max(0, lastRequest + interval - now()));
      budget.immediate();
      lastRequest = now();
      const response = await fetchImpl(url, options);
      if (response.status === 429) {
        const raw = response.headers.get('retry-after');
        const seconds = /^\d+$/.test(raw ?? '') ? Number(raw) : (Date.parse(raw) - now()) / 1000;
        blockedUntil = now() + bounded(seconds * 1000, 60000, 1000, 3600000);
      }
      return response;
    });
    serial = run.catch(() => {});
    return run;
  };
  const stored = (keyword) => db.prepare(`SELECT * FROM concerts WHERE source='ticketmaster'
    AND event_date >= date(?) AND (?='' OR instr(lower(artist || ' ' || coalesce(tour_name,'')),?)>0)
    ORDER BY event_date,id LIMIT 150`).all(new Date(now()).toISOString(), keyword, keyword);
  async function discover({ keyword = '', force = false } = {}) {
    keyword = keyword.trim().toLowerCase();
    const key = `concerts:${keyword}`;
    const cached = db.prepare('SELECT * FROM provider_cache WHERE cache_key=?').get(key);
    if (!force && cached && now() - cached.synced_at < ttl)
      return { events: JSON.parse(cached.body_json), source: 'cache', stale: false, syncedAt: cached.synced_at };
    if (pending.has(key)) return pending.get(key);
    const work = (async () => {
      try {
        if (!env.TICKETMASTER_API_KEY) throw new Error('concert_provider_not_configured');
        const events = await searchTicketmaster({ apiKey: env.TICKETMASTER_API_KEY, keyword, fetchImpl: request,
          now: new Date(now()), maxPages: bounded(env.TICKETMASTER_MAX_PAGES, 3, 1, 10) });
        importTicketmasterConcerts(db, events);
        db.prepare(`INSERT INTO provider_cache VALUES(?,?,?) ON CONFLICT(cache_key)
          DO UPDATE SET body_json=excluded.body_json,synced_at=excluded.synced_at`).run(key, JSON.stringify(events), now());
        db.prepare(`DELETE FROM provider_cache WHERE cache_key IN(SELECT cache_key FROM provider_cache
          WHERE cache_key LIKE 'concerts:%' ORDER BY synced_at DESC LIMIT -1 OFFSET 100)`).run();
        return { events, source: 'provider', stale: false, syncedAt: now() };
      } catch (error) {
        const events = cached ? JSON.parse(cached.body_json) : stored(keyword);
        if (cached || events.length) return { events, source: 'stored', stale: true,
          syncedAt: cached?.synced_at ?? null, reason: error.message === 'concert_provider_not_configured' ? error.message : 'concert_provider_unavailable' };
        throw Object.assign(new Error(error.message === 'concert_provider_not_configured' ? error.message : 'concert_provider_unavailable'),
          { status: error.message === 'concert_provider_not_configured' ? 503 : 502 });
      }
    })();
    pending.set(key, work);
    try { return await work; } finally { pending.delete(key); }
  }
  async function sync() {
    const result = await discover({ force: true });
    if (result.stale) throw new Error('concert_sync_deferred');
    // Search may omit cancelled/rescheduled events. Refresh previously stored events independently.
    const seen = new Set(result.events.map((e) => e.id));
    const known = db.prepare(`SELECT id,source_event_id FROM concerts WHERE source='ticketmaster'
      AND event_date >= date(?, '-7 day') ORDER BY provider_synced_at ASC LIMIT 50`).all(new Date(now()).toISOString());
    for (const event of known.filter((e) => !seen.has(e.id))) {
      const url = new URL(`https://app.ticketmaster.com/discovery/v2/events/${encodeURIComponent(event.source_event_id)}.json`);
      url.searchParams.set('apikey', env.TICKETMASTER_API_KEY);
      let data;
      try { data = await providerJson(request, url); }
      catch (error) {
        if (error.upstreamStatus === 404) continue; // Absence is not evidence of cancellation.
        throw new Error('concert_sync_deferred');
      }
      const normalized = normalizeTicketmasterEvent(data);
      if (normalized) importTicketmasterConcerts(db, [normalized]);
    }
    return { count: result.events.length, syncedAt: result.syncedAt };
  }
  return { discover, sync };
}
