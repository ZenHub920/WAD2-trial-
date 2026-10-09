/**
 * Integration tests: the API over a real (in-memory) database.
 *
 * These exercise the path the benchmarks skip — row mapping, JSON column
 * round-tripping, transactional round persistence, and the re-verification
 * endpoint that re-checks a stored round against its own snapshot.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { createTestDb } from '../src/db/connection.js';
import { createApp } from '../src/app.js';

let server;
let baseUrl;
let db;

const api = async (path, init) => {
  const res = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  return { status: res.status, body, cookie: res.headers.get('set-cookie')?.split(';')[0] };
};

const vibe = { singalong: 4, photography: 1, dancing: 4, quiet: 1, queue_early: 3, merch: 2 };
const cookies = {};

before(async () => {
  db = createTestDb();
  const { app } = createApp({ db });
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  // A concert with a hand-built instance small enough to reason about.
  db.prepare(`
    INSERT INTO concerts (id, artist, venue, city, event_date)
    VALUES ('c_test', 'Test Act', 'Test Venue', 'Singapore', '2026-12-01')
  `).run();
});

after(() => {
  server?.close();
  db?.close();
});

describe('Health and concerts', () => {
  test('health responds', async () => {
    const { status, body } = await api('/api/health');
    assert.equal(status, 200);
    assert.equal(body.ok, true);
  });

  test('lists concerts with live counts', async () => {
    const { status, body } = await api('/api/concerts');
    assert.equal(status, 200);
    assert.equal(body.concerts.length, 1);
    assert.equal(body.concerts[0].open_parties, 0);
  });

  test('404s an unknown concert', async () => {
    assert.equal((await api('/api/concerts/nope')).status, 404);
  });
});

describe('Creating users and listings', () => {
  const created = {};

  test('registers users without exposing credentials', async () => {
    for (const name of ['host_a', 'host_b', 'seek_a', 'seek_b', 'seek_c']) {
      const { status, body, cookie } = await api('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          display_name: name,
          email: `${name}@example.test`,
          password: 'test-password',
          age_band: '21-24',
          home_region: 'central',
          gender: 'f',
          vibe,
        }),
      });
      assert.equal(status, 201, `registering ${name}`);
      assert.equal(body.user.email, undefined, 'email must not be exposed');
      assert.ok(cookie?.startsWith('encore_session='));
      created[name] = body.user;
      cookies[name] = cookie;
      db.prepare('UPDATE users SET reliability = ?, verified = 1 WHERE id = ?')
        .run(name.startsWith('host') ? 0.9 : 0.8, body.user.id);
    }
    assert.equal(Object.keys(created).length, 5);
  });

  test('rejects a party with a bad section', async () => {
    const { status, body } = await api('/api/concerts/c_test/parties', {
      method: 'POST',
      headers: { cookie: cookies.host_a },
      body: JSON.stringify({
        capacity: 1, section: 'balcony', spend_band: 2, arrival_plan: 'mid',
      }),
    });
    assert.equal(status, 400);
    assert.equal(body.error, 'invalid_section');
  });

  test('rejects a party with zero capacity', async () => {
    const { status, body } = await api('/api/concerts/c_test/parties', {
      method: 'POST',
      headers: { cookie: cookies.host_a },
      body: JSON.stringify({
        capacity: 0, section: 'pit', spend_band: 2, arrival_plan: 'mid',
      }),
    });
    assert.equal(status, 400);
    assert.equal(body.error, 'capacity_must_be_positive_int');
  });

  test('creates two parties with capacity 2 and 1', async () => {
    const specs = [
      { id: 'p_a', user: 'host_a', capacity: 2, section: 'pit', spend_band: 2, arrival_plan: 'early_queue' },
      { id: 'p_b', user: 'host_b', capacity: 1, section: 'ga_standing', spend_band: 2, arrival_plan: 'mid' },
    ];
    for (const { user, ...spec } of specs) {
      const { status } = await api('/api/concerts/c_test/parties', {
        method: 'POST',
        headers: { cookie: cookies[user] },
        body: JSON.stringify({ ...spec, plans: { pre_meetup: true } }),
      });
      assert.equal(status, 201);
    }
    const { body } = await api('/api/concerts/c_test/parties');
    assert.equal(body.parties.length, 2);
    // JSON columns must survive the round trip.
    assert.equal(body.parties.find((p) => p.id === 'p_a').plans.pre_meetup, true);
  });

  test('creates three seeker requests', async () => {
    const specs = [
      { id: 's_a', user: 'seek_a', section_pref: 'pit', spend_band_max: 3, arrival_pref: 'early_queue' },
      { id: 's_b', user: 'seek_b', section_pref: 'pit', spend_band_max: 3, arrival_pref: 'early_queue' },
      { id: 's_c', user: 'seek_c', section_pref: 'ga_standing', spend_band_max: 3, arrival_pref: 'mid' },
    ];
    for (const { user, ...spec } of specs) {
      const { status } = await api('/api/concerts/c_test/requests', {
        method: 'POST',
        headers: { cookie: cookies[user] },
        body: JSON.stringify({ ...spec, plans_wanted: { pre_meetup: true } }),
      });
      assert.equal(status, 201);
    }
    const { body } = await api('/api/concerts/c_test/requests');
    assert.equal(body.requests.length, 3);
  });

  test('the concert now reports its open counts', async () => {
    const { body } = await api('/api/concerts/c_test');
    assert.equal(body.openParties, 2);
    assert.equal(body.openSlots, 3);
    assert.equal(body.openSeekers, 3);
    assert.equal(body.latestRound, null);
  });
});

describe('Matching over HTTP', () => {
  let roundId;

  test('preview solves without writing anything', async () => {
    const { status, body } = await api('/api/concerts/c_test/match/preview?baselines=true&trace=true');
    assert.equal(status, 200);
    assert.equal(body.empty, false);
    assert.equal(body.metrics.stable, true);
    assert.equal(body.metrics.blockingPairs, 0);
    assert.ok(Array.isArray(body.trace));
    assert.ok(body.comparison.length === 3);

    // Nothing persisted.
    const after = await api('/api/concerts/c_test');
    assert.equal(after.body.latestRound, null);
    assert.equal(after.body.openSeekers, 3, 'preview must not change listing status');
  });

  test('committing a round persists it and reports stability', async () => {
    const { status, body } = await api('/api/concerts/c_test/match', {
      method: 'POST', headers: { cookie: cookies.host_a },
    });
    assert.equal(status, 201);
    assert.ok(body.roundId);
    assert.equal(body.metrics.stable, true);
    roundId = body.roundId;
  });

  test('the round is retrievable with its results', async () => {
    const { status, body } = await api(`/api/rounds/${roundId}`);
    assert.equal(status, 200);
    assert.equal(body.round.isStable, true);
    assert.equal(body.round.blockingPairCount, 0);
    assert.equal(body.results.length, 3, 'one result row per seeker, matched or not');

    // Matched rows must come first.
    const outcomes = body.results.map((r) => r.outcome);
    const firstUnmatched = outcomes.indexOf('unmatched');
    if (firstUnmatched !== -1) {
      assert.ok(
        !outcomes.slice(firstUnmatched).includes('matched'),
        'matched rows should all precede unmatched rows',
      );
    }
  });

  test('all three seekers are placed — capacity is exactly 3', async () => {
    const { body } = await api(`/api/rounds/${roundId}`);
    const matched = body.results.filter((r) => r.outcome === 'matched');
    assert.equal(matched.length, 3);
    for (const row of matched) {
      assert.ok(row.party_id, 'a matched row must name a party');
      assert.ok(row.seeker_rank >= 1);
      assert.ok(row.party_rank >= 1);
    }
  });

  test('capacity is respected in the persisted result', async () => {
    const { body } = await api(`/api/rounds/${roundId}`);
    const counts = new Map();
    for (const row of body.results) {
      if (!row.party_id) continue;
      counts.set(row.party_id, (counts.get(row.party_id) ?? 0) + 1);
    }
    assert.ok((counts.get('p_a') ?? 0) <= 2);
    assert.ok((counts.get('p_b') ?? 0) <= 1);
  });

  test('re-verification agrees with the stored stability claim', async () => {
    const { status, body } = await api(`/api/rounds/${roundId}/verify`);
    assert.equal(status, 200);
    assert.equal(body.verified, true);
    assert.equal(body.blockingPairCount, 0);
    assert.equal(body.agreesWithStoredClaim, true);
  });

  test('the trace was persisted', async () => {
    const { body } = await api(`/api/rounds/${roundId}/trace`);
    assert.ok(body.trace.length > 0);
    assert.equal(body.trace[0].step, 0);
    for (const event of body.trace) {
      assert.ok(['accept', 'reject', 'evict'].includes(event.event_type));
    }
  });

  test('listings are flipped to matched, so a second round has nothing to do', async () => {
    const { body } = await api('/api/concerts/c_test');
    assert.equal(body.openSeekers, 0);
    assert.ok(body.latestRound);
    assert.equal(body.latestRound.isStable, true);

    const second = await api('/api/concerts/c_test/match', {
      method: 'POST', headers: { cookie: cookies.host_a },
    });
    assert.equal(second.status, 409);
    assert.equal(second.body.error, 'nothing_to_match');
  });

  test('verification detects tampering with a stored result', async () => {
    // Swap two seekers between parties behind the service's back. The stored
    // stability claim now describes a matching that no longer exists, and
    // re-verification must say so.
    const rows = db.prepare(
      `SELECT id, seeker_request_id, party_id FROM match_results
       WHERE round_id = ? AND outcome = 'matched' ORDER BY seeker_request_id`,
    ).all(roundId);

    const a = rows.find((r) => r.party_id === 'p_a');
    const b = rows.find((r) => r.party_id === 'p_b');
    assert.ok(a && b, 'need one row in each party to swap');

    db.prepare('UPDATE match_results SET party_id = ? WHERE id = ?').run('p_b', a.id);
    db.prepare('UPDATE match_results SET party_id = ? WHERE id = ?').run('p_a', b.id);

    const { body } = await api(`/api/rounds/${roundId}/verify`);
    assert.equal(body.agreesWithStoredClaim, false, 'tampering must be detected');

    // Restore, so later tests see a consistent database.
    db.prepare('UPDATE match_results SET party_id = ? WHERE id = ?').run(a.party_id, a.id);
    db.prepare('UPDATE match_results SET party_id = ? WHERE id = ?').run(b.party_id, b.id);
  });
});

describe('Empty instances', () => {
  test('a concert with no listings reports empty rather than erroring', async () => {
    db.prepare(`
      INSERT INTO concerts (id, artist, venue, city, event_date)
      VALUES ('c_empty', 'Nobody', 'Nowhere', 'Singapore', '2027-01-01')
    `).run();

    const preview = await api('/api/concerts/c_empty/match/preview');
    assert.equal(preview.status, 200);
    assert.equal(preview.body.empty, true);

    const run = await api('/api/concerts/c_empty/match', {
      method: 'POST', headers: { cookie: cookies.host_a },
    });
    assert.equal(run.status, 409);
  });
});
