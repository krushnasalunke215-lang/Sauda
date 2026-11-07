import { describe, expect, it } from 'vitest';
import { mapCarrier, normalizeTrackingNumber } from './carriers.js';

describe('mapCarrier', () => {
  it.each([
    ['dhl', 'DHL'],
    ['DHL Express'.slice(0, 3), 'DHL'],
    ['डीएचएल', 'DHL'],
    ['FedEx', 'FEDEX'],
    ['UPS', 'UPS'],
    ['usps', 'USPS'],
    ['Delhivery', 'IND_DELHIVERY'],
    ['डेल्हीवरी', 'IND_DELHIVERY'],
    ['Blue Dart', 'IND_BLUEDART'],
    ['bluedart', 'IND_BLUEDART'],
    ['ब्लू डार्ट', 'IND_BLUEDART'],
    ['DTDC', 'DTDC_IN'],
    ['डीटीडीसी', 'DTDC_IN'],
  ])('%s → %s', (spoken, code) => {
    expect(mapCarrier(spoken)).toBe(code);
  });

  it('returns null for anything else, so the maker picks from the list', () => {
    for (const s of ['India Post', 'speedpost', '', '   ', null, undefined]) expect(mapCarrier(s)).toBeNull();
  });
});

describe('normalizeTrackingNumber', () => {
  it('removes spaces and dashes and checks the length', () => {
    expect(normalizeTrackingNumber('4567 891-234')).toBe('4567891234');
    expect(normalizeTrackingNumber('sauda0001')).toBe('SAUDA0001');
    expect(normalizeTrackingNumber('12')).toBeNull();
    expect(normalizeTrackingNumber('abc/def')).toBeNull();
    expect(normalizeTrackingNumber(42)).toBeNull();
  });
});
