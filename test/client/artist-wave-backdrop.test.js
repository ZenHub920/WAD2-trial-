import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import ArtistWaveBackdrop from '../../client/src/components/market/ArtistWaveBackdrop.vue';

/**
 * The backdrop is decoration, and decoration earns its place by staying out of
 * the way: behind the content, outside the accessibility tree, deaf to the
 * pointer, and taking its one variable — colour — from the page rather than
 * from a value of its own.
 */
describe('the artist wave backdrop', () => {
  const mountIt = () => mount(ArtistWaveBackdrop, { attachTo: document.body });

  it('is hidden from assistive technology and from the pointer', () => {
    const wrapper = mountIt();
    const root = wrapper.get('[data-test="wave-backdrop"]');
    expect(root.attributes('aria-hidden')).toBe('true');
    // No label, no role, no focusable child: there is nothing here to announce.
    expect(root.findAll('[role]')).toHaveLength(0);
    expect(root.findAll('button, a, input')).toHaveLength(0);
    expect(root.findAll('svg[focusable="true"]')).toHaveLength(0);
    wrapper.unmount();
  });

  it('draws three lanes, each tiled twice so the loop has no seam', () => {
    const wrapper = mountIt();
    expect(wrapper.findAll('.wave__drift')).toHaveLength(3);
    expect(wrapper.findAll('.wave__tile')).toHaveLength(6);
    // The pair inside one lane must be identical, or the join would jump.
    for (const lane of wrapper.findAll('.wave__drift')) {
      const [first, second] = lane.findAll('path').map(p => p.attributes('d'));
      expect(first).toBe(second);
    }
    wrapper.unmount();
  });

  it('gives each lane a different wave, so the three never read as one line', () => {
    const wrapper = mountIt();
    const shapes = wrapper.findAll('.wave__drift').map(lane => lane.get('path').attributes('d'));
    expect(new Set(shapes).size).toBe(3);
    wrapper.unmount();
  });

  it('takes its colour from the page and hard-codes none of its own', () => {
    const wrapper = mountIt();
    for (const path of wrapper.findAll('path')) {
      // Colour belongs to the concert's palette variable, never to the markup.
      expect(path.attributes('stroke')).toBeUndefined();
      expect(path.attributes('fill')).toBeUndefined();
      expect(path.attributes('style')).toBeUndefined();
    }
    wrapper.unmount();
  });

  it('keeps its stroke an even weight however the tile is stretched', () => {
    const wrapper = mountIt();
    // The tiles stretch non-uniformly to span the window; without this the
    // stroke thickens and thins with the slope and reads as broken dashes.
    for (const path of wrapper.findAll('path')) {
      expect(path.attributes('vector-effect')).toBe('non-scaling-stroke');
    }
    for (const tile of wrapper.findAll('.wave__tile')) {
      expect(tile.element.getAttribute('preserveAspectRatio')).toBe('none');
    }
    wrapper.unmount();
  });

  it('runs on nothing: no timer, no listener, no audio', () => {
    // Motion is pure CSS, so unmounting can leave nothing behind by design.
    const wrapper = mountIt();
    expect(wrapper.html()).not.toContain('canvas');
    expect(() => wrapper.unmount()).not.toThrow();
  });
});
