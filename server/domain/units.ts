import type { Lang, Unit } from '../../shared/types.js';

const round1 = (n: number) => Math.round(n * 10) / 10;

export const inToCm = (inches: number): number => round1(inches * 2.54);
export const cmToIn = (cm: number): number => round1(cm / 2.54);

const UNIT_WORDS: Record<Lang, Record<Unit, string>> = {
  en: { in: 'in', cm: 'cm' },
  hi: { in: 'इंच', cm: 'सेमी' },
  es: { in: 'pulg', cm: 'cm' },
};

/** "44 in (111.8 cm)": the stated unit first, then the other one. */
export function formatMeasurement(m: { value: number; unit: Unit }, lang: Lang): string {
  const w = UNIT_WORDS[lang];
  const other: Unit = m.unit === 'in' ? 'cm' : 'in';
  const converted = m.unit === 'in' ? inToCm(m.value) : cmToIn(m.value);
  return `${round1(m.value)} ${w[m.unit]} (${converted} ${w[other]})`;
}
