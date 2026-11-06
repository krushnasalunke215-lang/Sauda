import { describe, expect, it } from 'vitest';
import { openDb } from '../db.js';
import { DealStore, makeDeal, newDealId, newToken } from './store.js';

const PARTIES = { maker: { name: 'Asha Chikan Studio', lang: 'hi' }, buyer: { name: 'Emily Carter', lang: 'en' } } as const;

function setup() {
  const store = new DealStore(openDb(':memory:'));
  const deal = store.create(makeDeal(PARTIES));
  return { store, deal };
}

describe('ids and tokens', () => {
  it('makes 8-character Crockford ids and 32-character base64url tokens', () => {
    expect(newDealId()).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
    expect(newToken()).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });
});

describe('DealStore', () => {
  it('round-trips a deal', () => {
    const { store, deal } = setup();
    expect(store.get(deal.id)).toEqual(deal);
    expect(store.get('NOPE0000')).toBeNull();
  });

  it('maps each token to its role and rejects a wrong token', () => {
    const { store, deal } = setup();
    expect(store.findByToken(deal.id, deal.tokens.maker)?.role).toBe('maker');
    expect(store.findByToken(deal.id, deal.tokens.buyer)?.role).toBe('buyer');
    expect(store.findByToken(deal.id, newToken())).toBeNull();
    expect(store.findByToken(deal.id, 'short')).toBeNull();
    expect(store.findByToken('NOPE0000', deal.tokens.maker)).toBeNull();
  });

  it('applies two concurrent updates in order', async () => {
    const { store, deal } = setup();
    const seen: number[] = [];
    const a = store.update(deal.id, async (d) => {
      await new Promise((r) => setTimeout(r, 20));
      seen.push(d.nextSeq);
      d.nextSeq += 1;
    });
    const b = store.update(deal.id, (d) => {
      seen.push(d.nextSeq);
      d.nextSeq *= 10;
    });
    await Promise.all([a, b]);
    expect(seen).toEqual([1, 2]);
    expect(store.get(deal.id)?.nextSeq).toBe(20);
  });

  it('does not save a failed update, and later updates still run', async () => {
    const { store, deal } = setup();
    await expect(
      store.update(deal.id, (d) => {
        d.nextSeq = 99;
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    await store.update(deal.id, (d) => {
      d.nextSeq += 1;
    });
    expect(store.get(deal.id)?.nextSeq).toBe(2);
  });

  it('notifies listeners and finds deals by invoice id', async () => {
    const { store, deal } = setup();
    const changes: string[] = [];
    store.onChange((d) => changes.push(d.id));
    await store.update(deal.id, (d) => {
      d.invoice = {
        id: 'INV2-TEST', number: '0001', status: 'UNPAID', payerUrl: 'https://www.sandbox.paypal.com/invoice/p/#INV2-TEST',
        totalCents: 12000, paidCents: 0, dueCents: 12000, depositCents: 3600, transactions: [], noteSha256: '', textMatches: true,
      };
    });
    expect(changes).toEqual([deal.id]);
    expect(store.findByInvoiceId('INV2-TEST')?.id).toBe(deal.id);
    expect(store.listWithOpenInvoices().map((d) => d.id)).toEqual([deal.id]);
    await store.update(deal.id, (d) => {
      d.invoice!.status = 'PAID';
    });
    expect(store.listWithOpenInvoices()).toEqual([]);
  });
});
