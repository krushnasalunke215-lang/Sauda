import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ApprovalService } from '../agent/approvals.js';
import type { DealStore } from '../deals/store.js';
import { toView } from '../deals/view.js';
import type { Logger } from '../deals/service.js';
import type { InvoiceSync } from '../paypal/sync.js';
import { pushTimeline } from '../paypal/timeline.js';
import { WEBHOOK_PATH, type WebhookManager } from '../paypal/webhooks.js';
import { authenticate, params, short, type IdParams } from './deals.js';

export interface PayPalRouteDeps {
  store: DealStore;
  approvals: ApprovalService;
  sync: InvoiceSync;
  webhooks: WebhookManager;
  publicBaseUrl: string | null;
  log?: Logger;
  now?: () => Date;
}

const DEAL_ACTION = /^\/api\/deals\/([0-9A-Z]{8})\//;

export function paypalRoutes(app: FastifyInstance, deps: PayPalRouteDeps): void {
  const { store, approvals, sync, webhooks } = deps;
  const now = deps.now ?? (() => new Date());
  const baseUrl = (req: FastifyRequest) => deps.publicBaseUrl ?? `${req.protocol}://${req.host}`;
  const auth = (req: FastifyRequest<{ Params: IdParams }>) => authenticate(store, req.params.id, req.headers['x-sauda-token']);

  // Any successful deal action keeps the poller watching that deal's open invoice.
  app.addHook('onResponse', async (req, reply) => {
    if (req.method !== 'POST' || reply.statusCode >= 400) return;
    const m = DEAL_ACTION.exec(req.url);
    if (m) sync.touch(m[1]);
  });

  /** The maker's manual "Add tracking" form or "Remind buyer" button: a new proposal card. */
  app.post<{ Params: IdParams; Body: { tool: string; args?: Record<string, unknown> } }>(
    '/api/deals/:id/proposals',
    {
      schema: {
        params: params(),
        body: {
          type: 'object',
          required: ['tool'],
          properties: { tool: { type: 'string', enum: ['add_tracking', 'send_reminder'] }, args: { type: 'object' } },
        },
      },
    },
    async (req, reply) => {
      const { deal, role } = auth(req);
      const p = await approvals.propose(deal.id, role, req.body.tool, req.body.args ?? {});
      return reply.code(201).send({ proposalId: p.id, status: p.status });
    },
  );

  app.post<{ Params: IdParams & { pid: string }; Body: { args?: Record<string, unknown> } | null }>(
    '/api/deals/:id/proposals/:pid/approve',
    { schema: { params: params({ pid: short }) } },
    async (req, reply) => {
      const { deal, role } = auth(req);
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const args = body.args && typeof body.args === 'object' ? body.args : undefined;
      const p = await approvals.approve(deal.id, role, req.params.pid, args);
      return reply.code(202).send({ proposalId: p.id, status: p.status });
    },
  );

  app.post<{ Params: IdParams & { pid: string } }>(
    '/api/deals/:id/proposals/:pid/reject',
    { schema: { params: params({ pid: short }) } },
    async (req) => {
      const { deal, role } = auth(req);
      return toView(await approvals.reject(deal.id, role, req.params.pid), role, baseUrl(req));
    },
  );

  /** The buyer's "I've paid, check now" button (at most once per 5 s per deal). */
  app.post<{ Params: IdParams }>('/api/deals/:id/refresh-payment', { schema: { params: params() } }, async (req) => {
    const { deal, role } = auth(req);
    await sync.refresh(deal.id);
    return toView(store.get(deal.id)!, role, baseUrl(req));
  });

  /**
   * PayPal webhook deliveries. Each one is verified with PayPal, deduplicated by event id and only
   * used as a signal: the invoice is read again, because event bodies can be out of order.
   */
  app.post<{ Body: unknown }>(WEBHOOK_PATH, { bodyLimit: 1024 * 1024 }, async (req, reply) => {
    const event = req.body as Record<string, any> | null;
    if (!event || typeof event !== 'object' || typeof event.id !== 'string' || typeof event.event_type !== 'string') {
      return reply.code(400).send({ error: 'invalid_event' });
    }
    if (!(await webhooks.verify(req.headers, event))) {
      deps.log?.warn({ eventId: event.id.slice(0, 64), eventType: String(event.event_type).slice(0, 64) }, 'webhook not verified');
      return reply.code(400).send({ error: 'unverified' });
    }
    const resource = event.resource ?? {};
    const invoiceId: string | null = typeof resource.invoice?.id === 'string' ? resource.invoice.id : typeof resource.id === 'string' ? resource.id : null;
    const fresh = store.recordWebhookEvent({ eventId: event.id, eventType: event.event_type, invoiceId, verified: true }, now());
    if (!fresh) return { ok: true, duplicate: true };
    const deal = invoiceId ? store.findByInvoiceId(invoiceId) : null;
    if (!deal) return { ok: true, ignored: true };
    const invoiceStatus = resource.invoice?.status ?? resource.status ?? null;
    await store.update(deal.id, (d) => {
      pushTimeline(d, { type: 'webhook', eventId: event.id, eventType: event.event_type, verified: true, invoiceStatus: typeof invoiceStatus === 'string' ? invoiceStatus : null }, now());
    });
    // Reply first; the invoice is then read again and diffed.
    sync.trigger(deal.id, 'webhook');
    return { ok: true };
  });
}
