import { existsSync } from 'node:fs';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyError, type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { Interpreter } from './ai/interpret.js';
import type { Config } from './config.js';
import { DealService, ServiceError } from './deals/service.js';
import { DealNotFoundError, type DealStore } from './deals/store.js';
import { dealRoutes } from './routes/deals.js';
import { healthRoutes } from './routes/health.js';

export interface AppDeps {
  config: Config;
  store: DealStore;
  interpret: Interpreter | null;
  /** Built client (dist/client). Skipped when missing, e.g. in unit tests. */
  staticDir?: string | null;
  logger?: FastifyServerOptions['logger'];
  now?: () => Date;
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

export async function buildApp(deps: AppDeps): Promise<{ app: FastifyInstance; service: DealService }> {
  const app = Fastify({ logger: deps.logger ?? LOGGER, trustProxy: true, bodyLimit: 64 * 1024 });
  const service = new DealService({ store: deps.store, interpret: deps.interpret, now: deps.now, log: app.log });

  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Content-Type-Options', 'nosniff');
    return payload;
  });

  app.setErrorHandler((err: FastifyError, req, reply) => {
    if (err instanceof ServiceError) return reply.code(err.status).send({ error: err.code, ...(err.details ? { details: err.details } : {}) });
    if (err instanceof DealNotFoundError) return reply.code(404).send({ error: 'not_found' });
    if (err.validation) return reply.code(400).send({ error: 'invalid_request', message: err.message });
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.code ?? 'bad_request' });
    req.log.error({ err: { name: err.name, message: err.message, stack: err.stack } }, 'unhandled error');
    return reply.code(500).send({ error: 'internal' });
  });

  healthRoutes(app, deps.config);
  dealRoutes(app, { store: deps.store, service, publicBaseUrl: deps.config.publicBaseUrl });

  const hasClient = Boolean(deps.staticDir && existsSync(deps.staticDir));
  if (hasClient) await app.register(fastifyStatic, { root: deps.staticDir!, index: ['index.html'] });

  // SPA fallback: any other GET outside /api gets the client's index.html.
  app.setNotFoundHandler((req, reply) => {
    const path = req.url.split('?')[0];
    if (hasClient && req.method === 'GET' && !path.startsWith('/api/') && path !== '/api') return reply.sendFile('index.html');
    return reply.code(404).send({ error: 'not_found' });
  });

  return { app, service };
}
