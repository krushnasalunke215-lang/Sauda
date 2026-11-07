import { describe, expect, it } from 'vitest';
import type { Deal, InvoiceSnapshot, InvoiceTransaction } from '../../shared/types.js';
import { openDb } from '../db.js';
import { DealStore } from '../deals/store.js';
import { derivePhase } from '../domain/phase.js';
import { invoice, NOW } from '../domain/test-fixtures.js';
import { PayPalClient } from './client.js';
import { sha256 } from './invoices.js';
import { applySnapshot, InvoiceSync } from './sync.js';
import { confirmedSpikeDeal, fakePayPal, invoiceJson } from './test-fakes.js';

const txn = (id: string, cents: number, method = 'PAYPAL'): InvoiceTransaction => ({ id, type: method === 'PAYPAL' ? 'PAYPAL' : 'EXTERNAL', method, cents, date: '2026-11-06' });

function invoicedDeal(): Deal {
  const d = confirmedSpikeDeal();
  d.invoice = invoice();
  return d;
}

const events = (d: Deal) => d.messages.filter((m) => m.event).map((m) => m.event!);
const types = (d: Deal) => d.timeline.map((e) => e.type);

const partial = (txns: InvoiceTransaction[], over: Partial<InvoiceSnapshot> = {}) => {
  const paid = txns.reduce((n, t) => n + t.cents, 0);
  return invoice({ status: paid >= 12000 ? 'PAID' : 'PARTIALLY_PAID', paidCents: paid, dueCents: 12000 - paid, transactions: txns, ...over });
};

describe('applySnapshot', () => {
  it('UNPAID → PARTIALLY_PAID records the deposit; → PAID records the balance', () => {
    const d = invoicedDeal();
    expect(applySnapshot(d, partial([txn('CAP1', 3600)]), 'poll', NOW, 'dbg1')).toBe(true);
    expect(events(d).at(-1)).toEqual({ type: 'deposit_received', params: { cents: 3600, amount: '$36.00', due: '$84.00' } });
    expect(d.timeline).toMatchObject([
      { type: 'payment', kind: 'deposit', cents: 3600, txnId: 'CAP1', method: 'PAYPAL' },
      { type: 'poll_change', from: 'UNPAID', to: 'PARTIALLY_PAID', paidCents: 3600, source: 'poll', debugId: 'dbg1' },
    ]);
    expect(derivePhase(d)).toBe('deposit_paid');

    applySnapshot(d, partial([txn('CAP1', 3600), txn('CAP2', 8400)]), 'webhook', NOW);
    expect(events(d).at(-1)).toEqual({ type: 'balance_received', params: { cents: 8400, amount: '$84.00', total: '$120.00' } });
    expect(d.timeline.at(-2)).toMatchObject({ type: 'payment', kind: 'balance', cents: 8400, txnId: 'CAP2' });
    expect(d.timeline.at(-1)).toMatchObject({ type: 'poll_change', from: 'PARTIALLY_PAID', to: 'PAID', source: 'webhook' });
    expect(derivePhase(d)).toBe('paid');
  });

  it('UNPAID → PAID in one payment is paid_in_full, with no deposit event', () => {
    const d = invoicedDeal();
    applySnapshot(d, partial([txn('CAP1', 12000)]), 'poll', NOW);
    expect(events(d).map((e) => e.type)).not.toContain('deposit_received');
    expect(events(d).at(-1)).toEqual({ type: 'paid_in_full', params: { cents: 12000, amount: '$120.00' } });
    expect(d.timeline[0]).toMatchObject({ type: 'payment', kind: 'full', cents: 12000 });
  });

  it('a deposit overpayment is recorded as what was paid (50.00 of 120.00, 70.00 due)', () => {
    const d = invoicedDeal();
    applySnapshot(d, partial([txn('CAP1', 5000)]), 'poll', NOW);
    expect(events(d).at(-1)).toEqual({ type: 'deposit_received', params: { cents: 5000, amount: '$50.00', due: '$70.00' } });
    expect(d.invoice).toMatchObject({ paidCents: 5000, dueCents: 7000 });
    applySnapshot(d, partial([txn('CAP1', 5000), txn('CAP2', 7000)]), 'poll', NOW);
    expect(events(d).at(-1)?.params).toMatchObject({ amount: '$70.00' });
  });

  it('a repeated sync of the same state adds nothing', () => {
    const d = invoicedDeal();
    const s = partial([txn('CAP1', 3600)]);
    applySnapshot(d, s, 'poll', NOW);
    const before = JSON.stringify({ m: d.messages, t: d.timeline });
    expect(applySnapshot(d, structuredClone(s), 'webhook', NOW)).toBe(false);
    expect(applySnapshot(d, structuredClone(s), 'manual', NOW)).toBe(false);
    expect(JSON.stringify({ m: d.messages, t: d.timeline })).toBe(before);
  });

  it('labels recorded payments and still detects the deposit', () => {
    const d = invoicedDeal();
    applySnapshot(d, partial([txn('EXTR-FAKE1', 3600, 'CASH')]), 'poll', NOW);
    expect(d.timeline[0]).toMatchObject({ type: 'payment', kind: 'deposit', method: 'CASH' });
    expect(events(d).at(-1)?.type).toBe('deposit_received');
  });

  it('CANCELLED posts invoice_cancelled once', () => {
    const d = invoicedDeal();
    applySnapshot(d, invoice({ status: 'CANCELLED' }), 'webhook', NOW);
    applySnapshot(d, invoice({ status: 'CANCELLED' }), 'poll', NOW);
    expect(events(d).filter((e) => e.type === 'invoice_cancelled')).toHaveLength(1);
    expect(derivePhase(d)).toBe('cancelled');
  });

  it('raises the text alert once when the note on PayPal stops matching', () => {
    const d = invoicedDeal();
    applySnapshot(d, partial([txn('CAP1', 3600)]), 'poll', NOW);
    const edited = partial([txn('CAP1', 3600)], { textMatches: false, noteSha256: 'ab'.repeat(32) });
    expect(applySnapshot(d, edited, 'webhook', NOW)).toBe(true);
    applySnapshot(d, structuredClone(edited), 'poll', NOW);
    expect(d.timeline.filter((e) => e.type === 'alert')).toEqual([expect.objectContaining({ code: 'invoice_text_changed' })]);
    expect(events(d).filter((e) => e.type === 'invoice_text_changed')).toHaveLength(1);
    // The status did not change, so only the first sync recorded a status change.
    expect(types(d).filter((x) => x === 'poll_change')).toHaveLength(1);
  });
});

describe('InvoiceSync', () => {
  it('re-reads the invoice, applies changes once, and keeps polling reads off the timeline', async () => {
    const store = new DealStore(openDb(':memory:'));
    const deal = invoicedDeal();
    deal.invoice = invoice({ noteSha256: sha256('agreed') });
    deal.invoiceText = { noteSha256: sha256('agreed'), reference: 'SAUDA-TESTDEAL sha256:0000000000000000' };
    store.create(deal);
    let paid: { id: string; cents: number }[] = [];
    const fake = fakePayPal((c) => (c.method === 'GET' ? { body: invoiceJson({ id: deal.invoice!.id, status: paid.length ? 'PARTIALLY_PAID' : 'UNPAID', paid, note: 'agreed' }) } : undefined));
    const timelineCalls: string[] = [];
    const client = new PayPalClient({ clientId: 'x', clientSecret: 'y' }, { fetch: fake.fetch, onCall: (_id, e) => void (!e.quiet && timelineCalls.push(e.label)) });
    const sync = new InvoiceSync({ store, client, now: () => NOW });

    expect(await sync.syncInvoice(deal.id, 'poll')).toBe(false);
    paid = [{ id: 'FAKECAP1', cents: 3600 }];
    expect(await sync.syncInvoice(deal.id, 'poll')).toBe(true);
    expect(await sync.syncInvoice(deal.id, 'poll')).toBe(false);
    const d = store.get(deal.id)!;
    expect(d.invoice).toMatchObject({ status: 'PARTIALLY_PAID', paidCents: 3600, textMatches: true });
    expect(d.messages.filter((m) => m.event?.type === 'deposit_received')).toHaveLength(1);
    expect(timelineCalls).toEqual([]);

    await sync.syncInvoice(deal.id, 'manual');
    expect(timelineCalls).toEqual(['get-invoice (manual)']);
  });

  it('limits the buyer\'s manual check to once per 5 s per deal', async () => {
    const store = new DealStore(openDb(':memory:'));
    const deal = invoicedDeal();
    store.create(deal);
    const fake = fakePayPal((c) => (c.method === 'GET' ? { body: invoiceJson({ id: deal.invoice!.id }) } : undefined));
    let t = NOW.getTime();
    const sync = new InvoiceSync({ store, client: new PayPalClient({ clientId: 'x', clientSecret: 'y' }, { fetch: fake.fetch }), now: () => new Date(t) });
    await sync.refresh(deal.id);
    await expect(sync.refresh(deal.id)).rejects.toMatchObject({ status: 429, code: 'too_soon' });
    t += 5000;
    await sync.refresh(deal.id);
    await sync.whenIdle();
    expect(fake.api()).toHaveLength(2);
  });
});
