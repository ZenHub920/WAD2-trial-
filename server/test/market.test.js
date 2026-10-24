/**
 * Integration tests for unavailable checkout, historical orders, chatting and
 * verifying ticket listings, on top of the inventory covered by tickets.test.js.
 *
 * An unconfigured payment provider must never create an order or sell a ticket.
 * Historical orders and ticket numbers stay private, and verification is earned.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';

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
    return new Promise((resolve, reject) => {
      const req = request(`${base}/api${path}`, {
        method,
        headers: {
        'X-Requested-With': 'Encore',
          ...(as ? { cookie: people[as].cookie } : {}),
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        },
      }, (response) => {
        let text = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => { text += chunk; });
        response.on('error', reject);
        response.on('end', () => {
          try {
            resolve({
              status: response.statusCode,
              body: response.statusCode === 204 ? null : JSON.parse(text),
              cookie: response.headers['set-cookie']?.[0]?.split(';')[0],
            });
          } catch (error) {
            reject(error);
          }
        });
      });
      req.on('error', reject);
      req.end(body === undefined ? undefined : JSON.stringify(body));
    });
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

  function previousOrder(ticketId, buyer) {
    const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(ticketId);
    const id = `o_test_${ticketId}`;
    db.prepare("UPDATE tickets SET status = 'sold' WHERE id = ?").run(ticketId);
    db.prepare(`
      INSERT INTO orders (id, ticket_id, buyer_user_id, subtotal_cents, total_cents, payment_method)
      VALUES (?, ?, ?, ?, ?, 'visa')
    `).run(id, ticketId, people[buyer].id, ticket.price_cents, ticket.price_cents);
    return id;
  }

  return { db, api, people, sell, previousOrder };
}

test('checkout: signed in only and no inventory changes without a payment provider', async (t) => {
  const { db, api, sell } = await fixture(t);
  const id = (await sell('seller')).body.listing.id;
  const buy = (as, body = {}) => api(`/tickets/${id}/orders`, { method: 'POST', as, body });

  assert.equal((await buy(null)).status, 401);
  for (const [as, body] of [
    ['buyer', {}],
    ['buyer2', { paymentMethod: 'visa', priceCents: 1 }],
    ['seller', { paymentMethod: 'paypal' }],
  ]) {
    const response = await buy(as, body);
    assert.deepEqual([response.status, response.body], [503, { error: 'payment_provider_not_configured' }]);
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM orders WHERE ticket_id = ?').get(id).n, 0);
  const listing = (await api(`/tickets/${id}`)).body.listing;
  assert.equal(listing.status, 'active');
  assert.equal(listing.priceCents, 31000);
  assert.ok((await api('/tickets')).body.listings.some((l) => l.id === id));
});

test('historical orders remain readable only by their recorded buyer', async (t) => {
  const { api, sell, previousOrder } = await fixture(t);
  const id = (await sell('seller')).body.listing.id;
  const orderId = previousOrder(id, 'buyer');
  const response = await api(`/orders/${orderId}`, { as: 'buyer' });
  assert.equal(response.status, 200);
  assert.equal(response.body.order.totalCents, 31000);
  assert.equal((await api(`/orders/${orderId}`)).status, 401);
  assert.equal((await api(`/orders/${orderId}`, { as: 'buyer2' })).status, 404);
  assert.equal((await api(`/orders/${orderId}`, { as: 'seller' })).status, 404);
});

test('chat: one thread per buyer and listing, readable only by its two people', async (t) => {
  const { api, db, people, sell } = await fixture(t);
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
  db.prepare("UPDATE ticket_messages SET created_at = '2026-10-17 12:00:00.000' WHERE conversation_id = ?").run(cid);
  assert.equal((await send('buyer2', 'hi')).status, 404);

  const thread = await api(`/conversations/${cid}`, { as: 'seller' });
  assert.equal(thread.body.conversation.role, 'seller');
  assert.deepEqual(thread.body.messages.map((m) => m.body), ['Is this still available?', 'Yes it is!']);
  const newer = await api(`/conversations/${cid}?after=${encodeURIComponent(thread.body.messages[0].id)}`, { as: 'buyer' });
  assert.deepEqual(newer.body.messages.map((m) => m.body), ['Yes it is!']);
  assert.equal((await api(`/conversations/${cid}`, { as: 'buyer2' })).status, 404);
  assert.equal((await api('/conversations', { as: 'seller' })).body.conversations[0].lastMessage.body, 'Yes it is!');
});

test('opening and polling ticket chats reads only the viewer’s notifications for that thread', async (t) => {
  const { api, sell } = await fixture(t);
  const createThread = async () => {
    const listing = (await sell('seller')).body.listing;
    return (await api(`/tickets/${listing.id}/conversations`, { method: 'POST', as: 'buyer' })).body.conversation.id;
  };
  const first = await createThread();
  const second = await createThread();
  const send = (id, as, body) => api(`/conversations/${id}/messages`, { method: 'POST', as, body: { body } });
  const inbox = async (as) => (await api('/me/notifications', { as })).body.notifications;
  const last = (await send(first, 'seller', 'Still available.')).body.message;
  await send(second, 'seller', 'These seats are available too.');
  await send(first, 'buyer', 'Thanks for confirming.');
  assert.equal((await api(`/conversations/${first}`, { as: 'buyer2' })).status, 404);
  assert.equal((await inbox('buyer')).find(n => n.path === `/chat/${first}`).readAt, null);

  // Opening clears the row outright; the other thread and the other party keep theirs.
  assert.equal((await api(`/conversations/${first}`, { as: 'buyer' })).status, 200);
  let notifications = await inbox('buyer');
  assert.equal(notifications.find(n => n.path === `/chat/${first}`), undefined);
  assert.equal(notifications.find(n => n.path === `/chat/${second}`).readAt, null);
  assert.equal((await inbox('seller')).find(n => n.path === `/chat/${first}`).readAt, null);

  // And a later message raises a fresh one, named after the sender.
  await send(first, 'seller', 'Let me know if you have any other questions.');
  const raised = (await inbox('buyer')).find(n => n.path === `/chat/${first}`);
  assert.ok(raised && !raised.readAt);
  assert.match(raised.title, /^Ticket message from /);
  assert.equal((await api(`/conversations/${first}?after=${last.id}`, { as: 'buyer' })).status, 200);
  notifications = await inbox('buyer');
  assert.equal(notifications.filter(n => n.path === `/chat/${first}`).length, 0);
  assert.equal(notifications.find(n => n.path === `/chat/${second}`).readAt, null);
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
  const { api, sell, previousOrder } = await fixture(t);
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

  const orderId = previousOrder(id, 'buyer2');
  const bought = await api(`/orders/${orderId}`, { as: 'buyer2' });
  assert.deepEqual(bought.body.order.ticketNumbers, ['TA-0001'], 'historical buyers retain access to their numbers');
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

test('verified ticket categories cannot be changed to a different issued category', async (t) => {
  const { api, sell } = await fixture(t);
  await api('/operator/concerts/c_market/issued-tickets', {
    method: 'POST', as: 'operator', body: { csv: 'TA-0001,Cat 1' },
  });
  const created = await sell('seller', { ticketNumbers: ['TA-0001'] });
  const id = created.body.listing.id;
  const edit = await api(`/tickets/${id}`, { method: 'PATCH', as: 'seller', body: { section: 'VIP' } });
  assert.equal(edit.status, 400);
  assert.equal(edit.body.error, 'ticket_category_mismatch');
  const current = (await api(`/tickets/${id}`)).body.listing;
  assert.equal(current.section, 'Cat 1');
  assert.equal(current.verified, true);
});

test('proof approval is invalidated when the seller changes the reviewed quantity or section', async (t) => {
  const { api, sell } = await fixture(t);
  const id = (await sell('seller', { proofData: PROOF })).body.listing.id;
  const approve = () => api(`/operator/verifications/${id}`, {
    method: 'POST', as: 'operator', body: { decision: 'approve' },
  });
  assert.equal((await approve()).status, 200);
  assert.equal((await api(`/tickets/${id}`, {
    method: 'PATCH', as: 'seller', body: { priceCents: 20000 },
  })).body.listing.verified, true, 'changing price does not alter proof coverage');
  for (const body of [{ quantity: 2 }, { section: 'VIP' }]) {
    const edited = await api(`/tickets/${id}`, { method: 'PATCH', as: 'seller', body });
    assert.equal(edited.status, 200);
    assert.equal(edited.body.listing.verified, false);
    assert.equal(edited.body.listing.verification.status, 'pending');
    assert.equal(edited.body.listing.verification.method, null);
    assert.equal((await approve()).status, 200);
  }
});

test('only the recorded buyer can relist a previously sold ticket number', async (t) => {
  const { api, sell, previousOrder } = await fixture(t);
  const id = (await sell('seller', { ticketNumbers: ['TA-0001'] })).body.listing.id;
  previousOrder(id, 'buyer');
  for (const as of ['seller', 'buyer2']) {
    const denied = await sell(as, { ticketNumbers: ['TA-0001'] });
    assert.equal(denied.status, 409);
    assert.equal(denied.body.error, 'ticket_number_not_owned');
  }
  assert.equal((await sell('buyer', { ticketNumbers: ['TA-0001'] })).status, 201);
});

test('operators cannot approve proof after the listing is sold or deleted', async (t) => {
  const { api, sell, previousOrder } = await fixture(t);
  for (const status of ['sold', 'deleted']) {
    const id = (await sell('seller', { proofData: PROOF })).body.listing.id;
    if (status === 'sold') {
      previousOrder(id, 'buyer');
    } else {
      await api(`/tickets/${id}`, { method: 'DELETE', as: 'seller' });
    }
    const review = await api(`/operator/verifications/${id}`, {
      method: 'POST', as: 'operator', body: { decision: 'approve' },
    });
    assert.equal(review.status, 409);
    assert.equal(review.body.error, 'not_pending');
  }
});

test('issued CSV does not mistake a real ticket-prefixed number for its header', async (t) => {
  const { api, sell } = await fixture(t);
  const imported = await api('/operator/concerts/c_market/issued-tickets', {
    method: 'POST', as: 'operator', body: { csv: 'TICKET-0001,Cat 1' },
  });
  assert.deepEqual(imported.body, { added: 1, skipped: 0 });
  assert.equal((await sell('seller', { ticketNumbers: ['TICKET-0001'] })).body.listing.verified, true);
});
