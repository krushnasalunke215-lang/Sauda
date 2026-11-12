import { describe, expect, it } from 'vitest';
import type { DealView, InvoiceSnapshot, Message, Proposal, Role } from '../../shared/types.js';
import { nextAction } from './nextAction.js';

const AT = '2026-11-12T00:00:00.000Z';

function view(role: Role, patch: Partial<DealView> = {}): DealView {
  return {
    id: 'D1',
    role,
    parties: { maker: { name: 'Ravi', lang: 'hi' }, buyer: { name: 'Emily', lang: 'en' } },
    phase: 'negotiating',
    agreement: {
      rows: [{ field: 'item', value: 'kurta', sourceMessageId: 'm1', seq: 1 }],
      derived: { currency: 'USD', totalCents: 12000, depositCents: 3600, balanceCents: 8400, depositPercent: 30 },
      missing: [],
      errors: [],
      hash: 'h1',
      locked: false,
      summary: [],
      deliveryDate: '2026-12-10',
    },
    messages: [],
    questions: [],
    confirmations: { maker: null, buyer: null },
    invoice: null,
    proposals: [],
    timeline: [],
    tracking: null,
    progressApproval: null,
    createdAt: AT,
    updatedAt: AT,
    ...patch,
  };
}

const confirmed = { hash: 'h1', at: AT, current: true };
const both = { maker: confirmed, buyer: confirmed };

function invoice(patch: Partial<InvoiceSnapshot> = {}): InvoiceSnapshot {
  return {
    id: 'INV2-1',
    number: '0001',
    status: 'UNPAID',
    payerUrl: 'https://www.sandbox.paypal.com/invoice/p/#INV2-1',
    totalCents: 12000,
    paidCents: 0,
    dueCents: 12000,
    depositCents: 3600,
    transactions: [],
    noteSha256: 'x',
    textMatches: true,
    ...patch,
  };
}

const depositIn = invoice({ status: 'PARTIALLY_PAID', paidCents: 3600, dueCents: 8400 });

function proposal(status: Proposal['status']): Proposal {
  return { id: 'p1', tool: 'create_invoice', args: {}, status, createdAt: AT };
}

function photo(status: Message['status'], decision?: { approve: boolean; at: string }): Message {
  return { id: 'ph1', seq: 9, from: 'maker', kind: 'photo', status, photo: { kind: 'progress', decision }, createdAt: AT };
}

describe('nextAction', () => {
  it('is null for a cancelled deal or invoice', () => {
    expect(nextAction(view('buyer', { phase: 'cancelled' }))).toBeNull();
    expect(nextAction(view('buyer', { invoice: invoice({ status: 'CANCELLED' }), confirmations: both }))).toBeNull();
  });

  it('is null while the agreement is incomplete, invalid or locked', () => {
    const a = view('buyer').agreement;
    expect(nextAction(view('buyer', { agreement: { ...a, missing: ['price'] } }))).toBeNull();
    expect(nextAction(view('buyer', { agreement: { ...a, errors: [{ code: 'delivery_in_past' }] } }))).toBeNull();
    expect(nextAction(view('maker', { agreement: { ...a, locked: true }, confirmations: both }))).toBeNull();
  });

  it('asks me to confirm until I confirmed the current hash', () => {
    expect(nextAction(view('buyer'))).toEqual({ kind: 'confirm' });
    const old = { hash: 'h0', at: AT, current: false };
    expect(nextAction(view('maker', { confirmations: { maker: old, buyer: confirmed } }))).toEqual({ kind: 'confirm' });
  });

  it('waits for the other side to confirm', () => {
    expect(nextAction(view('buyer', { confirmations: { maker: null, buyer: confirmed } }))).toEqual({ kind: 'waiting', who: 'maker' });
    expect(nextAction(view('maker', { confirmations: { maker: confirmed, buyer: null } }))).toEqual({ kind: 'waiting', who: 'buyer' });
  });

  it('asks the maker to approve a pending or failed invoice proposal; the buyer waits', () => {
    for (const status of ['pending', 'failed'] as const) {
      expect(nextAction(view('maker', { confirmations: both, proposals: [proposal(status)] }))).toEqual({ kind: 'approveInvoice' });
      expect(nextAction(view('buyer', { confirmations: both, proposals: [proposal(status)] }))).toEqual({ kind: 'waiting', who: 'maker' });
    }
  });

  it('is null when both confirmed and no invoice proposal is open', () => {
    expect(nextAction(view('maker', { confirmations: both }))).toBeNull();
    expect(nextAction(view('maker', { confirmations: both, proposals: [proposal('running')] }))).toBeNull();
  });

  it('asks the buyer to pay the deposit; the maker waits', () => {
    expect(nextAction(view('buyer', { invoice: invoice(), confirmations: both }))).toEqual({ kind: 'payDeposit', cents: 3600 });
    expect(nextAction(view('maker', { invoice: invoice(), confirmations: both }))).toEqual({ kind: 'waiting', who: 'buyer' });
  });

  it('asks the maker for a progress photo after the deposit; the buyer waits', () => {
    expect(nextAction(view('maker', { invoice: depositIn }))).toEqual({ kind: 'sendPhoto' });
    expect(nextAction(view('buyer', { invoice: depositIn }))).toEqual({ kind: 'waiting', who: 'maker' });
  });

  it('asks again for a photo after changes were requested or the last photo failed', () => {
    const changes = photo('done', { approve: false, at: AT });
    expect(nextAction(view('maker', { invoice: depositIn, messages: [changes] }))).toEqual({ kind: 'sendPhoto' });
    expect(nextAction(view('buyer', { invoice: depositIn, messages: [photo('failed')] }))).toEqual({ kind: 'waiting', who: 'maker' });
  });

  it('asks the buyer to review a checked photo; the maker waits', () => {
    expect(nextAction(view('buyer', { invoice: depositIn, messages: [photo('done')] }))).toEqual({ kind: 'reviewPhoto' });
    expect(nextAction(view('maker', { invoice: depositIn, messages: [photo('done')] }))).toEqual({ kind: 'waiting', who: 'buyer' });
  });

  it('shows nothing to the buyer while the photo is still being checked', () => {
    expect(nextAction(view('buyer', { invoice: depositIn, messages: [photo('interpreting')] }))).toBeNull();
    expect(nextAction(view('maker', { invoice: depositIn, messages: [photo('interpreting')] }))).toEqual({ kind: 'waiting', who: 'buyer' });
  });

  it('asks the buyer to pay the balance after the approval; the maker waits', () => {
    const approved = { invoice: depositIn, progressApproval: { messageId: 'ph1', at: AT } };
    expect(nextAction(view('buyer', approved))).toEqual({ kind: 'payBalance', cents: 8400 });
    expect(nextAction(view('maker', approved))).toEqual({ kind: 'waiting', who: 'buyer' });
  });

  it('is null once the invoice is paid in full', () => {
    const paid = invoice({ status: 'MARKED_AS_PAID', paidCents: 12000, dueCents: 0 });
    expect(nextAction(view('buyer', { invoice: paid, progressApproval: { messageId: 'ph1', at: AT } }))).toBeNull();
    expect(nextAction(view('maker', { invoice: paid }))).toBeNull();
  });
});
