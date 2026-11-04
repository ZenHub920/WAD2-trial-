/**
 * Operator-curated setlists, and the link handling that lets the page embed a
 * Spotify frame safely. The link tests matter most: the site's CSP allows one
 * frame host, and these are what stop anything else reaching an iframe src.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../../server/src/app.js';
import { createTestDb } from '../../server/src/db/connection.js';
import { spotifyEmbedUrl, spotifyTrackId } from '../../server/src/services/spotifyLinks.js';
import { validateSetlist } from '../../server/src/db/setlistRepository.js';

const ID = '4cOdK2wGLETKBW3PvgPWqT'; // 22 base62 characters, the shape Spotify uses

/* ----------------------------------------------------------- link handling */

test('a track id is read from every shape Spotify hands people', () => {
  assert.equal(spotifyTrackId(`https://open.spotify.com/track/${ID}`), ID);
  assert.equal(spotifyTrackId(`https://open.spotify.com/track/${ID}?si=abc123`), ID, 'share suffix');
  assert.equal(spotifyTrackId(`https://open.spotify.com/intl-pt/track/${ID}`), ID, 'locale prefix');
  assert.equal(spotifyTrackId(`  https://open.spotify.com/track/${ID}  `), ID, 'pasted with spaces');
  assert.equal(spotifyTrackId(`spotify:track:${ID}`), ID, 'desktop app uri');
  assert.equal(spotifyTrackId(ID), ID, 'bare id');
});

test('anything that is not a Spotify track is refused, not coerced', () => {
  const rejected = [
    `https://open.spotify.com.evil.test/track/${ID}`, // look-alike host
    `https://evil.test/track/${ID}`,
    `http://open.spotify.com/track/${ID}`, // not https
    `https://open.spotify.com/album/${ID}`, // not a track
    `https://open.spotify.com/playlist/${ID}`,
    `https://open.spotify.com/a/b/track/${ID}`, // buried too deep to be a share link
    'https://open.spotify.com/track/short',
    'javascript:alert(1)',
    '', '   ', null, undefined, 42, {},
  ];
  for (const value of rejected)
    assert.equal(spotifyTrackId(value), null, `should refuse ${JSON.stringify(value)}`);
});

test('the embed address is rebuilt from the id, never from what was pasted', () => {
  assert.equal(spotifyEmbedUrl(ID), `https://open.spotify.com/embed/track/${ID}`);
  // Even if a bad value reached this far, it cannot become a frame address.
  assert.equal(spotifyEmbedUrl('../../evil'), null);
  assert.equal(spotifyEmbedUrl(null), null);
});

/* -------------------------------------------------------------- validation */

test('a track needs a title; the link is optional so orders can go up early', () => {
  const result = validateSetlist({ tracks: [{ title: 'Beautiful Things' }, { title: 'Ghost Town', spotify: ID }] });
  assert.equal(result.tracks.length, 2);
  assert.equal(result.tracks[0].spotifyTrackId, null, 'no link yet is fine');
  assert.equal(result.tracks[1].spotifyTrackId, ID);
  assert.throws(() => validateSetlist({ tracks: [{ title: '  ' }] }), /invalid_track_title/);
});

test('a link that is not a Spotify track is reported rather than silently dropped', () => {
  assert.throws(
    () => validateSetlist({ tracks: [{ title: 'Song', spotify: 'https://youtube.com/watch?v=x' }] }),
    /invalid_spotify_link/,
    'an operator who pasted the wrong thing should be told',
  );
});

test('status says how much the running order should be trusted', () => {
  assert.equal(validateSetlist({ tracks: [] }).status, 'announced', 'the default');
  assert.equal(validateSetlist({ status: 'rumoured', tracks: [] }).status, 'rumoured');
  assert.throws(() => validateSetlist({ status: 'leaked', tracks: [] }), /invalid_setlist_status/);
});

test('an implausibly long setlist is refused', () => {
  const tracks = Array.from({ length: 61 }, (_, i) => ({ title: `Song ${i}` }));
  assert.throws(() => validateSetlist({ tracks }), /invalid_setlist/);
});

/* ------------------------------------------------------------- the endpoint */

async function fixture(t) {
  const db = createTestDb();
  const server = createApp({ db }).app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); db.close(); });

  async function request(path, { cookie, method = 'GET', body } = {}) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method,
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json().catch(() => null), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  async function person(name, { operator = false } = {}) {
    const result = await request('/auth/register', {
      method: 'POST',
      body: { display_name: name, email: `${name}@example.test`, password: 'example-password' },
    });
    assert.equal(result.status, 201);
    if (operator) db.prepare('UPDATE users SET is_operator=1 WHERE id=?').run(result.body.user.id);
    return { ...result.body.user, cookie: result.cookie };
  }
  const concert = db.prepare('SELECT id FROM concerts LIMIT 1').get()
    ?? (() => {
      db.prepare(`INSERT INTO concerts(id,artist,venue,city,event_date) VALUES('c_set','Test Act','Hall','Singapore','2027-09-09')`).run();
      return { id: 'c_set' };
    })();
  return { db, request, person, concertId: concert.id };
}

test('a concert with no setlist reports null rather than failing', async (t) => {
  const f = await fixture(t);
  const result = await f.request(`/concerts/${f.concertId}/setlist`);
  assert.equal(result.status, 200);
  assert.equal(result.body.setlist, null, 'the disc simply does not appear');
});

test('only an operator can enter a setlist', async (t) => {
  const f = await fixture(t);
  const fan = await f.person('setlist-fan');
  const body = { tracks: [{ title: 'Opener' }] };

  assert.equal((await f.request(`/concerts/${f.concertId}/setlist`, { method: 'PUT', body })).status, 401,
    'signed out');
  assert.equal((await f.request(`/concerts/${f.concertId}/setlist`, { method: 'PUT', body, cookie: fan.cookie })).status, 403,
    'an ordinary account is not an editor');
});

test('an operator enters a running order and anyone can read it back', async (t) => {
  const f = await fixture(t);
  const operator = await f.person('setlist-operator', { operator: true });

  const saved = await f.request(`/concerts/${f.concertId}/setlist`, {
    method: 'PUT',
    cookie: operator.cookie,
    body: {
      status: 'announced',
      tracks: [
        { title: 'Opener', spotify: `https://open.spotify.com/track/${ID}` },
        { title: 'Deep Cut' },
        { title: 'Encore', spotify: `spotify:track:${ID}` },
      ],
    },
  });
  assert.equal(saved.status, 200);

  const { setlist } = (await f.request(`/concerts/${f.concertId}/setlist`)).body;
  assert.deepEqual(setlist.tracks.map((t2) => t2.title), ['Opener', 'Deep Cut', 'Encore'],
    'the order entered is the order served');
  assert.deepEqual(setlist.tracks.map((t2) => t2.position), [1, 2, 3]);
  assert.equal(setlist.trackCount, 3);
  assert.equal(setlist.previewCount, 2, 'the page can say how many are playable');
  assert.equal(setlist.tracks[0].embedUrl, `https://open.spotify.com/embed/track/${ID}`);
  assert.equal(setlist.tracks[1].embedUrl, null, 'no link, no player, still listed');
  assert.ok(setlist.updatedAt, 'freshness is recorded');
});

test('saving again replaces the whole order instead of appending', async (t) => {
  const f = await fixture(t);
  const operator = await f.person('setlist-replacer', { operator: true });
  const put = (tracks) => f.request(`/concerts/${f.concertId}/setlist`, {
    method: 'PUT', cookie: operator.cookie, body: { tracks },
  });

  await put([{ title: 'First' }, { title: 'Second' }]);
  await put([{ title: 'Only' }]);
  const { setlist } = (await f.request(`/concerts/${f.concertId}/setlist`)).body;
  assert.deepEqual(setlist.tracks.map((t2) => t2.title), ['Only']);
});

test('a bad link leaves the stored setlist untouched', async (t) => {
  const f = await fixture(t);
  const operator = await f.person('setlist-guard', { operator: true });
  await f.request(`/concerts/${f.concertId}/setlist`, {
    method: 'PUT', cookie: operator.cookie, body: { tracks: [{ title: 'Good' }] },
  });
  const rejected = await f.request(`/concerts/${f.concertId}/setlist`, {
    method: 'PUT',
    cookie: operator.cookie,
    body: { tracks: [{ title: 'Bad', spotify: 'https://evil.test/track/x' }] },
  });
  assert.equal(rejected.status, 400);
  assert.equal(rejected.body.error, 'invalid_spotify_link');

  const { setlist } = (await f.request(`/concerts/${f.concertId}/setlist`)).body;
  assert.deepEqual(setlist.tracks.map((t2) => t2.title), ['Good'],
    'a refused save must not half-apply');
});

test('clearing a setlist removes it entirely', async (t) => {
  const f = await fixture(t);
  const operator = await f.person('setlist-clearer', { operator: true });
  await f.request(`/concerts/${f.concertId}/setlist`, {
    method: 'PUT', cookie: operator.cookie, body: { tracks: [{ title: 'Song' }] },
  });
  assert.equal((await f.request(`/concerts/${f.concertId}/setlist`, {
    method: 'DELETE', cookie: operator.cookie,
  })).status, 200);
  assert.equal((await f.request(`/concerts/${f.concertId}/setlist`)).body.setlist, null);
});

test('a setlist for a concert that does not exist is a 404', async (t) => {
  const f = await fixture(t);
  const operator = await f.person('setlist-missing', { operator: true });
  assert.equal((await f.request('/concerts/no_such_concert/setlist')).status, 404);
  assert.equal((await f.request('/concerts/no_such_concert/setlist', {
    method: 'PUT', cookie: operator.cookie, body: { tracks: [{ title: 'x' }] },
  })).status, 404);
});
