import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// This checks the shared solid-color contracts. Browser checks are still needed
// for photography, translucent layers, component overrides and rendered focus.
const source = readFileSync(resolve(process.cwd(), 'src/assets/tokens.css'), 'utf8');
const declarations = block => Object.fromEntries([...block.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)].map(match => [match[1], match[2].trim()]));
const light = declarations(source.match(/:root\s*\{([\s\S]*?)\}/)[1]);
const dark = { ...light, ...declarations(source.match(/:root\[data-theme='dark'\]\s*\{([\s\S]*?)\}/)[1]) };

function color(tokens, name) {
  const value = tokens[name];
  const reference = value?.match(/^var\(--([\w-]+)\)$/);
  if (reference) return color(tokens, reference[1]);
  if (!/^#[\da-f]{3}([\da-f]{3})?$/i.test(value)) throw new Error(`Expected solid color for --${name}, received ${value}`);
  return value.length === 4 ? `#${[...value.slice(1)].map(char => char + char).join('')}` : value;
}
function luminance(hex) {
  return hex.slice(1).match(/../g).map(channel => parseInt(channel, 16) / 255)
    .map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
    .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
}
function contrast(first, second) {
  const a = luminance(first), b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

describe.each([['light', light], ['dark', dark]])('%s shared color contracts', (_theme, tokens) => {
  it('keeps body, secondary, muted and accent text readable on page, card, field and floating surfaces', () => {
    for (const text of ['text-100', 'text-200', 'text-300', 'text-400', 'accent-400']) {
      for (const surface of ['ink-900', 'ink-800', 'field-bg', 'surface-floating']) {
        expect(contrast(color(tokens, text), color(tokens, surface)), `--${text} on --${surface}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('keeps action labels readable at every shared button gradient endpoint and status fill', () => {
    for (const fill of ['action-start', 'action-end', 'action-hover', 'success-fill', 'success-hover', 'danger-fill', 'danger-hover']) {
      expect(contrast(color(tokens, 'on-action'), color(tokens, fill)), `--on-action on --${fill}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('distinguishes control edges and focus rings from their adjacent surfaces', () => {
    for (const edge of ['control-edge', 'focus-ring']) {
      for (const surface of ['field-bg', 'ink-800', 'surface-floating']) {
        expect(contrast(color(tokens, edge), color(tokens, surface)), `--${edge} against --${surface}`).toBeGreaterThanOrEqual(3);
      }
    }
  });
});
