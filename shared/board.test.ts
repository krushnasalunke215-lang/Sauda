import { describe, expect, it } from 'vitest';
import { buildBoard, mergeBoards, sampleOrders, type BoardRowState } from './board.js';
import type { DealView, InvoiceSnapshot, Message } from './types.js';

const CREATED = '2026-11-08T09:15:00.000Z';
const CONFIRMED_LATER = '2026-11-09T14:30:00.000Z';

function baseView(): DealView {
  return {
    id: 'DEAL1',
    role: 'maker',
    parties: { maker: { name: 'Ravi Chikan', lang: 'hi' }, buyer: { name: 'Emily Carter', lang: 'en' } },
    phase: 'negotiating',
    agreement: {
      rows: [{ field: 'item', value: 'चिकनकारी कुर्ता', sourceMessageId: 'm1', seq: 1 }],
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
    createdAt: CREATED,
    updatedAt: CREATED,
  };
}

const invoice = (status: string, paidCents: number): InvoiceSnapshot => ({
  id: 'INV2-TEST',
  number: '0001',
  status,
  payerUrl: 'https://www.sandbox.paypal.com/invoice/p/#INV2-TEST',
  totalCents: 12000,
  paidCents,
  dueCents: 12000 - paidCents,
  depositCents: 3600,
  transactions: [],
  noteSha256: '',
  textMatches: true,
});

const progressPhoto: Message = {
  id: 'm9',
  seq: 9,
  from: 'maker',
  kind: 'photo',
  status: 'done',
  photo: { kind: 'progress', checks: [] },
  createdAt: '2026-11-20T10:00:00.000Z',
};

const confirmed = (v: DealView): DealView => ({
  ...v,
  phase: 'confirmed',
  confirmations: { maker: { hash: 'h1', at: CREATED, current: true }, buyer: { hash: 'h1', at: CONFIRMED_LATER, current: true } },
});
const invoiced = (v: DealView): DealView => ({ ...confirmed(v), phase: 'invoiced', invoice: invoice('UNPAID', 0) });
const deposit = (v: DealView): DealView => ({ ...invoiced(v), phase: 'deposit_paid', invoice: invoice('PARTIALLY_PAID', 3600) });
const approved = (v: DealView): DealView => ({
  ...deposit(v),
  messages: [progressPhoto],
  progressApproval: { messageId: 'm9', at: '2026-11-21T10:00:00.000Z' },
});
const paid = (v: DealView): DealView => ({ ...approved(v), phase: 'paid', invoice: invoice('PAID', 12000) });
const shipped = (v: DealView): DealView => ({
  ...paid(v),
  phase: 'shipped',
  tracking: { carrier: 'DHL', number: '4567891234', transactionIds: ['T1'], at: '2026-12-01T10:00:00.000Z' },
});

/** The state of every child row, by key. */
function states(v: DealView): Record<string, BoardRowState> {
  return Object.fromEntries(
    buildBoard(v)
      .rows.filter((r) => r.kind !== 'order')
      .map((r) => [r.key, r.state]),
  );
}

describe('buildBoard', () => {
  it('builds the order row and its eight children with finish-to-start dependencies in order', () => {
    const b = buildBoard(baseView());
    expect(b.rows.map((r) => r.key)).toEqual([
      'order',
      'confirmed',
      'deposit_paid',
      'cutting_embroidery',
      'photo_approved',
      'balance_paid',
      'pack_ship',
      'tracking_added',
      'ship_by',
    ]);
    expect(b.rows.map((r) => r.kind)).toEqual(['order', 'milestone', 'gate', 'task', 'milestone', 'gate', 'task', 'milestone', 'deadline']);
    expect(b.rows[0]).toMatchObject({ id: 'DEAL1', nameKey: 'board.order', params: { id: 'DEAL1', item: 'चिकनकारी कुर्ता', buyer: 'Emily Carter' } });
    for (const r of b.rows.slice(1)) {
      expect(r.parentId).toBe('DEAL1');
      expect(r.id).toBe(`DEAL1:${r.key}`);
      expect(r.nameKey).toBe(`board.row.${r.key}`);
    }
    expect(b.dependencies).toEqual([
      { from: 'DEAL1:confirmed', to: 'DEAL1:deposit_paid' },
      { from: 'DEAL1:deposit_paid', to: 'DEAL1:cutting_embroidery' },
      { from: 'DEAL1:cutting_embroidery', to: 'DEAL1:photo_approved' },
      { from: 'DEAL1:photo_approved', to: 'DEAL1:balance_paid' },
      { from: 'DEAL1:balance_paid', to: 'DEAL1:pack_ship' },
      { from: 'DEAL1:pack_ship', to: 'DEAL1:tracking_added' },
      { from: 'DEAL1:tracking_added', to: 'DEAL1:ship_by' },
    ]);
  });

  it('negotiating: only the confirmation is open, everything after it is locked', () => {
    expect(states(baseView())).toEqual({
      confirmed: 'ready',
      deposit_paid: 'locked',
      cutting_embroidery: 'locked',
      photo_approved: 'locked',
      balance_paid: 'locked',
      pack_ship: 'locked',
      tracking_added: 'locked',
      ship_by: 'locked',
    });
  });

  it('confirmed and invoiced: the deposit gate is open, the work stays locked behind it', () => {
    for (const v of [confirmed(baseView()), invoiced(baseView())]) {
      expect(states(v)).toMatchObject({ confirmed: 'done', deposit_paid: 'ready', cutting_embroidery: 'locked', pack_ship: 'locked' });
    }
  });

  it('deposit paid: cutting and embroidery is ready, packing stays locked behind the balance gate', () => {
    expect(states(deposit(baseView()))).toEqual({
      confirmed: 'done',
      deposit_paid: 'done',
      cutting_embroidery: 'ready',
      photo_approved: 'ready',
      balance_paid: 'ready',
      pack_ship: 'locked',
      tracking_added: 'locked',
      ship_by: 'locked',
    });
  });

  it('names the gate that blocks each locked row', () => {
    const blocked = (v: DealView) => Object.fromEntries(buildBoard(v).rows.filter((r) => r.blockedBy).map((r) => [r.key, r.blockedBy]));
    expect(blocked(invoiced(baseView()))).toMatchObject({ cutting_embroidery: 'deposit_paid', pack_ship: 'deposit_paid' });
    expect(blocked(deposit(baseView()))).toEqual({ pack_ship: 'balance_paid', tracking_added: 'balance_paid', ship_by: 'balance_paid' });
    expect(blocked(paid(baseView()))).toEqual({});
  });

  it('photo approved: cutting and embroidery is done once the progress photo exists', () => {
    expect(states(approved(baseView()))).toMatchObject({ cutting_embroidery: 'done', photo_approved: 'done', balance_paid: 'ready', pack_ship: 'locked' });
    // A failed photo does not count.
    const failed = { ...deposit(baseView()), messages: [{ ...progressPhoto, status: 'failed' as const }] };
    expect(states(failed).cutting_embroidery).toBe('ready');
  });

  it('paid: the balance gate is done and packing and shipping is ready', () => {
    expect(states(paid(baseView()))).toMatchObject({ balance_paid: 'done', pack_ship: 'ready', tracking_added: 'ready', ship_by: 'ready' });
    // Recorded payments end as MARKED_AS_PAID, which counts the same.
    expect(states({ ...paid(baseView()), invoice: invoice('MARKED_AS_PAID', 12000) }).balance_paid).toBe('done');
  });

  it('shipped: everything is done and the order is complete', () => {
    const b = buildBoard(shipped(baseView()));
    expect(b.rows.every((r) => r.state === 'done')).toBe(true);
    expect(b.rows[0].percentDone).toBe(100);
  });

  it('PAID at once (the buyer paid the total in one checkout) marks both gates done', () => {
    const v = { ...invoiced(baseView()), phase: 'paid' as const, invoice: invoice('PAID', 12000) };
    expect(states(v)).toEqual({
      confirmed: 'done',
      deposit_paid: 'done',
      cutting_embroidery: 'ready',
      photo_approved: 'ready',
      balance_paid: 'done',
      pack_ship: 'ready',
      tracking_added: 'ready',
      ship_by: 'ready',
    });
  });

  it('dates: start at the later confirmation day, end at the delivery date, every row inside [start, end]', () => {
    for (const v of [baseView(), confirmed(baseView()), deposit(baseView()), paid(baseView()), shipped(baseView())]) {
      const b = buildBoard(v);
      for (const r of b.rows) {
        expect(r.startDate >= b.startDate, `${r.key} start`).toBe(true);
        expect(r.endDate <= b.endDate, `${r.key} end`).toBe(true);
        expect(r.startDate <= r.endDate, `${r.key} order`).toBe(true);
        if (r.kind === 'milestone' || r.kind === 'gate' || r.kind === 'deadline') expect(r.startDate).toBe(r.endDate);
      }
    }
    const b = buildBoard(confirmed(baseView()));
    expect(b.startDate).toBe('2026-11-09T00:00:00.000Z');
    expect(b.endDate).toBe('2026-12-10T00:00:00.000Z');
    const row = (k: string) => b.rows.find((r) => r.key === k)!;
    // 31 days: cutting and embroidery 60 % (19 days), packing 15 % (5 days).
    expect(row('cutting_embroidery').endDate).toBe('2026-11-28T00:00:00.000Z');
    expect(row('pack_ship')).toMatchObject({ startDate: '2026-11-28T00:00:00.000Z', endDate: '2026-12-03T00:00:00.000Z' });
    expect(row('ship_by')).toMatchObject({ startDate: '2026-12-10T00:00:00.000Z', params: { date: '2026-12-10' } });
    // Before both confirm, the plan starts at the deal's creation.
    expect(buildBoard(baseView()).startDate).toBe('2026-11-08T00:00:00.000Z');
  });

  it('dates: 21 days without a delivery date, and at least one day per task for a very short plan', () => {
    const none = buildBoard({ ...baseView(), agreement: { ...baseView().agreement, deliveryDate: null } });
    expect(none.endDate).toBe('2026-11-29T00:00:00.000Z');
    const short = buildBoard({ ...baseView(), agreement: { ...baseView().agreement, deliveryDate: '2026-11-08' } });
    expect(short.endDate).toBe('2026-11-11T00:00:00.000Z');
    for (const k of ['cutting_embroidery', 'pack_ship']) {
      const r = short.rows.find((x) => x.key === k)!;
      expect(Date.parse(r.endDate) - Date.parse(r.startDate)).toBeGreaterThanOrEqual(86_400_000);
      expect(r.endDate <= short.endDate).toBe(true);
    }
  });
});

describe('sample orders', () => {
  it('builds two labelled sample orders through the same function: one with the deposit paid, one waiting for it', () => {
    const now = new Date('2026-12-05T12:00:00Z');
    const [a, b] = sampleOrders(now, 'hi').map(buildBoard);
    expect(a.rows[0]).toMatchObject({ nameKey: 'board.order.sample', params: { item: 'ब्लॉक-प्रिंट सूती साड़ी' } });
    expect(a.rows.find((r) => r.key === 'deposit_paid')!.state).toBe('done');
    expect(a.rows.find((r) => r.key === 'cutting_embroidery')!.state).toBe('ready');
    expect(b.rows[0].nameKey).toBe('board.order.sample');
    expect(b.rows.find((r) => r.key === 'deposit_paid')!.state).toBe('ready');
    expect(b.rows.find((r) => r.key === 'cutting_embroidery')!.state).toBe('locked');
    // Dates follow today, so the samples stay current while the demo is hosted.
    expect(a.startDate).toBe('2026-11-29T00:00:00.000Z');

    const merged = mergeBoards([buildBoard(baseView()), a, b]);
    expect(merged.rows).toHaveLength(27);
    expect(new Set(merged.rows.map((r) => r.id)).size).toBe(27);
    expect(merged.startDate).toBe('2026-11-08T00:00:00.000Z');
    expect(merged.endDate).toBe(b.endDate);
  });
});
