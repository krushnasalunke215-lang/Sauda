import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { AiBudget } from './ai/budget.js';
import { createGenAI, sdkCallModel } from './ai/gemini.js';
import { createInterpreter } from './ai/interpret.js';
import { createSpeak } from './ai/tts.js';
import { createVision } from './ai/vision.js';
import { buildApp } from './app.js';
import { describeConfig, geminiConfigured, loadConfig, ROOT_DIR } from './config.js';
import { openDb } from './db.js';
import { DealStore } from './deals/store.js';
import { InvoicePoller } from './paypal/poller.js';
import { attachRealtime } from './realtime.js';

const config = loadConfig();
mkdirSync(config.dataDir, { recursive: true });
const db = openDb(path.join(config.dataDir, 'sauda.db'));
const store = new DealStore(db);
const budget = new AiBudget(db, config.aiDailyCallLimit);
const genai = geminiConfigured(config) ? createGenAI(config.gemini) : null;
const generate = genai ? { callModel: sdkCallModel(genai), settings: config.gemini, budget } : null;
const interpret = generate ? createInterpreter(generate) : null;
const vision = generate ? createVision(generate) : null;
const speak = genai ? createSpeak(genai, budget) : null;

const { app, service, payments } = await buildApp({ config, store, interpret, vision, speak, budget, staticDir: path.join(ROOT_DIR, 'dist', 'client') });
const io = attachRealtime(app, store, config.publicBaseUrl, { onJoin: (dealId) => payments.sync.onJoin(dealId) });
const poller = new InvoicePoller({ store, sync: payments.sync, intervalMs: config.paypal.pollIntervalMs, log: app.log });

app.log.info({ config: describeConfig(config) }, 'sauda config');
if (!interpret) app.log.warn('GEMINI_API_KEY is not set: turns and photos will return 503');
if (!payments.client) app.log.warn('PayPal sandbox credentials are not complete: invoices will return 503');

await app.listen({ host: '0.0.0.0', port: config.port });
if (payments.client) {
  poller.start();
  // Webhooks need a public https URL (Render); locally, polling alone keeps both pages up to date.
  void payments.webhooks.ensure(config.publicBaseUrl);
}

let closing = false;
async function shutdown(signal: string): Promise<void> {
  if (closing) return;
  closing = true;
  app.log.info({ signal }, 'shutting down');
  try {
    poller.stop();
    io.disconnectSockets(true);
    await app.close();
    const idle = Promise.all([service.whenIdle(), payments.approvals.whenIdle(), payments.sync.whenIdle(), payments.recorder.whenIdle()]);
    await Promise.race([idle, new Promise((r) => setTimeout(r, 5000))]);
    db.close();
  } finally {
    process.exit(0);
  }
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
