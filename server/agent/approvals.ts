import type { Deal, Proposal, ProposalTool, Role } from '../../shared/types.js';
import { pushEvent, ServiceError, type Logger } from '../deals/service.js';
import type { DealStore } from '../deals/store.js';
import { isCarrier, normalizeTrackingNumber } from '../domain/carriers.js';
import { formatMoney } from '../domain/money.js';
import { PayPalCallError, type PayPalClient, type PayPalCredentials } from '../paypal/client.js';
import { createAndSend, InvoiceValidationError, type CreatedInvoice } from '../paypal/invoices.js';
import { POLL_WINDOW_MS } from '../paypal/sync.js';
import { pushTimeline } from '../paypal/timeline.js';
import { addTracking, TrackingError } from '../paypal/tracking.js';
import { defaultToolkit, sendReminder, type ToolkitFactory } from '../paypal/toolkit.js';
import {
  invoiceBlocker,
  isOpen,
  proposeReminder,
  proposeTracking,
  reminderBlocker,
  setStatus,
  trackingBlocker,
  type PayPalOps,
  type ReminderResult,
  type TrackingResult,
} from './proposals.js';

const usd = (cents: number) => formatMoney(cents, 'USD');

/** The real PayPal side effects: our REST client for invoices and tracking, the Agent Toolkit for reminders. */
export function createPayPalOps(
  client: PayPalClient,
  cfg: { creds: PayPalCredentials; merchantEmail: string; buyerEmail: string },
  toolkit: ToolkitFactory = defaultToolkit,
): PayPalOps {
  return {
    createInvoice: (deal) => createAndSend(client, deal, { merchantEmail: cfg.merchantEmail, buyerEmail: cfg.buyerEmail }),
    addTracking: (deal, carrier, number) => addTracking(client, deal, carrier, number),
    sendReminder: (deal, n) => sendReminder(cfg.creds, deal, n, toolkit),
  };
}

/** What a failed proposal shows: a code (i18n) and PayPal's error name, message and debug ID. */
export function describeFailure(e: unknown): { code: string; detail: Record<string, unknown> } {
  if (e instanceof PayPalCallError) {
    return { code: e.status === 0 ? 'network_error' : 'paypal_error', detail: { name: e.paypalName, message: e.paypalMessage, debugId: e.debugId, httpStatus: e.status } };
  }
  if (e instanceof InvoiceValidationError) return { code: e.code, detail: e.params };
  if (e instanceof TrackingError) return { code: e.code, detail: { message: e.message } };
  return { code: 'internal', detail: { message: (e instanceof Error ? e.message : String(e)).slice(0, 200) } };
}

function find(d: Deal, id: string): Proposal {
  const p = d.proposals.find((x) => x.id === id);
  if (!p) throw new ServiceError(404, 'proposal_not_found');
  return p;
}

export interface ApprovalDeps {
  store: DealStore;
  /** null when PayPal is not configured: approvals then return 503. */
  ops: PayPalOps | null;
  now?: () => Date;
  log?: Logger;
}

/**
 * Runs proposals once the maker approves them. Every guard is re-checked in code under the deal
 * lock; the proposal is then marked running and PayPal is called outside the lock, so a second
 * approval of the same card is refused.
 */
export class ApprovalService {
  private readonly inflight = new Set<Promise<void>>();
  private readonly now: () => Date;

  constructor(private readonly deps: ApprovalDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  /** The maker's manual "Add tracking" form or "Remind buyer" button. */
  async propose(dealId: string, role: Role, tool: unknown, args: Record<string, unknown> = {}): Promise<Proposal> {
    if (role !== 'maker') throw new ServiceError(403, 'maker_only');
    let p!: Proposal;
    await this.deps.store.update(dealId, (d) => {
      const now = this.now();
      const reason = { code: 'manual' as const, params: { by: role } };
      if (tool === 'add_tracking') {
        const blocked = trackingBlocker(d);
        if (blocked) throw new ServiceError(409, blocked);
        if (!isCarrier(args.carrier)) throw new ServiceError(400, 'carrier_required');
        const number = normalizeTrackingNumber(args.trackingNumber);
        if (!number) throw new ServiceError(400, 'invalid_tracking_number');
        p = proposeTracking(d, args.carrier, number, reason, now);
      } else if (tool === 'send_reminder') {
        const blocked = reminderBlocker(d);
        if (blocked) throw new ServiceError(409, blocked);
        p = proposeReminder(d, reason, now);
      } else throw new ServiceError(400, 'invalid_tool');
    });
    return p;
  }

  async reject(dealId: string, role: Role, proposalId: string): Promise<Deal> {
    if (role !== 'maker') throw new ServiceError(403, 'maker_only');
    return this.deps.store.update(dealId, (d) => {
      const p = find(d, proposalId);
      if (!isOpen(p)) throw new ServiceError(409, 'proposal_not_pending', { status: p.status });
      setStatus(p, 'rejected', this.now());
    });
  }

  /**
   * Approves a proposal and starts it in the background. Returns the proposal as 'running'.
   * Only add_tracking accepts changed args (the maker can correct the carrier and number).
   */
  async approve(dealId: string, role: Role, proposalId: string, override?: Record<string, unknown>): Promise<Proposal> {
    if (role !== 'maker') throw new ServiceError(403, 'maker_only');
    if (!this.deps.ops) throw new ServiceError(503, 'paypal_not_configured');
    let blocked: string | null = null;
    let running!: Proposal;
    let deal!: Deal;
    await this.deps.store.update(dealId, (d) => {
      const now = this.now();
      const p = find(d, proposalId);
      if (!isOpen(p)) throw new ServiceError(409, 'proposal_not_pending', { status: p.status });
      if (override !== undefined) {
        if (p.tool !== 'add_tracking') throw new ServiceError(400, 'args_not_allowed');
        if (!isCarrier(override.carrier)) throw new ServiceError(400, 'carrier_required');
        const number = normalizeTrackingNumber(override.trackingNumber);
        if (!number) throw new ServiceError(400, 'invalid_tracking_number');
        p.args = { ...p.args, carrier: override.carrier, trackingNumber: number };
      }
      blocked = this.blocker(d, p, now);
      if (blocked) {
        // A proposal for an agreement that changed can never run; say so on the card.
        if (blocked === 'stale_proposal') setStatus(p, 'stale', now);
        return;
      }
      setStatus(p, 'running', now);
      delete p.error;
      delete p.result;
      running = structuredClone(p);
      deal = structuredClone(d);
    });
    if (blocked) throw new ServiceError(409, blocked);
    this.track(this.execute(dealId, running, deal));
    return running;
  }

  private blocker(d: Deal, p: Proposal, now: Date): string | null {
    const busy = (tool: ProposalTool) => d.proposals.some((x) => x.id !== p.id && x.tool === tool && x.status === 'running');
    switch (p.tool) {
      case 'create_invoice':
        return invoiceBlocker(d, p, now);
      case 'add_tracking':
        if (busy('add_tracking')) return 'tracking_in_progress';
        if (!isCarrier(p.args.carrier)) return trackingBlocker(d) ?? 'carrier_required';
        if (!normalizeTrackingNumber(p.args.trackingNumber)) return 'invalid_tracking_number';
        return trackingBlocker(d);
      case 'send_reminder':
        if (busy('send_reminder')) return 'reminder_in_progress';
        return reminderBlocker(d);
    }
  }

  private async execute(dealId: string, p: Proposal, deal: Deal): Promise<void> {
    const ops = this.deps.ops!;
    const { store } = this.deps;
    try {
      if (p.tool === 'create_invoice') {
        const created = await ops.createInvoice(deal);
        await store.update(dealId, (d) => this.invoiceCreated(d, p.id, created));
      } else if (p.tool === 'add_tracking') {
        const r = await ops.addTracking(deal, String(p.args.carrier), String(p.args.trackingNumber));
        await store.update(dealId, (d) => this.tracked(d, p.id, r));
      } else {
        const n = deal.proposals.filter((x) => x.tool === 'send_reminder').findIndex((x) => x.id === p.id) + 1;
        const r = await ops.sendReminder(deal, n);
        await store.update(dealId, (d) => this.reminded(d, p.id, r));
      }
    } catch (e) {
      const f = describeFailure(e);
      this.deps.log?.warn({ dealId, proposal: p.id, tool: p.tool, failure: f }, 'proposal failed');
      await store
        .update(dealId, (d) => {
          const cur = find(d, p.id);
          setStatus(cur, 'failed', this.now());
          cur.error = f.code;
          cur.result = f.detail;
        })
        .catch(() => undefined);
    }
  }

  private invoiceCreated(d: Deal, id: string, c: CreatedInvoice): void {
    const now = this.now();
    const p = find(d, id);
    d.invoice = c.snapshot;
    d.invoiceText = { noteSha256: c.noteSha256, reference: c.reference };
    d.pollUntil = new Date(now.getTime() + POLL_WINDOW_MS).toISOString();
    setStatus(p, 'done', now);
    p.result = { invoiceId: c.invoiceId, number: c.number };
    for (const x of d.proposals) if (x.id !== id && x.tool === 'create_invoice' && isOpen(x)) setStatus(x, 'stale', now);
    pushEvent(d, 'invoice_created', { number: c.number, total: usd(c.snapshot.totalCents), deposit: usd(c.snapshot.depositCents) }, now);
  }

  private tracked(d: Deal, id: string, r: TrackingResult): void {
    const now = this.now();
    const p = find(d, id);
    d.tracking = { carrier: r.carrier, number: r.number, transactionIds: r.transactionIds, at: now.toISOString() };
    const statuses = [...new Set(r.readBack.map((x) => x.status ?? 'UNKNOWN'))].join(', ');
    pushTimeline(d, { type: 'tracking', carrier: r.carrier, trackingNumber: r.number, status: statuses || 'UNKNOWN', txnIds: r.transactionIds }, now);
    setStatus(p, 'done', now);
    p.result = { transactionIds: r.transactionIds, readBack: r.readBack };
    pushEvent(d, 'shipped', { carrier: r.carrier, number: r.number }, now);
  }

  private reminded(d: Deal, id: string, r: ReminderResult): void {
    const now = this.now();
    const p = find(d, id);
    pushTimeline(
      d,
      {
        type: 'paypal_call',
        label: 'agent-toolkit send_invoice_reminder',
        method: 'POST',
        path: `/v2/invoicing/invoices/${d.invoice?.id ?? ''}/remind`,
        status: r.status,
        debugId: null,
        ms: r.ms,
        ...(r.ok ? {} : { error: r.message ?? 'failed' }),
      },
      now,
    );
    if (r.ok) {
      setStatus(p, 'done', now);
      p.result = { sent: true };
      pushEvent(d, 'reminder_sent', { amount: usd(d.invoice?.dueCents ?? 0) }, now);
    } else {
      setStatus(p, 'failed', now);
      p.error = 'paypal_error';
      p.result = { name: 'send_invoice_reminder', message: r.message ?? '', debugId: null, httpStatus: r.status };
    }
  }

  private track(p: Promise<void>): void {
    this.inflight.add(p);
    void p.finally(() => this.inflight.delete(p));
  }

  async whenIdle(): Promise<void> {
    while (this.inflight.size > 0) await Promise.allSettled([...this.inflight]);
  }
}
