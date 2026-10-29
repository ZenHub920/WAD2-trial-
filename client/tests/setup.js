import { afterEach, vi } from 'vitest';
import { enableAutoUnmount } from '@vue/test-utils';

enableAutoUnmount(afterEach);
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn(query => ({
    media: query, matches: query === '(prefers-reduced-motion: reduce)',
    addEventListener() {}, removeEventListener() {},
  })),
});
Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; });
