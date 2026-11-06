import { describe, expect, it } from 'vitest';
import { cmToIn, formatMeasurement, inToCm } from './units.js';

describe('units', () => {
  it('converts inches and centimetres to 1 decimal', () => {
    expect(inToCm(44)).toBe(111.8);
    expect(cmToIn(111.8)).toBe(44);
    expect(cmToIn(100)).toBe(39.4);
  });

  it('shows both units in the viewer language', () => {
    expect(formatMeasurement({ value: 44, unit: 'in' }, 'en')).toBe('44 in (111.8 cm)');
    expect(formatMeasurement({ value: 44, unit: 'in' }, 'hi')).toBe('44 इंच (111.8 सेमी)');
    expect(formatMeasurement({ value: 100, unit: 'cm' }, 'es')).toBe('100 cm (39.4 pulg)');
  });
});
