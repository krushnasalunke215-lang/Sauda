import { describe, expect, it } from 'vitest';
import { PayPalClient, type CallLogEntry } from './client.js';
import { FAKE_TOKEN_PREFIX, fakePayPal } from './test-fakes.js';

const CREDS = { clientId: 'fake-client-id', clientSecret: 'fake-client-secret' };

function client(handler?: Parameters<typeof fakePayPal>[0]) {
  const fake = fakePayPal(handler);
  const log: { dealId: string | undefined; entry: CallLogEntry }[] = [];
  const c = new PayPalClient(CREDS, { fetch: fake.fetch, onCall: (dealId, entry) => log.push({ dealId, entry }) });
  return { c, fake, log };
}

describe('PayPalClient', () => {
  it('refuses any origin other than the sandbox, before calling anything', async () => {
    const { c, fake } = client();
    await expect(c.call('GET', 'https://api-m.paypal.com/v2/invoicing/invoices')).rejects.toThrow(/non-sandbox/);
    await expect(c.call('GET', '//example.com/v1/x')).rejects.toThrow(/non-sandbox/);
    await expect(c.call('GET', 'http://api-m.sandbox.paypal.com/v1/x')).rejects.toThrow(/non-sandbox/);
    expect(fake.calls).toHaveLength(0);
  });

  it('sends PayPal-Request-Id and Content-Type on writes, and neither request id nor body on reads', async () => {
    const { c, fake } = client(() => ({ status: 200, body: {} }));
    await c.call('POST', '/v2/invoicing/generate-next-invoice-number');
    await c.call('POST', '/v2/invoicing/invoices', { body: { a: 1 }, requestId: 'sauda-X-create', prefer: 'return=representation' });
    await c.call('GET', '/v2/invoicing/invoices/INV2-1');
    const [gen, create, get] = fake.api();
    expect(gen.headers['Content-Type']).toBe('application/json');
    expect(gen.headers['PayPal-Request-Id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(create.headers).toMatchObject({ 'Content-Type': 'application/json', 'PayPal-Request-Id': 'sauda-X-create', Prefer: 'return=representation', Accept: 'application/json' });
    expect(create.body).toEqual({ a: 1 });
    expect(get.headers['PayPal-Request-Id']).toBeUndefined();
    expect(get.body).toBeUndefined();
    // One token for all three calls.
    expect(fake.tokenCalls()).toBe(1);
  });

  it('on HTTP 401 clears the token and retries once, then gives up', async () => {
    let n = 0;
    const { c, fake } = client((call) => (call.path.endsWith('/flaky') && n++ === 0 ? { status: 401, body: { error: 'invalid_token' } } : call.path.endsWith('/never') ? { status: 401 } : { status: 200, body: { ok: true } }));
    const r = await c.call('GET', '/v1/flaky');
    expect(r).toMatchObject({ status: 200, ok: true, body: { ok: true } });
    expect(fake.tokenCalls()).toBe(2);
    const auths = fake.api().map((x) => x.headers.Authorization);
    expect(auths[0]).not.toBe(auths[1]);

    const never = await c.call('GET', '/v1/never');
    expect(never.status).toBe(401);
    expect(fake.api().filter((x) => x.path === '/v1/never')).toHaveLength(2);
  });

  it('reports every call with status, debug ID and timing, but never the token, the credentials or the body', async () => {
    const { c, log } = client(() => ({ status: 400, body: { name: 'INVALID_REQUEST', message: 'bad', details: [{ issue: 'X', value: 'v'.repeat(100) }] }, debugId: 'f00ddebug1' }));
    const r = await c.call('POST', '/v2/invoicing/invoices', { body: { note: 'secret agreement text' }, dealId: 'DEAL0001', label: 'create-invoice' });
    expect(r).toMatchObject({ ok: false, status: 400, debugId: 'f00ddebug1' });
    const entry = log.find((l) => l.entry.label === 'create-invoice')!;
    expect(entry.dealId).toBe('DEAL0001');
    expect(entry.entry).toMatchObject({ method: 'POST', path: '/v2/invoicing/invoices', status: 400, debugId: 'f00ddebug1', error: { name: 'INVALID_REQUEST' } });
    expect(typeof entry.entry.ms).toBe('number');
    const all = JSON.stringify(log);
    for (const leaked of [FAKE_TOKEN_PREFIX, 'Bearer', 'Basic', 'Authorization', CREDS.clientSecret, CREDS.clientId, 'secret agreement text']) expect(all).not.toContain(leaked);
    // Long values in errors are shortened.
    expect(all).not.toContain('v'.repeat(61));
  });

  it('returns failures instead of exiting, and exposes the token scopes', async () => {
    const { c } = client(() => ({ status: 500, body: { name: 'INTERNAL_SERVER_ERROR' } }));
    const r = await c.call('GET', '/v2/invoicing/invoices/INV2-1');
    expect(r).toMatchObject({ ok: false, status: 500, body: { name: 'INTERNAL_SERVER_ERROR' } });
    expect((await c.token()).scope).toContain('https://uri.paypal.com/services/invoicing');
  });
});
