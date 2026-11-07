import { loadConfig, paypalConfigured } from '../server/config.js';
import { paypalToday } from '../server/domain/dates.js';
import { fmt } from '../server/domain/money.js';
import { expectOk, PayPalClient } from '../server/paypal/client.js';

let client: PayPalClient | null = null;

/** The same sandbox client and .env the app uses. */
function paypal(): PayPalClient {
  if (client) return client;
  const config = loadConfig();
  if (!paypalConfigured(config)) throw new Error('PayPal sandbox credentials are not set in .env');
  client = new PayPalClient({ clientId: config.paypal.clientId!, clientSecret: config.paypal.clientSecret! });
  return client;
}

/**
 * Records a cash payment on a sandbox invoice (POST /v2/invoicing/invoices/{id}/payments), so
 * repeated runs do not need a buyer to pay through PayPal checkout.
 */
export async function recordPayment(invoiceId: string, cents: number): Promise<string> {
  const r = expectOk(
    await paypal().call('POST', `/v2/invoicing/invoices/${encodeURIComponent(invoiceId)}/payments`, {
      body: { method: 'CASH', payment_date: paypalToday(), amount: { currency_code: 'USD', value: fmt(cents) }, note: 'Sauda e2e: recorded test payment' },
      label: 'record-payment',
    }),
    'record payment',
  );
  return String(r.body?.payment_id ?? '');
}
