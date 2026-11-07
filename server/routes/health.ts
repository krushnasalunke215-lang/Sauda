import type { FastifyInstance } from 'fastify';
import type { BudgetStatus } from '../ai/budget.js';
import type { Config } from '../config.js';

export function healthRoutes(
  app: FastifyInstance,
  config: Config,
  webhook: () => { configured: boolean; lastVerifiedAt: string | null } = () => ({ configured: false, lastVerifiedAt: null }),
  budget: () => BudgetStatus = () => ({ callsToday: 0, limit: config.aiDailyCallLimit }),
): void {
  app.get('/healthz', async () => ({
    ok: true,
    commit: config.commit,
    ai: { fastModel: config.gemini.fastModel, fallbackModel: config.gemini.fallbackModel, ...budget() },
    webhook: webhook(),
  }));
}
