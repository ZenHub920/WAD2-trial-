import { afterEach, vi } from 'vitest';
import { enableAutoUnmount } from '@vue/test-utils';

enableAutoUnmount(afterEach);
// Backend tests run in the node environment, where there is no DOM to stub.
if (typeof window !== 'undefined') {
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn(query => ({
    media: query, matches: query === '(prefers-reduced-motion: reduce)',
    addEventListener() {}, removeEventListener() {},
  })),
});
Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
}
afterEach(() => { vi.useRealTimers(); if (typeof document !== 'undefined') document.body.innerHTML = ''; });
