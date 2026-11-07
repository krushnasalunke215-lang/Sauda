import type { Deal, TimelineEntry, TimelineInput } from '../../shared/types.js';
import type { Logger } from '../deals/service.js';
import type { DealStore } from '../deals/store.js';
import type { CallLogEntry } from './client.js';

/** Appends an entry to the deal's money timeline (call under the deal lock). */
export function pushTimeline(d: Deal, entry: TimelineInput, now: Date): TimelineEntry {
  const e = { id: `t${d.timeline.length + 1}`, at: now.toISOString(), ...entry } as TimelineEntry;
  d.timeline.push(e);
  return e;
}

/** A short, value-free error text for the timeline. */
export function errorText(e: CallLogEntry['error']): string | undefined {
  if (!e) return undefined;
  if (typeof e === 'string') return e.slice(0, 200);
  return [e.name, e.message].filter(Boolean).map(String).join(': ').slice(0, 200) || undefined;
}

/**
 * Receives every PayPal call (PayPalClient onCall): logs it, and writes it to the deal's money
 * timeline unless the call is quiet (background polling) or belongs to no deal.
 */
export class TimelineRecorder {
  private readonly pending = new Set<Promise<unknown>>();

  constructor(
    private readonly store: DealStore,
    private readonly log?: Logger,
    private readonly now: () => Date = () => new Date(),
  ) {}

  readonly onCall = (dealId: string | undefined, e: CallLogEntry): void => {
    const error = errorText(e.error);
    this.log?.info(
      { paypal: { label: e.label, method: e.method, path: e.path, status: e.status, debugId: e.debugId, ms: e.ms, ...(error ? { error } : {}) }, dealId },
      'paypal call',
    );
    if (!dealId || e.quiet) return;
    this.add(dealId, { type: 'paypal_call', label: e.label, method: e.method, path: e.path, status: e.status, debugId: e.debugId, ms: e.ms, ...(error ? { error } : {}) });
  };

  /** Adds an entry in the background (the deal lock keeps the order). */
  add(dealId: string, entry: TimelineInput): void {
    const p = this.store.update(dealId, (d) => void pushTimeline(d, entry, this.now())).catch(() => undefined);
    this.pending.add(p);
    void p.finally(() => this.pending.delete(p));
  }

  async whenIdle(): Promise<void> {
    while (this.pending.size > 0) await Promise.allSettled([...this.pending]);
  }
}
