import type { GoogleGenAI } from '@google/genai';
import type { Lang, Role } from '../../shared/types.js';
import type { Reserve } from './budget.js';

/** Gemini text-to-speech model that reads translations aloud; the browser's voice is the client's fallback. */
export const TTS_MODEL = 'gemini-3.8-flash-tts';
export const TTS_TIMEOUT_MS = 20_000;
/** Longer texts are cut so one message cannot run up a long synthesis. */
export const MAX_TTS_CHARS = 600;

/** Each message is read in a voice that matches its speaker (the user's choice): female for the buyer, male for the maker. */
export const TTS_VOICES: Readonly<Record<Role, string>> = { buyer: 'Aoede', maker: 'Umbriel' };

/** The 3.8 TTS models read the text verbatim, so the delivery style goes in speechMetadata, not in the text. */
const STYLES: Record<Lang, string> = {
  hi: 'natural, warm and conversational, like a person speaking everyday Hindi in India',
  en: 'natural, warm and conversational, at a relaxed everyday pace',
  es: 'natural, warm and conversational, like a person speaking everyday Spanish',
  fr: 'natural, warm and conversational, like a person speaking everyday French',
  pt: 'natural, warm and conversational, like a person speaking everyday Brazilian Portuguese',
  de: 'natural, warm and conversational, like a person speaking everyday German',
  ja: 'natural, warm and polite, like a person speaking everyday Japanese',
};

/** The sample rate in a MIME type such as `audio/L16;codec=pcm;rate=24000` (24 kHz when absent). */
export function pcmRate(mimeType: string): number {
  const m = /(?:^|;)\s*rate=(\d+)/i.exec(mimeType);
  const rate = m ? Number(m[1]) : 24000;
  return Number.isInteger(rate) && rate >= 8000 && rate <= 96000 ? rate : 24000;
}

/** Wraps 16-bit little-endian PCM in a RIFF/WAVE header. */
export function pcmToWav(pcm: Buffer, sampleRate: number, channels = 1): Buffer {
  const bits = 16;
  const blockAlign = (channels * bits) / 8;
  const h = Buffer.alloc(44);
  h.write('RIFF', 0, 'ascii');
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write('WAVE', 8, 'ascii');
  h.write('fmt ', 12, 'ascii');
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * blockAlign, 28);
  h.writeUInt16LE(blockAlign, 32);
  h.writeUInt16LE(bits, 34);
  h.write('data', 36, 'ascii');
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

export interface TtsResult {
  wav: Buffer;
  model: string;
  sourceMimeType: string;
  pcmBytes: number;
  sampleRate: number;
}

/** Speaks `text` in `lang` with a prebuilt Gemini voice and returns it as a WAV file. */
export async function synthesize(ai: GoogleGenAI, text: string, lang: Lang, voice: string): Promise<TtsResult> {
  const clipped = Array.from(text).slice(0, MAX_TTS_CHARS).join('');
  const resp = await ai.models.generateContent({
    model: TTS_MODEL,
    contents: [{ role: 'user', parts: [{ text: clipped, speechMetadata: { style: STYLES[lang] } }] }],
    config: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { voice } },
      abortSignal: AbortSignal.timeout(TTS_TIMEOUT_MS),
      httpOptions: { timeout: TTS_TIMEOUT_MS },
    },
  });
  const part = resp.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
  const inline = part?.inlineData;
  if (!inline?.data) throw new Error('TTS returned no audio');
  const mimeType = inline.mimeType ?? '';
  const audio = Buffer.from(inline.data, 'base64');
  if (/^audio\/(wav|x-wav|wave)/i.test(mimeType)) return { wav: audio, model: TTS_MODEL, sourceMimeType: mimeType, pcmBytes: Math.max(0, audio.length - 44), sampleRate: audio.readUInt32LE(24) };
  if (!/^audio\/l16/i.test(mimeType)) throw new Error(`TTS returned an unexpected type: ${mimeType}`);
  const rate = pcmRate(mimeType);
  return { wav: pcmToWav(audio, rate), model: TTS_MODEL, sourceMimeType: mimeType, pcmBytes: audio.length, sampleRate: rate };
}

/** Synthesizes a message's translation in the given voice. Injected so tests can fake it. */
export type Speak = (text: string, lang: Lang, voice: string) => Promise<Buffer>;

/** Each synthesis reserves one call from the daily AI budget first (AiBudgetError when used up). */
export function createSpeak(ai: GoogleGenAI, budget?: Reserve | null): Speak {
  return async (text, lang, voice) => {
    budget?.reserve();
    return (await synthesize(ai, text, lang, voice)).wav;
  };
}
