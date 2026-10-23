import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchChatUpdates } from '../../client/src/chatPages.js';

test('reconnecting drains every forward page before advancing to the latest message', async () => {
  const calls = [];
  const messages = await fetchChatUpdates(async ({ after }) => {
    calls.push(after);
    const first = Number(after) + 1, last = Math.min(175, first + 49);
    const rows = Array.from({ length: last - first + 1 }, (_, i) => ({ id: String(first + i) }));
    return { messages: rows, page: { hasMore: last < 175, direction: 'newer', newest: String(last) } };
  }, '50');
  assert.equal(messages.length, 125);
  assert.deepEqual(calls, ['50', '100', '150']);
  assert.equal(messages[0].id, '51');
  assert.equal(messages.at(-1).id, '175');
});

test('malformed pagination cannot trap a reconnect in an endless loop', async () => {
  await assert.rejects(() => fetchChatUpdates(async () => ({ messages: [], page: { hasMore: true, direction: 'newer', newest: 'm1' } }), 'm1'), /invalid_chat_page/);
});
