const SOURCES = {
  kaki: ['messages', 'conversation_id'],
  group: ['group_channel_messages', 'party_id'],
  connection: ['connection_channel_messages', 'connection_id'],
  market: ['ticket_messages', 'conversation_id'],
};
const invalid = () => Object.assign(new Error('invalid_message_cursor'), { status: 400 });

/** Call only after the repository/controller authorizes access to this thread. */
export function readMessagePage(db, source, parentId, options = {}) {
  const [table, parent] = SOURCES[source] ?? [];
  if (!table) throw new Error('unknown_message_source');
  const { before, after } = options;
  const limit = options.limit === undefined ? 50 : Number(options.limit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || (before && after)
    || [before, after].some((v) => v !== undefined && v !== null && (typeof v !== 'string' || !v || v.length > 200))) throw invalid();
  let cursor = null;
  if (before || after) {
    cursor = db.prepare(`SELECT rowid AS seq FROM ${table} WHERE id=? AND ${parent}=?`).get(before || after, parentId);
    if (!cursor) throw invalid();
  }
  const forward = Boolean(after);
  const rows = db.prepare(`SELECT rowid AS seq, * FROM ${table} WHERE ${parent}=?
    ${cursor ? `AND rowid ${forward ? '>' : '<'} ?` : ''}
    ORDER BY rowid ${forward ? 'ASC' : 'DESC'} LIMIT ?`)
    .all(...[parentId, ...(cursor ? [cursor.seq] : []), limit + 1]);
  const hasMore = rows.length > limit;
  if (hasMore) rows.pop();
  if (!forward) rows.reverse();
  return {
    rows,
    page: {
      limit, hasMore, direction: forward ? 'newer' : 'older',
      nextCursor: hasMore ? (forward ? rows.at(-1)?.id : rows[0]?.id) ?? null : null,
      oldest: rows[0]?.id ?? null, newest: rows.at(-1)?.id ?? null,
    },
  };
}
