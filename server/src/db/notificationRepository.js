import { randomUUID } from "node:crypto";
import { communityError } from "./membershipRepository.js";
export function migrateNotifications(db) {
  db.transaction(() => {
    db.exec(`CREATE TABLE IF NOT EXISTS notifications(
    id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category TEXT NOT NULL CHECK(category IN('chat','group','match','meetup','feedback')),
    event_key TEXT NOT NULL,title TEXT NOT NULL,resource_path TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT(datetime('now')),read_at TEXT,
    UNIQUE(user_id,event_key));
    CREATE INDEX IF NOT EXISTS idx_notification_inbox ON notifications(user_id,read_at,created_at);
    CREATE TABLE IF NOT EXISTS notification_preferences(user_id TEXT NOT NULL REFERENCES users(id),category TEXT NOT NULL,
      enabled INTEGER NOT NULL CHECK(enabled IN(0,1)),PRIMARY KEY(user_id,category));`);
    const trigger = (
      name,
      table,
      timing,
      category,
      recipients,
      title,
      path,
      key,
      condition = "1",
    ) =>
      db.exec(`
    CREATE TRIGGER IF NOT EXISTS ${name} AFTER ${timing} ON ${table} WHEN ${condition} BEGIN
      INSERT OR IGNORE INTO notifications(id,user_id,category,event_key,title,resource_path)
      SELECT lower(hex(randomblob(16))),recipient,'${category}',${key},'${title}',${path}
      FROM (${recipients}) WHERE recipient IS NOT NULL AND COALESCE((SELECT enabled FROM notification_preferences
        WHERE user_id=recipient AND category='${category}'),1)=1;
    END;`);
    trigger(
      "notify_kaki_message",
      "messages",
      "INSERT",
      "chat",
      `SELECT CASE WHEN c.user_a_id=NEW.sender_user_id THEN c.user_b_id ELSE c.user_a_id END recipient FROM conversations c WHERE c.id=NEW.conversation_id`,
      "New Kaki message",
      "'/kaki/chat/'||NEW.conversation_id",
      "'kaki-message:'||NEW.id",
    );
    trigger(
      "notify_market_message",
      "ticket_messages",
      "INSERT",
      "chat",
      `SELECT CASE WHEN c.buyer_user_id=NEW.sender_user_id THEN c.seller_user_id ELSE c.buyer_user_id END recipient FROM ticket_conversations c WHERE c.id=NEW.conversation_id`,
      "New marketplace message",
      "'/chat/'||NEW.conversation_id",
      "'ticket-message:'||NEW.id",
    );
    trigger(
      "notify_join_request",
      "group_join_requests",
      "INSERT",
      "group",
      "SELECT host_user_id recipient FROM parties WHERE id=NEW.party_id",
      "A seeker requested to join your group",
      "'/groups/connect'",
      "'join-request:'||NEW.id",
    );
    trigger(
      "notify_join_response",
      "group_join_requests",
      "UPDATE OF status",
      "group",
      "SELECT NEW.user_id recipient",
      "Your group join request was updated",
      "'/groups'",
      "'join-response:'||NEW.id||':'||NEW.status",
      "NEW.status<>OLD.status AND NEW.status<>'pending'",
    );
    trigger(
      "notify_join_reopened",
      "group_join_requests",
      "UPDATE OF status",
      "group",
      "SELECT host_user_id recipient FROM parties WHERE id=NEW.party_id",
      "A seeker requested to join your group",
      "'/groups/connect'",
      "'join-reopened:'||lower(hex(randomblob(16)))",
      "NEW.status='pending' AND OLD.status IN('withdrawn','expired')",
    );
    trigger(
      "notify_group_invite",
      "group_connections",
      "INSERT",
      "group",
      `SELECT host_user_id recipient FROM parties WHERE id=CASE WHEN NEW.initiator_party_id=NEW.party_a_id THEN NEW.party_b_id ELSE NEW.party_a_id END`,
      "A group invited your group to connect",
      "'/groups/connect'",
      "'group-invite:'||NEW.id",
    );
    trigger(
      "notify_group_profile_changed",
      "group_settings",
      "UPDATE OF version",
      "group",
      "SELECT user_id recipient FROM group_join_requests WHERE party_id=NEW.party_id AND status='pending' AND COALESCE(group_version,0)<>NEW.version",
      "A group you chose changed; review and resubmit your request",
      "'/groups'",
      "'group-profile:'||NEW.party_id||':'||NEW.version",
      "NEW.version<>OLD.version",
    );
    trigger(
      "notify_group_response",
      "group_connections",
      "UPDATE OF status",
      "group",
      "SELECT host_user_id recipient FROM parties WHERE id=NEW.initiator_party_id",
      "Your group invitation was updated",
      "'/groups/connect'",
      "'group-response:'||NEW.id||':'||NEW.status",
      "NEW.status<>OLD.status",
    );
    trigger(
      "notify_match_offer",
      "match_proposals",
      "INSERT",
      "match",
      "SELECT user_id recipient FROM seeker_requests WHERE id=NEW.seeker_request_id",
      "You received a matching proposal",
      "'/concerts/'||(SELECT concert_id FROM parties WHERE id=NEW.party_id)",
      "'match-offer:'||NEW.id",
    );
    trigger(
      "notify_match_response",
      "match_proposals",
      "UPDATE OF status",
      "match",
      `SELECT host_user_id recipient FROM parties WHERE id=NEW.party_id UNION SELECT user_id recipient FROM seeker_requests WHERE id=NEW.seeker_request_id`,
      "A matching proposal was updated",
      "'/concerts/'||(SELECT concert_id FROM parties WHERE id=NEW.party_id)",
      "'match-status:'||NEW.id||':'||NEW.status",
      "NEW.status<>OLD.status",
    );
  }).immediate();
}
export function createNotificationRepo(db) {
  return {
    list(user, { limit = 30, before } = {}) {
      limit = Number(limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100)
        throw communityError("invalid_limit", 400);
      let rowid = Number.MAX_SAFE_INTEGER;
      if (before) {
        const row = db
          .prepare("SELECT rowid FROM notifications WHERE id=? AND user_id=?")
          .get(before, user);
        if (!row) throw communityError("invalid_cursor", 400);
        rowid = row.rowid;
      }
      return db
        .prepare(
          `SELECT id,category,title,resource_path AS path,created_at AS createdAt,read_at AS readAt
     FROM notifications WHERE user_id=? AND rowid<? ORDER BY rowid DESC LIMIT ?`,
        )
        .all(user, rowid, limit);
    },
    unread(user) {
      return db
        .prepare(
          "SELECT COUNT(*) total FROM notifications WHERE user_id=? AND read_at IS NULL",
        )
        .get(user).total;
    },
    read(user, id) {
      const result = db
        .prepare(
          "UPDATE notifications SET read_at=COALESCE(read_at,datetime('now')) WHERE id=? AND user_id=?",
        )
        .run(id, user);
      if (!result.changes) throw communityError("notification_not_found", 404);
      return { read: true };
    },
    readAll(user) {
      db.prepare(
        "UPDATE notifications SET read_at=datetime('now') WHERE user_id=? AND read_at IS NULL",
      ).run(user);
      return { read: true };
    },
    settings(user) {
      return Object.fromEntries(
        ["chat", "group", "match", "meetup", "feedback"].map((category) => [
          category,
          db
            .prepare(
              "SELECT enabled FROM notification_preferences WHERE user_id=? AND category=?",
            )
            .get(user, category)?.enabled !== 0,
        ]),
      );
    },
    setSettings: db.transaction((user, input) => {
      if (
        !input ||
        Array.isArray(input) ||
        typeof input !== "object" ||
        Object.entries(input).some(
          ([k, v]) =>
            !["chat", "group", "match", "meetup", "feedback"].includes(k) ||
            typeof v !== "boolean",
        )
      )
        throw communityError("invalid_notification_preferences", 400);
      for (const [key, value] of Object.entries(input))
        db.prepare(
          "INSERT INTO notification_preferences VALUES(?,?,?) ON CONFLICT(user_id,category) DO UPDATE SET enabled=excluded.enabled",
        ).run(user, key, value ? 1 : 0);
      return { saved: true };
    }).immediate,
    /** Internal hook for a teammate's authorized chat transaction; never an HTTP endpoint. */
    chatMessage: db.transaction(
      ({ messageId, conversationPath, senderId, recipientIds }) => {
        if (
          typeof messageId !== "string" ||
          !messageId ||
          typeof conversationPath !== "string" ||
          !/^\/(?:groups|kaki|chat)(?:\/|$)/.test(conversationPath) ||
          !Array.isArray(recipientIds)
        )
          throw communityError("invalid_notification_event", 400);
        for (const user of new Set(
          recipientIds.filter((u) => u !== senderId),
        )) {
          if (
            db
              .prepare(
                "SELECT enabled FROM notification_preferences WHERE user_id=? AND category=?",
              )
              .get(user, "chat")?.enabled === 0
          )
            continue;
          db.prepare(
            "INSERT OR IGNORE INTO notifications(id,user_id,category,event_key,title,resource_path) VALUES(?,?,'chat',?,'New chat message',?)",
          ).run(randomUUID(), user, `chat:${messageId}`, conversationPath);
        }
      },
    ).immediate,
  };
}
