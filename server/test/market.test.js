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
  return { status: res.status, body };
};

const buy = (listingId, body) =>
  api(`/api/listings/${listingId}/orders`, { method: 'POST', body: JSON.stringify(body) });

const vibe = { singalong: 3, photography: 2, dancing: 3, quiet: 2, queue_early: 2, merch: 3 };
const person = (id) => ({
  id, display_name: id, age_band: '21-24', home_region: 'central', gender: 'f', vibe,
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
  for (const id of ['u_seller', 'u_buyer', 'u_buyer2']) repos.users.create(person(id));

  repos.listings.create({
    id: 'l_cat3', seller_user_id: 'u_seller', concert_id: 'c_market',
    title: 'Test Act Cat 3', category: 'Cat 3', price_cents: 31000, verified: true,
    created_at: '2026-01-01 10:00:00',
  });
  repos.listings.create({
    id: 'l_vip', seller_user_id: 'u_seller', concert_id: 'c_market',
    title: 'Test Act VIP 1', category: 'VIP 1', price_cents: 62000,
    created_at: '2026-01-01 11:00:00',
  });
  repos.listings.create({
    id: 'l_pct', seller_user_id: 'u_seller', concert_id: 'c_market',
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
    assert.equal(cat3.seller.id, 'u_seller');
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
  test('rejects a bad payment method and an unknown buyer', async () => {
    const badMethod = await buy('l_cat3', { buyer_user_id: 'u_buyer', payment_method: 'cash' });
    assert.equal(badMethod.status, 400);
    assert.equal(badMethod.body.error, 'invalid_payment_method');

    const ghost = await buy('l_cat3', { buyer_user_id: 'u_ghost', payment_method: 'visa' });
    assert.equal(ghost.status, 400);
    assert.equal(ghost.body.error, 'buyer_not_found');
  });

  test('a seller cannot buy their own listing', async () => {
    const { status, body } = await buy('l_cat3', { buyer_user_id: 'u_seller', payment_method: 'visa' });
    assert.equal(status, 409);
    assert.equal(body.error, 'cannot_buy_own_listing');
  });

  test('charges the stored price, ignoring any price in the request', async () => {
    const { status, body } = await buy('l_cat3', {
      buyer_user_id: 'u_buyer', payment_method: 'paypal', price_cents: 1,
    });
    assert.equal(status, 201);
    assert.equal(body.order.subtotalCents, 31000);
    assert.equal(body.order.deliveryFeeCents, 0);
    assert.equal(body.order.totalCents, 31000);
    assert.equal(body.order.paymentMethod, 'paypal');
    assert.equal(body.order.listing.status, 'sold');

    const fetched = await api(`/api/orders/${body.order.id}`);
    assert.equal(fetched.status, 200);
    assert.equal(fetched.body.order.listing.id, 'l_cat3');
  });

  test('a sold listing cannot be bought again and leaves the open list', async () => {
    const second = await buy('l_cat3', { buyer_user_id: 'u_buyer2', payment_method: 'visa' });
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
      buy('l_vip', { buyer_user_id: 'u_buyer', payment_method: 'visa' }),
      buy('l_vip', { buyer_user_id: 'u_buyer2', payment_method: 'mastercard' }),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  });

  test('buying a listing that does not exist is 404', async () => {
    const { status } = await buy('nope', { buyer_user_id: 'u_buyer', payment_method: 'visa' });
    assert.equal(status, 404);
  });
});
