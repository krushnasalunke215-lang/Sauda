import type { Logger } from '../deals/service.js';
import type { DealStore } from '../deals/store.js';
import { POLL_STATUSES, type InvoiceSync } from './sync.js';

/**
 * The primary payment update: every interval, re-reads each open invoice (UNPAID, SENT or
 * PARTIALLY_PAID) whose deal was active in the last two hours, one deal at a time.
 */
export class InvoicePoller {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private readonly now: () => Date;

  constructor(
    private readonly deps: { store: DealStore; sync: InvoiceSync; intervalMs: number; now?: () => Date; log?: Logger },
  ) {
    this.now = deps.now ?? (() => new Date());
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.schedule();
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(): void {
    if (!this.running) return;
    this.timer = setTimeout(() => {
      void this.tick().finally(() => this.schedule());
    }, this.deps.intervalMs);
    this.timer.unref?.();
  }

  /** One pass over the open invoices. */
  async tick(): Promise<void> {
    const now = this.now().toISOString();
    for (const d of this.deps.store.listWithOpenInvoices()) {
      if (!d.invoice || !POLL_STATUSES.has(d.invoice.status)) continue;
      if (!d.pollUntil || d.pollUntil <= now) continue;
      try {
        await this.deps.sync.syncInvoice(d.id, 'poll');
      } catch (e) {
        this.deps.log?.warn({ dealId: d.id, err: e instanceof Error ? e.message : String(e) }, 'poll failed');
      }
    }
  }
}
