/** Refresh visible quotes even when their original message is outside the window. */
export function applyConnectionMessageUpdate(messages, changed, { includeOriginal = true } = {}) {
  const rows = new Map(messages.map(message => [message.id, message]));
  if (includeOriginal) rows.set(changed.id, changed);
  return [...rows.values()].sort((a, b) => a.seq - b.seq).map(message =>
    message.replyTo?.id === changed.id
      ? { ...message, replyTo: { ...message.replyTo, body: changed.deleted ? null : changed.body, deleted: Boolean(changed.deleted) } }
      : message);
}
