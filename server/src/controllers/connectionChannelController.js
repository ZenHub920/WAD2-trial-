import { connectionChannelPath } from '../db/connectionChannelRepository.js';

export function createConnectionChannelController(repos, realtime = null) {
  const chat = repos.connectionChannels;
  const run = (res, fn) => {
    res.set('Cache-Control', 'private, no-store');
    try { return res.json(fn()); }
    catch (error) { if (error.status) return res.status(error.status).json({ error: error.message }); throw error; }
  };
  const fanOut = (connectionId, type, payload = {}) => realtime?.emitTo(chat.memberIds(connectionId), type, { connectionId, ...payload });
  const markRead = (id, user) => {
    const result = chat.markRead(id, user);
    const notificationsRead = repos.notifications.readConversation(user, connectionChannelPath(id));
    if (result.changed) fanOut(id, 'connection-read', { readerId: user, lastReadSeq: result.read });
    return { ...result, notificationsRead };
  };
  return {
    list: (req, res) => run(res, () => ({ channels: chat.list(req.user.id) })),
    unread: (req, res) => run(res, () => ({ total: chat.unreadTotal(req.user.id) })),
    open: (req, res) => run(res, () => {
      const channel = chat.open(req.params.connectionId, req.user.id, req.query);
      const { notificationsRead } = markRead(req.params.connectionId, req.user.id);
      return { channel, notificationsRead };
    }),
    message: (req, res) => run(res, () => ({ message: chat.message(req.params.connectionId, req.user.id, req.params.messageId) })),
    read: (req, res) => run(res, () => markRead(req.params.connectionId, req.user.id)),
    send: (req, res) => run(res, () => {
      const message = chat.send(req.params.connectionId, req.user.id, req.body?.body, req.body?.replyTo ?? null);
      const notificationsRead = repos.notifications.readConversation(req.user.id, connectionChannelPath(req.params.connectionId));
      fanOut(req.params.connectionId, 'connection-message', { messageId: message.id });
      return { message, notificationsRead };
    }),
    edit: (req, res) => run(res, () => {
      const message = chat.edit(req.params.connectionId, req.user.id, req.params.messageId, req.body?.body);
      fanOut(req.params.connectionId, 'connection-message', { messageId: message.id });
      return { message };
    }),
    remove: (req, res) => run(res, () => {
      const result = chat.remove(req.params.connectionId, req.user.id, req.params.messageId);
      fanOut(req.params.connectionId, 'connection-message', { messageId: req.params.messageId });
      return result;
    }),
    background: (req, res) => run(res, () => chat.setBackground(req.params.connectionId, req.user.id, req.body?.background)),
  };
}
