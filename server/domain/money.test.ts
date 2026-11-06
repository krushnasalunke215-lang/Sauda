import { describe, expect, it } from 'vitest';
import { balanceCents, depositCents, fmt, formatMoney, toCents } from './money.js';

describe('money', () => {
  it('converts to integer cents and refuses non-finite amounts', () => {
    expect(toCents(120)).toBe(12000);
    expect(toCents(36.5)).toBe(3650);
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(() => toCents(Number.NaN)).toThrow(RangeError);
    expect(() => toCents(Infinity)).toThrow(RangeError);
  });

  it('formats cents with 2 decimals', () => {
    expect(fmt(12000)).toBe('120.00');
    expect(fmt(3605)).toBe('36.05');
    expect(formatMoney(3600, 'USD')).toBe('$36.00');
    expect(formatMoney(3600, 'EUR')).toBe('EUR 36.00');
  });

  it('computes the spike order: USD 120 with 30% → 36.00 / 84.00', () => {
    const dep = depositCents(12000, { percent: 30, cents: null })!;
    expect(dep).toBe(3600);
    expect(balanceCents(12000, dep)).toBe(8400);
  });

  it('rounds a percent deposit and accepts a fixed amount', () => {
    expect(depositCents(9999, { percent: 33, cents: null })).toBe(3300);
    expect(depositCents(12000, { percent: null, cents: 5000 })).toBe(5000);
    expect(depositCents(12000, { percent: null, cents: null })).toBeNull();
  });
});
