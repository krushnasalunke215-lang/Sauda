import type { FastifyInstance } from 'fastify';
import type { Config } from '../config.js';

export function healthRoutes(
  app: FastifyInstance,
  config: Config,
  webhook: () => { configured: boolean; lastVerifiedAt: string | null } = () => ({ configured: false, lastVerifiedAt: null }),
): void {
  app.get('/healthz', async () => ({
    ok: true,
    commit: config.commit,
    ai: { fastModel: config.gemini.fastModel, fallbackModel: config.gemini.fallbackModel },
    webhook: webhook(),
  }));
}
