/**
 * Live probe of the server TTS fallback: asks the TTS model (Vertex express) to speak one short Hindi
 * sentence and reports the returned MIME type and byte count. Never prints keys.
 *   npm run smoke:tts
 */
import { createGenAI } from '../server/ai/gemini.js';
import { TTS_MODEL, synthesize } from '../server/ai/tts.js';
import { describeConfig, loadConfig } from '../server/config.js';

const config = loadConfig();
console.log(`Gemini: backend ${config.gemini.backend}, key ${String(describeConfig(config).GEMINI_API_KEY)}, model ${TTS_MODEL}`);
if (!config.gemini.apiKey) {
  console.error('GEMINI_API_KEY is not set in .env');
  process.exitCode = 2;
} else {
  const t0 = performance.now();
  try {
    const r = await synthesize(createGenAI(config.gemini), 'नमस्ते जी, आपका कुर्ता दस दिसंबर तक तैयार हो जाएगा।', 'hi');
    console.log(`model ${r.model}, ${Math.round(performance.now() - t0)} ms`);
    console.log(`returned mimeType: ${r.sourceMimeType}, ${r.pcmBytes} PCM bytes, ${r.sampleRate} Hz -> WAV ${r.wav.length} bytes (${(r.pcmBytes / 2 / r.sampleRate).toFixed(1)} s)`);
    console.log('\nSMOKE OK');
    process.exitCode = 0;
  } catch (e) {
    console.error(`TTS failed after ${Math.round(performance.now() - t0)} ms: ${e instanceof Error ? e.message.slice(0, 300) : e}`);
    console.log('\nSMOKE FAILED');
    process.exitCode = 1;
  }
}
