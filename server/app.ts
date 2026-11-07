import { existsSync } from 'node:fs';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyError, type FastifyInstance, type FastifyServerOptions } from 'fastify';
import path from 'node:path';
import { ApprovalService, createPayPalOps } from './agent/approvals.js';
import type { PayPalOps } from './agent/proposals.js';
import type { AiBudget } from './ai/budget.js';
import type { Interpreter } from './ai/interpret.js';
import { MAX_AUDIO_BYTES, MAX_IMAGE_BYTES } from './ai/media.js';
import type { Speak } from './ai/tts.js';
import type { Vision } from './ai/vision.js';
import { paypalConfigured, ROOT_DIR, type Config } from './config.js';
import { DealService, ServiceError, type Logger } from './deals/service.js';
import { DealNotFoundError, type DealStore } from './deals/store.js';
import { PayPalClient } from './paypal/client.js';
import { InvoiceSync } from './paypal/sync.js';
import { TimelineRecorder } from './paypal/timeline.js';
import type { ToolkitFactory } from './paypal/toolkit.js';
import { WebhookManager } from './paypal/webhooks.js';
import { dealRoutes } from './routes/deals.js';
import { healthRoutes } from './routes/health.js';
import { mediaRoutes } from './routes/media.js';
import { paypalRoutes } from './routes/paypal.js';
import { photoRoutes } from './routes/photos.js';
import { SampleLibrary, sampleRoutes } from './routes/samples.js';

export interface AppDeps {
  config: Config;
  store: DealStore;
  interpret: Interpreter | null;
  vision?: Vision | null;
  speak?: Speak | null;
  /** Folder with manifest.json and the sample clips (default: samples/ in the repo). */
  samplesDir?: string;
  /** Built client (dist/client). Skipped when missing, e.g. in unit tests. */
  staticDir?: string | null;
  logger?: FastifyServerOptions['logger'];
  now?: () => Date;
  /**
   * PayPal overrides for tests: a fake fetch for the sandbox client, fake side effects, a fake
   * Agent Toolkit. null turns PayPal off. By default the client is built from config.paypal.
   */
  paypal?: { fetch?: typeof fetch; ops?: Partial<PayPalOps>; toolkit?: ToolkitFactory } | null;
  /** The daily AI call budget shown on /healthz (the model calls reserve from it). */
  budget?: AiBudget | null;
  /** Lower rate limits for tests. */
  rateLimits?: Partial<RateLimits>;
}

export interface Limit {
  max: number;
  timeWindow: string;
}

/** Per-IP request limits (in memory) for the public demo. */
export interface RateLimits {
  global: Limit;
  createDeal: Limit;
  turns: Limit;
  photos: Limit;
  approve: Limit;
  refreshPayment: Limit;
}

export const RATE_LIMITS: RateLimits = {
  global: { max: 300, timeWindow: '1 minute' },
  createDeal: { max: 20, timeWindow: '1 hour' },
  turns: { max: 30, timeWindow: '10 minutes' },
  photos: { max: 12, timeWindow: '10 minutes' },
  approve: { max: 20, timeWindow: '1 hour' },
  refreshPayment: { max: 12, timeWindow: '1 minute' },
};

/** Route method + URL pattern → the limit (and group, so a turn and its retry share one counter). */
const ROUTE_LIMITS: { method: string; url: string; limit: keyof RateLimits; group?: string }[] = [
  { method: 'POST', url: '/api/deals', limit: 'createDeal' },
  { method: 'POST', url: '/api/deals/:id/turns', limit: 'turns', group: 'turns' },
  { method: 'POST', url: '/api/deals/:id/turns/:mid/retry', limit: 'turns', group: 'turns' },
  { method: 'POST', url: '/api/deals/:id/photos', limit: 'photos' },
  { method: 'POST', url: '/api/deals/:id/proposals/:pid/approve', limit: 'approve' },
  { method: 'POST', url: '/api/deals/:id/refresh-payment', limit: 'refreshPayment' },
];

export interface Payments {
  client: PayPalClient | null;
  recorder: TimelineRecorder;
  sync: InvoiceSync;
  approvals: ApprovalService;
  webhooks: WebhookManager;
}

/** Removes the access token from URLs (/r/:id?t=TOKEN) before they are logged. */
export const redactUrl = (url: string): string => url.replace(/([?&]t=)[^&#]*/g, '$1[redacted]');

/** Logs method, redacted URL and status only: never bodies or headers (the X-Sauda-Token header included). */
export const LOGGER: FastifyServerOptions['logger'] = {
  level: process.env.LOG_LEVEL ?? 'info',
  serializers: {
    req: (req: { method: string; url: string; ip?: string }) => ({ method: req.method, url: redactUrl(req.url), ip: req.ip }),
    res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
  },
};

function buildPayments(deps: AppDeps, log: Logger): Payments {
  const { config, store } = deps;
  const p = config.paypal;
  const creds = deps.paypal !== null && paypalConfigured(config) ? { clientId: p.clientId!, clientSecret: p.clientSecret! } : null;
  const recorder = new TimelineRecorder(store, log, deps.now);
  const client = creds ? new PayPalClient(creds, { onCall: recorder.onCall, fetch: deps.paypal?.fetch }) : null;
  const real = client && creds ? createPayPalOps(client, { creds, merchantEmail: p.merchantEmail!, buyerEmail: p.buyerEmail! }, deps.paypal?.toolkit) : null;
  const fake = deps.paypal?.ops;
  const ops = real ? { ...real, ...fake } : fake?.createInvoice && fake.addTracking && fake.sendReminder ? (fake as PayPalOps) : null;
  return {
    client,
    recorder,
    sync: new InvoiceSync({ store, client, now: deps.now, log }),
    approvals: new ApprovalService({ store, ops, now: deps.now, log }),
    webhooks: new WebhookManager(client, { webhookId: p.webhookId, log, now: deps.now }),
  };
}

export async function buildApp(deps: AppDeps): Promise<{ app: FastifyInstance; service: DealService; payments: Payments }> {
  const app = Fastify({ logger: deps.logger ?? LOGGER, trustProxy: true, bodyLimit: 64 * 1024 });
  const service = new DealService({
    store: deps.store,
    interpret: deps.interpret,
    vision: deps.vision ?? null,
    speak: deps.speak ?? null,
    mediaDir: path.join(deps.config.dataDir, 'media'),
    now: deps.now,
    log: app.log,
  });
  const samples = new SampleLibrary(deps.samplesDir ?? path.join(ROOT_DIR, 'samples'));

  // Raw uploads: voice (WhatsApp voice notes are audio-only MP4) and photos. Other types get 415.
  const raw = (_req: unknown, body: Buffer, done: (err: Error | null, body?: Buffer) => void) => done(null, body);
  app.addContentTypeParser(/^(audio\/[a-z0-9.+-]+|video\/mp4)(\s*;.*)?$/i, { parseAs: 'buffer', bodyLimit: MAX_AUDIO_BYTES }, raw);
  app.addContentTypeParser(/^image\/(jpeg|png|webp)(\s*;.*)?$/i, { parseAs: 'buffer', bodyLimit: MAX_IMAGE_BYTES }, raw);

  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Content-Type-Options', 'nosniff');
    return payload;
  });

  // Rate limits: the route table above sets each route's limit as it is added; /healthz is exempt
  // (Render's health checks). Keyed by the client IP, which trustProxy reads from X-Forwarded-For.
  const limits: RateLimits = { ...RATE_LIMITS, ...deps.rateLimits };
  app.addHook('onRoute', (route) => {
    if (route.url === '/healthz') {
      route.config = { ...route.config, rateLimit: false } as typeof route.config;
      return;
    }
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    const hit = ROUTE_LIMITS.find((r) => r.url === route.url && methods.includes(r.method as (typeof methods)[number]));
    if (hit) route.config = { ...route.config, rateLimit: { ...limits[hit.limit], ...(hit.group ? { groupId: hit.group } : {}) } } as typeof route.config;
  });
  await app.register(rateLimit, { global: true, ...limits.global });

  app.setErrorHandler((err: FastifyError, req, reply) => {
    if (err instanceof ServiceError) return reply.code(err.status).send({ error: err.code, ...(err.details ? { details: err.details } : {}) });
    if (err instanceof DealNotFoundError) return reply.code(404).send({ error: 'not_found' });
    if (err.statusCode === 429) return reply.code(429).send({ error: 'rate_limited' });
    if (err.validation) return reply.code(400).send({ error: 'invalid_request', message: err.message });
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.code ?? 'bad_request' });
    req.log.error({ err: { name: err.name, message: err.message, stack: err.stack } }, 'unhandled error');
    return reply.code(500).send({ error: 'internal' });
  });

  const payments = buildPayments(deps, app.log);

  healthRoutes(
    app,
    deps.config,
    () => payments.webhooks.status(),
    () => deps.budget?.status() ?? { callsToday: 0, limit: deps.config.aiDailyCallLimit },
  );
  dealRoutes(app, { store: deps.store, service, samples, publicBaseUrl: deps.config.publicBaseUrl });
  mediaRoutes(app, { store: deps.store, service });
  photoRoutes(app, { store: deps.store, service, publicBaseUrl: deps.config.publicBaseUrl });
  sampleRoutes(app, samples);
  paypalRoutes(app, { ...payments, store: deps.store, publicBaseUrl: deps.config.publicBaseUrl, log: app.log, now: deps.now });

  const hasClient = Boolean(deps.staticDir && existsSync(deps.staticDir));
  if (hasClient) await app.register(fastifyStatic, { root: deps.staticDir!, index: ['index.html'] });

  // SPA fallback: any other GET outside /api gets the client's index.html.
  app.setNotFoundHandler((req, reply) => {
    const path = req.url.split('?')[0];
    if (hasClient && req.method === 'GET' && !path.startsWith('/api/') && path !== '/api') return reply.sendFile('index.html');
    return reply.code(404).send({ error: 'not_found' });
  });

  return { app, service, payments };
}
