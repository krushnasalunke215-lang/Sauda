/**
 * Manage the app's PayPal sandbox webhooks (the server finds or creates its own at boot).
 *   npm run webhooks -- list
 *   npm run webhooks -- delete <webhookId>
 *   npm run webhooks -- simulate <webhookId> [EVENT_TYPE]   (default INVOICING.INVOICE.PAID)
 */
import { loadConfig, paypalConfigured } from '../server/config.js';
import { line, PayPalClient } from '../server/paypal/client.js';

const [cmd, arg, eventType] = process.argv.slice(2);
const config = loadConfig();
if (!paypalConfigured(config)) {
  console.error('PayPal sandbox credentials are not set in .env');
  process.exit(2);
}
const client = new PayPalClient({ clientId: config.paypal.clientId!, clientSecret: config.paypal.clientSecret! });

async function main(): Promise<boolean> {
  if (cmd === 'list') {
    const r = await client.call('GET', '/v1/notifications/webhooks', { label: 'list-webhooks' });
    console.log(line(r));
    for (const w of r.body?.webhooks ?? []) console.log(`${w.id} ${w.url} [${(w.event_types ?? []).map((e: any) => e.name).join(', ')}]`);
    return r.ok;
  }
  if (cmd === 'delete' && arg) {
    const r = await client.call('DELETE', `/v1/notifications/webhooks/${encodeURIComponent(arg)}`, { label: 'delete-webhook' });
    console.log(line(r));
    return r.ok;
  }
  if (cmd === 'simulate' && arg) {
    // Invoicing sample events fail with "Not a valid Resource Type" when resource_version is set, so it is omitted.
    const r = await client.call('POST', '/v1/notifications/simulate-event', {
      body: { webhook_id: arg, event_type: eventType ?? 'INVOICING.INVOICE.PAID' },
      label: 'simulate-event',
    });
    console.log(line(r), r.body?.id ?? '');
    return r.ok;
  }
  console.error('Usage: npm run webhooks -- list | delete <webhookId> | simulate <webhookId> [EVENT_TYPE]');
  return false;
}

main()
  .then((ok) => {
    process.exitCode = ok ? 0 : 1;
  })
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  });
