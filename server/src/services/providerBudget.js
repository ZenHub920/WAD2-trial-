import { providerError } from './providerCache.js';

/** Only counters and backoff deadlines persist; URLs, coordinates and credentials do not. */
export function migrateProviderBudget(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS provider_budget (
    provider TEXT NOT NULL, day TEXT NOT NULL, requests INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(provider,day)
  );
  CREATE TABLE IF NOT EXISTS provider_throttle (
    provider TEXT PRIMARY KEY, minute INTEGER NOT NULL DEFAULT -1,
    minute_used INTEGER NOT NULL DEFAULT 0, blocked_until INTEGER NOT NULL DEFAULT 0,
    blocked_reason TEXT NOT NULL DEFAULT 'provider_rate_limited'
  );`);
}

/** Reserve exactly one attempt immediately before each HTTP call, including authentication/retries. */
export function createProviderBudget({ db, provider, now = Date.now, dailyLimit = 1000, requestsPerMinute = 60 } = {}) {
  if (!/^[a-z][a-z0-9_-]{0,39}$/.test(provider)) throw new Error('invalid_provider_name');
  let memory = { day: '', requests: 0, minute: -1, minute_used: 0, blocked_until: 0, blocked_reason: 'provider_rate_limited' };
  if (db) migrateProviderBudget(db);
  const update = (fn) => db ? db.transaction(fn).immediate() : fn();
  return {
    consume() {
      return update(() => {
        const time = now(), day = new Date(time).toISOString().slice(0, 10), minute = Math.floor(time / 60000);
        const state = db ? db.prepare('SELECT * FROM provider_throttle WHERE provider=?').get(provider) || memory : memory;
        if (state.blocked_until > time) throw providerError(state.blocked_reason);
        const requests = db ? db.prepare('SELECT requests FROM provider_budget WHERE provider=? AND day=?').get(provider, day)?.requests || 0 : memory.day === day ? memory.requests : 0;
        const minuteUsed = state.minute === minute ? state.minute_used : 0;
        if (requests >= dailyLimit || minuteUsed >= requestsPerMinute) throw providerError('provider_rate_limited');
        if (db) {
          db.prepare(`INSERT INTO provider_budget(provider,day,requests) VALUES(?,?,1)
            ON CONFLICT(provider,day) DO UPDATE SET requests=requests+1`).run(provider, day);
          db.prepare(`INSERT INTO provider_throttle(provider,minute,minute_used) VALUES(?,?,1)
            ON CONFLICT(provider) DO UPDATE SET minute=excluded.minute,minute_used=?`).run(provider, minute, minuteUsed + 1);
          db.prepare("DELETE FROM provider_budget WHERE day < date(?, '-7 day')").run(day);
        } else memory = { ...state, day, requests: requests + 1, minute, minute_used: minuteUsed + 1 };
      });
    },
    block(reason, durationMs = 60000) {
      if (!['provider_rate_limited', 'provider_authentication_failed'].includes(reason)) return;
      const until = now() + Math.max(1000, Math.min(3600000, durationMs));
      update(() => {
        if (db) db.prepare(`INSERT INTO provider_throttle(provider,blocked_until,blocked_reason) VALUES(?,?,?)
          ON CONFLICT(provider) DO UPDATE SET blocked_until=max(blocked_until,excluded.blocked_until),blocked_reason=excluded.blocked_reason`).run(provider, until, reason);
        else memory = { ...memory, blocked_until: Math.max(memory.blocked_until, until), blocked_reason: reason };
      });
    },
  };
}
