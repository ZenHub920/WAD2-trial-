/**
 * Integration tests for buying, chatting and verifying ticket listings, on top of
 * the ticket inventory covered by tickets.test.js.
 *
 * What matters most: a ticket never sells twice, the price comes from the listing,
 * private data (ticket numbers, proofs, chats, orders) only reaches the people it
 * belongs to, and `verified` can only be earned, never asserted.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createApp } from '../src/app.js';
import { createTestDb } from '../src/db/connection.js';

const PROOF = 'data:image/png;base64,iVBORw0KGgo=';

async function fixture(t) {
  const db = createTestDb();
  const imageDir = mkdtempSync(join(tmpdir(), 'encore-market-'));
  const { app, repos } = createApp({ db, imageDir });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    db.close();
    rmSync(imageDir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  async function api(path, { method = 'GET', as, body } = {}) {
    const response = await fetch(`${base}/api${path}`, {
      method,
      headers: {
        ...(as ? { cookie: people[as].cookie } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return {
      status: response.status,
      body: response.status === 204 ? null : await response.json(),
      cookie: response.headers.get('set-cookie')?.split(';')[0],
    };
  }

  const people = {};
  for (const name of ['seller', 'buyer', 'buyer2', 'operator']) {
    const result = await api('/auth/register', { method: 'POST', body: {
      display_name: name, email: `${name}@example.test`, password: 'test-password',
    } });
    assert.equal(result.status, 201);
    people[name] = { id: result.body.user.id, cookie: result.cookie };
  }
  db.prepare("UPDATE users SET is_operator = 1 WHERE email = 'operator@example.test'").run();

  repos.concerts.create({
    id: 'c_market', artist: 'Test Act', venue: 'Test Venue', city: 'Singapore', event_date: '2026-12-01',
  });
  const sell = (as, overrides = {}) => api('/tickets', { method: 'POST', as, body: {
    concertId: 'c_market', priceCents: 31000, quantity: 1, section: 'Cat 1', description: 'One seat',
    ...overrides,
  } });

  return { db, api, people, sell };
}

test('buying: signed in only, stored price, one buyer wins, and the order is private', async (t) => {
  const { db, api, sell } = await fixture(t);
  const id = (await sell('seller')).body.listing.id;
  const buy = (as, body = { paymentMethod: 'visa' }) => api(`/tickets/${id}/orders`, { method: 'POST', as, body });

  assert.equal((await buy(null)).status, 401);
  assert.equal((await buy('buyer', { paymentMethod: 'cash' })).body.error, 'invalid_payment_method');
  assert.equal((await buy('seller')).body.error, 'cannot_buy_own_listing');

  const results = await Promise.all([
    buy('buyer', { paymentMethod: 'paypal', priceCents: 1 }),
    buy('buyer2'),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409], 'exactly one buyer wins');
  const won = results.find((r) => r.status === 201);
  assert.equal(won.body.order.totalCents, 31000, 'price comes from the listing, not the request');
  assert.equal(won.body.order.listing.status, 'sold');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM orders WHERE ticket_id = ?').get(id).n, 1);
  assert.ok(!(await api('/tickets')).body.listings.some((l) => l.id === id), 'sold tickets leave the market');

  const orderId = won.body.order.id;
  const winner = won.body.order.paymentMethod === 'paypal' ? 'buyer' : 'buyer2';
  const loser = winner === 'buyer' ? 'buyer2' : 'buyer';
  assert.equal((await api(`/orders/${orderId}`, { as: winner })).status, 200);
  assert.equal((await api(`/orders/${orderId}`, { as: loser })).status, 404);
  assert.equal((await api('/tickets/nope/orders', { method: 'POST', as: 'buyer', body: { paymentMethod: 'visa' } })).status, 404);
});

test('chat: one thread per buyer and listing, readable only by its two people', async (t) => {
  const { api, people, sell } = await fixture(t);
  const id = (await sell('seller')).body.listing.id;

  const first = await api(`/tickets/${id}/conversations`, { method: 'POST', as: 'buyer' });
  assert.equal(first.status, 201);
  assert.equal(first.body.conversation.role, 'buyer');
  assert.equal(first.body.conversation.other.id, people.seller.id);
  const cid = first.body.conversation.id;
  assert.equal((await api(`/tickets/${id}/conversations`, { method: 'POST', as: 'buyer' })).body.conversation.id, cid);
  assert.equal((await api(`/tickets/${id}/conversations`, { method: 'POST', as: 'seller' })).status, 409);

  const send = (as, body) => api(`/conversations/${cid}/messages`, { method: 'POST', as, body: { body } });
  assert.equal((await send('buyer', 'Is this still available?')).status, 201);
  assert.equal((await send('seller', 'Yes it is!')).status, 201);
  assert.equal((await send('buyer', '   ')).status, 400);
  assert.equal((await send('buyer2', 'hi')).status, 404);

  const thread = await api(`/conversations/${cid}`, { as: 'seller' });
  assert.equal(thread.body.conversation.role, 'seller');
  assert.deepEqual(thread.body.messages.map((m) => m.body), ['Is this still available?', 'Yes it is!']);
  const newer = await api(`/conversations/${cid}?after=${encodeURIComponent(thread.body.messages[0].createdAt)}`, { as: 'buyer' });
  assert.deepEqual(newer.body.messages.map((m) => m.body), ['Yes it is!']);
  assert.equal((await api(`/conversations/${cid}`, { as: 'buyer2' })).status, 404);
  assert.equal((await api('/conversations', { as: 'seller' })).body.conversations[0].lastMessage.body, 'Yes it is!');
});

test('proof review: pending until an operator decides; rejection needs a note; approval is final', async (t) => {
  const { api, sell } = await fixture(t);
  const created = await sell('seller', { proofData: PROOF, verified: true });
  assert.equal(created.body.listing.verified, false, 'a seller cannot assert verified');
  assert.equal(created.body.listing.verification.status, 'pending');
  const id = created.body.listing.id;

  const pub = await api(`/tickets/${id}`);
  assert.equal(pub.body.listing.verification, undefined, 'review state is private');
  assert.ok(!JSON.stringify(pub.body).includes('base64'), 'proof never leaves via public routes');

  assert.equal((await api('/operator/verifications', { as: 'seller' })).status, 403);
  const queue = await api('/operator/verifications', { as: 'operator' });
  assert.equal(queue.body.listings.find((l) => l.id === id).proofData, PROOF);

  const decide = (as, body) => api(`/operator/verifications/${id}`, { method: 'POST', as, body });
  assert.equal((await decide('seller', { decision: 'approve' })).status, 403);
  assert.equal((await decide('operator', { decision: 'reject' })).status, 400);
  assert.equal((await decide('operator', { decision: 'reject', note: 'Order number is cut off' })).status, 200);

  const own = (await api('/me/tickets', { as: 'seller' })).body.listings.find((l) => l.id === id);
  assert.deepEqual([own.verification.status, own.verification.note], ['rejected', 'Order number is cut off']);

  const resubmit = (as, proofData) => api(`/me/tickets/${id}/proof`, { method: 'POST', as, body: { proofData } });
  assert.equal((await resubmit('buyer', PROOF)).status, 409, 'only the seller can submit proof');
  assert.equal((await resubmit('seller', 'hello')).status, 400);
  assert.equal((await resubmit('seller', PROOF)).body.listing.verification.status, 'pending');

  assert.equal((await decide('operator', { decision: 'approve' })).status, 200);
  assert.equal((await api(`/tickets/${id}`)).body.listing.verified, true);
  assert.equal((await decide('operator', { decision: 'reject', note: 'x' })).status, 409);
  assert.equal((await resubmit('seller', PROOF)).status, 409);
});

test('ticket numbers: issued-list matches verify outright; numbers stay private and unique', async (t) => {
  const { api, sell } = await fixture(t);
  const importList = (as, csv) => api('/operator/concerts/c_market/issued-tickets', { method: 'POST', as, body: { csv } });

  assert.equal((await importList('seller', 'TA-0001')).status, 403);
  const bad = await importList('operator', 'ticket_number,category\nTA-0001,Cat 1\n!!,Cat 1');
  assert.deepEqual([bad.status, bad.body.lines], [400, [3]]);
  const ok = await importList('operator', 'ticket_number,category\nTA-0001,Cat 1\nta 0002,Cat 1\nTA-0003,Cat 1\nTA-0100,');
  assert.deepEqual(ok.body, { added: 4, skipped: 0 });
  assert.deepEqual((await importList('operator', 'TA-0001,Cat 1')).body, { added: 0, skipped: 1 });
  const summary = await api('/operator/issued-tickets', { as: 'operator' });
  assert.equal(summary.body.concerts.find((c) => c.id === 'c_market').issued, 4);

  const listed = await sell('seller', { ticketNumbers: ['ta - 0001'] });
  assert.equal(listed.status, 201);
  assert.equal(listed.body.listing.verified, true);
  assert.equal(listed.body.listing.verification.method, 'ticket_number');
  assert.deepEqual(listed.body.listing.ticketNumbers, ['TA-0001'], 'spaces and dashes are equivalent');
  const id = listed.body.listing.id;
  assert.equal((await api(`/tickets/${id}`)).body.listing.ticketNumbers, undefined, 'numbers are never public');
  assert.ok(!JSON.stringify((await api('/tickets')).body).includes('TA-0001'));

  const twice = await sell('buyer', { ticketNumbers: ['TA 0001'] });
  assert.deepEqual([twice.status, twice.body], [409, { error: 'ticket_number_already_listed', ticketNumber: 'TA-0001' }]);
  assert.deepEqual((await sell('seller', { ticketNumbers: ['TA-9999'] })).body,
    { error: 'ticket_number_not_issued', ticketNumber: 'TA-9999' });
  assert.equal((await sell('seller', { section: 'VIP', ticketNumbers: ['TA-0003'] })).body.error, 'ticket_category_mismatch');
  assert.equal((await sell('seller', { section: 'VIP', ticketNumbers: ['TA-0100'] })).status, 201,
    'a number issued without a category fits any section');
  assert.equal((await sell('seller', { quantity: 2, ticketNumbers: ['TA-0003', 'ta-0003'] })).body.error, 'duplicate_ticket_number');
  assert.equal((await sell('seller', { quantity: 2, ticketNumbers: ['TA-0003'] })).body.error, 'one_ticket_number_per_ticket');
  assert.equal((await api(`/tickets/${id}`, { method: 'PATCH', as: 'seller', body: { quantity: 2 } })).body.error,
    'quantity_locked_by_ticket_numbers');

  const bought = await api(`/tickets/${id}/orders`, { method: 'POST', as: 'buyer2', body: { paymentMethod: 'visa' } });
  assert.deepEqual(bought.body.order.ticketNumbers, ['TA-0001'], 'the buyer receives the numbers');
  const resale = await sell('buyer2', { ticketNumbers: ['TA-0001'] });
  assert.equal(resale.body.listing.verified, true, 'once sold, the new owner can resell it');
});

test('without an issued list, numbers are kept for uniqueness but do not verify', async (t) => {
  const { api } = await fixture(t);
  const created = await api('/tickets', { method: 'POST', as: 'seller', body: {
    concert: { artist: 'New Act', venue: 'Hall', event_date: '2027-01-02' },
    priceCents: 5000, quantity: 1, section: 'GA', ticketNumbers: ['NA-0001'],
  } });
  assert.equal(created.status, 201);
  assert.equal(created.body.listing.verified, false);
  assert.equal(created.body.listing.verification.status, 'none');
  assert.equal((await api('/tickets', { method: 'POST', as: 'seller', body: {
    concertId: 'nope', priceCents: 1, quantity: 1, section: 'GA',
  } })).body.error, 'concert_not_found');
});
