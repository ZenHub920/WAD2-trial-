/**
 * Group channel HTTP layer.
 *
 * Every handler re-asks the repository whether this user may be here; none of
 * them trust that an earlier call said yes. Membership can be revoked between
 * two requests, and a stale tab must not keep writing into a room its owner
 * has left.
 */

/** Repository errors carry their own status; anything else is a real fault. */
function send(res, run) {
  try {
    return res.json(run());
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    throw error;
  }
}

export function createGroupChannelController(repos, realtime) {
  /** Push to everyone in the room, including the sender's other tabs. */
  const fanOut = (partyId, type, payload = {}) =>
    realtime?.emitTo(repos.groupChannels.memberIds(partyId), type, { partyId, ...payload });

  return {
    list(req, res) {
      res.json({ channels: repos.groupChannels.list(req.user.id) });
    },

    unread(req, res) {
      res.json({ total: repos.groupChannels.unreadTotal(req.user.id) });
    },

    open(req, res) {
      return send(res, () => {
        const channel = repos.groupChannels.open(req.params.partyId, req.user.id);
        // Opening is reading; the badge should not survive the visit.
        repos.groupChannels.markRead(req.params.partyId, req.user.id);
        repos.notifications.readConversation(req.user.id, `/groups/${req.params.partyId}/channel`);
        return { channel };
      });
    },

    candidates(req, res) {
      return send(res, () => ({
        candidates: repos.groupChannels.candidates(req.params.partyId, req.user.id),
      }));
    },

    addMember(req, res) {
      return send(res, () => {
        const result = repos.groupChannels.add(req.params.partyId, req.user.id, req.body?.userId);
        fanOut(req.params.partyId, 'group-members');
        return result;
      });
    },

    leave(req, res) {
      return send(res, () => {
        // Members must be read BEFORE the row goes, or the person leaving
        // never hears that they left and their inbox keeps the stale room.
        const audience = repos.groupChannels.memberIds(req.params.partyId);
        const result = repos.groupChannels.leave(req.params.partyId, req.user.id);
        realtime?.emitTo(audience, 'group-members', { partyId: req.params.partyId });
        return result;
      });
    },

    send(req, res) {
      return send(res, () => {
        const message = repos.groupChannels.send(req.params.partyId, req.user.id, req.body?.body);
        fanOut(req.params.partyId, 'group-message', { messageId: message.id });
        repos.notifications.chatMessage({
          messageId: message.id,
          conversationPath: `/groups/${req.params.partyId}/channel`,
          senderId: req.user.id,
          recipientIds: repos.groupChannels.memberIds(req.params.partyId),
        });
        return { message };
      });
    },

    remove(req, res) {
      return send(res, () => {
        const result = repos.groupChannels.remove(
          req.params.partyId, req.user.id, req.params.messageId,
        );
        fanOut(req.params.partyId, 'group-message');
        return result;
      });
    },

    markRead(req, res) {
      return send(res, () => {
        const result = repos.groupChannels.markRead(req.params.partyId, req.user.id);
        repos.notifications.readConversation(req.user.id, `/groups/${req.params.partyId}/channel`);
        return result;
      });
    },
  };
}
