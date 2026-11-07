/** A fake PayPal sandbox for unit tests (not a test file itself). No real ids, tokens or emails. */
import type { Deal } from '../../shared/types.js';
import { canonicalHash } from '../domain/agreement.js';
import { NOW, spikeDeal } from '../domain/test-fixtures.js';

export interface FakeCall {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: any;
}

export interface FakeResponse {
  status?: number;
  body?: unknown;
  debugId?: string;
}

export const FAKE_TOKEN_PREFIX = 'fake-access-token';
export const MERCHANT = 'maker@example.test';
export const BUYER = 'buyer@example.test';

/**
 * A fetch that answers the OAuth token call itself and passes every other call to `handler`
 * (404 when it returns nothing). All calls are recorded.
 */
export function fakePayPal(handler: (c: FakeCall) => FakeResponse | undefined = () => undefined) {
  const calls: FakeCall[] = [];
  let tokens = 0;
  const fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const headers = { ...((init.headers as Record<string, string>) ?? {}) };
    let body: any = init.body;
    if (typeof body === 'string' && headers['Content-Type'] === 'application/json') body = JSON.parse(body);
    const call: FakeCall = { method: init.method ?? 'GET', path: url.pathname + url.search, headers, body };
    calls.push(call);
    if (url.pathname === '/v1/oauth2/token') {
      tokens += 1;
      return respond({ status: 200, body: { access_token: `${FAKE_TOKEN_PREFIX}-${tokens}`, expires_in: 32400, scope: 'https://uri.paypal.com/services/invoicing openid' }, debugId: `dbgtoken${tokens}` });
    }
    return respond(handler(call) ?? { status: 404, body: { name: 'RESOURCE_NOT_FOUND', message: 'not faked' } }, calls.length);
  }) as typeof globalThis.fetch;
  return {
    fetch,
    calls,
    /** Calls other than the OAuth token. */
    api: () => calls.filter((c) => c.path !== '/v1/oauth2/token'),
    tokenCalls: () => tokens,
  };
}

function respond(r: FakeResponse, n = 0): Response {
  const status = r.status ?? 200;
  const hasBody = r.body !== undefined && status !== 204;
  return new Response(hasBody ? JSON.stringify(r.body) : null, {
    status,
    headers: { 'content-type': 'application/json', 'paypal-debug-id': r.debugId ?? `f0debug${n}` },
  });
}

export interface InvoiceJsonOptions {
  id?: string;
  status?: string;
  totalCents?: number;
  paid?: { id: string; cents: number; method?: string; type?: string }[];
  note?: string;
  reference?: string;
}

const money = (cents: number) => ({ currency_code: 'USD', value: (cents / 100).toFixed(2) });

/** A synthetic Invoicing v2 GET body. */
export function invoiceJson(o: InvoiceJsonOptions = {}): any {
  const id = o.id ?? 'INV2-FAKE-0000-0000-0042';
  const total = o.totalCents ?? 12000;
  const paid = o.paid ?? [];
  const paidCents = paid.reduce((n, p) => n + p.cents, 0);
  return {
    id,
    status: o.status ?? 'UNPAID',
    detail: {
      invoice_number: '0042',
      reference: o.reference ?? 'SAUDA-TESTDEAL sha256:0000000000000000',
      note: o.note ?? 'note',
      currency_code: 'USD',
      metadata: { recipient_view_url: `https://www.sandbox.paypal.com/invoice/p/#${id.replaceAll('-', '').slice(4)}` },
    },
    amount: money(total),
    due_amount: money(total - paidCents),
    payments: {
      paid_amount: money(paidCents),
      transactions: paid.map((p) => ({
        payment_id: p.id,
        type: p.type ?? (p.method === 'PAYPAL' || p.method === undefined ? 'PAYPAL' : 'EXTERNAL'),
        method: p.method ?? 'PAYPAL',
        amount: money(p.cents),
        payment_date: '2026-11-06',
      })),
    },
  };
}

/** The spike deal with both sides confirmed on the current hash. */
export function confirmedSpikeDeal(): Deal {
  const deal = spikeDeal();
  const hash = canonicalHash(deal);
  deal.confirmations = { maker: { hash, at: NOW.toISOString() }, buyer: { hash, at: NOW.toISOString() } };
  return deal;
}
