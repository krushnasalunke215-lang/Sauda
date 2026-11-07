import { describe, expect, it } from 'vitest';
import { formatDate, isNotPast, isValidIsoDate, paypalToday, todayUtc } from './dates.js';

describe('dates', () => {
  it('gives today in UTC', () => {
    expect(todayUtc(new Date('2026-11-06T20:30:00Z'))).toBe('2026-11-06');
  });

  it("gives today in PayPal's US Pacific time, which can be a day behind UTC", () => {
    // 09:10 IST on Nov 7 is 03:40 UTC on Nov 7 but still Nov 6 in California.
    expect(paypalToday(new Date('2026-11-07T03:40:00Z'))).toBe('2026-11-06');
    expect(paypalToday(new Date('2026-11-06T13:00:00Z'))).toBe('2026-11-06');
  });

  it('accepts only real calendar dates', () => {
    expect(isValidIsoDate('2026-12-10')).toBe(true);
    expect(isValidIsoDate('2028-02-29')).toBe(true);
    expect(isValidIsoDate('2026-02-29')).toBe(false);
    expect(isValidIsoDate('2026-13-01')).toBe(false);
    expect(isValidIsoDate('10 Dec 2026')).toBe(false);
  });

  it('checks dates against today', () => {
    expect(isNotPast('2026-12-10', '2026-11-06')).toBe(true);
    expect(isNotPast('2026-11-06', '2026-11-06')).toBe(true);
    expect(isNotPast('2026-11-05', '2026-11-06')).toBe(false);
  });

  it('formats in each language', () => {
    expect(formatDate('2026-12-10', 'en')).toBe('December 10, 2026');
    expect(formatDate('2026-12-10', 'hi')).toContain('दिसंबर');
    expect(formatDate('2026-12-10', 'es')).toContain('diciembre');
  });
});
