import { afterEach, describe, expect, it } from 'vitest';
import type { DealView } from '../../shared/types.js';
import { invoice } from '../domain/test-fixtures.js';
import { authed, testApp, type TestApp } from '../routes/test-helpers.js';
import { PayPalClient } from './client.js';
import { fakePayPal, invoiceJson, type FakeCall } from './test-fakes.js';
import { WEBHOOK_EVENT_TYPES, WEBHOOK_PATH, WebhookManager } from './webhooks.js';

const INVOICE_ID = 'INV2-TEST-0000-0000-0001';
const HEADERS = {
  'paypal-auth-algo': 'SHA256withRSA',
  'paypal-cert-url': 'https://api.sandbox.paypal.com/v1/notifications/certs/CERT-FAKE',
  'paypal-transmission-id': 'fake-transmission-1',
  'paypal-transmission-sig': 'fake-signature',
  'paypal-transmission-time': '2026-11-06T13:16:27Z',
};

/** A synthetic INVOICING.INVOICE.PAID delivery (no real ids or emails). */
const paidEvent = (id: string, invoiceId = INVOICE_ID, status = 'PARTIALLY_PAID') => ({
  id,
  event_type: 'INVOICING.INVOICE.PAID',
  resource_type: 'invoices',
  summary: 'An invoice was paid',
  resource: { invoice: { id: invoiceId, status, payments: { paid_amount: { currency_code: 'USD', value: '999.00' } } } },
});

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

async function setup(verified: boolean) {
  const fake = fakePayPal((c: FakeCall) => {
    if (c.path === '/v1/notifications/verify-webhook-signature') return { body: { verification_status: verified ? 'SUCCESS' : 'FAILURE' } };
    if (c.method === 'GET' && c.path === `/v2/invoicing/invoices/${INVOICE_ID}`)
      return { body: invoiceJson({ id: INVOICE_ID, status: 'PARTIALLY_PAID', paid: [{ id: 'FAKECAP1', cents: 3600 }] }) };
    return undefined;
  });
  t = await testApp({ paypal: { fetch: fake.fetch }, env: { PAYPAL_WEBHOOK_ID: 'WH-FAKE-0001' } });
  await t.store.update(t.deal.id, (d) => {
    d.invoice = invoice();
  });
  return { a: t, fake, gets: () => fake.api().filter((c) => c.method === 'GET').length };
}

const deliver = (a: TestApp, event: object, headers: Record<string, string> = HEADERS) =>
  a.app.inject({ method: 'POST', url: WEBHOOK_PATH, headers: { 'content-type': 'application/json', ...headers }, payload: event });

describe('POST /api/paypal/webhook', () => {
  it('rejects a delivery whose signature PayPal does not verify, without syncing', async () => {
    const { a, fake, gets } = await setup(false);
    const res = await deliver(a, paidEvent('WH-FAKE-EVENT-1'));
    expect(res.statusCode).toBe(400);
    await a.idle();
    expect(gets()).toBe(0);
    const verify = fake.api().find((c) => c.path === '/v1/notifications/verify-webhook-signature')!;
    expect(verify.body).toMatchObject({ ...Object.fromEntries(Object.entries(HEADERS).map(([k, v]) => [k.replace('paypal-', '').replaceAll('-', '_'), v])), webhook_id: 'WH-FAKE-0001' });
    expect(verify.body.webhook_event.id).toBe('WH-FAKE-EVENT-1');
    expect(verify.headers['PayPal-Request-Id']).toBeTruthy();
  });

  it('verifies, records the webhook, replies 200 and re-reads the invoice instead of trusting the event', async () => {
    const { a, gets } = await setup(true);
    const res = await deliver(a, paidEvent('WH-FAKE-EVENT-2'));
    expect(res.statusCode).toBe(200);
    await a.idle();
    expect(gets()).toBe(1);
    const v = (await a.app.inject({ method: 'GET', url: `/api/deals/${a.deal.id}`, headers: authed(a.deal.buyer.token) })).json() as DealView;
    expect(v.timeline[0]).toMatchObject({ type: 'webhook', eventId: 'WH-FAKE-EVENT-2', eventType: 'INVOICING.INVOICE.PAID', verified: true, invoiceStatus: 'PARTIALLY_PAID' });
    // The amounts come from the GET (36.00), not from the event body (999.00).
    expect(v.invoice).toMatchObject({ status: 'PARTIALLY_PAID', paidCents: 3600 });
    expect(v.messages.at(-1)?.event).toMatchObject({ type: 'deposit_received', params: { amount: '$36.00' } });
    expect(v.timeline.some((e) => e.type === 'poll_change' && e.source === 'webhook')).toBe(true);
    const health = (await a.app.inject({ method: 'GET', url: '/healthz' })).json() as { webhook: { configured: boolean; lastVerifiedAt: string | null } };
    expect(health.webhook.configured).toBe(true);
    expect(health.webhook.lastVerifiedAt).toMatch(/^\d{4}-/);
  });

  it('a redelivered event id is acknowledged and synced only once', async () => {
    const { a, gets } = await setup(true);
    expect((await deliver(a, paidEvent('WH-FAKE-EVENT-3'))).statusCode).toBe(200);
    const again = await deliver(a, paidEvent('WH-FAKE-EVENT-3'));
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ duplicate: true });
    await a.idle();
    expect(gets()).toBe(1);
  });

  it('acknowledges and ignores an event for an invoice Sauda does not know', async () => {
    const { a, gets } = await setup(true);
    const res = await deliver(a, paidEvent('WH-FAKE-EVENT-4', 'INV2-SOMEONE-ELSE'));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ignored: true });
    await a.idle();
    expect(gets()).toBe(0);
  });

  it('rejects a body that is not an event', async () => {
    const { a } = await setup(true);
    expect((await deliver(a, { hello: 'world' })).statusCode).toBe(400);
  });
});

describe('WebhookManager.ensure', () => {
  it('reuses the webhook registered for this URL, or creates one for the invoice events, and skips http', async () => {
    const created: FakeCall[] = [];
    let existing: object[] = [];
    const fake = fakePayPal((c) => {
      if (c.method === 'GET' && c.path === '/v1/notifications/webhooks') return { body: { webhooks: existing } };
      if (c.method === 'POST' && c.path === '/v1/notifications/webhooks') {
        created.push(c);
        return { status: 201, body: { id: 'WH-FAKE-NEW' } };
      }
      return undefined;
    });
    const client = new PayPalClient({ clientId: 'x', clientSecret: 'y' }, { fetch: fake.fetch });

    expect(await new WebhookManager(client).ensure('http://localhost:8787')).toBeNull();
    expect(fake.api()).toHaveLength(0);

    expect(await new WebhookManager(client).ensure('https://sauda.example.test/')).toBe('WH-FAKE-NEW');
    expect(created[0].body).toEqual({ url: `https://sauda.example.test${WEBHOOK_PATH}`, event_types: WEBHOOK_EVENT_TYPES.map((name) => ({ name })) });

    existing = [{ id: 'WH-FAKE-OLD', url: 'https://sauda.example.test/api/paypal/webhook' }];
    expect(await new WebhookManager(client).ensure('https://sauda.example.test')).toBe('WH-FAKE-OLD');
    expect(created).toHaveLength(1);

    expect(await new WebhookManager(client, { webhookId: 'WH-FROM-ENV' }).ensure('https://sauda.example.test')).toBe('WH-FROM-ENV');
  });

  it('logs a failure and lets boot continue', async () => {
    const fake = fakePayPal(() => ({ status: 500, body: { name: 'INTERNAL_SERVER_ERROR' } }));
    const warnings: string[] = [];
    const m = new WebhookManager(new PayPalClient({ clientId: 'x', clientSecret: 'y' }, { fetch: fake.fetch }), {
      log: { info: () => undefined, warn: (_o, msg) => void warnings.push(msg) },
    });
    expect(await m.ensure('https://sauda.example.test')).toBeNull();
    expect(warnings).toEqual(['paypal webhook setup failed; polling continues']);
    expect(m.status()).toEqual({ configured: false, lastVerifiedAt: null });
  });
});
