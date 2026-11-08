import { describe, expect, it } from 'vitest';
import { canonicalHash } from './agreement.js';
import {
  AgreementTooLongError,
  agreementRows,
  buildItemDescription,
  buildItemName,
  buildNote,
  buildReference,
  buildTerms,
  checkTextLimits,
  summaryLines,
} from './agreement-text.js';
import { NOW, spikeDeal } from './test-fixtures.js';

const bytes = (s: string) => Buffer.byteLength(s, 'utf8');

describe('invoice texts', () => {
  it('builds the bilingual note in the "local / english" line format with the full hash', () => {
    const deal = spikeDeal();
    deal.confirmations = { maker: { hash: canonicalHash(deal), at: NOW.toISOString() }, buyer: { hash: canonicalHash(deal), at: NOW.toISOString() } };
    const note = buildNote(deal);
    const lines = note.split('\n');
    expect(lines[0]).toBe('सौदा ऑर्डर समझौता / Sauda order agreement SAUDA-TESTDEAL');
    expect(lines[1]).toBe('कारीगर / Maker: Ravi Chikan (हिंदी)');
    expect(note).toContain('1. सामान / Item: हाथ की कढ़ाई वाला चिकनकारी कुर्ता / Hand-embroidered chikankari kurta');
    expect(note).toContain('लंबाई 44 इंच (111.8 सेमी) / Length 44 in (111.8 cm)');
    expect(note).toContain('कुल कीमत / Total price: $120.00');
    expect(note).toContain('एडवांस / Deposit: 30% = $36.00');
    expect(note).toContain('बाकी रकम / Balance: $84.00');
    expect(note).toContain('December 10, 2026');
    expect(note).toContain('Both sides confirmed in their own language on November 6, 2026');
    expect(lines.at(-1)).toBe(`SHA-256: ${canonicalHash(deal)}`);
    expect(bytes(note)).toBeLessThanOrEqual(4000);
  });

  it('omits the confirmed line until both sides confirm the current hash', () => {
    const deal = spikeDeal();
    deal.confirmations = { maker: { hash: canonicalHash(deal), at: NOW.toISOString() } };
    expect(buildNote(deal)).not.toContain('Both sides confirmed');
  });

  it('builds terms, item name, description and reference within the limits', () => {
    const deal = spikeDeal();
    expect(buildTerms(deal)).toContain('Work starts after the deposit of $36.00 is paid on this invoice.');
    expect(buildItemName(deal)).toBe('हाथ की कढ़ाई वाला चिकनकारी कुर्ता / Hand-embroidered chikankari kurta');
    deal.terms.quantity = { value: 2, sourceMessageId: 'm1', updatedAt: NOW.toISOString() };
    expect(buildItemName(deal)).toMatch(/ × 2$/);
    expect(buildItemDescription(deal)).toBe('मीडियम, लंबाई 44 इंच (111.8 सेमी), हल्का हरा / Medium, Length 44 in (111.8 cm), Light green');
    expect(buildReference(deal)).toMatch(/^SAUDA-TESTDEAL sha256:[0-9a-f]{16}$/);
  });

  it('cuts a long item name to 200 bytes', () => {
    const deal = spikeDeal();
    deal.terms.item!.value = { maker: 'क'.repeat(120), buyer: 'a'.repeat(120) };
    deal.terms.quantity = { value: 3, sourceMessageId: 'm1', updatedAt: NOW.toISOString() };
    const name = buildItemName(deal);
    expect(bytes(name)).toBeLessThanOrEqual(200);
    expect(name).toMatch(/… × 3$/);
  });

  it('rejects a Hindi-heavy note over 4000 bytes before PayPal is called', () => {
    const deal = spikeDeal();
    const long = 'कंधे से कलाई तक की लंबाई'.repeat(5).slice(0, 119);
    deal.terms.measurements = Array.from({ length: 12 }, (_, i) => ({
      value: { key: `m${i}`, label: { maker: long, buyer: `measurement ${i}` }, value: 10 + i, unit: 'in' as const },
      sourceMessageId: 'm1',
      updatedAt: NOW.toISOString(),
    }));
    expect(() => buildNote(deal)).toThrow(AgreementTooLongError);
    expect(checkTextLimits(deal).map((i) => i.params?.field)).toEqual(['note', 'itemDescription']);
  });
});

describe('rows and summary', () => {
  it('formats rows in each viewer language with citations', () => {
    const deal = spikeDeal();
    const en = agreementRows(deal, 'buyer');
    expect(en.find((r) => r.field === 'price')).toEqual({ field: 'price', value: '$120.00', sourceMessageId: 'm1', seq: 1 });
    expect(en.find((r) => r.field === 'deposit')?.value).toBe('30% · $36.00');
    expect(en.find((r) => r.field === 'balance')).toMatchObject({ value: '$84.00', sourceMessageId: null });
    expect(en.find((r) => r.field === 'measurement')).toMatchObject({ label: 'Length', value: '44 in (111.8 cm)' });
    const hi = agreementRows(deal, 'maker');
    expect(hi.find((r) => r.field === 'item')?.value).toBe('हाथ की कढ़ाई वाला चिकनकारी कुर्ता');
    expect(summaryLines(deal, 'en')).toContain('Total price: $120.00');
    expect(summaryLines(deal, 'hi')).toContain('कुल कीमत: $120.00');
  });
});
