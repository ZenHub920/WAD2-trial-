import { ref, watch } from 'vue';

/**
 * Reads the dominant hue out of a concert poster so the hero backdrop can take
 * its colour from whoever is on stage. Posters come off the Ticketmaster CDN,
 * which sends `Access-Control-Allow-Origin: *`, so the canvas stays untainted;
 * anything that fails (a broken URL, a host without CORS, a poster that is all
 * greys) just leaves the default purple in place.
 */

const SAMPLE_SIZE = 32;
// Below this saturation a poster is effectively monochrome and its "dominant
// hue" would be noise, so we keep the brand colour instead.
const MIN_SATURATION = 0.18;

const cache = new Map();

function rgbToHsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h: h * 360, s, l };
}

function sample(url) {
  if (cache.has(url)) return Promise.resolve(cache.get(url));

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = SAMPLE_SIZE;
        canvas.height = SAMPLE_SIZE;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
        const { data } = ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);

        // Average the hue as a vector so reds either side of 0deg don't cancel
        // out into cyan, and weight each pixel by how colourful it is.
        let x = 0;
        let y = 0;
        let weight = 0;
        let satTotal = 0;
        let counted = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] < 128) continue;
          const { h, s, l } = rgbToHsl(data[i], data[i + 1], data[i + 2]);
          // Near-black and near-white pixels carry no usable hue.
          if (l < 0.12 || l > 0.94) continue;
          const w = s * s;
          const rad = (h * Math.PI) / 180;
          x += Math.cos(rad) * w;
          y += Math.sin(rad) * w;
          weight += w;
          satTotal += s;
          counted += 1;
        }

        if (!counted || satTotal / counted < MIN_SATURATION) {
          cache.set(url, null);
          resolve(null);
          return;
        }

        const hue = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
        cache.set(url, hue);
        resolve(hue);
      } catch {
        // Tainted canvas: the poster host didn't allow cross-origin reads.
        cache.set(url, null);
        resolve(null);
      }
    };

    img.onerror = () => {
      cache.set(url, null);
      resolve(null);
    };

    img.src = url;
  });
}

/**
 * @param {import('vue').Ref<string|null>} source poster URL to read
 * @returns {{ hue: import('vue').Ref<number|null> }}
 */
export function usePosterHue(source) {
  const hue = ref(null);

  watch(
    source,
    async (url) => {
      if (!url) {
        hue.value = null;
        return;
      }
      const found = await sample(url);
      // The carousel may have moved on while we were decoding.
      if (source.value === url) hue.value = found;
    },
    { immediate: true },
  );

  return { hue };
}
