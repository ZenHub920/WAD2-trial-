import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SECTION_SUGGESTIONS, formatDateTime, formatMoney, formatRelative, hueFor,
  listingTitle, priceParts, sectionLabel, useSavedListings,
} from '../../client/src/market.js';

// formatMoney(cents) turns a price stored in cents into Singapore-dollar text.
// Prices are stored as whole cents to avoid floating-point rounding errors.
describe('TestSuite: formatMoney', () => {
  // Normal case: a whole-dollar amount still shows ".00".
  it('Test1: formats whole dollars with two decimal places', () => {
    expect(formatMoney(31000)).toBe('$310.00');
  });
  // Normal case: the last two digits become the cents.
  it('Test2: formats cents', () => {
    expect(formatMoney(12345)).toBe('$123.45');
  });
  // Option: { withCode: true } is used on order summaries to make the currency explicit.
  it('Test3: prefixes the currency code when asked', () => {
    expect(formatMoney(31000, { withCode: true })).toBe('SGD $310.00');
  });
  // Edge cases: zero (sellers may give tickets away) and a large number,
  // which should get thousands separators.
  it('Test4: formats zero (a free ticket) and large amounts', () => {
    expect(formatMoney(0)).toBe('$0.00');
    expect(formatMoney(123456789)).toBe('$1,234,567.89');
  });
});

// priceParts(cents) splits a price into pieces so the listing card can style the
// "$", the dollars and the cents separately. It returns an object, so toEqual().
describe('TestSuite: priceParts', () => {
  // Whole-dollar prices are shown without ".00" on the big price display.
  it('Test1: drops the fraction for a whole-dollar price', () => {
    expect(priceParts(31000)).toEqual({ symbol: '$', whole: '310', fraction: '' });
  });
  // Prices with cents keep their fraction, including a trailing zero (".50").
  it('Test2: keeps the fraction when the price has cents', () => {
    expect(priceParts(12050)).toEqual({ symbol: '$', whole: '120', fraction: '.50' });
  });
  // The comma separator must stay in the whole-dollar part.
  it('Test3: keeps thousands separators in the whole part', () => {
    expect(priceParts(1234500).whole).toBe('12,345');
  });
});

// sectionLabel() shows a seating section; listingTitle() builds the card heading.
describe('TestSuite: sectionLabel and listingTitle', () => {
  // New listings store whatever the seller typed, so it is shown unchanged.
  it('Test1: free-text sections are shown as typed', () => {
    expect(sectionLabel('Cat 3')).toBe('Cat 3');
  });
  // Older listings stored internal keys such as "ga_standing"; these must
  // still be shown as readable labels (regression protection for old data).
  it('Test2: older matching-section keys are translated to labels', () => {
    expect(sectionLabel('ga_standing')).toBe('General admission standing');
    expect(sectionLabel('pit')).toBe('Pit');
  });
  // The title is "<artist>, <section label>", combining both helpers.
  it('Test3: a listing title combines artist and section', () => {
    const listing = { concert: { artist: 'Taylor Swift' }, section: 'lower_bowl' };
    expect(listingTitle(listing)).toBe('Taylor Swift, Lower bowl');
  });
  // The form's suggestion list: checks its size, that it contains a common
  // category (toContain) and that old internal keys are not offered (.not).
  it('Test4: the section suggestions offer the common categories', () => {
    expect(SECTION_SUGGESTIONS).toHaveLength(10);
    expect(SECTION_SUGGESTIONS).toContain('VIP');
    expect(SECTION_SUGGESTIONS).not.toContain('pit');
  });
});

// formatRelative(time, now) gives "11 minutes ago"-style text.
// A fixed `now` is passed in so the results never depend on when the test runs.
describe('TestSuite: formatRelative', () => {
  // SQLite stores UTC without a zone marker, e.g. "2026-01-01 10:00:00".
  const now = Date.parse('2026-01-01T10:00:00Z');
  // If the database time were wrongly read as local time, this would be off by hours.
  it('Test1: reads database time as UTC and reports minutes', () => {
    expect(formatRelative('2026-01-01 09:49:00', now)).toBe('11 minutes ago');
  });
  // Larger units: exactly one hour, and exactly one day ("yesterday").
  it('Test2: reports hours and days', () => {
    expect(formatRelative('2026-01-01 09:00:00', now)).toBe('1 hour ago');
    expect(formatRelative('2025-12-31 10:00:00', now)).toBe('yesterday');
  });
  // Boundary: below 60 seconds there is no "0 minutes ago".
  it('Test3: anything under a minute is "just now"', () => {
    expect(formatRelative('2026-01-01 09:59:30', now)).toBe('just now');
  });
  // The function should also accept ISO times (with a "T" and "Z").
  it('Test4: also accepts ISO timestamps', () => {
    expect(formatRelative('2026-01-01T07:00:00Z', now)).toBe('3 hours ago');
  });
  // Invalid inputs must not crash or show "Invalid Date"; '' is falsy.
  it('Test5: missing or invalid values give an empty string', () => {
    expect(formatRelative(null, now)).toBe('');
    expect(formatRelative('', now)).toBeFalsy();
    expect(formatRelative('not a date', now)).toBe('');
  });
});

// formatDateTime() shows a full date and time, e.g. on order pages.
describe('TestSuite: formatDateTime', () => {
  // toContain() checks the important parts only, so the test does not
  // break if the exact punctuation of the browser's date format changes.
  it('Test1: formats a valid time with year and minutes', () => {
    const text = formatDateTime('2026-03-14 12:05:00');
    expect(text).toContain('2026');
    expect(text).toContain('Mar');
    expect(text).toContain('05');
  });
  // Invalid or missing values give an empty string instead of "Invalid Date".
  it('Test2: an invalid time gives an empty string', () => {
    expect(formatDateTime('nonsense')).toBe('');
    expect(formatDateTime(undefined)).toBe('');
  });
});

// hueFor(id) picks a colour (0–359 degrees) for generated posters and avatars,
// so the same concert always gets the same colour.
describe('TestSuite: hueFor', () => {
  // Deterministic: calling it twice with the same id gives the same answer.
  it('Test1: the same id always gets the same colour', () => {
    expect(hueFor('concert_42')).toBe(hueFor('concert_42'));
  });
  // Range check, including a very long id that could overflow a naive hash.
  it('Test2: the hue is a valid degree between 0 and 359', () => {
    for (const id of ['a', 'concert_1', 'x'.repeat(500)]) {
      const hue = hueFor(id);
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThan(360);
    }
  });
  // Different concerts look different; empty or missing ids fall back to 0.
  it('Test3: different ids usually differ; an empty id is 0', () => {
    expect(hueFor('concert_1')).not.toBe(hueFor('concert_2'));
    expect(hueFor('')).toBe(0);
    expect(hueFor()).toBe(0);
  });
});

// useSavedListings() lets a visitor bookmark listings in this browser (localStorage).
describe('TestSuite: useSavedListings', () => {
  const { isSaved, toggle } = useSavedListings();
  beforeEach(() => {
    // Saved state is shared module-wide, so start each case with nothing saved.
    // Without this, one test's saved listing would leak into the next test.
    for (const id of ['t1', 't2']) if (isSaved(id)) toggle(id);
  });
  // Saving changes the in-memory state AND writes it to localStorage,
  // so the bookmark survives a page refresh.
  it('Test1: toggling saves a listing and persists it in this browser', () => {
    toggle('t1');
    expect(isSaved('t1')).toBe(true);
    expect(isSaved('t2')).toBe(false);
    expect(JSON.parse(localStorage.getItem('encore-saved-listings'))).toContain('t1');
  });
  // Toggling twice returns to the starting state, and storage is emptied too.
  it('Test2: toggling again un-saves it', () => {
    toggle('t1');
    toggle('t1');
    expect(isSaved('t1')).toBeFalsy();
    expect(JSON.parse(localStorage.getItem('encore-saved-listings'))).toEqual([]);
  });
  // Two separate callers (e.g. two cards on one page) see the same saved list.
  it('Test3: every caller shares one saved list', () => {
    useSavedListings().toggle('t2');
    expect(isSaved('t2')).toBeTruthy();
  });
  // vi.spyOn(...).mockImplementation() makes localStorage throw, as it can in
  // private browsing. Saving must still work for the current visit.
  it('Test4: still works for this visit when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('private mode'); });
    expect(() => toggle('t1')).not.toThrow();
    expect(isSaved('t1')).toBe(true);
  });
});
