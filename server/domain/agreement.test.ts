import { describe, expect, it } from 'vitest';
import { applyPatch, canonicalHash, derive, dropInvalid, emptyPatch, missingRequired, patchDeal, validate } from './agreement.js';
import { inToCm } from './units.js';
import { NOW, TODAY, invoice, message, spikeDeal } from './test-fixtures.js';

describe('agreement merge', () => {
  it('derives the spike order: USD 120, 30% → 36.00 / 84.00, 44 in = 111.8 cm', () => {
    const deal = spikeDeal();
    expect(derive(deal.terms)).toEqual({ currency: 'USD', totalCents: 12000, depositCents: 3600, balanceCents: 8400, depositPercent: 30 });
    expect(inToCm(deal.terms.measurements[0].value.value)).toBe(111.8);
    expect(missingRequired(deal.terms)).toEqual([]);
    expect(validate(deal.terms, TODAY)).toEqual([]);
  });

  it('cites the message that set each term', () => {
    const deal = spikeDeal();
    for (const f of [deal.terms.item, deal.terms.price, deal.terms.deposit, deal.terms.delivery, deal.terms.color, deal.terms.measurements[0]]) {
      expect(f?.sourceMessageId).toBe('m1');
    }
  });

  it('moves a citation when a later turn changes the term, and keeps it when the value is the same', () => {
    const deal = spikeDeal();
    const m2 = message(deal, 'buyer', 'Can we do 110?');
    patchDeal(deal, { ...emptyPatch(), priceAmount: 110, priceCurrency: 'USD', depositPercent: 30 }, m2.id, NOW, TODAY);
    expect(deal.terms.price).toMatchObject({ value: { cents: 11000 }, sourceMessageId: 'm2' });
    expect(deal.terms.deposit?.sourceMessageId).toBe('m1');
    expect(derive(deal.terms).depositCents).toBe(3300);
  });

  it('upserts measurements by key', () => {
    const deal = spikeDeal();
    const m2 = message(deal, 'buyer', 'Make it 45 inches, chest 38');
    patchDeal(
      deal,
      {
        ...emptyPatch(),
        measurements: [
          { key: 'length', label: { maker: 'लंबाई', buyer: 'Length' }, value: 45, unit: 'in' },
          { key: 'chest', label: { maker: 'छाती', buyer: 'Chest' }, value: 38, unit: 'in' },
        ],
      },
      m2.id,
      NOW,
      TODAY,
    );
    expect(deal.terms.measurements.map((m) => [m.value.key, m.value.value, m.sourceMessageId])).toEqual([
      ['length', 45, 'm2'],
      ['chest', 38, 'm2'],
    ]);
  });

  it('drops impossible values with warnings', () => {
    const { patch, warnings } = dropInvalid(
      {
        ...emptyPatch(),
        priceAmount: -5,
        priceCurrency: 'dollars',
        depositPercent: 130,
        depositAmount: Number.NaN,
        deliveryDateIso: '2026-11-01',
        deliveryDateSpoken: '1 नवंबर',
        quantity: 1.5,
        measurements: [{ key: 'length', label: { maker: 'x', buyer: 'x' }, value: -1, unit: 'in' }],
      },
      TODAY,
    );
    expect(patch).toEqual(emptyPatch());
    expect(warnings.sort()).toEqual(
      ['invalid_currency', 'invalid_deposit_amount', 'invalid_deposit_percent', 'invalid_measurement', 'invalid_price', 'invalid_quantity', 'past_delivery_date'].sort(),
    );
    expect(dropInvalid({ ...emptyPatch(), deliveryDateIso: '2026-02-30' }, TODAY).warnings).toEqual(['invalid_delivery_date']);
    expect(dropInvalid({ ...emptyPatch(), priceCurrency: 'usd' }, TODAY).patch.priceCurrency).toBe('USD');
  });

  it('cuts long free text to 120 characters', () => {
    const { terms } = applyPatch({ measurements: [] }, { ...emptyPatch(), item: { maker: 'क'.repeat(300), buyer: 'a'.repeat(300) } }, 'm1', NOW);
    expect(Array.from(terms.item!.value.maker)).toHaveLength(120);
    expect(terms.item!.value.buyer).toHaveLength(120);
  });

  it('validates currency, deposit and quantity, and lists missing fields', () => {
    const deal = spikeDeal();
    const m2 = message(deal, 'buyer', '...');
    patchDeal(deal, { ...emptyPatch(), priceCurrency: 'EUR', depositAmount: 200, quantity: 0 }, m2.id, NOW, TODAY);
    // A percent deposit wins only while it is the latest deposit term; here the fixed amount replaced it.
    expect(validate(deal.terms, TODAY).map((i) => i.code).sort()).toEqual(['currency_not_usd', 'deposit_exceeds_total', 'quantity_below_one']);
    expect(missingRequired({ measurements: [] })).toEqual(['item', 'price', 'deposit', 'delivery']);
  });

  it('ignores patches once the agreement is locked by an invoice', () => {
    const deal = spikeDeal();
    deal.invoice = invoice();
    const before = canonicalHash(deal);
    const m2 = message(deal, 'buyer', 'Make it 100');
    const r = patchDeal(deal, { ...emptyPatch(), priceAmount: 100 }, m2.id, NOW, TODAY);
    expect(r.warnings).toEqual(['agreement_locked']);
    expect(canonicalHash(deal)).toBe(before);
  });
});

describe('canonicalHash', () => {
  it('is stable, ignores citations and changes with any term', () => {
    const a = spikeDeal();
    const b = spikeDeal();
    b.terms.price!.sourceMessageId = 'm9';
    b.terms.price!.updatedAt = '2030-01-01T00:00:00.000Z';
    expect(canonicalHash(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(canonicalHash(b)).toBe(canonicalHash(a));
    b.terms.color!.value.buyer = 'Mint green';
    expect(canonicalHash(b)).not.toBe(canonicalHash(a));
  });
});
