/**
 * A colour theme per concert.
 *
 * WHAT IS STORED, AND WHY IT IS ONLY A HUE
 * ----------------------------------------
 * The poster decides the hue and nothing else. Lightness and saturation come
 * from this module, the same for every concert, so a page tinted by a washed
 * out pastel and a page tinted by a neon sleeve are equally readable. Storing
 * a whole palette from the image would mean inheriting its contrast too, and
 * a background that fails behind white text on one artist in ten is worse than
 * one that never quite matches the artwork.
 *
 * TWO SOURCES, ONE SHAPE
 * ----------------------
 * `fromArtist` hashes the name, so every concert has a theme immediately: no
 * network, no decoding, and — this is the point — it works for the many
 * concerts whose provider listing carries no image at all. `fromImage` reads
 * the dominant hue off the poster when there is one, and defers to the name
 * when the image is grey, tiny or undecodable, because a hue taken from a
 * black and white sleeve is just noise.
 *
 * Both return the same shape, so nothing downstream needs to know which ran.
 */

/** Fixed by design rather than by the artwork: see the note above. */
const SURFACE_LIGHTNESS = 16;
const SURFACE_SATURATION = 42;
const ACCENT_LIGHTNESS = 64;
const ACCENT_SATURATION = 72;
/** Below this, an image has no colour worth taking — only a grey cast. */
const MIN_USEFUL_SATURATION = 0.18;

/** FNV-1a: small, stable across runs, and well spread for short strings. */
function hash(text) {
  let value = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value;
}

/** The full theme derived from one hue, so every source agrees on the rest. */
export function paletteFromHue(hue, source = 'name') {
  const h = ((Math.round(hue) % 360) + 360) % 360;
  return {
    hue: h,
    source,
    // The page's own background behind the hero and the setlist.
    surface: `hsl(${h} ${SURFACE_SATURATION}% ${SURFACE_LIGHTNESS}%)`,
    // A touch further round the wheel, so a gradient has somewhere to go.
    surfaceEnd: `hsl(${(h + 24) % 360} ${SURFACE_SATURATION}% ${Math.max(8, SURFACE_LIGHTNESS - 7)}%)`,
    // What the lit part of the rhythm string uses.
    accent: `hsl(${h} ${ACCENT_SATURATION}% ${ACCENT_LIGHTNESS}%)`,
    // Unlit segments: the same hue, kept well back.
    muted: `hsl(${h} ${Math.round(ACCENT_SATURATION * 0.5)}% ${Math.round(ACCENT_LIGHTNESS * 0.55)}%)`,
  };
}

/** Always available, and identical every time for the same artist. */
export const paletteFromArtist = (artist) =>
  paletteFromHue(hash(String(artist ?? '').trim().toLowerCase() || 'encore') % 360, 'name');

/** RGB 0-255 to hue 0-360 plus the saturation that says whether to trust it. */
function hueOf(r, g, b) {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  if (delta === 0) return { hue: 0, saturation: 0, lightness: max };

  let hue;
  if (max === red) hue = ((green - blue) / delta) % 6;
  else if (max === green) hue = (blue - red) / delta + 2;
  else hue = (red - green) / delta + 4;

  const lightness = (max + min) / 2;
  const saturation = delta / (1 - Math.abs(2 * lightness - 1) || 1);
  return { hue: ((hue * 60) % 360 + 360) % 360, saturation, lightness };
}

/**
 * The dominant hue of a JPEG, or null when there is nothing worth taking.
 *
 * Pixels are weighted by how colourful they are and binned into twelve
 * segments of the wheel, so a poster that is mostly dark background with one
 * saturated band still reports that band rather than the background. Near
 * black and near white pixels are skipped: their hue is meaningless and they
 * are usually the majority of a concert photograph.
 *
 * @param {Buffer}   bytes   the raw JPEG
 * @param {Function} decode  injected so this stays testable without the codec
 */
export function hueFromJpeg(bytes, decode) {
  let image;
  try {
    image = decode(bytes, { useTArray: true, maxMemoryUsageInMB: 64 });
  } catch {
    return null; // Not a JPEG we can read: the artist name still gives a theme.
  }
  if (!image?.width || !image?.height || !image.data) return null;

  const BINS = 12;
  const weights = new Float64Array(BINS);
  const hues = new Float64Array(BINS);
  // A poster needs nothing like full resolution to give up its hue.
  const step = Math.max(1, Math.floor((image.width * image.height) / 20000)) * 4;

  for (let i = 0; i < image.data.length - 3; i += step) {
    const { hue, saturation, lightness } = hueOf(image.data[i], image.data[i + 1], image.data[i + 2]);
    if (saturation < MIN_USEFUL_SATURATION) continue;
    if (lightness < 0.12 || lightness > 0.93) continue;
    const bin = Math.min(BINS - 1, Math.floor(hue / (360 / BINS)));
    // Saturation as the weight: a vivid pixel speaks louder than a muddy one.
    weights[bin] += saturation;
    hues[bin] += hue * saturation;
  }

  let best = -1;
  let bestWeight = 0;
  for (let bin = 0; bin < BINS; bin += 1) {
    if (weights[bin] > bestWeight) { bestWeight = weights[bin]; best = bin; }
  }
  // Almost no colourful pixels at all: a greyscale sleeve, so take nothing.
  if (best === -1 || bestWeight <= 0) return null;
  return hues[best] / weights[best];
}

/**
 * The theme for one concert.
 * `storedHue` is whatever the sync last managed to read off the poster.
 */
export function concertPalette({ artist, paletteHue, paletteSource } = {}) {
  if (Number.isFinite(paletteHue)) return paletteFromHue(paletteHue, paletteSource ?? 'image');
  return paletteFromArtist(artist);
}
