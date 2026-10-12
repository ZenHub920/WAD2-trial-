/**
 * Integration tests: the ticket market over a real (in-memory) database.
 *
 * The purchase path is the one that matters — the price must come from the
 * listing rather than the request, and a ticket must never sell twice.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { createTestDb } from '../src/db/connection.js';
import { createApp } from '../src/app.js';

let server;
let baseUrl;
let db;
let repos;

const api = async (path, init) => {
  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  return { status: res.status, body, cookie: res.headers.get('set-cookie')?.split(';')[0] };
};

const vibe = { singalong: 3, photography: 2, dancing: 3, quiet: 2, queue_early: 2, merch: 3 };

/** Signed-in people, by name: { id, cookie }. */
const people = {};

async function register(name) {
  const { status, body, cookie } = await api('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      display_name: name, email: `${name}@example.test`, password: 'test-password',
      age_band: '21-24', home_region: 'central', gender: 'f', vibe,
    }),
  });
  assert.equal(status, 201, `registering ${name}`);
  people[name] = { id: body.user.id, cookie };
}

const buy = (listingId, as, body) =>
  api(`/api/listings/${listingId}/orders`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: as ? { cookie: people[as].cookie } : {},
  });

before(async () => {
  db = createTestDb();
  const created = createApp({ db });
  repos = created.repos;
  server = created.app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  repos.concerts.create({
    id: 'c_market', artist: 'Test Act', tour_name: 'Test Tour',
    venue: 'Test Venue', city: 'Singapore', event_date: '2026-12-01',
  });
  for (const name of ['seller', 'buyer', 'buyer2']) await register(name);

  repos.listings.create({
    id: 'l_cat3', seller_user_id: people.seller.id, concert_id: 'c_market',
    title: 'Test Act Cat 3', category: 'Cat 3', price_cents: 31000, verified: true,
    created_at: '2026-01-01 10:00:00',
  });
  repos.listings.create({
    id: 'l_vip', seller_user_id: people.seller.id, concert_id: 'c_market',
    title: 'Test Act VIP 1', category: 'VIP 1', price_cents: 62000,
    created_at: '2026-01-01 11:00:00',
  });
  repos.listings.create({
    id: 'l_pct', seller_user_id: people.seller.id, concert_id: 'c_market',
    title: 'Test Act 100% legit', category: 'Cat 5', price_cents: 5000,
    created_at: '2026-01-01 09:00:00',
  });
});

after(() => {
  server?.close();
  db?.close();
});

describe('Listings', () => {
  test('lists open listings newest first, with seller and concert attached', async () => {
    const { status, body } = await api('/api/listings');
    assert.equal(status, 200);
    assert.deepEqual(body.listings.map((l) => l.id), ['l_vip', 'l_cat3', 'l_pct']);

    const cat3 = body.listings[1];
    assert.equal(cat3.priceCents, 31000);
    assert.equal(cat3.verified, true);
    assert.equal(cat3.seller.id, people.seller.id);
    assert.equal(cat3.concert.artist, 'Test Act');
    assert.equal(cat3.seller.email, undefined, 'seller email must not leak');
  });

  test('search matches title, category and artist', async () => {
    const byCategory = await api('/api/listings?q=vip');
    assert.deepEqual(byCategory.body.listings.map((l) => l.id), ['l_vip']);

    const byArtist = await api('/api/listings?q=test%20act');
    assert.equal(byArtist.body.listings.length, 3);
  });

  test('search treats LIKE wildcards literally', async () => {
    const { body } = await api(`/api/listings?q=${encodeURIComponent('100%')}`);
    assert.deepEqual(body.listings.map((l) => l.id), ['l_pct']);

    const underscore = await api('/api/listings?q=_');
    assert.equal(underscore.body.listings.length, 0);
  });

  test('unknown listing is 404', async () => {
    const { status } = await api('/api/listings/nope');
    assert.equal(status, 404);
  });
});

describe('Orders', () => {
  test('requires sign-in, and rejects a bad payment method', async () => {
    const anonymous = await buy('l_cat3', null, { payment_method: 'visa' });
    assert.equal(anonymous.status, 401);

    const badMethod = await buy('l_cat3', 'buyer', { payment_method: 'cash' });
    assert.equal(badMethod.status, 400);
    assert.equal(badMethod.body.error, 'invalid_payment_method');
  });

  test('a seller cannot buy their own listing', async () => {
    const { status, body } = await buy('l_cat3', 'seller', { payment_method: 'visa' });
    assert.equal(status, 409);
    assert.equal(body.error, 'cannot_buy_own_listing');
  });

  test('charges the stored price, ignoring any price in the request', async () => {
    const { status, body } = await buy('l_cat3', 'buyer', {
      buyer_user_id: people.seller.id, payment_method: 'paypal', price_cents: 1,
    });
    assert.equal(status, 201);
    assert.equal(body.order.subtotalCents, 31000);
    assert.equal(body.order.deliveryFeeCents, 0);
    assert.equal(body.order.totalCents, 31000);
    assert.equal(body.order.paymentMethod, 'paypal');
    assert.equal(body.order.buyerUserId, people.buyer.id, 'buyer comes from the session');
    assert.equal(body.order.listing.status, 'sold');

    const fetched = await api(`/api/orders/${body.order.id}`, {
      headers: { cookie: people.buyer.cookie },
    });
    assert.equal(fetched.status, 200);
    assert.equal(fetched.body.order.listing.id, 'l_cat3');

    const someoneElse = await api(`/api/orders/${body.order.id}`, {
      headers: { cookie: people.buyer2.cookie },
    });
    assert.equal(someoneElse.status, 404, 'orders are private to their buyer');
  });

  test('a sold listing cannot be bought again and leaves the open list', async () => {
    const second = await buy('l_cat3', 'buyer2', { payment_method: 'visa' });
    assert.equal(second.status, 409);
    assert.equal(second.body.error, 'listing_unavailable');

    const orders = db.prepare("SELECT COUNT(*) AS n FROM ticket_orders WHERE listing_id = 'l_cat3'")
      .get().n;
    assert.equal(orders, 1);

    const { body } = await api('/api/listings');
    assert.ok(!body.listings.some((l) => l.id === 'l_cat3'));
  });

  test('concurrent buyers: exactly one wins', async () => {
    const results = await Promise.all([
      buy('l_vip', 'buyer', { payment_method: 'visa' }),
      buy('l_vip', 'buyer2', { payment_method: 'mastercard' }),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  });

  test('buying a listing that does not exist is 404', async () => {
    const { status } = await buy('nope', 'buyer', { payment_method: 'visa' });
    assert.equal(status, 404);
  });
});

describe('Selling', () => {
  const sell = (as, body) =>
    api('/api/listings', {
      method: 'POST', body: JSON.stringify(body), headers: { cookie: people[as].cookie },
    });
  const valid = {
    concert_id: 'c_market', title: 'Test Act Cat 2', category: 'Cat 2',
    quantity: 2, price_cents: 18000, description: 'Two together',
  };

  test('a signed-in seller can list, see and withdraw their own ticket', async () => {
    const created = await sell('seller', valid);
    assert.equal(created.status, 201);
    assert.equal(created.body.listing.seller.id, people.seller.id, 'seller comes from the session');
    assert.equal(created.body.listing.priceCents, 18000);

    const mine = await api('/api/me/listings', { headers: { cookie: people.seller.cookie } });
    assert.ok(mine.body.listings.some((l) => l.id === created.body.listing.id));

    const notTheirs = await api(`/api/me/listings/${created.body.listing.id}`, {
      method: 'DELETE', headers: { cookie: people.buyer.cookie },
    });
    assert.equal(notTheirs.status, 404);

    const withdrawn = await api(`/api/me/listings/${created.body.listing.id}`, {
      method: 'DELETE', headers: { cookie: people.seller.cookie },
    });
    assert.equal(withdrawn.status, 204);
    const open = await api('/api/listings');
    assert.ok(!open.body.listings.some((l) => l.id === created.body.listing.id));
  });

  test('rejects bad listings and anonymous sellers', async () => {
    assert.equal((await api('/api/listings', { method: 'POST', body: JSON.stringify(valid) })).status, 401);
    assert.equal((await sell('seller', { ...valid, price_cents: 0 })).status, 400);
    assert.equal((await sell('seller', { ...valid, quantity: 11 })).status, 400);
    assert.equal((await sell('seller', { ...valid, concert_id: 'nope' })).status, 400);
    assert.equal((await sell('seller', { ...valid, image_url: 'https://evil.test/x.png' })).status, 400);
  });
});

describe('Chat', () => {
  let conversationId;
  const as = (name) => ({ cookie: people[name].cookie });

  test('the buyer opens one thread per listing; a seller cannot chat with themselves', async () => {
    const first = await api('/api/listings/l_pct/conversations', { method: 'POST', headers: as('buyer') });
    assert.equal(first.status, 201);
    assert.equal(first.body.conversation.role, 'buyer');
    assert.equal(first.body.conversation.other.id, people.seller.id);
    conversationId = first.body.conversation.id;

    const again = await api('/api/listings/l_pct/conversations', { method: 'POST', headers: as('buyer') });
    assert.equal(again.body.conversation.id, conversationId);

    const self = await api('/api/listings/l_pct/conversations', { method: 'POST', headers: as('seller') });
    assert.equal(self.status, 409);
  });

  test('both sides can post and read; an outsider cannot see the thread', async () => {
    const send = (name, body) => api(`/api/conversations/${conversationId}/messages`, {
      method: 'POST', body: JSON.stringify({ body }), headers: as(name),
    });
    assert.equal((await send('buyer', 'Is this still available?')).status, 201);
    const reply = await send('seller', 'Yes it is!');
    assert.equal(reply.status, 201);
    assert.equal((await send('buyer', '   ')).status, 400);
    assert.equal((await send('buyer2', 'hi')).status, 404);

    const thread = await api(`/api/conversations/${conversationId}`, { headers: as('seller') });
    assert.equal(thread.body.conversation.role, 'seller');
    assert.deepEqual(thread.body.messages.map((m) => m.body), ['Is this still available?', 'Yes it is!']);

    const newer = await api(
      `/api/conversations/${conversationId}?after=${encodeURIComponent(thread.body.messages[0].createdAt)}`,
      { headers: as('buyer') },
    );
    assert.deepEqual(newer.body.messages.map((m) => m.body), ['Yes it is!']);

    assert.equal((await api(`/api/conversations/${conversationId}`, { headers: as('buyer2') })).status, 404);

    const inbox = await api('/api/conversations', { headers: as('seller') });
    assert.equal(inbox.body.conversations[0].lastMessage.body, 'Yes it is!');
  });
});

describe('Ticket verification', () => {
  const PROOF = 'data:image/png;base64,iVBORw0KGgo=';
  const as = (name) => ({ cookie: people[name].cookie });
  const post = (path, name, body) =>
    api(path, { method: 'POST', body: JSON.stringify(body ?? {}), headers: as(name) });
  let listingId;

  before(async () => {
    process.env.ADMIN_EMAILS = 'Admin@example.test, other-admin@example.test';
    await register('admin');
  });
  after(() => { delete process.env.ADMIN_EMAILS; });

  test('a listing with proof starts pending and is not verified publicly', async () => {
    const { status, body } = await post('/api/listings', 'seller', {
      concert_id: 'c_market', title: 'Test Act Cat 4', category: 'Cat 4',
      quantity: 1, price_cents: 9000, proof_data: PROOF,
    });
    assert.equal(status, 201);
    assert.equal(body.listing.verification.status, 'pending');
    listingId = body.listing.id;

    const pub = await api(`/api/listings/${listingId}`);
    assert.equal(pub.body.listing.verified, false);
    assert.equal(pub.body.listing.verification, undefined, 'review state is private to the seller');
    assert.equal(JSON.stringify(pub.body).includes('base64'), false, 'proof never leaves via public routes');
  });

  test('only admins see the queue, and /auth/me says who is one', async () => {
    assert.equal((await api('/api/admin/verifications', { headers: as('seller') })).status, 404);
    assert.equal((await api('/api/admin/verifications')).status, 401);

    const me = await api('/api/auth/me', { headers: as('admin') });
    assert.equal(me.body.user.isAdmin, true, 'email match ignores case');
    assert.equal((await api('/api/auth/me', { headers: as('seller') })).body.user.isAdmin, false);

    const queue = await api('/api/admin/verifications', { headers: as('admin') });
    const item = queue.body.listings.find((l) => l.id === listingId);
    assert.equal(item.proofData, PROOF);
  });

  test('reject needs a note; the seller sees it and can re-submit', async () => {
    const path = `/api/admin/verifications/${listingId}`;
    assert.equal((await post(path, 'seller', { decision: 'approve' })).status, 404, 'sellers cannot self-approve');
    assert.equal((await post(path, 'admin', { decision: 'reject' })).status, 400);

    const rejected = await post(path, 'admin', { decision: 'reject', note: 'Order number is cut off' });
    assert.equal(rejected.status, 200);

    const mine = await api('/api/me/listings', { headers: as('seller') });
    const own = mine.body.listings.find((l) => l.id === listingId);
    assert.equal(own.verification.status, 'rejected');
    assert.equal(own.verification.note, 'Order number is cut off');

    assert.equal((await post(`/api/me/listings/${listingId}/proof`, 'buyer', { proof_data: PROOF })).status, 409,
      'only the seller can submit proof');
    assert.equal((await post(`/api/me/listings/${listingId}/proof`, 'seller', { proof_data: 'hello' })).status, 400);
    const resubmitted = await post(`/api/me/listings/${listingId}/proof`, 'seller', { proof_data: PROOF });
    assert.equal(resubmitted.body.listing.verification.status, 'pending');
    assert.equal(resubmitted.body.listing.verification.note, null);
  });

  test('approval sets the public badge, and is final', async () => {
    const path = `/api/admin/verifications/${listingId}`;
    assert.equal((await post(path, 'admin', { decision: 'approve' })).status, 200);
    assert.equal((await api(`/api/listings/${listingId}`)).body.listing.verified, true);

    assert.equal((await post(path, 'admin', { decision: 'reject', note: 'x' })).status, 409);
    assert.equal((await post(`/api/me/listings/${listingId}/proof`, 'seller', { proof_data: PROOF })).status, 409);
  });
});

describe('Ticket-number verification', () => {
  const as = (name) => ({ cookie: people[name].cookie });
  const post = (path, name, body) =>
    api(path, { method: 'POST', body: JSON.stringify(body ?? {}), headers: as(name) });
  const listing = (overrides) => ({
    concert_id: 'c_market', title: 'Test Act Cat 1', category: 'Cat 1',
    quantity: 1, price_cents: 20000, ...overrides,
  });
  let verifiedId;

  before(() => { process.env.ADMIN_EMAILS = 'admin@example.test'; });
  after(() => { delete process.env.ADMIN_EMAILS; });

  test('admins import an issued list from CSV; bad lines are reported, re-imports skipped', async () => {
    const path = '/api/admin/concerts/c_market/issued-tickets';
    assert.equal((await post(path, 'seller', { csv: 'TA-0001' })).status, 404, 'admins only');

    const bad = await post(path, 'admin', { csv: 'ticket_number,category\nTA-0001,Cat 1\n!!,Cat 1' });
    assert.equal(bad.status, 400);
    assert.deepEqual(bad.body.lines, [3]);

    const ok = await post(path, 'admin', { csv: 'ticket_number,category\nTA-0001,Cat 1\nta 0002,Cat 1\nTA-0003,Cat 1\nTA-0100,' });
    assert.deepEqual(ok.body, { added: 4, skipped: 0 });
    assert.deepEqual((await post(path, 'admin', { csv: 'TA-0001,Cat 1' })).body, { added: 0, skipped: 1 });

    const summary = await api('/api/admin/issued-tickets', { headers: as('admin') });
    assert.equal(summary.body.concerts.find((c) => c.id === 'c_market').issued, 4);
  });

  test('numbers on the issued list verify the listing with no review', async () => {
    const { status, body } = await post('/api/listings', 'seller', listing({ ticket_numbers: ['ta-0001'] }));
    assert.equal(status, 201);
    assert.equal(body.listing.verified, true);
    assert.equal(body.listing.verification.method, 'ticket_number');
    assert.deepEqual(body.listing.ticketNumbers, ['TA-0001'], 'normalised for matching');
    verifiedId = body.listing.id;

    const pub = await api(`/api/listings/${verifiedId}`);
    assert.equal(pub.body.listing.verified, true);
    assert.equal(pub.body.listing.ticketNumbers, undefined, 'numbers are never public');
    assert.ok(!JSON.stringify((await api('/api/listings')).body).includes('TA-0001'));
  });

  test('a number cannot be on two open listings at once', async () => {
    const twice = await post('/api/listings', 'buyer', listing({ ticket_numbers: ['TA 0001'] }));
    assert.equal(twice.status, 409);
    assert.deepEqual(twice.body, { error: 'ticket_number_already_listed', ticketNumber: 'TA-0001' });
  });

  test('rejects unknown numbers, wrong categories, duplicates and count mismatches', async () => {
    const unknown = await post('/api/listings', 'seller', listing({ ticket_numbers: ['TA-9999'] }));
    assert.equal(unknown.status, 400);
    assert.deepEqual(unknown.body, { error: 'ticket_number_not_issued', ticketNumber: 'TA-9999' });

    const wrongCat = await post('/api/listings', 'seller', listing({ category: 'VIP', ticket_numbers: ['TA-0003'] }));
    assert.equal(wrongCat.body.error, 'ticket_category_mismatch');

    const anyCat = await post('/api/listings', 'seller', listing({ category: 'VIP', ticket_numbers: ['TA-0100'] }));
    assert.equal(anyCat.status, 201, 'a number issued without a category fits any category');

    const dup = await post('/api/listings', 'seller', listing({ quantity: 2, ticket_numbers: ['TA-0003', 'ta-0003'] }));
    assert.equal(dup.body.error, 'duplicate_ticket_number');

    const count = await post('/api/listings', 'seller', listing({ quantity: 2, ticket_numbers: ['TA-0003'] }));
    assert.equal(count.body.error, 'one_ticket_number_per_ticket');
  });

  test('without an issued list, numbers are kept but do not verify', async () => {
    repos.concerts.create({ id: 'c_nolist', artist: 'No List', venue: 'V', city: 'Singapore', event_date: '2026-12-02' });
    const { body } = await post('/api/listings', 'seller', listing({ concert_id: 'c_nolist', ticket_numbers: ['NL-0001'] }));
    assert.equal(body.listing.verified, false);
    assert.equal(body.listing.verification.status, 'none');
  });

  test('the buyer receives the numbers, and can resell the ticket once sold', async () => {
    const bought = await post(`/api/listings/${verifiedId}/orders`, 'buyer2', { payment_method: 'visa' });
    assert.equal(bought.status, 201);
    assert.deepEqual(bought.body.order.ticketNumbers, ['TA-0001']);

    const resale = await post('/api/listings', 'buyer2', listing({ ticket_numbers: ['TA-0001'] }));
    assert.equal(resale.status, 201);
    assert.equal(resale.body.listing.verified, true);
  });
});
