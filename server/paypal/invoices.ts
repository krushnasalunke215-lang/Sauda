import { createHash } from 'node:crypto';
import type { Deal, InvoiceSnapshot, InvoiceTransaction } from '../../shared/types.js';
import { canonicalHash, derive, missingRequired, validate } from '../domain/agreement.js';
import {
  AgreementTooLongError,
  buildItemDescription,
  buildItemName,
  buildNote,
  buildReference,
  buildTerms,
} from '../domain/agreement-text.js';
import { paypalToday, todayUtc } from '../domain/dates.js';
import { fmt } from '../domain/money.js';
import { expectOk, type PayPalClient } from './client.js';

/** The agreement cannot become an invoice (checked before any PayPal call). */
export class InvoiceValidationError extends Error {
  constructor(
    readonly code: string,
    readonly params: Record<string, unknown> = {},
  ) {
    super(`Invoice validation failed: ${code}`);
    this.name = 'InvoiceValidationError';
  }
}

export interface InvoiceParties {
  merchantEmail: string;
  buyerEmail: string;
  invoiceNumber?: string;
}

export const sha256 = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');

/** "Emily Carter" → {given_name: "Emily", surname: "Carter"}. */
function splitName(name: string): { given_name: string; surname?: string } {
  const parts = name.trim().split(/\s+/);
  const [given, ...rest] = parts;
  return rest.length ? { given_name: given, surname: rest.join(' ') } : { given_name: given };
}

/**
 * The Invoicing v2 body for a confirmed agreement: one item for the total, partial payment with
 * the deposit as the minimum due, and the bilingual agreement in the note, terms and item fields.
 * Throws InvoiceValidationError before PayPal is called when the agreement cannot be invoiced.
 */
export function buildInvoiceBody(deal: Deal, parties: InvoiceParties, now: Date = new Date()): any {
  const missing = missingRequired(deal.terms);
  if (missing.length) throw new InvoiceValidationError('not_ready', { missing });
  const issues = validate(deal.terms, todayUtc(now));
  if (issues.length) throw new InvoiceValidationError('not_ready', { errors: issues.map((i) => i.code) });
  const d = derive(deal.terms);
  const total = d.totalCents!;
  const deposit = d.depositCents!;
  const currency = d.currency ?? 'USD';

  let note: string, terms: string, description: string, reference: string;
  try {
    note = buildNote(deal);
    terms = buildTerms(deal);
    description = buildItemDescription(deal);
    reference = buildReference(deal);
  } catch (e) {
    if (e instanceof AgreementTooLongError) throw new InvoiceValidationError('agreement_too_long', { field: e.field, bytes: e.bytes, limit: e.limit });
    throw e;
  }
  const money = (cents: number) => ({ currency_code: currency, value: fmt(cents) });

  return {
    detail: {
      ...(parties.invoiceNumber ? { invoice_number: parties.invoiceNumber } : {}),
      // PayPal's date, not UTC: a date ahead of US Pacific time makes the invoice SCHEDULED.
      invoice_date: paypalToday(now),
      currency_code: currency,
      reference,
      note,
      terms_and_conditions: terms,
      memo: `Sauda deal ${deal.id}`,
      payment_term: { term_type: 'DUE_ON_RECEIPT' },
    },
    invoicer: { business_name: deal.parties.maker.name, email_address: parties.merchantEmail },
    primary_recipients: [{ billing_info: { name: splitName(deal.parties.buyer.name), email_address: parties.buyerEmail } }],
    items: [
      {
        name: buildItemName(deal),
        ...(description ? { description } : {}),
        quantity: '1',
        unit_amount: money(total),
        unit_of_measure: 'QUANTITY',
      },
    ],
    configuration: {
      allow_tip: false,
      tax_calculated_after_discount: true,
      tax_inclusive: false,
      ...(deposit < total ? { partial_payment: { allow_partial_payment: true, minimum_amount_due: money(deposit) } } : {}),
    },
  };
}

/** "36.00" → 3600. */
export function parseCents(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/** True for an https link on a *.sandbox.paypal.com host. */
export function isSandboxPayerUrl(u: unknown): u is string {
  if (typeof u !== 'string') return false;
  try {
    const url = new URL(u);
    return url.protocol === 'https:' && url.hostname.endsWith('.sandbox.paypal.com');
  } catch {
    return false;
  }
}

export interface InvoiceExpect {
  noteSha256: string;
  reference: string;
  payerUrl?: string;
}

/** The parts of a PayPal invoice Sauda tracks, with money in cents. */
export function snapshot(inv: any, depositCents: number, expected?: InvoiceExpect): InvoiceSnapshot {
  const totalCents = parseCents(inv?.amount?.value);
  const paidCents = parseCents(inv?.payments?.paid_amount?.value);
  const due = inv?.due_amount?.value;
  const transactions: InvoiceTransaction[] = (inv?.payments?.transactions ?? []).map((t: any) => ({
    id: String(t?.payment_id ?? ''),
    type: String(t?.type ?? ''),
    method: String(t?.method ?? ''),
    cents: parseCents(t?.amount?.value),
    date: String(t?.payment_date ?? ''),
  }));
  const noteSha256 = sha256(String(inv?.detail?.note ?? ''));
  const recipientView = inv?.detail?.metadata?.recipient_view_url;
  return {
    id: String(inv?.id ?? ''),
    number: String(inv?.detail?.invoice_number ?? ''),
    status: String(inv?.status ?? ''),
    payerUrl: expected?.payerUrl ?? (isSandboxPayerUrl(recipientView) ? recipientView : ''),
    totalCents,
    paidCents,
    dueCents: due === undefined ? Math.max(0, totalCents - paidCents) : parseCents(due),
    depositCents,
    transactions,
    noteSha256,
    textMatches: expected ? noteSha256 === expected.noteSha256 && inv?.detail?.reference === expected.reference : true,
  };
}

/** Invoice ID from a create response (the full representation or a links-only body). */
export function invoiceIdFrom(body: any): string {
  if (typeof body?.id === 'string') return body.id;
  const href: unknown = body?.href ?? body?.links?.find((l: any) => l?.rel === 'self')?.href;
  if (typeof href !== 'string') throw new Error('No invoice ID in the create response');
  return href.split('/').pop()!;
}

/** The buyer's pay page: the send response's payer-view link, else the invoice's recipient_view_url. */
export function payerUrlFrom(sendBody: any, invoice: any): string {
  const links: any[] = [sendBody, ...(Array.isArray(sendBody?.links) ? sendBody.links : [])];
  const payerView = links.find((l) => l?.rel === 'payer-view')?.href;
  const url = isSandboxPayerUrl(payerView) ? payerView : invoice?.detail?.metadata?.recipient_view_url;
  if (!isSandboxPayerUrl(url)) throw new Error('PayPal returned no sandbox payer link');
  return url;
}

export interface CreatedInvoice {
  invoiceId: string;
  number: string;
  payerUrl: string;
  noteSha256: string;
  reference: string;
  snapshot: InvoiceSnapshot;
}

/** Reads one invoice. */
export async function getInvoice(client: PayPalClient, invoiceId: string, opts: { dealId?: string; quiet?: boolean; label?: string } = {}) {
  return client.call('GET', `/v2/invoicing/invoices/${encodeURIComponent(invoiceId)}`, { label: opts.label ?? 'get-invoice', dealId: opts.dealId, quiet: opts.quiet });
}

/**
 * Creates the deposit invoice from the confirmed agreement and sends it (without PayPal emails):
 * generate-next-invoice-number, create, send, then read it back. The create and send calls carry
 * idempotency keys derived from the agreement hash, so a retry cannot make a second invoice.
 */
export async function createAndSend(client: PayPalClient, deal: Deal, parties: InvoiceParties, now: Date = new Date()): Promise<CreatedInvoice> {
  // Validate first: nothing goes to PayPal for an agreement that cannot be invoiced.
  const body = buildInvoiceBody(deal, parties, now);
  const dealId = deal.id;
  const key = `sauda-${deal.id}-${canonicalHash(deal).slice(0, 16)}`;

  const num = expectOk(await client.call('POST', '/v2/invoicing/generate-next-invoice-number', { label: 'generate-invoice-number', dealId }), 'generate invoice number');
  if (typeof num.body?.invoice_number === 'string') body.detail.invoice_number = num.body.invoice_number;

  const created = expectOk(
    await client.call('POST', '/v2/invoicing/invoices', { body, prefer: 'return=representation', requestId: `${key}-create`, label: 'create-invoice', dealId }),
    'create invoice',
  );
  const invoiceId = invoiceIdFrom(created.body);
  const id = encodeURIComponent(invoiceId);

  const sent = expectOk(
    await client.call('POST', `/v2/invoicing/invoices/${id}/send`, {
      body: { send_to_invoicer: false, send_to_recipient: false },
      requestId: `${key}-send`,
      label: 'send-invoice',
      dealId,
    }),
    'send invoice',
  );
  const detail = expectOk(await getInvoice(client, invoiceId, { dealId }), 'get invoice');
  const payerUrl = payerUrlFrom(sent.body, detail.body);
  const noteSha256 = sha256(body.detail.note);
  const reference: string = body.detail.reference;
  const depositCents = derive(deal.terms).depositCents!;
  const snap = snapshot(detail.body, depositCents, { noteSha256, reference, payerUrl });
  return { invoiceId, number: snap.number, payerUrl, noteSha256, reference, snapshot: snap };
}

/** Cancels a sent invoice without emails (smoke tests and clean-up). */
export async function cancelInvoice(client: PayPalClient, invoiceId: string, dealId?: string) {
  const r = await client.call('POST', `/v2/invoicing/invoices/${encodeURIComponent(invoiceId)}/cancel`, {
    body: { send_to_invoicer: false, send_to_recipient: false },
    label: 'cancel-invoice',
    dealId,
  });
  return expectOk(r, 'cancel invoice');
}
