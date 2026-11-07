import { fullyPaid, type Deal, type InvoiceSnapshot, type PaymentKind } from '../../shared/types.js';
import { pushEvent, ServiceError, type Logger } from '../deals/service.js';
import type { DealStore } from '../deals/store.js';
import { formatMoney } from '../domain/money.js';
import type { PayPalClient } from './client.js';
import { getInvoice, snapshot } from './invoices.js';
import { pushTimeline } from './timeline.js';

export type SyncSource = 'poll' | 'webhook' | 'manual' | 'join';

/** Statuses the poller keeps watching. */
export const POLL_STATUSES = new Set(['UNPAID', 'SENT', 'PARTIALLY_PAID']);
export const POLL_WINDOW_MS = 2 * 60 * 60 * 1000;
export const MANUAL_REFRESH_MS = 5_000;

const usd = (cents: number) => formatMoney(cents, 'USD');
const sumCents = (s: InvoiceSnapshot) => s.transactions.reduce((n, t) => n + t.cents, 0);

function eventCents(d: Deal, type: string): number | null {
  const m = d.messages.find((x) => x.event?.type === type);
  const c = m?.event?.params.cents;
  return m ? (typeof c === 'number' ? c : 0) : null;
}

/**
 * Applies a fresh invoice snapshot to the deal (under the deal lock) and records what changed:
 * payment entries and events for new transactions, the deposit, the balance or a payment in full,
 * a cancellation, status changes, and an alert when the invoice text stops matching the agreement.
 * Applying the same snapshot again changes nothing. Returns true when something changed.
 */
export function applySnapshot(d: Deal, snap: InvoiceSnapshot, source: SyncSource, now: Date, debugId: string | null = null): boolean {
  const prev = d.invoice;
  if (!prev) return false;
  const next: InvoiceSnapshot = { ...snap, payerUrl: prev.payerUrl || snap.payerUrl, depositCents: prev.depositCents };
  const known = new Set(prev.transactions.map((t) => t.id));
  const fresh = next.transactions.filter((t) => !known.has(t.id));
  const before = JSON.stringify(prev);

  let depositDone = eventCents(d, 'deposit_received') !== null || eventCents(d, 'paid_in_full') !== null;
  const fullDone = eventCents(d, 'balance_received') !== null || eventCents(d, 'paid_in_full') !== null;
  const paidNow = fullyPaid({ invoice: next });

  let running = sumCents(prev);
  for (const t of fresh) {
    running += t.cents;
    let kind: PaymentKind = 'other';
    if (running >= next.totalCents && next.totalCents > 0) kind = depositDone ? 'balance' : 'full';
    else if (!depositDone && next.depositCents > 0 && running >= next.depositCents) kind = 'deposit';
    pushTimeline(d, { type: 'payment', kind, cents: t.cents, txnId: t.id, method: t.method }, now);
    if (kind === 'deposit') {
      depositDone = true;
      // The amount actually paid so far, which can be more than the deposit.
      pushEvent(d, 'deposit_received', { cents: running, amount: usd(running), due: usd(next.dueCents) }, now);
    }
  }
  // Paid changed without a transaction we could see (should not happen, but the amounts rule).
  if (!depositDone && !paidNow && next.depositCents > 0 && next.paidCents >= next.depositCents) {
    depositDone = true;
    pushEvent(d, 'deposit_received', { cents: next.paidCents, amount: usd(next.paidCents), due: usd(next.dueCents) }, now);
  }
  if (paidNow && !fullDone) {
    const atDeposit = eventCents(d, 'deposit_received');
    if (atDeposit !== null) pushEvent(d, 'balance_received', { cents: next.paidCents - atDeposit, amount: usd(next.paidCents - atDeposit), total: usd(next.paidCents) }, now);
    else pushEvent(d, 'paid_in_full', { cents: next.paidCents, amount: usd(next.paidCents) }, now);
  }
  if (next.status === 'CANCELLED' && prev.status !== 'CANCELLED') pushEvent(d, 'invoice_cancelled', { number: next.number }, now);
  if (next.status !== prev.status) {
    pushTimeline(d, { type: 'poll_change', from: prev.status || null, to: next.status, paidCents: next.paidCents, source, debugId }, now);
  }
  if (prev.textMatches && !next.textMatches) {
    pushTimeline(d, { type: 'alert', code: 'invoice_text_changed', params: { status: next.status, noteSha256: next.noteSha256.slice(0, 16) } }, now);
    pushEvent(d, 'invoice_text_changed', { number: next.number }, now);
  }
  d.invoice = next;
  return JSON.stringify(next) !== before || fresh.length > 0;
}

/** True when the snapshot holds nothing new compared with the stored one. */
export function sameSnapshot(a: InvoiceSnapshot | null, b: InvoiceSnapshot): boolean {
  if (!a) return false;
  return (
    a.status === b.status &&
    a.paidCents === b.paidCents &&
    a.dueCents === b.dueCents &&
    a.totalCents === b.totalCents &&
    a.textMatches === b.textMatches &&
    a.noteSha256 === b.noteSha256 &&
    a.transactions.map((t) => t.id).join() === b.transactions.map((t) => t.id).join()
  );
}

export interface SyncDeps {
  store: DealStore;
  client: PayPalClient | null;
  now?: () => Date;
  log?: Logger;
}

/**
 * Keeps the stored invoice snapshot in step with PayPal. Every source (the poller, a webhook, the
 * buyer's "check now" button, a page opening) re-reads the invoice; webhook bodies are never trusted
 * for amounts. Syncs of one deal run one at a time.
 */
export class InvoiceSync {
  private readonly chains = new Map<string, Promise<unknown>>();
  private readonly inflight = new Set<Promise<unknown>>();
  private readonly lastManual = new Map<string, number>();
  private readonly lastJoin = new Map<string, number>();
  private readonly now: () => Date;

  constructor(private readonly deps: SyncDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  get configured(): boolean {
    return this.deps.client !== null;
  }

  /** GETs the invoice and applies it under the deal lock. Resolves to true when something changed. */
  syncInvoice(dealId: string, source: SyncSource): Promise<boolean> {
    const prev = this.chains.get(dealId) ?? Promise.resolve();
    const run = prev.then(() => this.syncOnce(dealId, source));
    const tail = run.catch(() => undefined);
    this.chains.set(dealId, tail);
    void tail.then(() => {
      if (this.chains.get(dealId) === tail) this.chains.delete(dealId);
    });
    return run;
  }

  private async syncOnce(dealId: string, source: SyncSource): Promise<boolean> {
    const client = this.deps.client;
    const deal = this.deps.store.get(dealId);
    if (!client || !deal?.invoice) return false;
    // Background reads stay off the money timeline; the changes they find are recorded instead.
    const quiet = source === 'poll' || source === 'join';
    const res = await getInvoice(client, deal.invoice.id, { dealId, quiet, label: `get-invoice (${source})` });
    if (!res.ok) {
      this.deps.log?.warn({ dealId, source, status: res.status, debugId: res.debugId }, 'invoice sync failed');
      return false;
    }
    const expect = deal.invoiceText ? { ...deal.invoiceText, payerUrl: deal.invoice.payerUrl } : undefined;
    const snap = snapshot(res.body, deal.invoice.depositCents, expect);
    if (sameSnapshot(deal.invoice, snap)) return false;
    let changed = false;
    await this.deps.store.update(dealId, (d) => {
      changed = applySnapshot(d, snap, source, this.now(), res.debugId);
    });
    return changed;
  }

  /** Starts a sync in the background (webhooks, page joins). */
  trigger(dealId: string, source: SyncSource): void {
    const p = this.syncInvoice(dealId, source).catch((e) => {
      this.deps.log?.warn({ dealId, source, err: e instanceof Error ? e.message : String(e) }, 'invoice sync error');
      return false;
    });
    this.inflight.add(p);
    void p.finally(() => this.inflight.delete(p));
  }

  /** The buyer's "I've paid, check now" button: at most once per 5 s per deal. */
  async refresh(dealId: string): Promise<boolean> {
    const deal = this.deps.store.get(dealId);
    if (!deal?.invoice) throw new ServiceError(409, 'no_invoice');
    if (!this.deps.client) throw new ServiceError(503, 'paypal_not_configured');
    const t = this.now().getTime();
    if (t - (this.lastManual.get(dealId) ?? 0) < MANUAL_REFRESH_MS) throw new ServiceError(429, 'too_soon');
    this.lastManual.set(dealId, t);
    this.touch(dealId);
    return this.syncInvoice(dealId, 'manual');
  }

  /** Keeps the poller watching an open invoice for two more hours (called on every deal action). */
  touch(dealId: string): void {
    const deal = this.deps.store.get(dealId);
    if (!deal?.invoice || !POLL_STATUSES.has(deal.invoice.status)) return;
    const now = this.now().getTime();
    const until = deal.pollUntil ? Date.parse(deal.pollUntil) : 0;
    // Writing (and broadcasting) at most every few minutes is enough for a two-hour window.
    if (until - now > POLL_WINDOW_MS - 5 * 60_000) return;
    const p = this.deps.store
      .update(dealId, (d) => {
        d.pollUntil = new Date(now + POLL_WINDOW_MS).toISOString();
      })
      .catch(() => undefined);
    this.inflight.add(p);
    void p.finally(() => this.inflight.delete(p));
  }

  /** A page opened the deal: extend polling and re-read the invoice (at most every 5 s per deal). */
  onJoin(dealId: string): void {
    const deal = this.deps.store.get(dealId);
    if (!deal?.invoice || !this.deps.client) return;
    this.touch(dealId);
    const t = this.now().getTime();
    if (t - (this.lastJoin.get(dealId) ?? 0) < MANUAL_REFRESH_MS) return;
    this.lastJoin.set(dealId, t);
    this.trigger(dealId, 'join');
  }

  async whenIdle(): Promise<void> {
    while (this.inflight.size > 0 || this.chains.size > 0) await Promise.allSettled([...this.inflight, ...this.chains.values()]);
  }
}
