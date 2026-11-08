import type { Confirmation, ConfirmationView, Deal, DealView, Role } from '../../shared/types.js';
import { canonicalHash, derive, isLocked, missingRequired, validate } from '../domain/agreement.js';
import { agreementRows, checkTextLimits, summaryLines } from '../domain/agreement-text.js';
import { todayUtc } from '../domain/dates.js';
import { derivePhase } from '../domain/phase.js';

/** The buyer's invite path or URL. Without a public base URL it is a path the client resolves. */
export function invitePath(deal: Deal, role: Role, baseUrl: string | null): string {
  return `${baseUrl ?? ''}/r/${deal.id}?t=${deal.tokens[role]}`;
}

/** What one party sees: never the tokens, except the buyer invite link for the maker. */
export function toView(deal: Deal, role: Role, baseUrl: string | null, now: Date = new Date()): DealView {
  const hash = canonicalHash(deal);
  const cv = (c: Confirmation | undefined): ConfirmationView | null => (c ? { hash: c.hash, at: c.at, current: c.hash === hash } : null);
  return {
    id: deal.id,
    role,
    parties: deal.parties,
    ...(role === 'maker' ? { inviteUrl: invitePath(deal, 'buyer', baseUrl) } : {}),
    phase: derivePhase(deal),
    agreement: {
      rows: agreementRows(deal, role),
      derived: derive(deal.terms),
      missing: missingRequired(deal.terms),
      errors: [...validate(deal.terms, todayUtc(now)), ...checkTextLimits(deal)],
      hash,
      locked: isLocked(deal),
      summary: summaryLines(deal, deal.parties[role].lang),
      deliveryDate: deal.terms.delivery?.value.dateIso ?? null,
    },
    messages: deal.messages,
    questions: deal.questions,
    confirmations: { maker: cv(deal.confirmations.maker), buyer: cv(deal.confirmations.buyer) },
    invoice: deal.invoice,
    proposals: deal.proposals,
    timeline: deal.timeline,
    tracking: deal.tracking,
    progressApproval: deal.progressApproval,
    createdAt: deal.createdAt,
    updatedAt: deal.updatedAt,
  };
}
