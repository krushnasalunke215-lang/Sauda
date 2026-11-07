import { describe, expect, it } from 'vitest';
import { canonicalHash, emptyPatch, patchDeal } from '../domain/agreement.js';
import { buildNote, buildReference } from '../domain/agreement-text.js';
import { NOW, TODAY } from '../domain/test-fixtures.js';
import { PayPalClient } from './client.js';
import { buildInvoiceBody, createAndSend, InvoiceValidationError, sha256, snapshot } from './invoices.js';
import { BUYER, confirmedSpikeDeal, fakePayPal, invoiceJson, MERCHANT } from './test-fakes.js';

const PARTIES = { merchantEmail: MERCHANT, buyerEmail: BUYER };
const CREDS = { clientId: 'fake-id', clientSecret: 'fake-secret' };

describe('buildInvoiceBody', () => {
  it('turns the spike order into one 120.00 item with partial payment and a 36.00 minimum', () => {
    const deal = confirmedSpikeDeal();
    const body = buildInvoiceBody(deal, { ...PARTIES, invoiceNumber: '0042' }, NOW);
    expect(body.detail).toMatchObject({
      invoice_number: '0042',
      invoice_date: TODAY,
      currency_code: 'USD',
      reference: buildReference(deal),
      note: buildNote(deal),
      memo: 'Sauda deal TESTDEAL',
      payment_term: { term_type: 'DUE_ON_RECEIPT' },
    });
    expect(body.detail.terms_and_conditions).toContain('$36.00');
    expect(body.invoicer).toEqual({ business_name: 'Asha Chikan Studio', email_address: MERCHANT });
    expect(body.primary_recipients).toEqual([{ billing_info: { name: { given_name: 'Emily', surname: 'Carter' }, email_address: BUYER } }]);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ quantity: '1', unit_amount: { currency_code: 'USD', value: '120.00' }, name: expect.stringContaining('chikankari kurta') });
    expect(body.items[0].description).toContain('111.8 cm');
    expect(body.configuration).toEqual({
      allow_tip: false,
      tax_calculated_after_discount: true,
      tax_inclusive: false,
      partial_payment: { allow_partial_payment: true, minimum_amount_due: { currency_code: 'USD', value: '36.00' } },
    });
  });

  it('omits partial payment when the deposit is the whole price', () => {
    const deal = confirmedSpikeDeal();
    patchDeal(deal, { ...emptyPatch(), depositPercent: 100 }, 'm1', NOW, TODAY);
    const body = buildInvoiceBody(deal, PARTIES, NOW);
    expect(body.configuration.partial_payment).toBeUndefined();
    expect(body.items[0].unit_amount.value).toBe('120.00');
  });

  it('rejects an agreement that is not complete', () => {
    const deal = confirmedSpikeDeal();
    delete deal.terms.price;
    expect(() => buildInvoiceBody(deal, PARTIES, NOW)).toThrow(InvoiceValidationError);
  });
});

describe('createAndSend', () => {
  it('raises a validation error for a Hindi note over 4000 bytes before any PayPal call', async () => {
    const deal = confirmedSpikeDeal();
    const long = 'कंधे से कलाई तक की लंबाई'.repeat(5).slice(0, 119);
    deal.terms.measurements = Array.from({ length: 12 }, (_, i) => ({
      value: { key: `m${i}`, label: { maker: long, buyer: `measurement ${i}` }, value: 10 + i, unit: 'in' as const },
      sourceMessageId: 'm1',
      updatedAt: NOW.toISOString(),
    }));
    const fake = fakePayPal();
    const err = await createAndSend(new PayPalClient(CREDS, { fetch: fake.fetch }), deal, PARTIES, NOW).catch((e) => e);
    expect(err).toBeInstanceOf(InvoiceValidationError);
    expect(err).toMatchObject({ code: 'agreement_too_long', params: { field: 'note', limit: 4000 } });
    expect(fake.calls).toHaveLength(0);
  });

  it('generates a number, creates, sends without emails and reads the invoice back, with idempotency keys', async () => {
    const deal = confirmedSpikeDeal();
    let sentNote = '';
    let sentReference = '';
    const fake = fakePayPal((c) => {
      if (c.path === '/v2/invoicing/generate-next-invoice-number') return { body: { invoice_number: '0042' } };
      if (c.method === 'POST' && c.path === '/v2/invoicing/invoices') {
        sentNote = c.body.detail.note;
        sentReference = c.body.detail.reference;
        return { status: 201, body: { id: 'INV2-FAKE-0000-0000-0042', status: 'DRAFT' }, debugId: 'f0create' };
      }
      if (c.path.endsWith('/send')) return { body: { rel: 'payer-view', href: 'https://www.sandbox.paypal.com/invoice/p/#INV2-FAKE-0000-0000-0042', method: 'GET' } };
      if (c.method === 'GET') return { body: invoiceJson({ note: sentNote, reference: sentReference }) };
      return undefined;
    });
    const r = await createAndSend(new PayPalClient(CREDS, { fetch: fake.fetch }), deal, PARTIES, NOW);
    const calls = fake.api();
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'POST /v2/invoicing/generate-next-invoice-number',
      'POST /v2/invoicing/invoices',
      'POST /v2/invoicing/invoices/INV2-FAKE-0000-0000-0042/send',
      'GET /v2/invoicing/invoices/INV2-FAKE-0000-0000-0042',
    ]);
    const key = `sauda-TESTDEAL-${canonicalHash(deal).slice(0, 16)}`;
    expect(calls[1].headers).toMatchObject({ 'PayPal-Request-Id': `${key}-create`, Prefer: 'return=representation' });
    expect(calls[1].body.detail.invoice_number).toBe('0042');
    expect(calls[2].headers['PayPal-Request-Id']).toBe(`${key}-send`);
    expect(calls[2].body).toEqual({ send_to_invoicer: false, send_to_recipient: false });
    expect(r).toMatchObject({ invoiceId: 'INV2-FAKE-0000-0000-0042', number: '0042', payerUrl: 'https://www.sandbox.paypal.com/invoice/p/#INV2-FAKE-0000-0000-0042' });
    expect(r.noteSha256).toBe(sha256(buildNote(deal)));
    expect(r.snapshot).toMatchObject({ status: 'UNPAID', totalCents: 12000, paidCents: 0, dueCents: 12000, depositCents: 3600, textMatches: true });
  });

  it('refuses a payer link that is not on a sandbox host', async () => {
    const deal = confirmedSpikeDeal();
    const fake = fakePayPal((c) => {
      if (c.path.endsWith('generate-next-invoice-number')) return { body: { invoice_number: '1' } };
      if (c.method === 'POST' && c.path === '/v2/invoicing/invoices') return { status: 201, body: { id: 'INV2-X' } };
      if (c.path.endsWith('/send')) return { body: { rel: 'payer-view', href: 'https://www.paypal.com/invoice/p/#INV2-X' } };
      return { body: { ...invoiceJson({ id: 'INV2-X' }), detail: { metadata: { recipient_view_url: 'https://evil.example/pay' } } } };
    });
    await expect(createAndSend(new PayPalClient(CREDS, { fetch: fake.fetch }), deal, PARTIES, NOW)).rejects.toThrow(/sandbox payer link/);
  });
});

describe('snapshot', () => {
  it('reads a PARTIALLY_PAID invoice in cents and checks the text against the agreement', () => {
    const json = invoiceJson({ status: 'PARTIALLY_PAID', paid: [{ id: 'FAKECAPTURE0001', cents: 3600 }], note: 'agreed note', reference: 'SAUDA-TESTDEAL sha256:abcd' });
    const s = snapshot(json, 3600, { noteSha256: sha256('agreed note'), reference: 'SAUDA-TESTDEAL sha256:abcd' });
    expect(s).toMatchObject({ id: 'INV2-FAKE-0000-0000-0042', number: '0042', status: 'PARTIALLY_PAID', totalCents: 12000, paidCents: 3600, dueCents: 8400, depositCents: 3600, textMatches: true });
    expect(s.transactions).toEqual([{ id: 'FAKECAPTURE0001', type: 'PAYPAL', method: 'PAYPAL', cents: 3600, date: '2026-11-06' }]);
    expect(s.payerUrl).toMatch(/^https:\/\/www\.sandbox\.paypal\.com\//);

    const edited = snapshot({ ...json, detail: { ...json.detail, note: 'agreed note, edited' } }, 3600, { noteSha256: sha256('agreed note'), reference: 'SAUDA-TESTDEAL sha256:abcd' });
    expect(edited.textMatches).toBe(false);
  });
});
