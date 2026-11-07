import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { Deal, Party, Role } from '../../shared/types.js';
import type { Db } from '../db.js';

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** 8 Crockford base32 characters (40 random bits). */
export function newDealId(): string {
  // 256 is a multiple of 32, so masking each byte keeps the distribution uniform.
  return Array.from(randomBytes(8), (b) => CROCKFORD[b & 31]).join('');
}

/** 24 random bytes, base64url. */
export function newToken(): string {
  return randomBytes(24).toString('base64url');
}

/** A new, empty deal with fresh id and tokens. */
export function makeDeal(parties: Record<Role, Party>, now: Date = new Date()): Deal {
  const at = now.toISOString();
  return {
    id: newDealId(),
    createdAt: at,
    updatedAt: at,
    tokens: { maker: newToken(), buyer: newToken() },
    parties: structuredClone(parties),
    terms: { measurements: [] },
    messages: [],
    nextSeq: 1,
    questions: [],
    confirmations: {},
    invoice: null,
    proposals: [],
    timeline: [],
    tracking: null,
    progressApproval: null,
    pollUntil: null,
    cancelled: false,
  };
}

export class DealNotFoundError extends Error {
  constructor(id: string) {
    super(`Deal ${id} not found`);
    this.name = 'DealNotFoundError';
  }
}

const TERMINAL_INVOICE = new Set(['PAID', 'MARKED_AS_PAID', 'CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED', 'MARKED_AS_REFUNDED']);

type Listener = (deal: Deal) => void;

function tokenMatches(expected: string, given: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Deals are stored as one JSON document per row. Every change goes through update(), which
 * serializes changes per deal with a promise-chain mutex and notifies the onChange listeners.
 */
export class DealStore {
  private readonly locks = new Map<string, Promise<unknown>>();
  private readonly listeners = new Set<Listener>();

  constructor(private readonly db: Db) {}

  create(deal: Deal): Deal {
    this.db
      .prepare('INSERT INTO deals (id, maker_token, buyer_token, invoice_id, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(deal.id, deal.tokens.maker, deal.tokens.buyer, deal.invoice?.id ?? null, JSON.stringify(deal), deal.createdAt, deal.updatedAt);
    this.emit(deal);
    return structuredClone(deal);
  }

  get(id: string): Deal | null {
    const row = this.db.prepare('SELECT state FROM deals WHERE id = ?').get(id) as { state: string } | undefined;
    return row ? (JSON.parse(row.state) as Deal) : null;
  }

  /** Returns the deal and the role the token belongs to, or null for an unknown deal or a wrong token. */
  findByToken(id: string, token: string): { deal: Deal; role: Role } | null {
    if (typeof id !== 'string' || typeof token !== 'string' || !token) return null;
    const deal = this.get(id);
    if (!deal) return null;
    if (tokenMatches(deal.tokens.maker, token)) return { deal, role: 'maker' };
    if (tokenMatches(deal.tokens.buyer, token)) return { deal, role: 'buyer' };
    return null;
  }

  findByInvoiceId(invoiceId: string): Deal | null {
    const row = this.db.prepare('SELECT state FROM deals WHERE invoice_id = ?').get(invoiceId) as { state: string } | undefined;
    return row ? (JSON.parse(row.state) as Deal) : null;
  }

  /** Deals with an invoice that can still change (not paid, cancelled or refunded). */
  listWithOpenInvoices(): Deal[] {
    const rows = this.db.prepare('SELECT state FROM deals WHERE invoice_id IS NOT NULL').all() as { state: string }[];
    return rows.map((r) => JSON.parse(r.state) as Deal).filter((d) => d.invoice && !TERMINAL_INVOICE.has(d.invoice.status));
  }

  /**
   * Runs fn on the latest copy of the deal under the per-deal lock, then persists and broadcasts
   * it. If fn throws, nothing is saved and the error propagates.
   */
  update(id: string, fn: (deal: Deal) => void | Promise<void>): Promise<Deal> {
    const prev = this.locks.get(id) ?? Promise.resolve();
    const run = prev.then(async () => {
      const deal = this.get(id);
      if (!deal) throw new DealNotFoundError(id);
      await fn(deal);
      deal.updatedAt = new Date().toISOString();
      this.db
        .prepare('UPDATE deals SET invoice_id = ?, state = ?, updated_at = ? WHERE id = ?')
        .run(deal.invoice?.id ?? null, JSON.stringify(deal), deal.updatedAt, id);
      this.emit(deal);
      return deal;
    });
    const tail = run.catch(() => undefined);
    this.locks.set(id, tail);
    void tail.then(() => {
      if (this.locks.get(id) === tail) this.locks.delete(id);
    });
    return run;
  }

  /** Records a webhook event once. Returns false when the event id was seen before (a redelivery). */
  recordWebhookEvent(e: { eventId: string; eventType: string; invoiceId: string | null; verified: boolean }, now: Date = new Date()): boolean {
    const r = this.db
      .prepare('INSERT OR IGNORE INTO webhook_events (event_id, received_at, event_type, invoice_id, verified) VALUES (?, ?, ?, ?, ?)')
      .run(e.eventId, now.toISOString(), e.eventType, e.invoiceId, e.verified ? 1 : 0);
    return Number(r.changes) > 0;
  }

  /** Registers a listener for every created or updated deal. Returns an unsubscribe function. */
  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(deal: Deal): void {
    for (const l of this.listeners) {
      try {
        l(deal);
      } catch {
        // A failing listener (for example a broadcast) must not undo a saved change.
      }
    }
  }
}
