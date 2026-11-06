/** Helpers for route tests (not a test file itself). */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { CreateDealResult } from '../../shared/types.js';
import type { Interpreter, TurnResult } from '../ai/interpret.js';
import type { Speak } from '../ai/tts.js';
import type { Vision } from '../ai/vision.js';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDb } from '../db.js';
import type { DealService } from '../deals/service.js';
import { DealStore } from '../deals/store.js';
import { emptyPatch } from '../domain/agreement.js';

export function turnResult(over: Partial<TurnResult> = {}): TurnResult {
  return {
    transcript: 'नमस्ते',
    detectedLanguage: 'hi',
    translation: { text: 'Hello', lang: 'en' },
    patch: emptyPatch(),
    questions: [],
    intent: { kind: 'none', carrier: null, trackingNumber: null },
    ai: { model: 'fake-fast', ms: 5, fallback: false },
    attempts: [],
    ...over,
  };
}

const AI = { ai: { model: 'fake-fast', ms: 7, fallback: false }, attempts: [] };

export const fakeVision: Vision = {
  describeReference: async () => ({
    ...AI,
    description: { maker: 'हल्के हरे रंग का कढ़ाई वाला कुर्ता', buyer: 'A light green embroidered kurta' },
    details: [{ aspect: 'neckline', value: { maker: 'गला: गोल', buyer: 'Neckline: round' } }],
  }),
  checkProgress: async () => ({
    ...AI,
    checks: [
      { field: 'color', status: 'matches', note: { maker: 'रंग हल्का हरा है', buyer: 'The colour is light green' } },
      { field: 'measurements', status: 'cannot_verify', note: { maker: 'माप नहीं दिखता', buyer: 'No tape is visible' } },
    ],
    summary: { maker: 'सलाह के लिए', buyer: 'Advisory only' },
  }),
};

export interface TestApp {
  app: FastifyInstance;
  service: DealService;
  store: DealStore;
  dataDir: string;
  deal: CreateDealResult;
  close: () => Promise<void>;
}

export async function testApp(opts: { interpret?: Interpreter | null; vision?: Vision | null; speak?: Speak | null; samplesDir?: string } = {}): Promise<TestApp> {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'sauda-test-'));
  const config = loadConfig({ env: { DATA_DIR: dataDir }, envFile: null });
  const store = new DealStore(openDb(':memory:'));
  const { app, service } = await buildApp({
    config,
    store,
    interpret: opts.interpret === undefined ? async () => turnResult() : opts.interpret,
    vision: opts.vision === undefined ? fakeVision : opts.vision,
    speak: opts.speak ?? null,
    samplesDir: opts.samplesDir,
    staticDir: null,
    logger: false,
  });
  const res = await app.inject({
    method: 'POST',
    url: '/api/deals',
    payload: { makerName: 'Asha Chikan Studio', makerLang: 'hi', buyerName: 'Emily Carter', buyerLang: 'en' },
  });
  return {
    app,
    service,
    store,
    dataDir,
    deal: res.json() as CreateDealResult,
    close: async () => {
      await service.whenIdle();
      await app.close();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

export const authed = (token: string, extra: Record<string, string> = {}) => ({ 'x-sauda-token': token, ...extra });
