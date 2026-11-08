/**
 * The maker's production board (report 7.2 item 7): one pure builder turns a deal into production
 * rows. "Deposit paid" and "Balance paid" are gates: the work after a gate stays locked until
 * PayPal confirms that payment. Both boards (the fallback CSS board and Bryntum Gantt) draw these
 * rows. Row names are i18n keys (`board.*` in client/src/i18n.ts); dates are ISO strings.
 */
import { depositPaid, fullyPaid, type DealView, type Lang } from './types.js';

export type BoardRowKind = 'order' | 'task' | 'milestone' | 'gate' | 'deadline';
export type BoardRowState = 'done' | 'ready' | 'locked';

export type BoardRowKey =
  | 'order'
  | 'confirmed'
  | 'deposit_paid'
  | 'cutting_embroidery'
  | 'photo_approved'
  | 'balance_paid'
  | 'pack_ship'
  | 'tracking_added'
  | 'ship_by';

export interface BoardRow {
  /** Unique across orders: the deal id for the order row, `<deal id>:<key>` for its children. */
  id: string;
  parentId?: string;
  /** The deal this row belongs to. */
  orderId: string;
  key: BoardRowKey;
  nameKey: string;
  params: Record<string, string | null>;
  kind: BoardRowKind;
  startDate: string;
  endDate: string;
  state: BoardRowState;
  percentDone: number;
  /** Locked rows: the step that blocks them (the first lock before them that is not done). */
  blockedBy?: BoardRowKey;
}

export interface BoardDependency {
  from: string;
  to: string;
}

export interface Board {
  startDate: string;
  endDate: string;
  rows: BoardRow[];
  dependencies: BoardDependency[];
}

const DAY = 86_400_000;
/** Without an agreed delivery date the plan runs this long. */
const DEFAULT_SPAN_DAYS = 21;
/** The shortest plan that fits both tasks at their minimum length of one day. */
const MIN_SPAN_DAYS = 3;

const iso = (ms: number) => new Date(ms).toISOString();
const dayStart = (ms: number) => Math.floor(ms / DAY) * DAY;

/** The ids of the static sample orders; their order row is labelled as a sample. */
export const SAMPLE_ORDER_IDS: readonly string[] = ['SAMPLE1', 'SAMPLE2'];

/** The facts the row states come from (the same ones derivePhase reads). */
function facts(view: DealView) {
  const c = view.confirmations;
  return {
    confirmed: Boolean((c.maker?.current && c.buyer?.current) || view.invoice),
    deposit: depositPaid(view),
    // PAID (or MARKED_AS_PAID) at once marks both gates done.
    balance: fullyPaid(view),
    photo: view.messages.some((m) => m.from === 'maker' && m.kind === 'photo' && m.photo?.kind === 'progress' && m.status !== 'failed'),
    approved: Boolean(view.progressApproval),
    tracking: Boolean(view.tracking),
  };
}

/** The plan's start: the later of the two current confirmations, or the deal's creation. Floored to the UTC day. */
function planStart(view: DealView): number {
  const { maker, buyer } = view.confirmations;
  const at = maker?.current && buyer?.current ? Math.max(Date.parse(maker.at), Date.parse(buyer.at)) : Date.parse(view.createdAt);
  return dayStart(at);
}

/** The plan's end: the agreed delivery date (or start + 21 days), at least 3 days after the start. */
function planEnd(view: DealView, start: number): number {
  const delivery = view.agreement.deliveryDate ? Date.parse(`${view.agreement.deliveryDate}T00:00:00Z`) : Number.NaN;
  const end = Number.isFinite(delivery) ? delivery : start + DEFAULT_SPAN_DAYS * DAY;
  return Math.max(end, start + MIN_SPAN_DAYS * DAY);
}

/** One order's production rows, gates and finish-to-start dependencies. */
export function buildBoard(view: DealView): Board {
  const f = facts(view);
  const start = planStart(view);
  const end = planEnd(view, start);
  const spanDays = Math.round((end - start) / DAY);
  const cutDays = Math.max(1, Math.round(spanDays * 0.6));
  const packDays = Math.max(1, Math.round(spanDays * 0.15));
  const cutEnd = Math.min(end, start + cutDays * DAY);
  const packEnd = Math.min(end, cutEnd + packDays * DAY);

  // A row that is not done is ready when every lock before it (the confirmation and the payment
  // gates) is done; otherwise it is locked.
  type Spec = { key: Exclude<BoardRowKey, 'order'>; kind: BoardRowKind; from: number; to: number; done: boolean; lock?: boolean };
  const specs: Spec[] = [
    { key: 'confirmed', kind: 'milestone', from: start, to: start, done: f.confirmed, lock: true },
    { key: 'deposit_paid', kind: 'gate', from: start, to: start, done: f.deposit, lock: true },
    { key: 'cutting_embroidery', kind: 'task', from: start, to: cutEnd, done: f.photo },
    { key: 'photo_approved', kind: 'milestone', from: cutEnd, to: cutEnd, done: f.approved },
    { key: 'balance_paid', kind: 'gate', from: cutEnd, to: cutEnd, done: f.balance, lock: true },
    { key: 'pack_ship', kind: 'task', from: cutEnd, to: packEnd, done: f.tracking },
    { key: 'tracking_added', kind: 'milestone', from: packEnd, to: packEnd, done: f.tracking },
    { key: 'ship_by', kind: 'deadline', from: end, to: end, done: f.tracking },
  ];

  const item = view.agreement.rows.find((r) => r.field === 'item')?.value ?? null;
  const sample = SAMPLE_ORDER_IDS.includes(view.id);
  const children: BoardRow[] = [];
  let blocker: BoardRowKey | null = null;
  for (const s of specs) {
    const state: BoardRowState = s.done ? 'done' : blocker ? 'locked' : 'ready';
    const blockedBy = state === 'locked' && blocker ? blocker : undefined;
    if (s.lock && !s.done && !blocker) blocker = s.key;
    children.push({
      id: `${view.id}:${s.key}`,
      parentId: view.id,
      orderId: view.id,
      key: s.key,
      nameKey: `board.row.${s.key}`,
      params: s.key === 'ship_by' ? { date: iso(end).slice(0, 10) } : {},
      kind: s.kind,
      startDate: iso(s.from),
      endDate: iso(s.to),
      state,
      percentDone: state === 'done' ? 100 : 0,
      ...(blockedBy ? { blockedBy } : {}),
    });
  }

  const doneCount = children.filter((r) => r.state === 'done').length;
  const order: BoardRow = {
    id: view.id,
    orderId: view.id,
    key: 'order',
    nameKey: sample ? 'board.order.sample' : 'board.order',
    params: { id: view.id, item, buyer: view.parties.buyer.name },
    kind: 'order',
    startDate: iso(start),
    endDate: iso(end),
    state: doneCount === children.length ? 'done' : 'ready',
    percentDone: Math.round((doneCount / children.length) * 100),
  };

  const dependencies = children.slice(1).map((r, i) => ({ from: children[i].id, to: r.id }));
  return { startDate: iso(start), endDate: iso(end), rows: [order, ...children], dependencies };
}

/** Several orders on one board: the date range covers all of them. */
export function mergeBoards(boards: Board[]): Board {
  if (boards.length === 0) {
    const now = iso(dayStart(Date.now()));
    return { startDate: now, endDate: now, rows: [], dependencies: [] };
  }
  return {
    startDate: boards.map((b) => b.startDate).reduce((a, b) => (b < a ? b : a)),
    endDate: boards.map((b) => b.endDate).reduce((a, b) => (b > a ? b : a)),
    rows: boards.flatMap((b) => b.rows),
    dependencies: boards.flatMap((b) => b.dependencies),
  };
}

const SAMPLE_ITEMS: Record<Lang, [string, string]> = {
  en: ['Block-print cotton saree', 'Embroidered silk dupatta'],
  hi: ['ब्लॉक-प्रिंट सूती साड़ी', 'कढ़ाई वाला रेशमी दुपट्टा'],
  es: ['Sari de algodón estampado a mano', 'Dupatta de seda bordada'],
};

/** A minimal DealView for a sample order (only the fields the board reads carry data). */
function sampleView(
  id: string,
  buyer: string,
  item: string,
  times: { created: number; confirmed: number; delivery: number },
  invoice: { status: string; paidCents: number } | null,
  lang: Lang,
): DealView {
  const at = iso(times.confirmed);
  const conf = { hash: 'sample', at, current: true };
  return {
    id,
    role: 'maker',
    parties: { maker: { name: 'Ravi Chikan', lang }, buyer: { name: buyer, lang: 'en' } },
    phase: invoice ? (invoice.paidCents > 0 ? 'deposit_paid' : 'invoiced') : 'confirmed',
    agreement: {
      rows: [{ field: 'item', value: item, sourceMessageId: null, seq: null }],
      derived: { currency: 'USD', totalCents: 10000, depositCents: 3000, balanceCents: 7000, depositPercent: 30 },
      missing: [],
      errors: [],
      hash: 'sample',
      locked: true,
      summary: [],
      deliveryDate: iso(times.delivery).slice(0, 10),
    },
    messages: [],
    questions: [],
    confirmations: { maker: conf, buyer: conf },
    invoice: invoice && {
      id: `INV2-${id}`,
      number: id,
      status: invoice.status,
      payerUrl: '',
      totalCents: 10000,
      paidCents: invoice.paidCents,
      dueCents: 10000 - invoice.paidCents,
      depositCents: 3000,
      transactions: [],
      noteSha256: '',
      textMatches: true,
    },
    proposals: [],
    timeline: [],
    tracking: null,
    progressApproval: null,
    createdAt: iso(times.created),
    updatedAt: at,
  };
}

/**
 * Two sample orders that sit next to the real deal on the board, so it shows several orders: one
 * with the deposit paid (work under way), one waiting for the deposit (work locked). Their dates
 * are relative to `now` (whole UTC days), so they stay current while the demo is hosted.
 */
export function sampleOrders(now: Date, lang: Lang): DealView[] {
  const today = dayStart(now.getTime());
  const [first, second] = SAMPLE_ITEMS[lang];
  return [
    sampleView(SAMPLE_ORDER_IDS[0], 'Maria López', first, { created: today - 7 * DAY, confirmed: today - 6 * DAY, delivery: today + 14 * DAY }, { status: 'PARTIALLY_PAID', paidCents: 3000 }, lang),
    sampleView(SAMPLE_ORDER_IDS[1], 'Jonas Weber', second, { created: today - 2 * DAY, confirmed: today - DAY, delivery: today + 24 * DAY }, { status: 'UNPAID', paidCents: 0 }, lang),
  ];
}
