import { existsSync } from 'node:fs';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyError, type FastifyInstance, type FastifyServerOptions } from 'fastify';
import path from 'node:path';
import type { Interpreter } from './ai/interpret.js';
import { MAX_AUDIO_BYTES, MAX_IMAGE_BYTES } from './ai/media.js';
import type { Speak } from './ai/tts.js';
import type { Vision } from './ai/vision.js';
import { ROOT_DIR, type Config } from './config.js';
import { DealService, ServiceError } from './deals/service.js';
import { DealNotFoundError, type DealStore } from './deals/store.js';
import { dealRoutes } from './routes/deals.js';
import { healthRoutes } from './routes/health.js';
import { mediaRoutes } from './routes/media.js';
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

  app.setErrorHandler((err: FastifyError, req, reply) => {
    if (err instanceof ServiceError) return reply.code(err.status).send({ error: err.code, ...(err.details ? { details: err.details } : {}) });
    if (err instanceof DealNotFoundError) return reply.code(404).send({ error: 'not_found' });
    if (err.validation) return reply.code(400).send({ error: 'invalid_request', message: err.message });
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.code ?? 'bad_request' });
    req.log.error({ err: { name: err.name, message: err.message, stack: err.stack } }, 'unhandled error');
    return reply.code(500).send({ error: 'internal' });
  });

  healthRoutes(app, deps.config);
  dealRoutes(app, { store: deps.store, service, samples, publicBaseUrl: deps.config.publicBaseUrl });
  mediaRoutes(app, { store: deps.store, service });
  photoRoutes(app, { store: deps.store, service, publicBaseUrl: deps.config.publicBaseUrl });
  sampleRoutes(app, samples);

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
