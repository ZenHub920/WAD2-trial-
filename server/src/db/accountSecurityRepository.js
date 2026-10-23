import { createHash, randomUUID } from 'node:crypto';

export const hashActionToken = (token) => createHash('sha256').update(token).digest('hex');

/** Additive account controls, separate from the existing identity/ticket verified badge. */
export function migrateAccountSecurity(db) {
  db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS account_security (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        email_verified_at INTEGER,
        suspended_at INTEGER,
        suspension_reason TEXT,
        password_changed_at INTEGER
      );
      INSERT OR IGNORE INTO account_security(user_id) SELECT id FROM users;
      CREATE TRIGGER IF NOT EXISTS account_security_new_user AFTER INSERT ON users BEGIN
        INSERT OR IGNORE INTO account_security(user_id) VALUES(NEW.id);
      END;
      CREATE TABLE IF NOT EXISTS account_action_tokens (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        purpose TEXT NOT NULL CHECK(purpose IN ('reset','verify')),
        email TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        consumed_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_account_action_tokens_user
        ON account_action_tokens(user_id,purpose,created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_account_action_tokens_expiry ON account_action_tokens(expires_at);
      CREATE TABLE IF NOT EXISTS moderation_actions (
        id INTEGER PRIMARY KEY,
        operator_user_id TEXT NOT NULL REFERENCES users(id),
        target_user_id TEXT NOT NULL REFERENCES users(id),
        report_id TEXT REFERENCES reports(id) ON DELETE SET NULL,
        action TEXT NOT NULL CHECK(action IN ('review','dismiss','warn','suspend','unsuspend')),
        note TEXT NOT NULL CHECK(length(note) BETWEEN 1 AND 1000),
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_moderation_actions_target
        ON moderation_actions(target_user_id,created_at DESC,id DESC);
      CREATE INDEX IF NOT EXISTS idx_moderation_actions_report ON moderation_actions(report_id,id);
      CREATE TABLE IF NOT EXISTS api_rate_limits (
        bucket TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_api_rate_limits_expiry ON api_rate_limits(expires_at);
    `);
  })();
}

const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };

export function createAccountSecurityRepo(db, { now = Date.now } = {}) {
  const user = db.prepare(`SELECT u.id,u.email,u.password_hash,u.is_operator,
    s.email_verified_at,s.suspended_at,s.suspension_reason,s.password_changed_at
    FROM users u LEFT JOIN account_security s ON s.user_id=u.id WHERE u.id=?`);
  const lookup = db.prepare('SELECT id FROM users WHERE lower(email)=lower(?)');
  const token = db.prepare(`SELECT * FROM account_action_tokens
    WHERE token_hash=? AND purpose=? AND consumed_at IS NULL AND expires_at>?`);

  return {
    account: (id) => user.get(id) ?? null,
    byEmail(email) { const found = lookup.get(email); return found ? user.get(found.id) : null; },
    isAllowed(id) { const account = user.get(id); return Boolean(account && account.suspended_at == null); },
    issueToken({ userId, email, purpose, rawToken, lifetimeMs }) {
      return db.transaction(() => {
        const time = now();
        const previous = db.prepare(`SELECT created_at FROM account_action_tokens
          WHERE user_id=? AND purpose=? ORDER BY created_at DESC LIMIT 1`).get(userId, purpose);
        if (previous && previous.created_at > time - 60_000) return false;
        db.prepare(`UPDATE account_action_tokens SET consumed_at=?
          WHERE user_id=? AND purpose=? AND consumed_at IS NULL`).run(time, userId, purpose);
        db.prepare(`INSERT INTO account_action_tokens
          (token_hash,user_id,purpose,email,created_at,expires_at) VALUES(?,?,?,?,?,?)`)
          .run(hashActionToken(rawToken), userId, purpose, email, time, time + lifetimeMs);
        return true;
      })();
    },
    invalidateToken(rawToken) {
      db.prepare('UPDATE account_action_tokens SET consumed_at=? WHERE token_hash=? AND consumed_at IS NULL')
        .run(now(), hashActionToken(rawToken));
    },
    canUseToken(rawToken, purpose) {
      const found = token.get(hashActionToken(rawToken), purpose, now());
      const account = found && user.get(found.user_id);
      return Boolean(found && account && account.email === found.email && account.suspended_at == null);
    },
    resetPassword(rawToken, passwordHash) {
      return db.transaction(() => {
        const time = now();
        const found = token.get(hashActionToken(rawToken), 'reset', time);
        const account = found && user.get(found.user_id);
        if (!found || !account || account.email !== found.email || account.suspended_at != null) return false;
        db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(passwordHash, found.user_id);
        db.prepare('UPDATE account_security SET password_changed_at=? WHERE user_id=?').run(time, found.user_id);
        db.prepare('UPDATE account_action_tokens SET consumed_at=? WHERE user_id=? AND consumed_at IS NULL')
          .run(time, found.user_id);
        db.prepare('DELETE FROM sessions WHERE user_id=?').run(found.user_id);
        return true;
      })();
    },
    verifyEmail(rawToken) {
      return db.transaction(() => {
        const time = now();
        const found = token.get(hashActionToken(rawToken), 'verify', time);
        const account = found && user.get(found.user_id);
        if (!found || !account || account.email !== found.email || account.suspended_at != null) return false;
        db.prepare('UPDATE account_security SET email_verified_at=? WHERE user_id=?').run(time, found.user_id);
        db.prepare('UPDATE account_action_tokens SET consumed_at=? WHERE token_hash=?')
          .run(time, found.token_hash);
        return true;
      })();
    },
    changePassword(userId, passwordHash) {
      db.transaction(() => {
        db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(passwordHash, userId);
        db.prepare('UPDATE account_security SET password_changed_at=? WHERE user_id=?').run(now(), userId);
        db.prepare('DELETE FROM sessions WHERE user_id=?').run(userId);
        db.prepare('UPDATE account_action_tokens SET consumed_at=? WHERE user_id=? AND consumed_at IS NULL')
          .run(now(), userId);
      })();
    },
    revokeSessions(id) { return db.prepare('DELETE FROM sessions WHERE user_id=?').run(id).changes; },
    sessionCount(id) { return db.prepare('SELECT COUNT(*) AS count FROM sessions WHERE user_id=? AND expires_at>?').get(id, now()).count; },
    warnings(id) { return db.prepare(`SELECT id,note,created_at AS createdAt FROM moderation_actions
      WHERE target_user_id=? AND action='warn' ORDER BY id DESC LIMIT 20`).all(id); },
    cleanup() {
      const time = now();
      db.prepare('DELETE FROM account_action_tokens WHERE expires_at<?').run(time - 86_400_000);
      db.prepare('DELETE FROM api_rate_limits WHERE expires_at<?').run(time);
      db.prepare('DELETE FROM sessions WHERE expires_at<?').run(time);
    },
    reports({ status = 'open', before = Number.MAX_SAFE_INTEGER, limit = 30 } = {}) {
      if (!['open', 'reviewed', 'closed', 'all'].includes(status)) fail(400, 'invalid_report_status');
      const rows = db.prepare(`SELECT r.rowid AS cursor,r.id,r.reporter_user_id AS reporterId,
        r.reported_user_id AS reportedId,r.reason_category AS category,r.status,r.created_at AS createdAt
        FROM reports r WHERE (?='all' OR r.status=?) AND r.rowid<? ORDER BY r.rowid DESC LIMIT ?`)
        .all(status, status, before, limit + 1);
      return { reports: rows.slice(0, limit), nextCursor: rows.length > limit ? String(rows[limit - 1].cursor) : null };
    },
    report(id) {
      const found = db.prepare(`SELECT r.*,reporter.display_name AS reporter_name,
        reported.display_name AS reported_name FROM reports r
        JOIN users reporter ON reporter.id=r.reporter_user_id JOIN users reported ON reported.id=r.reported_user_id
        WHERE r.id=?`).get(id);
      if (!found) fail(404, 'report_not_found');
      // Only the exact reported message is disclosed, including retained soft-deleted text.
      const evidence = found.message_id ? db.prepare(`SELECT id,conversation_id AS conversationId,
        sender_user_id AS senderId,body,created_at AS createdAt,edited_at AS editedAt,deleted_at AS deletedAt
        FROM messages WHERE id=? AND sender_user_id=? AND conversation_id=?`)
        .get(found.message_id, found.reported_user_id, found.conversation_id) ?? null : null;
      const audit = db.prepare(`SELECT id,operator_user_id AS operatorId,action,note,created_at AS createdAt
        FROM moderation_actions WHERE report_id=? ORDER BY id`).all(id);
      return { report: found, evidence, audit };
    },
    moderate({ operatorId, userId, reportId = null, action, note }) {
      if (!['review', 'dismiss', 'warn', 'suspend', 'unsuspend'].includes(action)) fail(400, 'invalid_moderation_action');
      if (typeof note !== 'string' || !note.trim() || note.trim().length > 1000) fail(400, 'moderation_note_required');
      return db.transaction(() => {
        const actor = user.get(operatorId);
        if (!actor?.is_operator || actor.suspended_at != null) fail(403, 'operator_required');
        const target = user.get(userId);
        if (!target) fail(404, 'user_not_found');
        if (userId === operatorId || target.is_operator) fail(403, 'operator_accounts_require_local_review');
        const report = reportId ? db.prepare('SELECT * FROM reports WHERE id=?').get(reportId) : null;
        if (reportId && !report) fail(404, 'report_not_found');
        if (report && report.reported_user_id !== userId) fail(409, 'report_target_mismatch');
        if (action !== 'unsuspend' && !report) fail(400, 'report_required');
        if (report?.status === 'closed') fail(409, 'report_already_closed');
        const time = now();
        if (report) db.prepare('UPDATE reports SET status=? WHERE id=?')
          .run(action === 'review' ? 'reviewed' : 'closed', report.id);
        if (action === 'suspend') {
          db.prepare('UPDATE account_security SET suspended_at=?,suspension_reason=? WHERE user_id=?')
            .run(time, note.trim(), userId);
          db.prepare('DELETE FROM sessions WHERE user_id=?').run(userId);
          db.prepare('UPDATE account_action_tokens SET consumed_at=? WHERE user_id=? AND consumed_at IS NULL').run(time, userId);
        } else if (action === 'unsuspend') {
          db.prepare('UPDATE account_security SET suspended_at=NULL,suspension_reason=NULL WHERE user_id=?').run(userId);
        }
        const result = db.prepare(`INSERT INTO moderation_actions
          (operator_user_id,target_user_id,report_id,action,note,created_at) VALUES(?,?,?,?,?,?)`)
          .run(operatorId, userId, reportId, action, note.trim(), time);
        if (action === 'warn' && db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='notifications'").get()) {
          db.prepare(`INSERT INTO notifications(id,user_id,category,event_key,title,resource_path)
            VALUES(?,?,'group',?,'An operator sent you an account notice','/account/security')`)
            .run(`n_${randomUUID()}`, userId, `moderation:${result.lastInsertRowid}`);
        }
        return { id: Number(result.lastInsertRowid), action, userId, reportId, createdAt: time };
      })();
    },
  };
}
