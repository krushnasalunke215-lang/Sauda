import type { Logger } from '../deals/service.js';
import { expectOk, type PayPalClient } from './client.js';

export const WEBHOOK_PATH = '/api/paypal/webhook';
export const WEBHOOK_EVENT_TYPES = ['INVOICING.INVOICE.PAID', 'INVOICING.INVOICE.UPDATED', 'INVOICING.INVOICE.CANCELLED'] as const;

type Headers = Record<string, string | string[] | undefined>;
const header = (h: Headers, name: string) => {
  const v = h[name];
  return Array.isArray(v) ? v[0] : v;
};

/**
 * The app's PayPal webhook. At boot (with a public https URL) it reuses the webhook registered for
 * this URL or creates one for the invoice events; PAYPAL_WEBHOOK_ID overrides that. Every delivery
 * is verified with PayPal before anything is trusted.
 */
export class WebhookManager {
  id: string | null;
  lastVerifiedAt: string | null = null;
  private readonly log: Logger | undefined;
  private readonly now: () => Date;

  constructor(
    private readonly client: PayPalClient | null,
    opts: { webhookId?: string | null; log?: Logger; now?: () => Date } = {},
  ) {
    this.id = opts.webhookId ?? null;
    this.log = opts.log;
    this.now = opts.now ?? (() => new Date());
  }

  status(): { configured: boolean; lastVerifiedAt: string | null } {
    return { configured: Boolean(this.id), lastVerifiedAt: this.lastVerifiedAt };
  }

  /** Finds or creates the webhook for `${base}/api/paypal/webhook`. Failures are logged; polling still works. */
  async ensure(publicBaseUrl: string | null): Promise<string | null> {
    if (this.id || !this.client) return this.id;
    if (!publicBaseUrl?.startsWith('https://')) return null;
    const url = `${publicBaseUrl.replace(/\/+$/, '')}${WEBHOOK_PATH}`;
    try {
      const list = expectOk(await this.client.call('GET', '/v1/notifications/webhooks', { label: 'list-webhooks' }), 'list webhooks');
      const existing = (list.body?.webhooks ?? []).find((w: any) => w?.url === url);
      if (existing?.id) {
        this.id = String(existing.id);
      } else {
        const created = expectOk(
          await this.client.call('POST', '/v1/notifications/webhooks', {
            body: { url, event_types: WEBHOOK_EVENT_TYPES.map((name) => ({ name })) },
            label: 'create-webhook',
          }),
          'create webhook',
        );
        this.id = String(created.body.id);
      }
      this.log?.info({ webhookId: this.id, url, reused: Boolean(existing?.id) }, 'paypal webhook ready');
    } catch (e) {
      this.log?.warn({ err: e instanceof Error ? e.message : String(e), url }, 'paypal webhook setup failed; polling continues');
    }
    return this.id;
  }

  /** Verifies a delivery with POST /v1/notifications/verify-webhook-signature. */
  async verify(headers: Headers, event: unknown): Promise<boolean> {
    if (!this.id || !this.client) return false;
    const r = await this.client.call('POST', '/v1/notifications/verify-webhook-signature', {
      label: 'verify-webhook-signature',
      body: {
        auth_algo: header(headers, 'paypal-auth-algo'),
        cert_url: header(headers, 'paypal-cert-url'),
        transmission_id: header(headers, 'paypal-transmission-id'),
        transmission_sig: header(headers, 'paypal-transmission-sig'),
        transmission_time: header(headers, 'paypal-transmission-time'),
        webhook_id: this.id,
        webhook_event: event,
      },
    });
    const ok = r.ok && r.body?.verification_status === 'SUCCESS';
    if (ok) this.lastVerifiedAt = this.now().toISOString();
    return ok;
  }
}
