import type { Deal } from '../../shared/types.js';
import type { TrackingResult } from '../agent/proposals.js';
import { paypalToday } from '../domain/dates.js';
import { expectOk, type PayPalClient } from './client.js';
import { getInvoice } from './invoices.js';

/** Tracking cannot be added (for example there is no PayPal checkout payment to attach it to). */
export class TrackingError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'TrackingError';
  }
}

/**
 * Adds the same tracking number to every PayPal checkout payment of the deal's invoice with
 * trackers-batch, then reads each tracker back. Recorded (cash) payments have no PayPal
 * transaction, so they cannot carry tracking.
 */
export async function addTracking(client: PayPalClient, deal: Deal, carrier: string, number: string, now: Date = new Date()): Promise<TrackingResult> {
  if (!deal.invoice) throw new TrackingError('no_invoice', 'there is no invoice');
  const dealId = deal.id;
  const inv = expectOk(await getInvoice(client, deal.invoice.id, { dealId, label: 'get-invoice-for-tracking' }), 'get invoice');
  const txns: string[] = (inv.body?.payments?.transactions ?? [])
    .filter((t: any) => t?.method === 'PAYPAL' && typeof t.payment_id === 'string')
    .map((t: any) => t.payment_id);
  if (txns.length === 0) throw new TrackingError('no_paypal_payments', 'no PayPal checkout payments to attach tracking to');

  const trackers = txns.map((transaction_id) => ({
    transaction_id,
    tracking_number: number,
    status: 'SHIPPED',
    carrier,
    shipment_date: paypalToday(now),
    notify_buyer: false,
  }));
  const batch = expectOk(
    await client.call('POST', '/v1/shipping/trackers-batch', { body: { trackers }, requestId: `sauda-${deal.id}-track-${number}`, label: 'trackers-batch', dealId }),
    'add tracking',
  );
  const errors: any[] = Array.isArray(batch.body?.errors) ? batch.body.errors : [];
  const added: string[] = (batch.body?.tracker_identifiers ?? []).map((t: any) => t?.transaction_id).filter((x: unknown) => typeof x === 'string');
  if (added.length === 0) {
    const first = errors[0];
    throw new TrackingError('tracking_rejected', String(first?.message ?? first?.name ?? 'PayPal added no trackers').slice(0, 200));
  }

  const readBack: TrackingResult['readBack'] = [];
  for (const transactionId of added) {
    const r = await client.call('GET', `/v1/shipping/trackers/${encodeURIComponent(`${transactionId}-${number}`)}`, { label: 'get-tracker', dealId });
    readBack.push({ transactionId, status: r.ok && typeof r.body?.status === 'string' ? r.body.status : null });
  }
  return { carrier, number, transactionIds: added, readBack };
}
