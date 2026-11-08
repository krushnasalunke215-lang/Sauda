import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { BudgetStatus } from '../ai/budget.js';
import type { Config } from '../config.js';

export type BoardKind = 'bryntum' | 'fallback';

/** Which production board the client was built with (dist/client/build-info.json from vite.config.ts), or null without a build. */
export function readBoardKind(staticDir: string | null | undefined): BoardKind | null {
  if (!staticDir) return null;
  const file = path.join(staticDir, 'build-info.json');
  if (!existsSync(file)) return null;
  try {
    const board = (JSON.parse(readFileSync(file, 'utf8')) as { board?: unknown }).board;
    return board === 'bryntum' || board === 'fallback' ? board : null;
  } catch {
    return null;
  }
}

export function healthRoutes(
  app: FastifyInstance,
  config: Config,
  webhook: () => { configured: boolean; lastVerifiedAt: string | null } = () => ({ configured: false, lastVerifiedAt: null }),
  budget: () => BudgetStatus = () => ({ callsToday: 0, limit: config.aiDailyCallLimit }),
  board: BoardKind | null = null,
): void {
  app.get('/healthz', async () => ({
    ok: true,
    commit: config.commit,
    board,
    ai: { fastModel: config.gemini.fastModel, fallbackModel: config.gemini.fallbackModel, ...budget() },
    webhook: webhook(),
  }));
}
