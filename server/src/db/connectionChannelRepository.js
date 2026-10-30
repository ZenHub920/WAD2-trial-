/** Accepted connections have one shared room; attendance groups stay separate. */
import { randomUUID } from 'node:crypto';
import { readMessagePage, validateMessageBody, CHAT_BACKGROUNDS } from './messagePage.js';

const fail = (message, status = 409) => Object.assign(new Error(message), { status });
export const connectionChannelPath = (id) => `/groups/connections/${id}/channel`;

export function migrateConnectionChannels(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS connection_channel_members(
    connection_id TEXT NOT NULL REFERENCES group_connections(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at TEXT NOT NULL DEFAULT(datetime('now')),last_read_seq INTEGER NOT NULL DEFAULT 0,
    background TEXT NOT NULL DEFAULT 'default' CHECK(background IN('default','dusk','neon','paper','forest','mono')),
    PRIMARY KEY(connection_id,user_id));
    CREATE TABLE IF NOT EXISTS connection_channel_messages(
    id TEXT PRIMARY KEY,connection_id TEXT NOT NULL REFERENCES group_connections(id) ON DELETE CASCADE,
    sender_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 2000),
    reply_to_message_id TEXT REFERENCES connection_channel_messages(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT(datetime('now')),edited_at TEXT,deleted_at TEXT);
    CREATE INDEX IF NOT EXISTS idx_connection_channel_messages ON connection_channel_messages(connection_id);
    CREATE INDEX IF NOT EXISTS idx_connection_channel_member_user ON connection_channel_members(user_id,connection_id);`);
}

export function createConnectionChannelRepo(db, repos) {
  // This is the authorization source on EVERY operation, including queued push.
  // Persisted read/background rows never grant membership themselves.
  const context = (id) => {
    const connection = db.prepare("SELECT * FROM group_connections WHERE id=? AND status='accepted'").get(id);
    if (!connection) return null;
    const parties = [connection.party_a_id, connection.party_b_id].map((partyId) => repos.parties.findById(partyId));
    if (parties.some((party) => !party || party.status === 'cancelled'
      || db.prepare('SELECT 1 FROM tickets WHERE source_party_id=?').get(party.id))
      || parties[0].concert_id !== parties[1].concert_id) return null;
    const people = new Map();
    for (const party of parties) {
      const ids = [party.host_user_id, ...db.prepare("SELECT user_id FROM group_memberships WHERE party_id=? AND status='active'").all(party.id).map((row) => row.user_id)];
      for (const userId of ids) {
        const user = repos.users.findById(userId);
        if (user) people.set(userId, { id: user.id, displayName: user.display_name,
          avatarUrl: user.avatar_path ? `/api/avatars/${user.avatar_path}` : null,
          isHost: parties.some((p) => p.host_user_id === userId), partyId: party.id });
      }
    }
    const blocklist = repos.users.blocklist();
    const ids = [...people.keys()];
    // Match the privacy policy of connected-group meetup boards: a blocked pair
    // freezes the shared room, without revealing who blocked whom.
    if (ids.some((a) => ids.some((b) => blocklist.has(`${a}:${b}`)))) return null;
    return { connection, parties, members: [...people.values()].sort((a, b) => Number(b.isHost) - Number(a.isHost) || a.displayName.localeCompare(b.displayName) || a.id.localeCompare(b.id)) };
  };
  const requireMember = (connectionId, userId) => {
    const room = context(connectionId);
    if (!room || !room.members.some((member) => member.id === userId)) throw fail('connection_channel_not_found', 404);
    const insert = db.prepare('INSERT OR IGNORE INTO connection_channel_members(connection_id,user_id) VALUES(?,?)');
    for (const member of room.members) insert.run(connectionId, member.id);
    return room;
  };
  const identity = (room, viewer) => {
    const [a, b] = room.parties;
    const party = (p) => ({ id: p.id, name: p.name || `${p.host.display_name}'s group`, hostName: p.host.display_name });
    const concert = repos.concerts.findById(a.concert_id);
    const partyA = party(a), partyB = party(b);
    return { connectionId: room.connection.id, name: `${partyA.name} + ${partyB.name}`, partyA, partyB,
      concert: { id: concert.id, artist: concert.artist, eventDate: concert.event_date, venue: concert.venue },
      isHost: room.parties.some((p) => p.host_user_id === viewer) };
  };
  const messageRow = (id, connectionId) => db.prepare(`SELECT rowid AS seq,* FROM connection_channel_messages WHERE id=? AND connection_id=?`).get(id, connectionId);
  const shapeMessage = (row, viewer, room) => {
    const sender = repos.users.findById(row.sender_user_id);
    const quoted = row.reply_to_message_id ? messageRow(row.reply_to_message_id, row.connection_id) : null;
    const reads = db.prepare('SELECT user_id,last_read_seq FROM connection_channel_members WHERE connection_id=?').all(row.connection_id);
    return { id: row.id, seq: row.seq, body: row.deleted_at ? null : row.body,
      deleted: Boolean(row.deleted_at), createdAt: row.created_at, editedAt: row.edited_at,
      mine: row.sender_user_id === viewer,
      sender: { id: sender.id, displayName: sender.display_name, avatarUrl: sender.avatar_path ? `/api/avatars/${sender.avatar_path}` : null },
      replyTo: quoted ? { id: quoted.id, senderId: quoted.sender_user_id, body: quoted.deleted_at ? null : quoted.body, deleted: Boolean(quoted.deleted_at) } : null,
      readBy: room.members.filter((person) => person.id !== row.sender_user_id && reads.some((read) => read.user_id === person.id && read.last_read_seq >= row.seq))
        .map(({ id, displayName }) => ({ id, displayName })) };
  };
  const text = (input) => {
    const { body, error } = validateMessageBody(input);
    if (error) throw fail(error, 400);
    return body;
  };
  const advanceRead = (connectionId, userId) => {
    const top = db.prepare('SELECT COALESCE(MAX(rowid),0) seq FROM connection_channel_messages WHERE connection_id=?').get(connectionId).seq;
    db.prepare('UPDATE connection_channel_members SET last_read_seq=MAX(last_read_seq,?) WHERE connection_id=? AND user_id=?').run(top, connectionId, userId);
    return top;
  };
  const candidateIds = db.prepare(`SELECT gc.id FROM group_connections gc
    JOIN parties a ON a.id=gc.party_a_id JOIN parties b ON b.id=gc.party_b_id
    WHERE gc.status='accepted' AND (a.host_user_id=@user OR b.host_user_id=@user OR EXISTS(
      SELECT 1 FROM group_memberships gm WHERE gm.user_id=@user AND gm.status='active'
        AND gm.party_id IN(gc.party_a_id,gc.party_b_id))) ORDER BY gc.responded_at DESC,gc.id`);
  return {
    canAccess(userId, connectionId) { return Boolean(context(connectionId)?.members.some((member) => member.id === userId)); },
    memberIds(connectionId) { return context(connectionId)?.members.map((member) => member.id) ?? []; },
    audiences(userId) {
      return candidateIds.all({ user: userId }).map(({ id }) => context(id))
        .filter((room) => room?.members.some((member) => member.id === userId))
        .map((room) => ({ connectionId: room.connection.id, memberIds: room.members.map((member) => member.id).sort() }));
    },
    list(userId) {
      return candidateIds.all({ user: userId })
        .map(({ id }) => context(id)).filter((room) => room?.members.some((member) => member.id === userId))
        .map((room) => {
          requireMember(room.connection.id, userId);
          const last = db.prepare(`SELECT rowid seq,body,created_at,deleted_at FROM connection_channel_messages WHERE connection_id=? ORDER BY rowid DESC LIMIT 1`).get(room.connection.id);
          const read = db.prepare('SELECT last_read_seq FROM connection_channel_members WHERE connection_id=? AND user_id=?').get(room.connection.id, userId).last_read_seq;
          const unread = db.prepare(`SELECT COUNT(*) n FROM connection_channel_messages WHERE connection_id=? AND sender_user_id<>? AND deleted_at IS NULL AND rowid>?`).get(room.connection.id, userId, read).n;
          return { ...identity(room, userId), memberCount: room.members.length, unread,
            lastMessage: last ? { body: last.deleted_at ? null : last.body, deleted: Boolean(last.deleted_at), createdAt: last.created_at } : null, lastSeq: last?.seq ?? 0 };
        }).sort((a, b) => b.lastSeq - a.lastSeq || a.connectionId.localeCompare(b.connectionId));
    },
    unreadTotal(userId) { return this.list(userId).filter((room) => room.unread > 0).length; },
    open(connectionId, userId, options = {}) {
      const room = requireMember(connectionId, userId);
      const page = readMessagePage(db, 'connection', connectionId, options);
      return { ...identity(room, userId), members: room.members,
        background: db.prepare('SELECT background FROM connection_channel_members WHERE connection_id=? AND user_id=?').get(connectionId, userId).background,
        page: page.page, messages: page.rows.map((row) => shapeMessage(row, userId, room)) };
    },
    message(connectionId, userId, id) {
      const room = requireMember(connectionId, userId), row = messageRow(id, connectionId);
      if (!row) throw fail('message_not_found', 404);
      return shapeMessage(row, userId, room);
    },
    markRead: db.transaction((connectionId, userId) => {
      requireMember(connectionId, userId);
      const before = db.prepare('SELECT last_read_seq FROM connection_channel_members WHERE connection_id=? AND user_id=?').get(connectionId, userId).last_read_seq;
      const read = advanceRead(connectionId, userId);
      return { read, changed: read > before };
    }).immediate,
    send: db.transaction((connectionId, userId, input, replyTo = null) => {
      const room = requireMember(connectionId, userId), body = text(input);
      if (replyTo !== null && (typeof replyTo !== 'string' || !replyTo || !messageRow(replyTo, connectionId))) throw fail('reply_target_invalid', 400);
      const id = `ccm_${randomUUID()}`;
      db.prepare('INSERT INTO connection_channel_messages(id,connection_id,sender_user_id,body,reply_to_message_id) VALUES(?,?,?,?,?)').run(id, connectionId, userId, body, replyTo);
      advanceRead(connectionId, userId);
      // Existing notification and durable push-job triggers remain the source
      // of delivery. A failed notification rolls back this message as well.
      repos.notifications.chatMessage({ messageId: id, conversationPath: connectionChannelPath(connectionId), senderId: userId, recipientIds: room.members.map((member) => member.id) });
      return shapeMessage(messageRow(id, connectionId), userId, room);
    }).immediate,
    edit: db.transaction((connectionId, userId, id, input) => {
      const room = requireMember(connectionId, userId), body = text(input), row = messageRow(id, connectionId);
      if (!row) throw fail('message_not_found', 404);
      if (row.sender_user_id !== userId) throw fail('own_message_required', 403);
      if (row.deleted_at) throw fail('message_deleted');
      db.prepare("UPDATE connection_channel_messages SET body=?,edited_at=datetime('now') WHERE id=?").run(body, id);
      return shapeMessage(messageRow(id, connectionId), userId, room);
    }).immediate,
    remove: db.transaction((connectionId, userId, id) => {
      requireMember(connectionId, userId);
      const row = messageRow(id, connectionId);
      if (!row) throw fail('message_not_found', 404);
      if (row.sender_user_id !== userId) throw fail('own_message_required', 403);
      db.prepare("UPDATE connection_channel_messages SET deleted_at=COALESCE(deleted_at,datetime('now')) WHERE id=?").run(id);
      return { deleted: true };
    }).immediate,
    setBackground: db.transaction((connectionId, userId, background) => {
      requireMember(connectionId, userId);
      if (!CHAT_BACKGROUNDS.includes(background)) throw fail('invalid_background', 400);
      db.prepare('UPDATE connection_channel_members SET background=? WHERE connection_id=? AND user_id=?').run(background, connectionId, userId);
      return { background };
    }).immediate,
  };
}
