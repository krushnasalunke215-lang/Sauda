import { describe, expect, it } from 'vitest';
import { LANGS, type Lang } from '../../shared/types.js';
import { makeDeal } from '../deals/store.js';
import { canonicalHash, emptyPatch, patchDeal } from './agreement.js';
import {
  AgreementTooLongError,
  agreementRows,
  buildItemDescription,
  buildItemName,
  buildNote,
  buildReference,
  buildTerms,
  checkTextLimits,
  LIMITS,
  summaryLines,
} from './agreement-text.js';
import { NOW, spikeDeal, TODAY } from './test-fixtures.js';

const bytes = (s: string) => Buffer.byteLength(s, 'utf8');

const MEASUREMENT_KEYS = ['length', 'chest', 'waist', 'shoulder', 'sleeve', 'hip'];

/** A long, realistic order in every language (fr, pt, de, ja drafted by scripts/translate-strings.ts). */
const LONG_ORDER: Record<Lang, { item: string; size: string; color: string; measurements: string[] }> = {
  hi: {
    item: 'हाथ की कढ़ाई वाला चिकनकारी कुर्ता, शीशे के काम, स्कैलप्ड किनारी और मैचिंग सूती अस्तर के साथ',
    size: 'मीडियम, नाप से सिला हुआ',
    color: 'हल्का पिस्ता हरा, हाथीदांत रंग के धागे के साथ',
    measurements: ['लंबाई', 'छाती', 'कमर', 'कंधे की चौड़ाई', 'आस्तीन की लंबाई', 'कूल्हा'],
  },
  en: {
    item: 'Hand-embroidered chikankari kurta with mirror work, scalloped hem and a matching cotton lining',
    size: 'Medium, custom fitted',
    color: 'Light pista green with ivory thread',
    measurements: ['Length', 'Chest', 'Waist', 'Shoulder width', 'Sleeve length', 'Hip'],
  },
  es: {
    item: 'Kurta chikankari bordada a mano con espejitos, dobladillo festoneado y forro de algodón a juego',
    size: 'Mediana, a medida',
    color: 'Verde pistacho claro con hilo marfil',
    measurements: ['Largo', 'Pecho', 'Cintura', 'Ancho de hombros', 'Largo de manga', 'Cadera'],
  },
  fr: {
    item: 'Kurta chikankari brodé à la main avec incrustations de miroirs, ourlet festonné et doublure en coton assortie',
    size: 'M, confectionné sur mesure',
    color: 'Vert pistache clair avec fil ivoire',
    measurements: ['Longueur', 'Tour de poitrine', 'Tour de taille', "Largeur d'épaules", 'Longueur des manches', 'Tour de hanches'],
  },
  pt: {
    item: 'Kurta chikankari bordada à mão com apliques de espelho, barra ondulada e forro de algodão combinando',
    size: 'Médio, sob medida',
    color: 'Verde-pistache claro com linha marfim',
    measurements: ['Comprimento', 'Busto/Tórax', 'Cintura', 'Largura dos ombros', 'Comprimento da manga', 'Quadril'],
  },
  de: {
    item: 'Handgestickte Chikankari-Kurta mit Spiegelarbeiten, Bogenkante und passendem Baumwollfutter',
    size: 'Medium, maßgeschneidert',
    color: 'Helles Pistaziengrün mit elfenbeinfarbenem Garn',
    measurements: ['Länge', 'Brust', 'Taille', 'Schulterbreite', 'Ärmellänge', 'Hüfte'],
  },
  ja: {
    item: '手刺繍のチカンカリ・クルタ（ミラーワーク、スカラップヘム、同色のコットン裏地付き）',
    size: 'M（カスタムフィット）',
    color: 'ライトピスタグリーン（アイボリーの糸）',
    measurements: ['着丈', '身幅', 'ウエスト', '肩幅', '袖丈', 'ヒップ'],
  },
};

/** Every term set, six measurements, both sides confirmed: the longest invoice text a real order produces. */
function longDeal(maker: Lang, buyer: Lang) {
  const deal = makeDeal({ maker: { name: 'Ravi Chikan', lang: maker }, buyer: { name: 'Emily Carter', lang: buyer } }, NOW);
  deal.id = 'TESTDEAL';
  const m = LONG_ORDER[maker];
  const b = LONG_ORDER[buyer];
  patchDeal(
    deal,
    {
      ...emptyPatch(),
      item: { maker: m.item, buyer: b.item },
      quantity: 2,
      size: { maker: m.size, buyer: b.size },
      color: { maker: m.color, buyer: b.color },
      measurements: MEASUREMENT_KEYS.map((key, i) => ({ key, label: { maker: m.measurements[i]!, buyer: b.measurements[i]! }, value: 20 + i * 4.5, unit: 'in' as const })),
      priceAmount: 1240.5,
      priceCurrency: 'USD',
      depositPercent: 30,
      deliveryDateIso: '2026-12-10',
      deliveryDateSpoken: '10 December',
      shippingIncluded: true,
    },
    'm1',
    NOW,
    TODAY,
  );
  const hash = canonicalHash(deal);
  deal.confirmations = { maker: { hash, at: NOW.toISOString() }, buyer: { hash, at: NOW.toISOString() } };
  return deal;
}

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

  it('fits PayPal byte limits for every ordered pair of languages with a long, realistic order', () => {
    let largest = { pair: '', bytes: 0 };
    for (const maker of LANGS) {
      for (const buyer of LANGS) {
        if (maker === buyer) continue;
        const deal = longDeal(maker, buyer);
        const pair = `${maker} maker, ${buyer} buyer`;
        expect(checkTextLimits(deal), pair).toEqual([]);
        const note = buildNote(deal);
        expect(note, pair).toContain('SHA-256:');
        expect(bytes(note), pair).toBeLessThanOrEqual(LIMITS.note);
        expect(bytes(buildTerms(deal)), pair).toBeLessThanOrEqual(LIMITS.terms);
        expect(bytes(buildItemDescription(deal)), pair).toBeLessThanOrEqual(LIMITS.itemDescription);
        expect(bytes(buildItemName(deal)), pair).toBeLessThanOrEqual(LIMITS.itemName);
        expect(bytes(buildReference(deal)), pair).toBeLessThanOrEqual(LIMITS.reference);
        if (bytes(note) > largest.bytes) largest = { pair, bytes: bytes(note) };
      }
    }
    console.log(`largest invoice note: ${largest.bytes} of ${LIMITS.note} bytes (${largest.pair})`);
  });

  it('writes the new languages into the note with their own labels and dates', () => {
    const note = buildNote(longDeal('ja', 'fr'));
    expect(note.split('\n')[0]).toBe('Sauda 注文合意書 / Accord de commande Sauda SAUDA-TESTDEAL');
    expect(note).toContain('作り手 / Artisan: Ravi Chikan (日本語)');
    expect(note).toContain('2026年12月10日');
    expect(note).toContain('10 décembre 2026');
    expect(note).toContain('インチ');
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
