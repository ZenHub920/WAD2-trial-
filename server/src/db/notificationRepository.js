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
    DROP TRIGGER IF EXISTS ${name};
    CREATE TRIGGER ${name} AFTER ${timing} ON ${table} WHEN ${condition} BEGIN
      INSERT OR IGNORE INTO notifications(id,user_id,category,event_key,title,resource_path)
      SELECT lower(hex(randomblob(16))),recipient,'${category}',${key},${title},${path}
      FROM (${recipients}) WHERE recipient IS NOT NULL AND COALESCE((SELECT enabled FROM notification_preferences
        WHERE user_id=recipient AND category='${category}'),1)=1;
    END;`);
    trigger(
      "notify_kaki_message",
      "messages",
      "INSERT",
      "chat",
      `SELECT CASE WHEN c.user_a_id=NEW.sender_user_id THEN c.user_b_id ELSE c.user_a_id END recipient FROM conversations c WHERE c.id=NEW.conversation_id`,
      "'Message from '||COALESCE((SELECT display_name FROM users WHERE id=NEW.sender_user_id),'a companion')",
      "'/kaki/chat/'||NEW.conversation_id",
      // Keyed by CONVERSATION, not by message: ten messages from one person
      // are one thing to look at. UNIQUE(user_id,event_key) collapses the rest.
      "'kaki-chat:'||NEW.conversation_id",
    );
    trigger(
      "notify_market_message",
      "ticket_messages",
      "INSERT",
      "chat",
      `SELECT CASE WHEN c.buyer_user_id=NEW.sender_user_id THEN c.seller_user_id ELSE c.buyer_user_id END recipient FROM ticket_conversations c WHERE c.id=NEW.conversation_id`,
      "'Ticket message from '||COALESCE((SELECT display_name FROM users WHERE id=NEW.sender_user_id),'a companion')",
      "'/chat/'||NEW.conversation_id",
      "'ticket-chat:'||NEW.conversation_id",
    );
    trigger(
      "notify_join_request",
      "group_join_requests",
      "INSERT",
      "group",
      "SELECT host_user_id recipient FROM parties WHERE id=NEW.party_id",
      "'A seeker requested to join your group'",
      "'/groups/connect'",
      "'join-request:'||NEW.id",
    );
    trigger(
      "notify_join_response",
      "group_join_requests",
      "UPDATE OF status",
      "group",
      "SELECT NEW.user_id recipient",
      "'Your group join request was updated'",
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
      "'A seeker requested to join your group'",
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
      "'A group invited your group to connect'",
      "'/groups/connect'",
      "'group-invite:'||NEW.id",
    );
    trigger(
      "notify_group_profile_changed",
      "group_settings",
      "UPDATE OF version",
      "group",
      "SELECT user_id recipient FROM group_join_requests WHERE party_id=NEW.party_id AND status='pending' AND COALESCE(group_version,0)<>NEW.version",
      "'A group you chose changed; review and resubmit your request'",
      "'/groups'",
      "'group-profile:'||NEW.party_id||':'||NEW.version",
      "NEW.version<>OLD.version",
    );
    trigger(
      "notify_seeker_profile_changed",
      "seeker_discovery_preferences",
      "UPDATE OF answers_json",
      "group",
      `SELECT NEW.user_id recipient WHERE EXISTS(SELECT 1 FROM group_join_requests r JOIN parties p ON p.id=r.party_id
        WHERE r.user_id=NEW.user_id AND p.concert_id=NEW.concert_id AND r.status='pending')
       UNION SELECT p.host_user_id recipient FROM group_join_requests r JOIN parties p ON p.id=r.party_id
        WHERE r.user_id=NEW.user_id AND p.concert_id=NEW.concert_id AND r.status='pending'`,
      "'Seeker preferences changed; review and resubmit the join request'",
      "CASE WHEN recipient=NEW.user_id THEN '/groups' ELSE '/groups/connect' END",
      "'seeker-profile:'||NEW.user_id||':'||NEW.concert_id||':'||lower(hex(randomblob(16)))",
      "NEW.answers_json<>OLD.answers_json",
    );
    trigger(
      "notify_group_response",
      "group_connections",
      "UPDATE OF status",
      "group",
      "SELECT host_user_id recipient FROM parties WHERE id=NEW.initiator_party_id",
      "'Your group invitation was updated'",
      "'/groups/connect'",
      "'group-response:'||NEW.id||':'||NEW.status",
      "NEW.status<>OLD.status",
    );
    // Existing installations notified only the seeker. Both decision makers
    // now receive the same offer, without rewriting any delivered notification.
    db.exec("DROP TRIGGER IF EXISTS notify_match_offer");
    trigger(
      "notify_match_offer",
      "match_proposals",
      "INSERT",
      "match",
      `SELECT user_id recipient FROM seeker_requests WHERE id=NEW.seeker_request_id
        UNION SELECT host_user_id recipient FROM parties WHERE id=NEW.party_id`,
      "'You received a matching proposal'",
      "'/concerts/'||(SELECT concert_id FROM parties WHERE id=NEW.party_id)",
      "'match-offer:'||NEW.id",
    );
    const proposalColumns = new Set(db.prepare("PRAGMA table_info(match_proposals)").all().map((c) => c.name));
    if (proposalColumns.has("seeker_approved_at") && proposalColumns.has("host_approved_at")) trigger(
      "notify_match_first_approval",
      "match_proposals",
      "UPDATE OF seeker_approved_at,host_approved_at",
      "match",
      `SELECT host_user_id recipient FROM parties WHERE id=NEW.party_id
        AND OLD.seeker_approved_at IS NULL AND NEW.seeker_approved_at IS NOT NULL
        UNION SELECT user_id recipient FROM seeker_requests WHERE id=NEW.seeker_request_id
        AND OLD.host_approved_at IS NULL AND NEW.host_approved_at IS NOT NULL`,
      "'A matching proposal is waiting for your decision'",
      "'/concerts/'||(SELECT concert_id FROM parties WHERE id=NEW.party_id)",
      "'match-approval:'||NEW.id||':'||CASE WHEN OLD.seeker_approved_at IS NULL AND NEW.seeker_approved_at IS NOT NULL THEN 'seeker' ELSE 'host' END",
      "NEW.status='proposed' AND (NEW.seeker_approved_at IS NULL OR NEW.host_approved_at IS NULL) AND ((OLD.seeker_approved_at IS NULL AND NEW.seeker_approved_at IS NOT NULL) OR (OLD.host_approved_at IS NULL AND NEW.host_approved_at IS NOT NULL))",
    );
    trigger(
      "notify_match_response",
      "match_proposals",
      "UPDATE OF status",
      "match",
      `SELECT host_user_id recipient FROM parties WHERE id=NEW.party_id UNION SELECT user_id recipient FROM seeker_requests WHERE id=NEW.seeker_request_id`,
      "'A matching proposal was updated'",
      "'/concerts/'||(SELECT concert_id FROM parties WHERE id=NEW.party_id)",
      "'match-status:'||NEW.id||':'||NEW.status",
      "NEW.status<>OLD.status",
    );
    // The previous scheme wrote one row per message with a generic title. Those
    // rows cannot be upgraded in place — their keys are per-message — so they are
    // cleared once. A per-conversation row reappears with the next message, named
    // after whoever sent it.
    db.exec(`DELETE FROM notifications WHERE category='chat'
      AND (event_key LIKE 'kaki-message:%' OR event_key LIKE 'ticket-message:%'
           OR (event_key LIKE 'chat:%' AND event_key NOT LIKE 'chat-thread:%'))`);
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
    /**
     * Chat notifications are DELETED rather than marked, everywhere below.
     *
     * Two reasons, and the second is the load-bearing one. A chat notification
     * says "you have unread messages here" — once read it describes nothing, so
     * leaving it in the inbox is clutter. And because chat rows are now keyed by
     * conversation, UNIQUE(user_id,event_key) would silently swallow every later
     * message from that person if the row were merely marked read. Deleting is
     * what re-arms the key for the next conversation that goes quiet and starts
     * again. Everything else still marks read and stays as history.
     */
    read(user, id) {
      const row = db
        .prepare("SELECT category FROM notifications WHERE id=? AND user_id=?")
        .get(id, user);
      if (!row) throw communityError("notification_not_found", 404);
      if (row.category === "chat") {
        db.prepare("DELETE FROM notifications WHERE id=? AND user_id=?").run(id, user);
        return { read: true };
      }
      db.prepare(
        "UPDATE notifications SET read_at=COALESCE(read_at,datetime('now')) WHERE id=? AND user_id=?",
      ).run(id, user);
      return { read: true };
    },
    /** Called when the person opens the thread; the badge clears with the row. */
    readConversation(user, path) {
      return db.prepare(
        "DELETE FROM notifications WHERE user_id=? AND category='chat' AND resource_path=?",
      ).run(user, path).changes;
    },
    readAll(user) {
      db.prepare("DELETE FROM notifications WHERE user_id=? AND category='chat'").run(user);
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
          typeof senderId !== "string" ||
          !senderId ||
          !Array.isArray(recipientIds) ||
          recipientIds.some((id) => typeof id !== "string" || !id)
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
          const sender = db
            .prepare("SELECT display_name FROM users WHERE id=?")
            .get(senderId)?.display_name;
          db.prepare(
            "INSERT OR IGNORE INTO notifications(id,user_id,category,event_key,title,resource_path) VALUES(?,?,'chat',?,?,?)",
          ).run(
            randomUUID(),
            user,
            // Per conversation, not per message, to match the triggers.
            `chat-thread:${conversationPath}`,
            `Message from ${sender ?? "a companion"}`,
            conversationPath,
          );
        }
      },
    ).immediate,
  };
}
