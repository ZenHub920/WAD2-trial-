import { randomUUID } from 'node:crypto';
import { createJobRepository } from '../db/deliveryRepository.js';

const DAY = 86400000;
const fail = (code, status = 400) => Object.assign(new Error(code), { status });
const validPath = (value) => typeof value === 'string' && /^\/(?!\/)[a-zA-Z0-9/_?&=#.%:-]*$/.test(value);
const allowedHost = (host) => host === 'fcm.googleapis.com'
  || host === 'updates.push.services.mozilla.com' || host.endsWith('.push.services.mozilla.com')
  || host === 'web.push.apple.com' || host.endsWith('.push.apple.com') || host.endsWith('.notify.windows.com');
export function validatePushSubscription(input) {
  if (!input || typeof input.endpoint !== 'string' || input.endpoint.length > 2048) throw fail('invalid_push_subscription');
  let endpoint;
  try { endpoint = new URL(input.endpoint); } catch { throw fail('invalid_push_subscription'); }
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.port || endpoint.hash
    || !allowedHost(endpoint.hostname)) throw fail('invalid_push_endpoint');
  const keys = input.keys;
  for (const [key, bytes] of [['p256dh',65],['auth',16]]) {
    if (typeof keys?.[key] !== 'string' || !/^[A-Za-z0-9_-]+$/.test(keys[key]) || Buffer.from(keys[key],'base64url').length !== bytes)
      throw fail('invalid_push_keys');
  }
  if (Buffer.from(keys.p256dh,'base64url')[0] !== 4) throw fail('invalid_push_keys');
  return { endpoint: endpoint.href, p256dh: keys.p256dh, auth: keys.auth };
}

/** Explicitly started by server.js; app creation and tests create no timers. */
export function createDeliveryService({ db, repos, webPush, env = process.env, now = Date.now, logger = console } = {}) {
  const jobs = createJobRepository(db,{ now });
  const workerId = randomUUID();
  const handlers = new Map();
  const schedules = new Map();
  let timer, running = null, stopping = false;
  const configured = Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT);
  const notify = (user, category, key, title, path) => {
    if (!validPath(path)) throw new Error('invalid_notification_path');
    db.prepare(`INSERT OR IGNORE INTO notifications(id,user_id,category,event_key,title,resource_path)
      SELECT ?,?,?,?,?,? WHERE COALESCE((SELECT enabled FROM notification_preferences WHERE user_id=? AND category=?),1)=1`)
      .run(randomUUID(),user,category,key,title,path,user,category);
  };
  function accessibleChat(user, path) {
    let match = /^\/groups\/([^/]+)\/channel$/.exec(path);
    if (match) return Boolean(db.prepare(`SELECT 1 FROM group_channel_members m JOIN parties p ON p.id=m.party_id
      WHERE m.party_id=? AND m.user_id=? AND p.status<>'cancelled' AND NOT EXISTS(
        SELECT 1 FROM blocks b JOIN group_channel_members x ON x.user_id=b.blocker_user_id
        JOIN group_channel_members y ON y.user_id=b.blocked_user_id
        WHERE x.party_id=m.party_id AND y.party_id=m.party_id)
      AND (p.host_user_id=m.user_id OR EXISTS(
        SELECT 1 FROM group_memberships gm WHERE gm.party_id=m.party_id AND gm.user_id=m.user_id AND gm.status='active'))`)
      .get(match[1],user));
    match = /^\/kaki\/chat\/([^/]+)$/.exec(path);
    if (match) {
      const c = db.prepare('SELECT * FROM conversations WHERE id=?').get(match[1]);
      return Boolean(c && [c.user_a_id,c.user_b_id].includes(user)
        && repos.kakiChat.canChat(c.user_a_id,c.user_b_id,c.concert_id));
    }
    match = /^\/chat\/([^/]+)$/.exec(path);
    if (match) {
      const c = db.prepare('SELECT * FROM ticket_conversations WHERE id=?').get(match[1]);
      if (!c || ![c.buyer_user_id,c.seller_user_id].includes(user)) return false;
      return !db.prepare(`SELECT 1 FROM blocks WHERE (blocker_user_id=? AND blocked_user_id=?)
        OR(blocker_user_id=? AND blocked_user_id=?)`).get(c.buyer_user_id,c.seller_user_id,c.seller_user_id,c.buyer_user_id);
    }
    return false;
  }
  const currentNotification = (user,id) => {
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='account_security'").get()
      && db.prepare('SELECT 1 FROM account_security WHERE user_id=? AND suspended_at IS NOT NULL').get(user)) return null;
    const row = db.prepare(`SELECT n.* FROM notifications n WHERE n.id=? AND n.user_id=? AND n.read_at IS NULL
      AND COALESCE((SELECT enabled FROM notification_preferences p WHERE p.user_id=n.user_id AND p.category=n.category),1)=1`)
      .get(id,user);
    if (!row || !validPath(row.resource_path)) return null;
    const created = Date.parse(`${row.created_at.replace(' ','T')}Z`);
    if (!Number.isFinite(created) || now()-created > DAY || (row.category==='chat' && !accessibleChat(user,row.resource_path))) return null;
    if (row.category==='meetup') {
      const id = /^\/meetups\/([^/]+)$/.exec(row.resource_path)?.[1];
      if (id) try { repos.meetups.access(user,id); } catch { return null; }
    }
    return { id: row.id, title: row.title, path: row.resource_path, category: row.category };
  };
  handlers.set('notification.push', async ({ notificationId,subscriptionId }) => {
    if (!configured) return;
    const subscription = db.prepare('SELECT * FROM push_subscriptions WHERE id=?').get(subscriptionId);
    if (!subscription || !currentNotification(subscription.user_id,notificationId)) return;
    try {
      // Never include message bodies or a person's identity in queued push payloads.
      const client=webPush??(await import('web-push')).default;
      await client.sendNotification({ endpoint:subscription.endpoint,keys:{p256dh:subscription.p256dh,auth:subscription.auth} },
        JSON.stringify({ notificationId, subscriptionId }), {
          vapidDetails:{ subject:env.VAPID_SUBJECT,publicKey:env.VAPID_PUBLIC_KEY,privateKey:env.VAPID_PRIVATE_KEY },
          TTL:300, timeout:10000, urgency:'normal',
        });
    } catch (error) {
      if ([404,410].includes(error.statusCode)) {
        db.prepare('DELETE FROM push_subscriptions WHERE id=?').run(subscriptionId);
        return;
      }
      const after = error?.headers?.['retry-after'];
      if (after) error.retryAfterMs = /^\d+$/.test(after) ? Number(after)*1000 : Math.max(0,Date.parse(after)-now());
      throw error;
    }
  });
  handlers.set('lifecycle.sweep', () => {
    repos.proposals.expire();
    repos.recommendations.expire();
    db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(now());
    jobs.prune();
  });
  handlers.set('reminders.scan', () => db.transaction(() => {
    const time = now();
    for (const p of db.prepare(`SELECT mp.id,mp.expires_at,p.host_user_id,s.user_id,p.concert_id,
      mp.host_approved_at,mp.seeker_approved_at FROM match_proposals mp JOIN parties p ON p.id=mp.party_id
      JOIN seeker_requests s ON s.id=mp.seeker_request_id
      WHERE mp.status='proposed' AND mp.expires_at>? AND mp.expires_at<=?`).all(time,time+6*3600000)) {
      if (!p.host_approved_at) notify(p.host_user_id,'match',`reminder:proposal:${p.id}:host`,'A matching proposal expires soon',`/concerts/${p.concert_id}`);
      if (!p.seeker_approved_at) notify(p.user_id,'match',`reminder:proposal:${p.id}:seeker`,'A matching proposal expires soon',`/concerts/${p.concert_id}`);
    }
    for (const r of db.prepare(`SELECT j.id,p.host_user_id,j.user_id FROM group_join_requests j JOIN parties p ON p.id=j.party_id
      WHERE j.status='pending' AND j.expires_at>? AND j.expires_at<=?`).all(time,time+6*3600000)) {
      notify(r.host_user_id,'group',`reminder:application:${r.id}:host`,'A group application expires soon','/groups/connect');
      notify(r.user_id,'group',`reminder:application:${r.id}:seeker`,'Your group application expires soon','/groups');
    }
    for (const m of db.prepare(`SELECT * FROM meetups WHERE status='confirmed' AND selected_start>? AND selected_start<=?`)
      .all(time,time+3600000)) for (const user of repos.meetups.participants(m))
        notify(user,'meetup',`reminder:meetup:${m.id}:${m.version}`,'Your meetup starts within an hour',`/meetups/${m.id}`);
    // Limit feedback reminders to recent concerts and ask the existing eligibility
    // service so former members and people who already rated cannot be nagged.
    const users = db.prepare(`SELECT DISTINCT user_id FROM (
      SELECT p.host_user_id user_id,c.event_date FROM parties p JOIN concerts c ON c.id=p.concert_id
      UNION ALL SELECT gm.user_id,c.event_date FROM group_memberships gm JOIN concerts c ON c.id=gm.concert_id
      UNION ALL SELECT s.user_id,c.event_date FROM match_proposals mp JOIN seeker_requests s ON s.id=mp.seeker_request_id
        JOIN parties p ON p.id=mp.party_id JOIN concerts c ON c.id=p.concert_id WHERE mp.status='confirmed')
      WHERE event_date>=? AND event_date<?`).all(new Date(time-7*DAY).toISOString().slice(0,10),new Date(time).toISOString().slice(0,10));
    for (const {user_id:user} of users) for (const concert of new Set(repos.feedback.opportunities(user).map(x=>x.concertId)))
      notify(user,'feedback',`reminder:feedback:${concert}`,'How was your concert company? Leave feedback','/feedback');
  }).immediate());
  schedules.set('lifecycle.sweep',60000);
  schedules.set('reminders.scan',300000);
  const api = {
    jobs,
    publicConfig: () => ({ configured, publicKey:configured?env.VAPID_PUBLIC_KEY:null }),
    subscribe: db.transaction((user,input) => {
      if (!configured) throw fail('push_not_configured',503);
      const s = validatePushSubscription(input);
      const existing = db.prepare('SELECT * FROM push_subscriptions WHERE endpoint=?').get(s.endpoint);
      if (existing?.user_id!==user && db.prepare('SELECT COUNT(*) n FROM push_subscriptions WHERE user_id=?').get(user).n>=10)
        throw fail('push_subscription_limit',409);
      // Rotate id on an account switch: old queued jobs cannot reach the new owner.
      if (existing && existing.user_id!==user) db.prepare('DELETE FROM push_subscriptions WHERE id=?').run(existing.id);
      const id = existing?.user_id===user?existing.id:randomUUID();
      db.prepare(`INSERT INTO push_subscriptions(id,user_id,endpoint,p256dh,auth,created_at,updated_at) VALUES(?,?,?,?,?,?,?)
        ON CONFLICT(endpoint) DO UPDATE SET p256dh=excluded.p256dh,auth=excluded.auth,updated_at=excluded.updated_at`)
        .run(id,user,s.endpoint,s.p256dh,s.auth,now(),now());
      return { subscribed:true,id };
    }).immediate,
    unsubscribe(user,endpoint) {
      if (typeof endpoint !== 'string' || endpoint.length>2048) throw fail('invalid_push_subscription');
      db.prepare('DELETE FROM push_subscriptions WHERE user_id=? AND endpoint=?').run(user,endpoint);
      return { subscribed:false };
    },
    subscriptionStatus(user,endpoint) {
      if (typeof endpoint !== 'string' || endpoint.length>2048) throw fail('invalid_push_subscription');
      return { enabled:Boolean(db.prepare('SELECT 1 FROM push_subscriptions WHERE user_id=? AND endpoint=?').get(user,endpoint)) };
    },
    notification(user,id,subscriptionId) {
      if (!db.prepare('SELECT 1 FROM push_subscriptions WHERE id=? AND user_id=?').get(subscriptionId,user)) return null;
      return currentNotification(user,id);
    },
    registerTask(name,handler,{intervalMs}={}) {
      if (handlers.has(name) || typeof handler!=='function') throw new Error('invalid_job_handler');
      handlers.set(name,handler);
      if (intervalMs) {
        if (!Number.isFinite(intervalMs) || intervalMs<60000) throw new Error('invalid_job_interval');
        schedules.set(name,intervalMs);
      }
    },
    registerWeatherChecks(weather,{intervalMs=1800000}={}) {
      api.registerTask('weather.meetup-recheck',async()=>{
        const rows=db.prepare(`SELECT m.*,p.latitude,p.longitude FROM meetups m JOIN meetup_places p ON p.id=m.selected_place_id
          WHERE m.status='confirmed' AND m.selected_start>? AND m.selected_start<=? ORDER BY m.selected_start LIMIT 50`)
          .all(now(),now()+2*3600000);
        for (const m of rows) {
          const forecast=await weather.forecast({latitude:m.latitude,longitude:m.longitude,startsAt:m.selected_start});
          if(forecast.status!=='available' || forecast.stale || !forecast.rainWarning) continue;
          // The plan may have changed while the external provider was responding.
          const current=db.prepare("SELECT * FROM meetups WHERE id=? AND version=? AND status='confirmed'").get(m.id,m.version);
          if(!current) continue;
          db.transaction(()=>{
            for(const user of repos.meetups.participants(current))
              notify(user,'meetup',`weather:meetup:${m.id}:${m.version}`,
                forecast.precision === 'local_area' ? 'Rain is forecast near your meetup; check your plan' : 'Rain is forecast in Singapore; check your meetup plan',`/meetups/${m.id}`);
          }).immediate();
        }
      },{intervalMs});
    },
    enqueue:jobs.enqueue,
    async runOnce({maxJobs=50}={}) {
      if (running) return running;
      running = (async () => {
        for (const [type,interval] of schedules)
          jobs.enqueue({key:`scheduled:${type}:${Math.floor(now()/interval)}`,type});
        let processed=0;
        while (!stopping && processed<maxJobs) {
          const job=jobs.claim(workerId);
          if (!job) break;
          const heartbeat=setInterval(()=>{
            try { jobs.renew(job); } catch { /* Another worker recovers the durable lease after a crash. */ }
          },20000);
          heartbeat.unref?.();
          try {
            const handler=handlers.get(job.type);
            if (!handler) throw new Error('job_handler_unavailable');
            await handler(job.payload);
            jobs.complete(job);
          } catch (error) { jobs.retry(job,error); logger.warn?.('Background job will retry',{type:job.type,attempt:job.attempts}); }
          finally { clearInterval(heartbeat); }
          processed++;
        }
        return {processed};
      })();
      try { return await running; } finally { running=null; }
    },
    start({intervalMs=15000}={}) {
      if (timer) return;
      stopping=false;
      const tick=()=>api.runOnce().catch(()=>logger.warn?.('Background job scan failed'));
      timer=setInterval(tick,Math.max(1000,intervalMs));
      timer.unref?.();
      void tick();
    },
    async stop() { stopping=true;clearInterval(timer);timer=null;if(running) await running; },
  };
  return api;
}
