/**
 * The per-concert colour theme.
 *
 * The property that matters most is the one about contrast: whatever the
 * poster looks like, only its HUE is allowed through. If an image could set
 * lightness too, a pale sleeve would produce a page where the white text on
 * the hero stops being readable, and that would be found by a marker rather
 * than by us.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  concertPalette,
  hueFromJpeg,
  paletteFromArtist,
  paletteFromHue,
} from '../../server/src/services/concertPalette.js';

/**
 * A stand-in for the JPEG codec.
 *
 * `hueFromJpeg` takes its decoder as an argument precisely so this test does
 * not need one: whether jpeg-js can read a JPEG is jpeg-js's business, while
 * what this module owns is the binning that turns pixels into a hue. Feeding
 * pixels directly tests that, runs in microseconds, and keeps the codec out of
 * the test tree's dependencies.
 */
const decodeStub = (pixels) => () => pixels;

/** A solid block of one colour. */
function solid(r, g, b, width = 64, height = 64) {
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
  }
  return { width, height, data };
}
const solidJpeg = (r, g, b) => solid(r, g, b);

/** The lightness out of an `hsl(H S% L%)` string. */
const lightnessOf = (css) => Number(/\s(\d+(?:\.\d+)?)%\)/.exec(css)?.[1] ?? NaN);
const hueOfCss = (css) => Number(/hsl\((\d+)/.exec(css)?.[1] ?? NaN);

/* ------------------------------------------------------- the name fallback */

test('every artist has a theme, with no image and no network', () => {
  const palette = paletteFromArtist('Benson Boone');
  assert.ok(palette.surface.startsWith('hsl('));
  assert.ok(palette.accent.startsWith('hsl('));
  assert.equal(palette.source, 'name');
});

test('the same artist always gets the same theme, and different ones differ', () => {
  assert.equal(paletteFromArtist('LANY').hue, paletteFromArtist('LANY').hue,
    'a concert that changed colour between visits would look broken');
  assert.equal(paletteFromArtist('lany  ').hue, paletteFromArtist('LANY').hue,
    'case and spacing are not a different artist');
  const hues = new Set(['LANY', 'Joji', 'Khalid', 'BINI', 'yung kai'].map((a) => paletteFromArtist(a).hue));
  assert.ok(hues.size >= 4, `expected spread across the wheel, got ${[...hues].join(', ')}`);
});

test('an empty or missing artist still produces a theme rather than throwing', () => {
  for (const value of ['', '   ', null, undefined]) {
    const palette = paletteFromArtist(value);
    assert.ok(Number.isFinite(palette.hue), `failed on ${JSON.stringify(value)}`);
  }
});

/* ------------------------------------------- contrast is ours, not the art's */

test('lightness is fixed no matter which hue arrives', () => {
  const lightnesses = new Set();
  for (let hue = 0; hue < 360; hue += 30) lightnesses.add(lightnessOf(paletteFromHue(hue).surface));
  assert.equal(lightnesses.size, 1,
    'if a hue could change lightness, some artists would get an unreadable hero');
  const [surface] = [...lightnesses];
  assert.ok(surface <= 20, `the hero carries white text, so it must stay dark: ${surface}%`);
});

test('the accent is bright enough to read against that surface', () => {
  const palette = paletteFromHue(200);
  assert.ok(lightnessOf(palette.accent) > lightnessOf(palette.surface) + 30,
    'the lit part of the string has to separate from what is behind it');
});

test('a hue is wrapped rather than rejected', () => {
  assert.equal(paletteFromHue(400).hue, 40);
  assert.equal(paletteFromHue(-30).hue, 330);
});

/* --------------------------------------------------- reading a poster's hue */

test('a coloured poster gives up roughly its own hue', () => {
  // Pure red is hue 0, pure blue 240; JPEG is lossy so allow a little drift.
  const red = hueFromJpeg(null, decodeStub(solidJpeg(220, 30, 30)));
  const blue = hueFromJpeg(null, decodeStub(solidJpeg(30, 60, 220)));
  assert.ok(red < 20 || red > 340, `red should land near 0, got ${red}`);
  assert.ok(Math.abs(blue - 230) < 30, `blue should land near 230, got ${blue}`);
});

test('a greyscale sleeve yields nothing, so the artist name decides', () => {
  assert.equal(hueFromJpeg(null, decodeStub(solidJpeg(128, 128, 128))), null,
    'a hue read off grey is noise, not a theme');
  assert.equal(hueFromJpeg(null, decodeStub(solidJpeg(12, 12, 12))), null, 'near black');
  assert.equal(hueFromJpeg(null, decodeStub(solidJpeg(250, 250, 250))), null, 'near white');
});

test('something that is not a JPEG is declined quietly', () => {
  const throwing = () => { throw new Error('not a jpeg'); };
  assert.equal(hueFromJpeg(Buffer.from('not an image at all'), throwing), null);
  assert.equal(hueFromJpeg(Buffer.alloc(0), () => null), null, 'a decoder that gives nothing back');
  assert.equal(hueFromJpeg(Buffer.alloc(0), () => ({ width: 0, height: 0 })), null, 'an empty image');
});

test('a dark poster with one vivid band reports the band, not the background', () => {
  // Most of the image is near-black; a strip down one side is saturated green.
  const width = 64;
  const height = 64;
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const green = x < 10;
      data[i] = green ? 40 : 10;
      data[i + 1] = green ? 200 : 10;
      data[i + 2] = green ? 70 : 12;
      data[i + 3] = 255;
    }
  }
  const hue = hueFromJpeg(null, decodeStub({ width, height, data }));
  assert.ok(hue > 90 && hue < 160, `expected a green hue, got ${hue}`);
});

/* ------------------------------------------------------- choosing a source */

test('a stored hue wins, and its absence falls back to the name', () => {
  const fromImage = concertPalette({ artist: 'Anyone', paletteHue: 200, paletteSource: 'image' });
  assert.equal(fromImage.hue, 200);
  assert.equal(fromImage.source, 'image');

  const fromName = concertPalette({ artist: 'Anyone' });
  assert.equal(fromName.source, 'name');
  assert.equal(fromName.hue, paletteFromArtist('Anyone').hue);
});
