import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { createGenAI, sdkCallModel } from './ai/gemini.js';
import { createInterpreter } from './ai/interpret.js';
import { createSpeak } from './ai/tts.js';
import { createVision } from './ai/vision.js';
import { buildApp } from './app.js';
import { describeConfig, geminiConfigured, loadConfig, ROOT_DIR } from './config.js';
import { openDb } from './db.js';
import { DealStore } from './deals/store.js';
import { attachRealtime } from './realtime.js';

const config = loadConfig();
mkdirSync(config.dataDir, { recursive: true });
const db = openDb(path.join(config.dataDir, 'sauda.db'));
const store = new DealStore(db);
const genai = geminiConfigured(config) ? createGenAI(config.gemini) : null;
const generate = genai ? { callModel: sdkCallModel(genai), settings: config.gemini } : null;
const interpret = generate ? createInterpreter(generate) : null;
const vision = generate ? createVision(generate) : null;
const speak = genai ? createSpeak(genai) : null;

const { app, service } = await buildApp({ config, store, interpret, vision, speak, staticDir: path.join(ROOT_DIR, 'dist', 'client') });
const io = attachRealtime(app, store, config.publicBaseUrl);

app.log.info({ config: describeConfig(config) }, 'sauda config');
if (!interpret) app.log.warn('GEMINI_API_KEY is not set: turns and photos will return 503');

await app.listen({ host: '0.0.0.0', port: config.port });

let closing = false;
async function shutdown(signal: string): Promise<void> {
  if (closing) return;
  closing = true;
  app.log.info({ signal }, 'shutting down');
  try {
    io.disconnectSockets(true);
    await app.close();
    await Promise.race([service.whenIdle(), new Promise((r) => setTimeout(r, 5000))]);
    db.close();
  } finally {
    process.exit(0);
  }
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
