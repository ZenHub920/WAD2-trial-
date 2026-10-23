/** Drain forward pages before advancing the newest-message cursor. */
export async function fetchChatUpdates(loadPage, after) {
  if (!after) return [];
  const result = [], seen = new Set();
  let cursor = after;
  for (;;) {
    const data = await loadPage({ after: cursor });
    for (const message of data.messages) if (!seen.has(message.id)) { seen.add(message.id); result.push(message); }
    if (!data.page?.hasMore || data.page.direction !== 'newer') return result;
    const next = data.page.newest;
    if (!next || next === cursor) throw new Error('invalid_chat_page');
    cursor = next;
  }
}
