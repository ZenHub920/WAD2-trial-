/**
 * Reading the dominant hue off concert posters, once each.
 *
 * Kept apart from the concert import because that runs inside a synchronous
 * transaction and this has to go to the network. It is also entirely optional:
 * every concert already has a theme from its artist's name, so a poster that
 * cannot be fetched or decoded costs nothing but a slightly less apt colour.
 *
 * Only concerts with no stored hue are looked at, so a second run does no work
 * and no bandwidth. A failure is recorded as 'name' rather than left empty, so
 * an image that will never decode is not retried on every sync forever.
 */

import { decode } from 'jpeg-js';
import { hueFromJpeg } from '../services/concertPalette.js';

/** Posters are large; nothing here needs more than a thumbnail's worth. */
const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 6000;

export async function syncConcertPalettes(db, { fetchImpl = globalThis.fetch, limit = 40 } = {}) {
  const pending = db.prepare(`
    SELECT id, hero_image_url FROM concerts
    WHERE hero_image_url IS NOT NULL
      AND palette_hue IS NULL
      -- An attempt that produced no hue still sets the source, which is what
      -- keeps a permanently undecodable image from being fetched every sync.
      AND palette_source IS NULL
    LIMIT ?
  `).all(limit);

  const store = db.prepare('UPDATE concerts SET palette_hue = ?, palette_source = ? WHERE id = ?');
  let read = 0;
  let skipped = 0;

  for (const concert of pending) {
    let hue = null;
    try {
      const response = await fetchImpl(concert.hero_image_url, {
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: 'follow',
      });
      if (response.ok) {
        const type = response.headers.get('content-type') ?? '';
        const buffer = Buffer.from(await response.arrayBuffer());
        // jpeg-js reads JPEG only; anything else falls back to the name.
        if (/jpe?g/i.test(type) && buffer.byteLength <= MAX_BYTES) {
          hue = hueFromJpeg(buffer, decode);
        }
      }
    } catch {
      hue = null; // Offline, blocked, slow or malformed: the name still works.
    }

    if (Number.isFinite(hue)) {
      store.run(Math.round(hue), 'image', concert.id);
      read += 1;
    } else {
      // Marked so the next sync does not try this image again.
      store.run(null, 'name', concert.id);
      skipped += 1;
    }
  }

  return { considered: pending.length, read, skipped };
}
