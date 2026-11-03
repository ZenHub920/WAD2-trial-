import test from 'node:test';
import assert from 'node:assert/strict';
import { applyConnectionMessageUpdate } from '../../client/src/connectionChatMessages.js';

const reply = (id, seq, originalId, body) => ({
  id, seq, body: 'A visible reply', replyTo: { id: originalId, senderId: 'member', body, deleted: false },
});

test('deleting an unloaded original scrubs its visible quote without adding old history', () => {
  const messages = [reply('recent', 50, 'old', 'Private original text')];
  const updated = applyConnectionMessageUpdate(messages, { id: 'old', seq: 1, body: null, deleted: true }, { includeOriginal: false });
  assert.deepEqual(updated.map(message => message.id), ['recent']);
  assert.deepEqual(updated[0].replyTo, { id: 'old', senderId: 'member', body: null, deleted: true });
  assert.equal(messages[0].replyTo.body, 'Private original text');
});

test('editing an unloaded original refreshes all visible quotes', () => {
  const messages = [reply('first', 50, 'old', 'Before'), reply('second', 60, 'old', 'Before')];
  const updated = applyConnectionMessageUpdate(messages, { id: 'old', seq: 1, body: 'Corrected text', deleted: false }, { includeOriginal: false });
  assert.deepEqual(updated.map(message => message.id), ['first', 'second']);
  assert.deepEqual(updated.map(message => message.replyTo.body), ['Corrected text', 'Corrected text']);
  assert.ok(updated.every(message => !message.replyTo.deleted));
});

test('a message update preserves unrelated quotes and keeps an edited visible original in order', () => {
  const unrelated = reply('other-reply', 70, 'other-original', 'Keep this quote');
  const original = { id: 'old', seq: 1, body: 'Before', deleted: false };
  const updated = applyConnectionMessageUpdate([original, reply('recent', 50, 'old', 'Before'), unrelated], { ...original, body: 'After' });
  assert.deepEqual(updated.map(message => message.id), ['old', 'recent', 'other-reply']);
  assert.equal(updated[0].body, 'After');
  assert.equal(updated[1].replyTo.body, 'After');
  assert.equal(updated[2], unrelated);
  assert.equal(updated[2].replyTo.body, 'Keep this quote');
});
