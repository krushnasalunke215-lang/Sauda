import { CARRIERS, type CarrierCode } from '../../shared/types.js';

export { CARRIERS, type CarrierCode };

export const isCarrier = (v: unknown): v is CarrierCode => typeof v === 'string' && (CARRIERS as readonly string[]).includes(v);

/** Spoken or written names (Latin and Devanagari) for each carrier, compared without spaces or dots. */
const NAMES: [CarrierCode, string[]][] = [
  ['DHL', ['dhl', 'डीएचएल']],
  ['FEDEX', ['fedex', 'फेडेक्स', 'फ़ेडेक्स']],
  ['UPS', ['ups', 'यूपीएस']],
  ['USPS', ['usps', 'यूएसपीएस']],
  ['IND_DELHIVERY', ['delhivery', 'डेल्हीवरी', 'डेलीवरी', 'डेल्हिवरी']],
  ['IND_BLUEDART', ['bluedart', 'ब्लूडार्ट']],
  ['DTDC_IN', ['dtdc', 'डीटीडीसी']],
];

const squash = (s: string) => s.normalize('NFC').toLowerCase().replace(/[\s.\-_]/g, '');

/** "DHL", "Blue Dart", "डीएचएल" → the PayPal carrier code; anything else → null (the maker picks one). */
export function mapCarrier(spoken: string | null | undefined): CarrierCode | null {
  if (!spoken) return null;
  const s = squash(spoken);
  if (!s) return null;
  for (const [code, names] of NAMES) if (names.includes(s) || squash(code) === s) return code;
  return null;
}

/** Tracking numbers: 4 to 64 letters or digits once spaces and dashes are removed. */
export function normalizeTrackingNumber(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.replace(/[\s-]/g, '').toUpperCase();
  return /^[A-Z0-9]{4,64}$/.test(s) ? s : null;
}
