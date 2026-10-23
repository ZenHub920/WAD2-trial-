/**
 * Group channels — the shared thread for one concert group.
 *
 * Distinct from both other chats in this codebase. The Kaki thread is a pair
 * whose right to talk comes from a mutual like; the ticket thread is a buyer
 * and a seller around one listing. This one is a room, and its membership is
 * granted rather than earned:
 *
 *   1. Being ACCEPTED into the group (an active group_memberships row) makes
 *      someone eligible. It does not put them in the channel.
 *   2. The host adds whom they choose from those eligible. Nobody else can
 *      add anyone, and nobody can add themselves.
 *   3. An added member sees the channel from that moment, and may leave it at
 *      any time without leaving the group itself.
 *
 * Keeping the two memberships separate is the point of the feature: a group
 * can hold people who are not in its chat, and leaving the chat is not the
 * same decision as leaving the concert plan.
 *
 * There is no channels table. The channel IS the party, so membership and
 * messages key on party_id directly and a channel cannot drift out of step
 * with the group it belongs to. The host is inserted as a member the first
 * time the channel is touched, so a room always has its owner in it.
 */

import { randomUUID } from 'node:crypto';
import { readMessagePage } from './messagePage.js';

export function migrateGroupChannels(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS group_channel_members (
      party_id TEXT NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      added_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      joined_at TEXT NOT NULL DEFAULT (datetime('now')),
      -- Highest message rowid this member has seen; rowid rather than a
      -- timestamp because datetime('now') has one-second granularity and
      -- several messages a second share it.
      last_read_seq INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (party_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS group_channel_messages (
      id TEXT PRIMARY KEY,
      party_id TEXT NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
      sender_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      deleted_at TEXT
    );
    -- SQLite will not index rowid by name; narrowing on party_id is what
    -- matters, and rowid order inside a party comes free from the table order.
    CREATE INDEX IF NOT EXISTS idx_group_channel_msgs
      ON group_channel_messages(party_id);
    CREATE TRIGGER IF NOT EXISTS revoke_group_channel_member
      AFTER UPDATE OF status ON group_memberships WHEN NEW.status <> 'active'
      BEGIN
        DELETE FROM group_channel_members WHERE party_id = OLD.party_id AND user_id = OLD.user_id;
      END;
    CREATE TRIGGER IF NOT EXISTS delete_group_channel_member
      AFTER DELETE ON group_memberships
      BEGIN
        DELETE FROM group_channel_members WHERE party_id = OLD.party_id AND user_id = OLD.user_id;
      END;
    CREATE TRIGGER IF NOT EXISTS cancel_group_channel
      AFTER UPDATE OF status ON parties WHEN NEW.status = 'cancelled'
      BEGIN
        DELETE FROM group_channel_members WHERE party_id = NEW.id;
      END;
    DELETE FROM group_channel_members
    WHERE NOT EXISTS (
      SELECT 1 FROM parties p WHERE p.id = group_channel_members.party_id AND p.status <> 'cancelled'
        AND (p.host_user_id = group_channel_members.user_id OR EXISTS (
          SELECT 1 FROM group_memberships gm
          WHERE gm.party_id = group_channel_members.party_id
            AND gm.user_id = group_channel_members.user_id AND gm.status = 'active'
        ))
    );
  `);
}

export function createGroupChannelRepo(db, repos) {
  const party = (partyId) =>
    db.prepare('SELECT id, host_user_id, concert_id, status FROM parties WHERE id = ?').get(partyId) ?? null;

  /** Accepted into the group — eligibility, not channel membership. */
  const inGroup = db.prepare(`
    SELECT 1 FROM group_memberships
    WHERE party_id = ? AND user_id = ? AND status = 'active'
  `);
  const channelMember = db.prepare(
    'SELECT 1 FROM group_channel_members WHERE party_id = ? AND user_id = ?',
  );
  const addMember = db.prepare(`
    INSERT OR IGNORE INTO group_channel_members (party_id, user_id, added_by_user_id, last_read_seq)
    VALUES (?, ?, ?, COALESCE((SELECT MAX(rowid) FROM group_channel_messages WHERE party_id = ?), 0))
  `);

  /** Backfills the host's own membership for every group they run. */
  const ensureHostRooms = db.prepare(`
    INSERT OR IGNORE INTO group_channel_members (party_id, user_id, added_by_user_id, last_read_seq)
    SELECT p.id, p.host_user_id, p.host_user_id,
           COALESCE((SELECT MAX(m.rowid) FROM group_channel_messages m WHERE m.party_id = p.id), 0)
    FROM parties p
    WHERE p.host_user_id = ? AND p.status <> 'cancelled'
  `);

  const fail = (error, status = 409) => {
    const err = new Error(error);
    err.status = status;
    return err;
  };

  /**
   * The host is a member of their own room by definition, so the row is
   * created on first contact rather than at party creation — which would have
   * needed a migration over every party that already exists.
   */
  function ensureHost(partyId) {
    const row = party(partyId);
    if (row && row.status !== 'cancelled') addMember.run(partyId, row.host_user_id, row.host_user_id, partyId);
    return row;
  }

  /** 404 rather than 403 for a non-member: ids should not be probeable. */
  function requireMember(partyId, userId) {
    const row = ensureHost(partyId);
    if (!row || row.status === 'cancelled') throw fail('group_not_found', 404);
    if (!channelMember.get(partyId, userId)) throw fail('group_channel_not_found', 404);
    return row;
  }

  function requireHost(partyId, userId) {
    const row = ensureHost(partyId);
    if (!row || row.status === 'cancelled') throw fail('group_not_found', 404);
    if (row.host_user_id !== userId) throw fail('group_host_required', 403);
    return row;
  }

  const memberRows = db.prepare(`
    SELECT m.user_id, m.joined_at, u.display_name, u.avatar_path,
           (m.user_id = p.host_user_id) AS is_host
    FROM group_channel_members m
    JOIN users u ON u.id = m.user_id
    JOIN parties p ON p.id = m.party_id
    WHERE m.party_id = ?
    ORDER BY is_host DESC, m.joined_at, m.user_id
  `);

  const shapeMember = (row) => ({
    id: row.user_id,
    displayName: row.display_name,
    avatarUrl: row.avatar_path ? `/api/avatars/${row.avatar_path}` : null,
    isHost: Boolean(row.is_host),
    joinedAt: row.joined_at,
  });

  const messageRows = db.prepare(`
    SELECT m.id, m.rowid AS seq, m.sender_user_id, m.body, m.created_at, m.deleted_at,
           u.display_name, u.avatar_path
    FROM group_channel_messages m
    JOIN users u ON u.id = m.sender_user_id
    WHERE m.party_id = ?
    ORDER BY m.rowid ASC
  `);

  const shapeMessage = (row, viewerId) => ({
    id: row.id,
    seq: row.seq,
    body: row.deleted_at ? null : row.body,
    deleted: Boolean(row.deleted_at),
    createdAt: row.created_at,
    mine: row.sender_user_id === viewerId,
    sender: {
      id: row.sender_user_id,
      displayName: row.display_name,
      avatarUrl: row.avatar_path ? `/api/avatars/${row.avatar_path}` : null,
    },
  });

  return {
    /** Every channel this user is in, newest activity first. */
    list(userId) {
      // A host owns a room whether or not they have opened it, so their rows
      // are created here too — otherwise the inbox would be empty until the
      // first visit, which is the one place nobody would think to visit.
      ensureHostRooms.run(userId);
      const rows = db.prepare(`
        SELECT p.id AS party_id, p.host_user_id, c.id AS concert_id, c.artist, c.event_date, c.venue,
               p.name AS group_name, m.last_read_seq,
               (SELECT COUNT(*) FROM group_channel_members x WHERE x.party_id = p.id) AS member_count,
               (SELECT COUNT(*) FROM group_channel_messages msg
                 WHERE msg.party_id = p.id AND msg.sender_user_id <> m.user_id
                   AND msg.rowid > m.last_read_seq) AS unread,
               (SELECT msg.body FROM group_channel_messages msg
                 WHERE msg.party_id = p.id AND msg.deleted_at IS NULL
                 ORDER BY msg.rowid DESC LIMIT 1) AS last_body,
               (SELECT msg.created_at FROM group_channel_messages msg
                 WHERE msg.party_id = p.id ORDER BY msg.rowid DESC LIMIT 1) AS last_at,
               (SELECT COALESCE(MAX(msg.rowid), 0) FROM group_channel_messages msg
                 WHERE msg.party_id = p.id) AS last_seq
        FROM group_channel_members m
        JOIN parties p ON p.id = m.party_id
        JOIN concerts c ON c.id = p.concert_id
        WHERE m.user_id = ?
        ORDER BY last_seq DESC, p.id
      `).all(userId);
      return rows.map((row) => ({
        partyId: row.party_id,
        concert: { id: row.concert_id, artist: row.artist, eventDate: row.event_date, venue: row.venue },
        name: row.group_name || `${row.artist} group`,
        isHost: row.host_user_id === userId,
        memberCount: row.member_count,
        unread: row.unread,
        lastMessage: row.last_at ? { body: row.last_body, createdAt: row.last_at } : null,
      }));
    },

    /** The room itself. Membership is re-checked here, not only when added. */
    open(partyId, userId, options = {}) {
      const row = requireMember(partyId, userId);
      const paged = readMessagePage(db, 'group', partyId, options);
      const concert = repos.concerts.findById(row.concert_id);
      return {
        partyId,
        concert: concert
          ? { id: concert.id, artist: concert.artist, eventDate: concert.event_date, venue: concert.venue }
          : null,
        isHost: row.host_user_id === userId,
        members: memberRows.all(partyId).map(shapeMember),
        page: paged.page,
        messages: paged.rows.map((m) => ({ ...m, ...db.prepare('SELECT display_name,avatar_path FROM users WHERE id=?').get(m.sender_user_id) }))
          .map((m) => shapeMessage(m, userId)),
      };
    },

    /** Who the host may still add: accepted in the group, not yet in the room. */
    candidates(partyId, userId) {
      requireHost(partyId, userId);
      return db.prepare(`
        SELECT gm.user_id, u.display_name, u.avatar_path, gm.source
        FROM group_memberships gm
        JOIN users u ON u.id = gm.user_id
        WHERE gm.party_id = ? AND gm.status = 'active'
          AND NOT EXISTS (SELECT 1 FROM group_channel_members cm
                          WHERE cm.party_id = gm.party_id AND cm.user_id = gm.user_id)
        ORDER BY u.display_name, gm.user_id
      `).all(partyId).map((row) => ({
        id: row.user_id,
        displayName: row.display_name,
        avatarUrl: row.avatar_path ? `/api/avatars/${row.avatar_path}` : null,
        source: row.source,
      }));
    },

    /** Host-only, and only for somebody the group has already accepted. */
    add: db.transaction((partyId, hostId, memberId) => {
      requireHost(partyId, hostId);
      if (typeof memberId !== 'string' || !memberId) throw fail('user_required', 400);
      if (!inGroup.get(partyId, memberId)) throw fail('not_a_group_member', 409);
      if (channelMember.get(partyId, memberId)) throw fail('already_in_channel', 409);
      addMember.run(partyId, memberId, hostId, partyId);
      return { added: memberId, members: memberRows.all(partyId).map(shapeMember) };
    }),

    /**
     * Leaving the channel is not leaving the group — the plan survives it.
     * The host cannot leave their own room; they would strand it.
     */
    leave: db.transaction((partyId, userId) => {
      const row = requireMember(partyId, userId);
      if (row.host_user_id === userId) throw fail('host_cannot_leave_channel', 409);
      db.prepare('DELETE FROM group_channel_members WHERE party_id = ? AND user_id = ?')
        .run(partyId, userId);
      return { left: true };
    }),

    send: db.transaction((partyId, userId, body) => {
      requireMember(partyId, userId);
      const text = typeof body === 'string' ? body.trim() : '';
      if (!text) throw fail('message_required', 400);
      if (text.length > 2000) throw fail('message_too_long', 400);
      const id = `gcm_${randomUUID()}`;
      db.prepare(`INSERT INTO group_channel_messages (id, party_id, sender_user_id, body)
                  VALUES (?, ?, ?, ?)`).run(id, partyId, userId, text);
      const row = db.prepare(`
        SELECT m.id, m.rowid AS seq, m.sender_user_id, m.body, m.created_at, m.deleted_at,
               u.display_name, u.avatar_path
        FROM group_channel_messages m JOIN users u ON u.id = m.sender_user_id
        WHERE m.id = ?`).get(id);
      // The sender has by definition read their own message.
      db.prepare('UPDATE group_channel_members SET last_read_seq = ? WHERE party_id = ? AND user_id = ?')
        .run(row.seq, partyId, userId);
      return shapeMessage(row, userId);
    }),

    /** Only your own, and tombstoned so the thread keeps its shape. */
    remove: db.transaction((partyId, userId, messageId) => {
      requireMember(partyId, userId);
      const row = db.prepare(
        'SELECT sender_user_id, deleted_at FROM group_channel_messages WHERE id = ? AND party_id = ?',
      ).get(messageId, partyId);
      if (!row) throw fail('message_not_found', 404);
      if (row.sender_user_id !== userId) throw fail('own_message_required', 403);
      if (!row.deleted_at) {
        db.prepare("UPDATE group_channel_messages SET deleted_at = datetime('now') WHERE id = ?")
          .run(messageId);
      }
      return { deleted: true };
    }),

    markRead: db.transaction((partyId, userId) => {
      requireMember(partyId, userId);
      const top = db.prepare('SELECT COALESCE(MAX(rowid), 0) AS seq FROM group_channel_messages WHERE party_id = ?')
        .get(partyId).seq;
      db.prepare('UPDATE group_channel_members SET last_read_seq = ? WHERE party_id = ? AND user_id = ?')
        .run(top, partyId, userId);
      return { read: top };
    }),

    /** Member ids, for fanning a new message out over SSE and notifications. */
    memberIds(partyId) {
      return db.prepare('SELECT user_id FROM group_channel_members WHERE party_id = ?')
        .all(partyId).map((r) => r.user_id);
    },

    unreadTotal(userId) {
      return db.prepare(`
        SELECT COUNT(DISTINCT m.party_id) AS n
        FROM group_channel_members cm
        JOIN group_channel_messages m ON m.party_id = cm.party_id
        WHERE cm.user_id = ? AND m.sender_user_id <> ? AND m.rowid > cm.last_read_seq
      `).get(userId, userId).n;
    },
  };
}
