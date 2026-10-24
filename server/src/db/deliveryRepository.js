import { randomUUID } from 'node:crypto';

/** Jobs are committed in the same SQLite transaction as their source event. */
export function migrateDelivery(db) {
  db.transaction(() => {
    db.exec(`CREATE TABLE IF NOT EXISTS push_subscriptions (
      id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      endpoint TEXT NOT NULL UNIQUE,p256dh TEXT NOT NULL,auth TEXT NOT NULL,
      created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id);
      CREATE TABLE IF NOT EXISTS background_jobs (
      id TEXT PRIMARY KEY,job_key TEXT NOT NULL UNIQUE,type TEXT NOT NULL,payload_json TEXT NOT NULL,
      available_at INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'queued'
        CHECK(status IN('queued','running','completed','dead')),
      attempts INTEGER NOT NULL DEFAULT 0,lease_owner TEXT,leased_until INTEGER,
      last_error TEXT,created_at INTEGER NOT NULL,completed_at INTEGER);
      CREATE INDEX IF NOT EXISTS idx_jobs_due ON background_jobs(status,available_at,leased_until);
      CREATE INDEX IF NOT EXISTS idx_jobs_retention ON background_jobs(status,completed_at,available_at);
      DROP TRIGGER IF EXISTS enqueue_notification_push;
      CREATE TRIGGER enqueue_notification_push AFTER INSERT ON notifications BEGIN
        INSERT OR IGNORE INTO background_jobs(id,job_key,type,payload_json,available_at,created_at)
        SELECT lower(hex(randomblob(16))),'push:'||NEW.id||':'||s.id,'notification.push',
          json_object('notificationId',NEW.id,'subscriptionId',s.id),
          CAST(unixepoch('subsec')*1000 AS INTEGER),CAST(unixepoch('subsec')*1000 AS INTEGER)
        FROM push_subscriptions s WHERE s.user_id=NEW.user_id AND NEW.read_at IS NULL;
      END;
      DROP TRIGGER IF EXISTS notify_group_channel_message;
      CREATE TRIGGER notify_group_channel_message AFTER INSERT ON group_channel_messages BEGIN
        INSERT OR IGNORE INTO notifications(id,user_id,category,event_key,title,resource_path)
        SELECT lower(hex(randomblob(16))),m.user_id,'chat','chat-thread:/groups/'||NEW.party_id||'/channel',
          'Message from '||COALESCE((SELECT display_name FROM users WHERE id=NEW.sender_user_id),'your group'),
          '/groups/'||NEW.party_id||'/channel'
        FROM group_channel_members m JOIN parties p ON p.id=m.party_id
        WHERE m.party_id=NEW.party_id AND m.user_id<>NEW.sender_user_id AND p.status<>'cancelled'
          AND (m.user_id=p.host_user_id OR EXISTS(SELECT 1 FROM group_memberships gm
            WHERE gm.party_id=m.party_id AND gm.user_id=m.user_id AND gm.status='active'))
          AND COALESCE((SELECT enabled FROM notification_preferences WHERE user_id=m.user_id AND category='chat'),1)=1
          AND NOT EXISTS(SELECT 1 FROM blocks b WHERE
            (b.blocker_user_id=m.user_id AND b.blocked_user_id=NEW.sender_user_id) OR
            (b.blocked_user_id=m.user_id AND b.blocker_user_id=NEW.sender_user_id));
      END;`);
  }).immediate();
}

export function createJobRepository(db, { now = Date.now, maxAttempts = 6, leaseMs = 60000 } = {}) {
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts<1 || maxAttempts>10 || !Number.isFinite(leaseMs) || leaseMs<1000)
    throw new Error('invalid_job_configuration');
  const enqueue = ({ key, type, payload = {}, availableAt = now() }) => {
    if (typeof key !== 'string' || !key || key.length>512 || typeof type !== 'string' || !type || type.length>100
      || !Number.isFinite(availableAt)) throw new Error('invalid_background_job');
    const serialized=JSON.stringify(payload);
    if (typeof serialized !== 'string' || Buffer.byteLength(serialized)>16384) throw new Error('invalid_background_job');
    db.prepare(`INSERT OR IGNORE INTO background_jobs
      (id,job_key,type,payload_json,available_at,created_at) VALUES(?,?,?,?,?,?)`)
      .run(randomUUID(), key, type, serialized, availableAt, now());
  };
  return {
    enqueue,
    claim: db.transaction((owner) => {
      const time = now();
      db.prepare(`UPDATE background_jobs SET status='dead',completed_at=?,lease_owner=NULL,leased_until=NULL,last_error='attempt_limit'
        WHERE status IN('queued','running') AND attempts>=? AND COALESCE(leased_until,0)<=?`).run(time,maxAttempts,time);
      const row = db.prepare(`SELECT * FROM background_jobs WHERE attempts<? AND available_at<=?
        AND (status='queued' OR(status='running' AND leased_until<=?))
        ORDER BY CASE type WHEN 'lifecycle.sweep' THEN 0 WHEN 'reminders.scan' THEN 1 ELSE 2 END,available_at,id LIMIT 1`)
        .get(maxAttempts,time,time);
      if (!row) return null;
      db.prepare(`UPDATE background_jobs SET status='running',lease_owner=?,leased_until=?,attempts=attempts+1 WHERE id=?`)
        .run(owner,time+leaseMs,row.id);
      return { ...row, attempts: row.attempts+1, payload: JSON.parse(row.payload_json), leaseOwner: owner };
    }).immediate,
    complete(job) {
      return db.prepare(`UPDATE background_jobs SET status='completed',completed_at=?,lease_owner=NULL,leased_until=NULL,last_error=NULL
        WHERE id=? AND status='running' AND lease_owner=?`).run(now(),job.id,job.leaseOwner).changes;
    },
    renew(job) {
      return db.prepare(`UPDATE background_jobs SET leased_until=? WHERE id=? AND status='running' AND lease_owner=?`)
        .run(now()+leaseMs,job.id,job.leaseOwner).changes;
    },
    retry(job, error) {
      // Persist only machine error codes, never provider bodies, endpoints or credentials.
      const code = Number.isInteger(error?.statusCode) ? `provider_${error.statusCode}` : 'delivery_failed';
      const delay = Math.max(Math.min(3600000,1000*2**job.attempts), Math.min(3600000,Number(error?.retryAfterMs)||0));
      const dead=job.attempts>=maxAttempts || error?.permanent === true;
      return db.prepare(`UPDATE background_jobs SET status=?,available_at=?,completed_at=?,lease_owner=NULL,leased_until=NULL,last_error=?
        WHERE id=? AND status='running' AND lease_owner=?`)
        .run(dead?'dead':'queued',now()+delay,dead?now():null,code,job.id,job.leaseOwner).changes;
    },
    nextAvailableAt() {
      return db.prepare(`SELECT min(CASE WHEN status='running' THEN leased_until ELSE available_at END) due
        FROM background_jobs WHERE status IN('queued','running')`).get().due;
    },
    prune(retentionMs = 30*86400000, limit=1000) {
      if (!Number.isFinite(retentionMs) || retentionMs<86400000 || !Number.isSafeInteger(limit) || limit<1 || limit>10000)
        throw new Error('invalid_job_retention');
      // Batches prevent a large historical queue from blocking interactive work.
      return db.prepare(`DELETE FROM background_jobs WHERE id IN(SELECT id FROM background_jobs
        WHERE status IN('completed','dead') AND COALESCE(completed_at,available_at)<? ORDER BY available_at LIMIT ?)`)
        .run(now()-retentionMs,limit).changes;
    },
  };
}
