import { describe, it, expect, vi } from 'vitest';
import { useSavedListings } from '../../client/src/market.js';

describe('honest browser-saved ticket feedback', () => {
  it('reports a persisted selection only when browser storage accepts it', () => {
    const saved = useSavedListings();
    expect(saved.toggle('persisted-test-ticket')).toEqual({ saved: true, persisted: true });
    expect(JSON.parse(localStorage.getItem('encore-saved-listings'))).toContain('persisted-test-ticket');
    expect(saved.toggle('persisted-test-ticket')).toEqual({ saved: false, persisted: true });
  });
  it('preserves the existing visit-only fallback and exposes its persistence limit', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('storage unavailable'); });
    const saved = useSavedListings();
    expect(saved.toggle('visit-only-test-ticket')).toEqual({ saved: true, persisted: false });
    expect(saved.isSaved('visit-only-test-ticket')).toBe(true);
    expect(saved.toggle('visit-only-test-ticket')).toEqual({ saved: false, persisted: false });
  });
});
