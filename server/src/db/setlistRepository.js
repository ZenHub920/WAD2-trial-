/**
 * Setlists, entered by an operator rather than fetched.
 *
 * WHY THESE ARE TYPED IN
 * ----------------------
 * A setlist is not reliable data before a show. Running orders leak, change at
 * soundcheck, and differ between nights of the same tour; the free sources that
 * do exist are crowd-filled after the fact. So this is curated: an operator
 * enters what is known and marks how much it should be trusted, and the
 * interface shows that standing rather than implying a published fact.
 *
 * `status` is the honest part. "rumoured" is a guess from earlier dates,
 * "announced" came from the artist or promoter, and "played" is what actually
 * happened. `updated_at` lets a page say how fresh that claim is.
 *
 * A track needs only a title. The Spotify id is optional so a running order can
 * go up straight away and links can be filled in as they are found — a setlist
 * with no links is still useful, while a half-entered one held back is not.
 */

import { randomUUID } from 'node:crypto';
import { spotifyEmbedUrl, spotifyTrackId, spotifyTrackUrl } from '../services/spotifyLinks.js';

export const SETLIST_STATUSES = ['rumoured', 'announced', 'played'];
/** Long enough for an encore-heavy stadium night, short enough to bound a page. */
const MAX_TRACKS = 60;
const MAX_TITLE = 120;

const fail = (message, status = 400) => Object.assign(new Error(message), { status });

export function migrateSetlists(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS concert_setlists (
      concert_id TEXT PRIMARY KEY REFERENCES concerts(id) ON DELETE CASCADE,
      status     TEXT NOT NULL DEFAULT 'announced'
                 CHECK (status IN ('rumoured','announced','played')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_by TEXT REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS setlist_tracks (
      id               TEXT PRIMARY KEY,
      concert_id       TEXT NOT NULL REFERENCES concerts(id) ON DELETE CASCADE,
      position         INTEGER NOT NULL,
      title            TEXT NOT NULL,
      -- A bare 22-character id, never a pasted URL. See services/spotifyLinks.
      spotify_track_id TEXT,
      UNIQUE (concert_id, position)
    );
    CREATE INDEX IF NOT EXISTS idx_setlist_tracks_concert
      ON setlist_tracks(concert_id, position);
  `);
}

/**
 * Check a submitted setlist before any of it is written.
 *
 * Returns the tracks with ids extracted. A link that is not a Spotify track is
 * refused outright rather than quietly dropped: an operator who pasted the
 * wrong thing should be told, not left wondering why one song has no player.
 */
export function validateSetlist(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail('setlist_required');

  const status = input.status ?? 'announced';
  if (!SETLIST_STATUSES.includes(status)) throw fail('invalid_setlist_status');

  const entries = input.tracks ?? [];
  if (!Array.isArray(entries) || entries.length > MAX_TRACKS) throw fail('invalid_setlist');

  const tracks = [];
  for (const entry of entries) {
    const title = typeof entry === 'string' ? entry : entry?.title;
    if (typeof title !== 'string' || !title.trim() || title.length > MAX_TITLE)
      throw fail('invalid_track_title');

    // An empty link is "not found yet", which is allowed; a non-empty one that
    // is not a Spotify track is a mistake worth surfacing.
    const raw = typeof entry === 'object' ? (entry.spotify ?? entry.spotifyUrl ?? '') : '';
    let trackId = null;
    if (typeof raw === 'string' && raw.trim()) {
      trackId = spotifyTrackId(raw);
      if (!trackId) throw fail('invalid_spotify_link');
    }
    tracks.push({ title: title.trim(), spotifyTrackId: trackId });
  }
  return { status, tracks };
}

export function createSetlistRepo(db, repos) {
  const row = db.prepare('SELECT * FROM concert_setlists WHERE concert_id = ?');
  const trackRows = db.prepare(
    'SELECT id, position, title, spotify_track_id FROM setlist_tracks WHERE concert_id = ? ORDER BY position',
  );

  /** The shape both the card and the detail page read. */
  const present = (concertId) => {
    const meta = row.get(concertId);
    const tracks = trackRows.all(concertId);
    if (!meta && !tracks.length) return null;
    return {
      concertId,
      status: meta?.status ?? 'announced',
      updatedAt: meta?.updated_at ?? null,
      trackCount: tracks.length,
      // Playable ones are counted separately so the interface can say "3 of 14
      // have previews" instead of looking half-broken.
      previewCount: tracks.filter((t) => t.spotify_track_id).length,
      tracks: tracks.map((t) => ({
        id: t.id,
        position: t.position,
        title: t.title,
        // Addresses are rebuilt from the stored id; nothing pasted is echoed.
        embedUrl: spotifyEmbedUrl(t.spotify_track_id),
        spotifyUrl: spotifyTrackUrl(t.spotify_track_id),
      })),
    };
  };

  return {
    /** Public: null when no operator has entered one yet. */
    get: (concertId) => present(concertId),

    /** Several concerts at once, so a page of cards is one query, not twenty. */
    summaries(concertIds = []) {
      const summary = {};
      for (const id of concertIds) {
        const tracks = trackRows.all(id);
        if (!tracks.length) continue;
        summary[id] = {
          trackCount: tracks.length,
          previewCount: tracks.filter((t) => t.spotify_track_id).length,
          status: row.get(id)?.status ?? 'announced',
        };
      }
      return summary;
    },

    /** Operator only. Replaces the whole list, so the order is always theirs. */
    replace: db.transaction((operatorId, concertId, input) => {
      if (!repos.concerts.findById(concertId)) throw fail('concert_not_found', 404);
      const { status, tracks } = validateSetlist(input);

      db.prepare('DELETE FROM setlist_tracks WHERE concert_id = ?').run(concertId);
      const insert = db.prepare(
        `INSERT INTO setlist_tracks(id, concert_id, position, title, spotify_track_id)
         VALUES (?, ?, ?, ?, ?)`,
      );
      tracks.forEach((track, index) => {
        insert.run(randomUUID(), concertId, index + 1, track.title, track.spotifyTrackId);
      });

      db.prepare(
        `INSERT INTO concert_setlists(concert_id, status, updated_at, updated_by)
         VALUES (?, ?, datetime('now'), ?)
         ON CONFLICT(concert_id) DO UPDATE SET
           status = excluded.status,
           updated_at = excluded.updated_at,
           updated_by = excluded.updated_by`,
      ).run(concertId, status, operatorId ?? null);

      return present(concertId);
    }).immediate,

    /** Clearing a setlist removes the heading too, so the disc disappears. */
    clear: db.transaction((concertId) => {
      db.prepare('DELETE FROM setlist_tracks WHERE concert_id = ?').run(concertId);
      db.prepare('DELETE FROM concert_setlists WHERE concert_id = ?').run(concertId);
      return null;
    }).immediate,
  };
}
