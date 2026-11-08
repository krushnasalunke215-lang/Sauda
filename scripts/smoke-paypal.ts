/**
 * Live sandbox smoke test of the invoice path, with the credentials from .env.
 *   npm run smoke:paypal                  create, read back and cancel a test invoice
 *   npm run smoke:paypal -- --keep        leave the invoice UNPAID
 *   npm run smoke:paypal -- --remind      also send a reminder through the Agent Toolkit
 *   npm run smoke:paypal -- --cancel=ID   cancel an invoice kept earlier
 * Prints every PayPal call with its HTTP status and debug ID. Never prints credentials or emails.
 */
import { parseArgs } from 'node:util';
import { loadConfig, paypalConfigured } from '../server/config.js';
import { makeDeal } from '../server/deals/store.js';
import { canonicalHash, emptyPatch, patchDeal } from '../server/domain/agreement.js';
import { todayUtc } from '../server/domain/dates.js';
import { PayPalCallError, PayPalClient, type CallLogEntry } from '../server/paypal/client.js';
import { cancelInvoice, createAndSend, getInvoice, snapshot } from '../server/paypal/invoices.js';
import { errorText } from '../server/paypal/timeline.js';
import { sendReminder } from '../server/paypal/toolkit.js';

const { values } = parseArgs({ options: { keep: { type: 'boolean', default: false }, remind: { type: 'boolean', default: false }, cancel: { type: 'string' } } });

const INVOICING_SCOPE = 'https://uri.paypal.com/services/invoicing';

const config = loadConfig();
if (!paypalConfigured(config)) {
  console.error('PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET, PAYPAL_MERCHANT_EMAIL and PAYPAL_BUYER_EMAIL must be set in .env');
  process.exit(2);
}
const p = config.paypal;
const creds = { clientId: p.clientId!, clientSecret: p.clientSecret! };

const show = (e: CallLogEntry) => {
  const err = errorText(e.error);
  console.log(`  ${e.label}: ${e.method} ${e.path} -> HTTP ${e.status} (debug ${e.debugId ?? 'n/a'}, ${e.ms} ms)${err ? ` ${err}` : ''}`);
};
const client = new PayPalClient(creds, { onCall: (_dealId, e) => show(e) });

/** The spike order (USD 120, 30% deposit), confirmed by both sides, delivered in 30 days. */
function fixtureDeal() {
  const deal = makeDeal({ maker: { name: 'Ravi Chikan Studio', lang: 'hi' }, buyer: { name: 'Emily Carter', lang: 'en' } });
  const now = new Date();
  deal.messages.push({ id: 'm1', seq: 1, from: 'maker', kind: 'text', status: 'done', original: { text: 'smoke test', lang: 'hi' }, createdAt: now.toISOString() });
  deal.nextSeq = 2;
  patchDeal(
    deal,
    {
      ...emptyPatch(),
      item: { maker: 'हाथ की कढ़ाई वाला चिकनकारी कुर्ता', buyer: 'Hand-embroidered chikankari kurta' },
      size: { maker: 'मीडियम', buyer: 'Medium' },
      measurements: [{ key: 'length', label: { maker: 'लंबाई', buyer: 'Length' }, value: 44, unit: 'in' }],
      color: { maker: 'हल्का हरा', buyer: 'Light green' },
      priceAmount: 120,
      priceCurrency: 'USD',
      depositPercent: 30,
      deliveryDateIso: todayUtc(new Date(now.getTime() + 30 * 86_400_000)),
      shippingIncluded: true,
    },
    'm1',
    now,
    todayUtc(now),
  );
  const hash = canonicalHash(deal);
  deal.confirmations = { maker: { hash, at: now.toISOString() }, buyer: { hash, at: now.toISOString() } };
  return deal;
}

async function main(): Promise<boolean> {
  if (values.cancel) {
    console.log(`Cancelling ${values.cancel}`);
    await cancelInvoice(client, values.cancel);
    return true;
  }
  console.log('1. OAuth token (sandbox)');
  const token = await client.token();
  const hasInvoicing = token.scope.split(/\s+/).includes(INVOICING_SCOPE);
  console.log(`  token scopes include Invoicing: ${hasInvoicing}`);
  if (!hasInvoicing) {
    console.error('The app has no Invoicing scope. Enable Invoicing for the REST app in the Developer Dashboard, then revoke the cached token (findings §2) and run again.');
    return false;
  }

  console.log('2. Create and send the deposit invoice from a confirmed fixture deal');
  const deal = fixtureDeal();
  const created = await createAndSend(client, deal, { merchantEmail: p.merchantEmail!, buyerEmail: p.buyerEmail! });
  const host = new URL(created.payerUrl).hostname;
  console.log(`  invoice ${created.invoiceId} (number ${created.number}), status ${created.snapshot.status}`);
  console.log(`  total ${created.snapshot.totalCents / 100}, minimum due (deposit) ${created.snapshot.depositCents / 100}`);
  console.log(`  payer URL host: ${host} (sandbox: ${host.endsWith('.sandbox.paypal.com')})`);

  console.log('3. Read it back and compare the agreement text');
  const back = await getInvoice(client, created.invoiceId, { label: 'get-invoice (check)' });
  const snap = snapshot(back.body, created.snapshot.depositCents, { noteSha256: created.noteSha256, reference: created.reference, payerUrl: created.payerUrl });
  const minDue = back.body?.configuration?.partial_payment?.minimum_amount_due?.value;
  console.log(`  status ${snap.status}, note SHA-256 matches and reference matches: ${snap.textMatches}, partial payment minimum ${minDue}`);
  let ok = snap.status === 'UNPAID' && snap.textMatches && host.endsWith('.sandbox.paypal.com') && minDue === '36.00';

  if (values.remind) {
    console.log('4. Send a reminder through the Agent Toolkit (send_invoice_reminder)');
    deal.invoice = snap;
    const r = await sendReminder(creds, deal, 1);
    console.log(`  reminder ok: ${r.ok}${r.status ? `, HTTP ${r.status}` : ''}, ${r.ms} ms${r.message ? `, ${r.message}` : ''}`);
  }

  if (values.keep) console.log(`Kept ${created.invoiceId} (UNPAID). Cancel it later with: npm run smoke:paypal -- --cancel=${created.invoiceId}`);
  else {
    console.log('5. Cancel the test invoice');
    await cancelInvoice(client, created.invoiceId);
    const after = await getInvoice(client, created.invoiceId, { label: 'get-invoice (after cancel)' });
    console.log(`  status ${after.body?.status}`);
    ok = ok && after.body?.status === 'CANCELLED';
  }
  return ok;
}

main()
  .then((ok) => {
    console.log(ok ? '\nSMOKE OK' : '\nSMOKE FAILED');
    process.exitCode = ok ? 0 : 1;
  })
  .catch((e) => {
    if (e instanceof PayPalCallError) {
      console.error(`FAILED: ${e.what}: HTTP ${e.status} ${e.paypalName} ${e.paypalMessage} (debug ${e.debugId ?? 'n/a'})`);
      if (e.status === 403) console.error('A 403 usually means the Invoicing feature is off for the app, or the cached token predates enabling it: revoke the token and retry.');
    } else console.error(`FAILED: ${e instanceof Error ? e.message : e}`);
    console.log('\nSMOKE FAILED');
    process.exitCode = 1;
  });
