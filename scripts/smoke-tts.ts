/**
 * Live probe of Gemini speech playback: asks the TTS model (Vertex express) to read a Hindi sentence
 * in the buyer's voice and an English one in the maker's voice (as the listeners hear them), and
 * reports the returned MIME type, byte count and latency. Never prints keys.
 *   npm run smoke:tts
 */
import { createGenAI } from '../server/ai/gemini.js';
import { TTS_MODEL, TTS_VOICES, synthesize } from '../server/ai/tts.js';
import { describeConfig, loadConfig } from '../server/config.js';

const config = loadConfig();
console.log(`Gemini: backend ${config.gemini.backend}, key ${String(describeConfig(config).GEMINI_API_KEY)}, model ${TTS_MODEL}`);
if (!config.gemini.apiKey) {
  console.error('GEMINI_API_KEY is not set in .env');
  process.exitCode = 2;
} else {
  const ai = createGenAI(config.gemini);
  const cases = [
    { voice: TTS_VOICES.buyer, lang: 'hi', text: 'नमस्ते रवि जी, क्या आप मेरे लिए हल्के हरे रंग का कुर्ता बना सकते हैं?' },
    { voice: TTS_VOICES.maker, lang: 'en', text: 'Yes, shipping to the US is included in the 120 dollars.' },
  ] as const;
  let failed = false;
  for (const c of cases) {
    const t0 = performance.now();
    try {
      const r = await synthesize(ai, c.text, c.lang, c.voice);
      console.log(`${c.voice} (${c.lang}): ${Math.round(performance.now() - t0)} ms, mimeType ${r.sourceMimeType}, ${r.pcmBytes} PCM bytes, ${r.sampleRate} Hz -> WAV ${r.wav.length} bytes (${(r.pcmBytes / 2 / r.sampleRate).toFixed(1)} s)`);
    } catch (e) {
      failed = true;
      console.error(`${c.voice} (${c.lang}) failed after ${Math.round(performance.now() - t0)} ms: ${e instanceof Error ? e.message.slice(0, 300) : e}`);
    }
  }
  console.log(failed ? '\nSMOKE FAILED' : '\nSMOKE OK');
  process.exitCode = failed ? 1 : 0;
}
