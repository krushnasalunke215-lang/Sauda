import { describe, expect, it } from 'vitest';
import { invoice, NOW } from '../domain/test-fixtures.js';
import { PayPalClient } from './client.js';
import { confirmedSpikeDeal, fakePayPal, invoiceJson } from './test-fakes.js';
import { addTracking, TrackingError } from './tracking.js';

function setup(paid: { id: string; cents: number; method?: string }[]) {
  const fake = fakePayPal((c) => {
    if (c.method === 'GET' && c.path.startsWith('/v2/invoicing/invoices/')) return { body: invoiceJson({ id: 'INV2-TEST-0000-0000-0001', status: 'PAID', paid }) };
    if (c.path === '/v1/shipping/trackers-batch')
      return { body: { tracker_identifiers: c.body.trackers.map((t: any) => ({ transaction_id: t.transaction_id, tracking_number: t.tracking_number })), errors: [] } };
    if (c.method === 'GET' && c.path.startsWith('/v1/shipping/trackers/')) return { body: { status: 'SHIPPED', carrier: 'DHL' } };
    return undefined;
  });
  const deal = confirmedSpikeDeal();
  deal.invoice = invoice({ status: 'PAID' });
  return { fake, deal, client: new PayPalClient({ clientId: 'x', clientSecret: 'y' }, { fetch: fake.fetch }) };
}

describe('addTracking', () => {
  it('adds the number to the PayPal checkout payments only, then reads each tracker back', async () => {
    const { fake, deal, client } = setup([
      { id: 'FAKECAPTURE0001', cents: 3600 },
      { id: 'EXTR-FAKE0002', cents: 4000, method: 'CASH' },
      { id: 'FAKECAPTURE0003', cents: 4400 },
    ]);
    const r = await addTracking(client, deal, 'DHL', '4567891234', NOW);
    const batch = fake.api().find((c) => c.path === '/v1/shipping/trackers-batch')!;
    expect(batch.headers['PayPal-Request-Id']).toBe('sauda-TESTDEAL-track-4567891234');
    expect(batch.body.trackers).toEqual(
      ['FAKECAPTURE0001', 'FAKECAPTURE0003'].map((transaction_id) => ({
        transaction_id,
        tracking_number: '4567891234',
        status: 'SHIPPED',
        carrier: 'DHL',
        shipment_date: '2026-11-06',
        notify_buyer: false,
      })),
    );
    expect(fake.api().filter((c) => c.path.startsWith('/v1/shipping/trackers/')).map((c) => c.path)).toEqual([
      '/v1/shipping/trackers/FAKECAPTURE0001-4567891234',
      '/v1/shipping/trackers/FAKECAPTURE0003-4567891234',
    ]);
    expect(r).toEqual({
      carrier: 'DHL',
      number: '4567891234',
      transactionIds: ['FAKECAPTURE0001', 'FAKECAPTURE0003'],
      readBack: [
        { transactionId: 'FAKECAPTURE0001', status: 'SHIPPED' },
        { transactionId: 'FAKECAPTURE0003', status: 'SHIPPED' },
      ],
    });
  });

  it('fails with a clear reason when only recorded (non-checkout) payments exist', async () => {
    const { fake, deal, client } = setup([{ id: 'EXTR-FAKE0001', cents: 12000, method: 'CASH' }]);
    const err = await addTracking(client, deal, 'DHL', '4567891234', NOW).catch((e) => e);
    expect(err).toBeInstanceOf(TrackingError);
    expect(err).toMatchObject({ code: 'no_paypal_payments', message: 'no PayPal checkout payments to attach tracking to' });
    expect(fake.api().some((c) => c.method === 'POST')).toBe(false);
  });
});
