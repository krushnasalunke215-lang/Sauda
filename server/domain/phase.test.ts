import { describe, expect, it } from 'vitest';
import { canonicalHash, emptyPatch, patchDeal } from './agreement.js';
import { derivePhase } from './phase.js';
import { NOW, TODAY, invoice, message, spikeDeal } from './test-fixtures.js';

function confirmedDeal() {
  const deal = spikeDeal();
  const h = canonicalHash(deal);
  deal.confirmations = { maker: { hash: h, at: NOW.toISOString() }, buyer: { hash: h, at: NOW.toISOString() } };
  return deal;
}

describe('derivePhase', () => {
  it('is negotiating until both sides confirm the current hash', () => {
    const deal = spikeDeal();
    expect(derivePhase(deal)).toBe('negotiating');
    deal.confirmations.maker = { hash: canonicalHash(deal), at: NOW.toISOString() };
    expect(derivePhase(deal)).toBe('negotiating');
  });

  it('is confirmed when both hashes match, and a term change invalidates it', () => {
    const deal = confirmedDeal();
    expect(derivePhase(deal)).toBe('confirmed');
    const m = message(deal, 'buyer', 'Actually make it dark green');
    patchDeal(deal, { ...emptyPatch(), color: { maker: 'गहरा हरा', buyer: 'Dark green' } }, m.id, NOW, TODAY);
    expect(derivePhase(deal)).toBe('negotiating');
  });

  it('follows the invoice: invoiced → deposit_paid → paid → shipped', () => {
    const deal = confirmedDeal();
    deal.invoice = invoice();
    expect(derivePhase(deal)).toBe('invoiced');
    deal.invoice = invoice({ status: 'PARTIALLY_PAID', paidCents: 3600, dueCents: 8400 });
    expect(derivePhase(deal)).toBe('deposit_paid');
    deal.invoice = invoice({ status: 'PAID', paidCents: 12000, dueCents: 0 });
    expect(derivePhase(deal)).toBe('paid');
    deal.tracking = { carrier: 'DHL', number: '4567891234', transactionIds: ['X'], at: NOW.toISOString() };
    expect(derivePhase(deal)).toBe('shipped');
  });

  it('jumps from UNPAID straight to PAID when the buyer pays in full', () => {
    const deal = confirmedDeal();
    deal.invoice = invoice();
    expect(derivePhase(deal)).toBe('invoiced');
    deal.invoice = invoice({ status: 'PAID', paidCents: 12000, dueCents: 0 });
    expect(derivePhase(deal)).toBe('paid');
  });

  it('treats a partial payment below the deposit as still invoiced, and CANCELLED as cancelled', () => {
    const deal = confirmedDeal();
    deal.invoice = invoice({ status: 'PARTIALLY_PAID', paidCents: 1000 });
    expect(derivePhase(deal)).toBe('invoiced');
    deal.invoice = invoice({ status: 'CANCELLED' });
    expect(derivePhase(deal)).toBe('cancelled');
  });
});
