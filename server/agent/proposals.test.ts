import { afterEach, describe, expect, it } from 'vitest';
import type { DealView, Role, TurnIntent } from '../../shared/types.js';
import type { Interpreter } from '../ai/interpret.js';
import { emptyPatch } from '../domain/agreement.js';
import { invoice, SPIKE_PATCH } from '../domain/test-fixtures.js';
import { PayPalCallError } from '../paypal/client.js';
import type { CreatedInvoice } from '../paypal/invoices.js';
import { fakePayPal } from '../paypal/test-fakes.js';
import { TrackingError } from '../paypal/tracking.js';
import type { ToolkitFactory } from '../paypal/toolkit.js';
import { authed, testApp, turnResult, type TestApp, type TestAppOptions } from '../routes/test-helpers.js';
import type { PayPalOps } from './proposals.js';

const COLOUR_CHANGE = 'रंग गहरा हरा कर दीजिए';
const TRACKING = 'पार्सल डीएचएल से भेज दिया है, ट्रैकिंग नंबर 4567891234';
const UNKNOWN_CARRIER = 'India Post se bhej diya, number 1234 5678';

/** The maker states the spike order; special texts change the colour or carry a tracking intent. */
const interpret: Interpreter = async (_deal, speaker, input) => {
  const text = 'text' in input ? input.text : '';
  const intent = (kind: TurnIntent['kind'], carrier: string | null, trackingNumber: string | null): TurnIntent => ({ kind, carrier, trackingNumber });
  if (text === COLOUR_CHANGE) return turnResult({ patch: { ...emptyPatch(), color: { maker: 'गहरा हरा', buyer: 'Dark green' } } });
  if (text === TRACKING) return turnResult({ intent: intent('add_tracking', 'डीएचएल', '4567891234') });
  if (text === UNKNOWN_CARRIER) return turnResult({ intent: intent('add_tracking', 'India Post', '1234 5678') });
  if (text === 'remind') return turnResult({ intent: intent('send_reminder', null, null) });
  return turnResult({ patch: speaker === 'maker' ? SPIKE_PATCH : emptyPatch() });
};

function created(dealId: string): CreatedInvoice {
  return {
    invoiceId: 'INV2-FAKE-0000-0000-0042',
    number: '0042',
    payerUrl: 'https://www.sandbox.paypal.com/invoice/p/#INV2-FAKE-0000-0000-0042',
    noteSha256: 'a'.repeat(64),
    reference: `SAUDA-${dealId} sha256:0000000000000000`,
    snapshot: invoice({ id: 'INV2-FAKE-0000-0000-0042', number: '0042' }),
  };
}

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

async function setup(opts: TestAppOptions = {}) {
  t = await testApp({ interpret, paypal: {}, ...opts });
  return t;
}

const post = (a: TestApp, url: string, role: Role, payload?: object) =>
  a.app.inject({ method: 'POST', url: `/api/deals/${a.deal.id}${url}`, headers: authed(a.deal[role].token), ...(payload ? { payload } : {}) });
const view = async (a: TestApp, role: Role = 'maker') =>
  (await a.app.inject({ method: 'GET', url: `/api/deals/${a.deal.id}`, headers: authed(a.deal[role].token) })).json() as DealView;

async function say(a: TestApp, role: Role, text: string) {
  expect((await post(a, '/turns', role, { text })).statusCode).toBe(202);
  await a.idle();
}

/** The maker states the order and both sides confirm it. Returns the create_invoice proposal id. */
async function confirmBoth(a: TestApp): Promise<string> {
  await say(a, 'maker', 'order');
  const { hash } = (await view(a)).agreement;
  expect((await post(a, '/confirm', 'maker', { hash })).statusCode).toBe(200);
  expect((await view(a)).proposals).toEqual([]);
  expect((await post(a, '/confirm', 'buyer', { hash })).statusCode).toBe(200);
  const p = (await view(a)).proposals.find((x) => x.tool === 'create_invoice')!;
  expect(p).toMatchObject({ status: 'pending', args: { totalCents: 12000, depositCents: 3600, hash }, reason: { code: 'both_confirmed' } });
  return p.id;
}

function fakeOps(over: Partial<PayPalOps> = {}) {
  const calls = { createInvoice: 0, addTracking: [] as [string, string][], sendReminder: 0 };
  const ops: Partial<PayPalOps> = {
    createInvoice: async (deal) => {
      calls.createInvoice += 1;
      await new Promise((r) => setTimeout(r, 20));
      return created(deal.id);
    },
    addTracking: async (_deal, carrier, number) => {
      calls.addTracking.push([carrier, number]);
      return { carrier, number, transactionIds: ['FAKECAP1'], readBack: [{ transactionId: 'FAKECAP1', status: 'SHIPPED' }] };
    },
    ...over,
  };
  return { ops, calls };
}

/** Puts a paid deposit (one PayPal capture) on the deal's invoice. */
const payDeposit = (a: TestApp, status = 'PARTIALLY_PAID') =>
  a.store.update(a.deal.id, (d) => {
    d.invoice = invoice({ status, paidCents: 3600, dueCents: 8400, transactions: [{ id: 'FAKECAP1', type: 'PAYPAL', method: 'PAYPAL', cents: 3600, date: '2026-11-06' }] });
  });

describe('create_invoice proposal', () => {
  it('appears only after both confirmations, and the buyer cannot approve it', async () => {
    const { ops, calls } = fakeOps();
    const a = await setup({ paypal: { ops } });
    const pid = await confirmBoth(a);
    expect((await post(a, `/proposals/${pid}/approve`, 'buyer')).statusCode).toBe(403);
    expect(calls.createInvoice).toBe(0);
  });

  it('re-checks both confirmations on the current hash when approved', async () => {
    const { ops, calls } = fakeOps();
    const a = await setup({ paypal: { ops } });
    const pid = await confirmBoth(a);
    await a.store.update(a.deal.id, (d) => {
      delete d.confirmations.buyer;
    });
    const res = await post(a, `/proposals/${pid}/approve`, 'maker');
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'not_confirmed' });
    expect(calls.createInvoice).toBe(0);
  });

  it('a changed agreement makes the card stale and blocks creation', async () => {
    const { ops, calls } = fakeOps();
    const a = await setup({ paypal: { ops } });
    const pid = await confirmBoth(a);
    await say(a, 'maker', COLOUR_CHANGE);
    expect((await view(a)).proposals.find((p) => p.id === pid)?.status).toBe('stale');
    expect((await post(a, `/proposals/${pid}/approve`, 'maker')).statusCode).toBe(409);

    // A hash change that did not go through a turn is caught by the guard itself.
    const pid2 = await (async () => {
      const { hash } = (await view(a)).agreement;
      await post(a, '/confirm', 'maker', { hash });
      await post(a, '/confirm', 'buyer', { hash });
      return (await view(a)).proposals.find((p) => p.status === 'pending')!.id;
    })();
    await a.store.update(a.deal.id, (d) => {
      d.terms.price!.value.cents = 13000;
    });
    const res = await post(a, `/proposals/${pid2}/approve`, 'maker');
    expect(res.json()).toEqual({ error: 'stale_proposal' });
    expect((await view(a)).proposals.find((p) => p.id === pid2)?.status).toBe('stale');
    expect(calls.createInvoice).toBe(0);
  });

  it('a double approve creates exactly one invoice, then locks the agreement', async () => {
    const { ops, calls } = fakeOps();
    const a = await setup({ paypal: { ops } });
    const pid = await confirmBoth(a);
    const [r1, r2] = await Promise.all([post(a, `/proposals/${pid}/approve`, 'maker'), post(a, `/proposals/${pid}/approve`, 'maker')]);
    expect([r1.statusCode, r2.statusCode].sort()).toEqual([202, 409]);
    expect((await view(a)).agreement.locked).toBe(true);
    await a.idle();
    expect(calls.createInvoice).toBe(1);
    expect((await post(a, `/proposals/${pid}/approve`, 'maker')).statusCode).toBe(409);
    const v = await view(a, 'buyer');
    expect(v.invoice).toMatchObject({ id: 'INV2-FAKE-0000-0000-0042', status: 'UNPAID', depositCents: 3600 });
    expect(v.proposals.find((p) => p.id === pid)).toMatchObject({ status: 'done', result: { invoiceId: 'INV2-FAKE-0000-0000-0042', number: '0042' } });
    expect(v.messages.at(-1)?.event).toEqual({ type: 'invoice_created', params: { number: '0042', total: '$120.00', deposit: '$36.00' } });
    expect(v.phase).toBe('invoiced');
    expect(v.agreement.locked).toBe(true);
    const deal = a.store.get(a.deal.id)!;
    expect(Date.parse(deal.pollUntil!)).toBeGreaterThan(Date.now() + 60 * 60 * 1000);
    expect(deal.invoiceText).toEqual({ noteSha256: 'a'.repeat(64), reference: `SAUDA-${a.deal.id} sha256:0000000000000000` });
    expect(a.store.findByInvoiceId('INV2-FAKE-0000-0000-0042')?.id).toBe(a.deal.id);
  });

  it('records a PayPal failure on the card without crashing, and the maker can try again', async () => {
    let fail = true;
    const { ops } = fakeOps({
      createInvoice: async (deal) => {
        if (fail) throw new PayPalCallError('create invoice', 422, 'f0dbg422', { name: 'UNPROCESSABLE_ENTITY', message: 'The requested action could not be performed.' });
        return created(deal.id);
      },
    });
    const a = await setup({ paypal: { ops } });
    const pid = await confirmBoth(a);
    expect((await post(a, `/proposals/${pid}/approve`, 'maker')).statusCode).toBe(202);
    await a.idle();
    let v = await view(a);
    expect(v.proposals.find((p) => p.id === pid)).toMatchObject({
      status: 'failed',
      error: 'paypal_error',
      result: { name: 'UNPROCESSABLE_ENTITY', message: 'The requested action could not be performed.', debugId: 'f0dbg422', httpStatus: 422 },
    });
    expect(v.invoice).toBeNull();
    expect(v.agreement.locked).toBe(false);
    fail = false;
    expect((await post(a, `/proposals/${pid}/approve`, 'maker')).statusCode).toBe(202);
    await a.idle();
    v = await view(a);
    expect(v.proposals.find((p) => p.id === pid)?.status).toBe('done');
    expect(v.invoice?.id).toBe('INV2-FAKE-0000-0000-0042');
  });

  it('can be rejected by the maker', async () => {
    const a = await setup({ paypal: { ops: fakeOps().ops } });
    const pid = await confirmBoth(a);
    const v = (await post(a, `/proposals/${pid}/reject`, 'maker')).json() as DealView;
    expect(v.proposals.find((p) => p.id === pid)?.status).toBe('rejected');
  });

  it('returns 503 when PayPal is not configured', async () => {
    t = await testApp({ interpret });
    const pid = await confirmBoth(t);
    const res = await post(t, `/proposals/${pid}/approve`, 'maker');
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: 'paypal_not_configured' });
  });
});

describe('add_tracking proposal', () => {
  it("comes from the maker's spoken intent once a payment exists, and moves the deal to shipped", async () => {
    const { ops, calls } = fakeOps();
    const a = await setup({ paypal: { ops } });
    await say(a, 'maker', TRACKING);
    let v = await view(a);
    expect(v.proposals).toEqual([]);
    expect(v.messages.at(-1)?.warnings).toContain('tracking_not_ready');

    await payDeposit(a);
    await say(a, 'maker', TRACKING);
    v = await view(a);
    const p = v.proposals.find((x) => x.tool === 'add_tracking')!;
    expect(p).toMatchObject({ status: 'pending', args: { carrier: 'DHL', trackingNumber: '4567891234', spokenCarrier: 'डीएचएल' }, reason: { code: 'maker_said' } });
    expect((await post(a, `/proposals/${p.id}/approve`, 'maker')).statusCode).toBe(202);
    await a.idle();
    expect(calls.addTracking).toEqual([['DHL', '4567891234']]);
    v = await view(a, 'buyer');
    expect(v.tracking).toMatchObject({ carrier: 'DHL', number: '4567891234', transactionIds: ['FAKECAP1'] });
    expect(v.phase).toBe('shipped');
    expect(v.messages.at(-1)?.event).toEqual({ type: 'shipped', params: { carrier: 'DHL', number: '4567891234' } });
    expect(v.timeline.at(-1)).toMatchObject({ type: 'tracking', carrier: 'DHL', trackingNumber: '4567891234', status: 'SHIPPED', txnIds: ['FAKECAP1'] });

    // Only one successful tracking per deal.
    await say(a, 'maker', TRACKING);
    expect((await view(a)).messages.at(-1)?.warnings).toContain('already_shipped');
  });

  it('needs a carrier from the list; the maker can correct the carrier and number on the card', async () => {
    const { ops, calls } = fakeOps();
    const a = await setup({ paypal: { ops } });
    await payDeposit(a);
    await say(a, 'maker', UNKNOWN_CARRIER);
    const p = (await view(a)).proposals.find((x) => x.tool === 'add_tracking')!;
    expect(p.args).toMatchObject({ carrier: null, trackingNumber: '12345678' });
    expect((await post(a, `/proposals/${p.id}/approve`, 'maker')).json()).toEqual({ error: 'carrier_required' });
    expect((await post(a, `/proposals/${p.id}/approve`, 'maker', { args: { carrier: 'INDIA_POST', trackingNumber: '1' } })).statusCode).toBe(400);
    expect((await post(a, `/proposals/${p.id}/approve`, 'maker', { args: { carrier: 'IND_DELHIVERY', trackingNumber: 'sauda 0001' } })).statusCode).toBe(202);
    await a.idle();
    expect(calls.addTracking).toEqual([['IND_DELHIVERY', 'SAUDA0001']]);
  });

  it('the manual form makes a proposal; a failure says there is no PayPal checkout payment', async () => {
    const noCheckout = async (): Promise<never> => {
      throw new TrackingError('no_paypal_payments', 'no PayPal checkout payments to attach tracking to');
    };
    const a = await setup({ paypal: { ops: fakeOps({ addTracking: noCheckout }).ops } });
    expect((await post(a, '/proposals', 'maker', { tool: 'add_tracking', args: { carrier: 'DHL', trackingNumber: '4567891234' } })).statusCode).toBe(409);
    await payDeposit(a);
    expect((await post(a, '/proposals', 'buyer', { tool: 'add_tracking', args: { carrier: 'DHL', trackingNumber: '4567891234' } })).statusCode).toBe(403);
    const res = await post(a, '/proposals', 'maker', { tool: 'add_tracking', args: { carrier: 'DHL', trackingNumber: '4567891234' } });
    expect(res.statusCode).toBe(201);
    const { proposalId } = res.json() as { proposalId: string };
    await post(a, `/proposals/${proposalId}/approve`, 'maker');
    await a.idle();
    const p = (await view(a, 'buyer')).proposals.find((x) => x.id === proposalId)!;
    expect(p).toMatchObject({ status: 'failed', error: 'no_paypal_payments', result: { message: 'no PayPal checkout payments to attach tracking to' }, reason: { code: 'manual' } });
  });
});

describe('send_reminder proposal', () => {
  it('runs send_invoice_reminder through the Agent Toolkit with the amount due in the buyer\'s language', async () => {
    const seen: { requestId: string; call: { function: { name: string; arguments: string } } }[] = [];
    const toolkit: ToolkitFactory = async ({ requestId }) => ({
      handleToolCall: async (call) => {
        seen.push({ requestId, call });
        return { content: '""' };
      },
    });
    const a = await setup({ paypal: { toolkit, fetch: fakePayPal().fetch } });
    await payDeposit(a);
    await say(a, 'maker', 'remind');
    const p = (await view(a)).proposals.find((x) => x.tool === 'send_reminder')!;
    expect(p).toMatchObject({ status: 'pending', reason: { code: 'maker_said' } });
    expect((await post(a, `/proposals/${p.id}/approve`, 'maker')).statusCode).toBe(202);
    await a.idle();
    expect(seen).toHaveLength(1);
    expect(seen[0].requestId).toBe(`sauda-${a.deal.id}-remind-1`);
    expect(seen[0].call.function.name).toBe('send_invoice_reminder');
    const args = JSON.parse(seen[0].call.function.arguments);
    expect(args).toEqual({ invoice_id: 'INV2-TEST-0000-0000-0001', note: expect.stringContaining('$84.00') });
    expect(args.note).toMatch(/^Friendly reminder/);
    const v = await view(a);
    expect(v.proposals.find((x) => x.id === p.id)?.status).toBe('done');
    expect(v.timeline.at(-1)).toMatchObject({ type: 'paypal_call', label: 'agent-toolkit send_invoice_reminder', method: 'POST', status: null, debugId: null });
    expect(v.messages.at(-1)?.event?.type).toBe('reminder_sent');
  });

  it('records a toolkit error, and is not allowed once the invoice is paid', async () => {
    const toolkit: ToolkitFactory = async () => ({
      handleToolCall: async () => ({ content: JSON.stringify({ ok: false, status: 422, code: 'PAYPAL_API_HTTP_ERROR', message: 'Reminder not allowed' }) }),
    });
    const a = await setup({ paypal: { toolkit, fetch: fakePayPal().fetch } });
    await payDeposit(a);
    const { proposalId } = (await post(a, '/proposals', 'maker', { tool: 'send_reminder' })).json() as { proposalId: string };
    await post(a, `/proposals/${proposalId}/approve`, 'maker');
    await a.idle();
    const v = await view(a);
    expect(v.proposals.find((x) => x.id === proposalId)).toMatchObject({ status: 'failed', error: 'paypal_error', result: { message: 'Reminder not allowed', httpStatus: 422 } });
    expect(v.timeline.at(-1)).toMatchObject({ label: 'agent-toolkit send_invoice_reminder', status: 422, error: 'Reminder not allowed' });

    await payDeposit(a, 'PAID');
    expect((await post(a, '/proposals', 'maker', { tool: 'send_reminder' })).json()).toEqual({ error: 'reminder_not_allowed' });
  });
});
