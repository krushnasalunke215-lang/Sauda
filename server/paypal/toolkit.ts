import type { Deal, Lang } from '../../shared/types.js';
import type { ReminderResult } from '../agent/proposals.js';
import { formatMoney } from '../domain/money.js';
import type { PayPalCredentials } from './client.js';

/** The slice of the toolkit Sauda uses (faked in tests). */
export interface ToolkitLike {
  handleToolCall(call: { id: string; type: 'function'; function: { name: string; arguments: string } }): Promise<{ content?: unknown }>;
}

export type ToolkitFactory = (opts: { creds: PayPalCredentials; requestId: string }) => Promise<ToolkitLike>;

/** The PayPal Agent Toolkit with only the reminder action, always in the sandbox (loaded on first use). */
export const defaultToolkit: ToolkitFactory = async ({ creds, requestId }) => {
  const { PayPalAgentToolkit } = await import('@paypal/agent-toolkit/openai');
  return new PayPalAgentToolkit({
    clientId: creds.clientId,
    clientSecret: creds.clientSecret,
    configuration: { actions: { invoices: { sendReminder: true } }, context: { sandbox: true, request_id: requestId } },
  }) as unknown as ToolkitLike;
};

const NOTE: Record<Lang, (due: string, ref: string) => string> = {
  en: (due, ref) => `Friendly reminder: ${due} is still due on this invoice (${ref}).`,
  hi: (due, ref) => `याद दिलाना: इस इनवॉइस (${ref}) पर अभी ${due} बाकी है।`,
  es: (due, ref) => `Recordatorio: quedan ${due} pendientes en esta factura (${ref}).`,
};

export const REMINDER_TIMEOUT_MS = 120_000;

/** The reminder note, with the amount due, in the buyer's language. */
export function reminderNote(deal: Deal): string {
  const due = formatMoney(deal.invoice?.dueCents ?? 0, 'USD');
  return NOTE[deal.parties.buyer.lang](due, `SAUDA-${deal.id}`);
}

/**
 * Sends a payment reminder through the Agent Toolkit's send_invoice_reminder tool. The toolkit
 * returns its result (or a serialized error) as the tool message content; it exposes no debug ID.
 */
export async function sendReminder(creds: PayPalCredentials, deal: Deal, n: number, factory: ToolkitFactory = defaultToolkit): Promise<ReminderResult> {
  if (!deal.invoice) return { ok: false, ms: 0, status: null, message: 'there is no invoice' };
  const t0 = performance.now();
  try {
    const toolkit = await factory({ creds, requestId: `sauda-${deal.id}-remind-${n}` });
    // The toolkit's HTTP client has no timeout, and the sandbox /remind call took about 70 s once.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`no answer from PayPal after ${REMINDER_TIMEOUT_MS / 1000} s`)), REMINDER_TIMEOUT_MS);
    });
    const res = await Promise.race([
      toolkit.handleToolCall({
        id: `call_sauda_${deal.id}_${n}`,
        type: 'function',
        function: { name: 'send_invoice_reminder', arguments: JSON.stringify({ invoice_id: deal.invoice.id, note: reminderNote(deal) }) },
      }),
      timeout,
    ]).finally(() => clearTimeout(timer));
    const ms = Math.round(performance.now() - t0);
    let out: any = res.content;
    if (typeof out === 'string') {
      try {
        out = JSON.parse(out);
      } catch {
        // plain text content
      }
    }
    // Errors come back as {ok: false, status, code, message} or {error: {message}}.
    const failed = out && typeof out === 'object' && (out.ok === false || out.error);
    if (failed) {
      const message = String(out.message ?? out.error?.message ?? out.code ?? 'reminder failed').slice(0, 300);
      return { ok: false, ms, status: typeof out.status === 'number' ? out.status : null, message };
    }
    return { ok: true, ms, status: null };
  } catch (e) {
    return { ok: false, ms: Math.round(performance.now() - t0), status: null, message: (e instanceof Error ? e.message : String(e)).slice(0, 300) };
  }
}
