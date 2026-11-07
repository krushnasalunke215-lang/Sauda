import type { Deal, Message, Proposal, ProposalReason, ProposalTool } from '../../shared/types.js';
import { canonicalHash, derive, missingRequired, validate } from '../domain/agreement.js';
import { checkTextLimits } from '../domain/agreement-text.js';
import { isCarrier, mapCarrier, normalizeTrackingNumber } from '../domain/carriers.js';
import { todayUtc } from '../domain/dates.js';
import { bothConfirmed } from '../domain/phase.js';
import type { CreatedInvoice } from '../paypal/invoices.js';

/**
 * "AI proposes, code decides, a human approves, PayPal executes." Proposals are created from facts
 * (both confirmations) or from the maker's spoken intent; the guards below are re-checked in code
 * when the maker approves, and only then does PayPal run.
 */

export interface TrackingResult {
  carrier: string;
  number: string;
  transactionIds: string[];
  /** Tracker status read back from PayPal, per transaction. */
  readBack: { transactionId: string; status: string | null }[];
}

export interface ReminderResult {
  ok: boolean;
  ms: number;
  /** HTTP status when the toolkit reported one (on errors). */
  status: number | null;
  message?: string;
}

/** The PayPal side effects a proposal can run (faked in tests). */
export interface PayPalOps {
  createInvoice(deal: Deal): Promise<CreatedInvoice>;
  addTracking(deal: Deal, carrier: string, number: string): Promise<TrackingResult>;
  sendReminder(deal: Deal, n: number): Promise<ReminderResult>;
}

/** Invoice statuses a reminder makes sense for. */
export const REMINDER_STATUSES = new Set(['UNPAID', 'PARTIALLY_PAID']);

const OPEN = new Set<Proposal['status']>(['pending', 'failed']);

export function addProposal(d: Deal, tool: ProposalTool, args: Record<string, unknown>, reason: ProposalReason, now: Date): Proposal {
  const p: Proposal = { id: `p${d.proposals.length + 1}`, tool, args, status: 'pending', reason, createdAt: now.toISOString() };
  d.proposals.push(p);
  return p;
}

export function setStatus(p: Proposal, status: Proposal['status'], now: Date): void {
  p.status = status;
  p.updatedAt = now.toISOString();
}

/** Marks open create_invoice proposals for another agreement hash as stale. */
export function markStale(d: Deal, now: Date, hash: string = canonicalHash(d)): void {
  for (const p of d.proposals) if (p.tool === 'create_invoice' && OPEN.has(p.status) && p.args.hash !== hash) setStatus(p, 'stale', now);
}

/** After both sides confirm the same hash: propose creating the invoice (once per hash). */
export function proposeInvoice(d: Deal, now: Date): Proposal | null {
  if (d.invoice) return null;
  const hash = canonicalHash(d);
  markStale(d, now, hash);
  if (d.proposals.some((p) => p.tool === 'create_invoice' && p.args.hash === hash && (OPEN.has(p.status) || p.status === 'running'))) return null;
  const { totalCents, depositCents } = derive(d.terms);
  return addProposal(d, 'create_invoice', { totalCents, depositCents, hash }, { code: 'both_confirmed', params: { hash: hash.slice(0, 12) } }, now);
}

/** Why a tracking proposal cannot be made or run now, or null. */
export function trackingBlocker(d: Deal): string | null {
  if (!d.invoice) return 'no_invoice';
  if (d.invoice.paidCents <= 0 && d.invoice.transactions.length === 0) return 'no_payment_yet';
  if (d.tracking) return 'already_shipped';
  return null;
}

/** Why a reminder cannot be proposed or sent now, or null. */
export function reminderBlocker(d: Deal): string | null {
  if (!d.invoice) return 'no_invoice';
  if (!REMINDER_STATUSES.has(d.invoice.status)) return 'reminder_not_allowed';
  return null;
}

/** Supersedes the open proposals of one tool (a newer request replaces them). */
function supersede(d: Deal, tool: ProposalTool, now: Date): void {
  for (const p of d.proposals) if (p.tool === tool && OPEN.has(p.status)) setStatus(p, 'stale', now);
}

export function proposeTracking(d: Deal, carrierSpoken: string | null, trackingNumber: string, reason: ProposalReason, now: Date): Proposal {
  supersede(d, 'add_tracking', now);
  const carrier = isCarrier(carrierSpoken) ? carrierSpoken : mapCarrier(carrierSpoken);
  return addProposal(d, 'add_tracking', { carrier, trackingNumber, spokenCarrier: carrierSpoken }, reason, now);
}

export function proposeReminder(d: Deal, reason: ProposalReason, now: Date): Proposal {
  supersede(d, 'send_reminder', now);
  return addProposal(d, 'send_reminder', { invoiceId: d.invoice?.id ?? null, dueCents: d.invoice?.dueCents ?? null }, reason, now);
}

/**
 * Turns the maker's spoken intent (add tracking, send a reminder) into a pending proposal.
 * Returns a warning code for the message when the intent cannot be acted on yet.
 */
export function proposeFromIntent(d: Deal, m: Message, now: Date): string | null {
  const intent = m.intent;
  if (m.from !== 'maker' || !intent || intent.kind === 'none') return null;
  const reason: ProposalReason = { code: 'maker_said', params: { seq: m.seq } };
  if (intent.kind === 'add_tracking') {
    const blocked = trackingBlocker(d);
    if (blocked) return blocked === 'already_shipped' ? 'already_shipped' : 'tracking_not_ready';
    const number = normalizeTrackingNumber(intent.trackingNumber);
    if (!number) return 'tracking_number_missing';
    proposeTracking(d, intent.carrier, number, reason, now);
    return null;
  }
  if (reminderBlocker(d)) return 'reminder_not_allowed';
  proposeReminder(d, reason, now);
  return null;
}

/** Guards for creating the invoice, re-checked when the maker approves. Returns an error code or null. */
export function invoiceBlocker(d: Deal, p: Proposal, now: Date): string | null {
  if (d.cancelled) return 'cancelled';
  if (d.invoice) return 'invoice_already_created';
  if (d.proposals.some((x) => x.id !== p.id && x.tool === 'create_invoice' && x.status === 'running')) return 'invoice_in_progress';
  const hash = canonicalHash(d);
  if (p.args.hash !== hash) return 'stale_proposal';
  if (!bothConfirmed(d, hash)) return 'not_confirmed';
  if (missingRequired(d.terms).length || validate(d.terms, todayUtc(now)).length || checkTextLimits(d).length) return 'not_ready';
  return null;
}

/** True while a proposal may still be approved (a failed one may be tried again). */
export const isOpen = (p: Proposal): boolean => OPEN.has(p.status);
