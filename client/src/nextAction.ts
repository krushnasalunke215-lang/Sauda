import { depositPaid, fullyPaid, otherRole, type DealView, type Role } from '../../shared/types.js';

/**
 * The one thing the viewer should do next (the "Your turn" line), or whose move it is. Read-only:
 * it derives everything from the deal view and never changes PayPal or money state.
 */
export type NextAction =
  | { kind: 'confirm' }
  | { kind: 'approveInvoice' }
  | { kind: 'payDeposit'; cents: number }
  | { kind: 'sendPhoto' }
  | { kind: 'reviewPhoto' }
  | { kind: 'payBalance'; cents: number }
  | { kind: 'waiting'; who: Role };

export function nextAction(view: DealView): NextAction | null {
  const role = view.role;
  const other = otherRole(role);
  const maker = role === 'maker';
  const inv = view.invoice;
  if (view.phase === 'cancelled' || inv?.status === 'CANCELLED') return null;

  if (!inv) {
    const a = view.agreement;
    if (a.locked || a.missing.length > 0 || a.errors.length > 0) return null;
    if (!view.confirmations[role]?.current) return { kind: 'confirm' };
    if (!view.confirmations[other]?.current) return { kind: 'waiting', who: other };
    const invoiceOpen = view.proposals.some((p) => p.tool === 'create_invoice' && (p.status === 'pending' || p.status === 'failed'));
    if (!invoiceOpen) return null;
    return maker ? { kind: 'approveInvoice' } : { kind: 'waiting', who: 'maker' };
  }

  if (fullyPaid(view)) return null;
  if (!depositPaid(view)) return maker ? { kind: 'waiting', who: 'buyer' } : { kind: 'payDeposit', cents: inv.depositCents };
  if (view.progressApproval) return maker ? { kind: 'waiting', who: 'buyer' } : { kind: 'payBalance', cents: inv.dueCents };

  // Deposit paid, no approval yet: the buyer reviews the latest progress photo, or the maker sends one.
  const photo = view.messages.findLast((m) => m.from === 'maker' && m.kind === 'photo' && m.photo?.kind === 'progress');
  if (photo && !photo.photo?.decision && photo.status !== 'failed') {
    if (maker) return { kind: 'waiting', who: 'buyer' };
    return photo.status === 'done' ? { kind: 'reviewPhoto' } : null;
  }
  return maker ? { kind: 'sendPhoto' } : { kind: 'waiting', who: 'maker' };
}
