import { ROLES, type Deal, type Phase } from '../../shared/types.js';
import { canonicalHash } from './agreement.js';

/** True when both parties confirmed the current agreement hash. */
export function bothConfirmed(deal: Deal, hash: string = canonicalHash(deal)): boolean {
  return ROLES.every((r) => deal.confirmations[r]?.hash === hash);
}

/** The deal phase, derived from facts only (confirmations, the invoice snapshot, tracking). */
export function derivePhase(deal: Deal): Phase {
  const inv = deal.invoice;
  if (deal.cancelled || inv?.status === 'CANCELLED') return 'cancelled';
  if (deal.tracking) return 'shipped';
  if (inv) {
    if (inv.status === 'PAID' || inv.status === 'MARKED_AS_PAID' || (inv.totalCents > 0 && inv.paidCents >= inv.totalCents)) return 'paid';
    if (inv.depositCents > 0 && inv.paidCents >= inv.depositCents) return 'deposit_paid';
    return 'invoiced';
  }
  return bothConfirmed(deal) ? 'confirmed' : 'negotiating';
}
