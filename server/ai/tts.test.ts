import type { GenerateContentParameters, GoogleGenAI } from '@google/genai';
import { describe, expect, it } from 'vitest';
import { MAX_TTS_CHARS, TTS_MODEL, TTS_VOICES, pcmRate, pcmToWav, synthesize } from './tts.js';

describe('tts helpers', () => {
  it('reads the sample rate from an L16 MIME type', () => {
    expect(pcmRate('audio/L16;codec=pcm;rate=24000')).toBe(24000);
    expect(pcmRate('audio/L16; rate=16000')).toBe(16000);
    expect(pcmRate('audio/L16')).toBe(24000);
    expect(pcmRate('audio/L16;rate=1')).toBe(24000);
  });

  it('wraps PCM in a valid WAV header', () => {
    const pcm = Buffer.alloc(48000); // 1 s of 24 kHz mono 16-bit
    const wav = pcmToWav(pcm, 24000);
    expect(wav.length).toBe(44 + pcm.length);
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.readUInt32LE(4)).toBe(36 + pcm.length);
    expect(wav.toString('ascii', 8, 16)).toBe('WAVEfmt ');
    expect(wav.readUInt16LE(20)).toBe(1);
    expect(wav.readUInt16LE(22)).toBe(1);
    expect(wav.readUInt32LE(24)).toBe(24000);
    expect(wav.readUInt32LE(28)).toBe(48000);
    expect(wav.readUInt16LE(34)).toBe(16);
    expect(wav.toString('ascii', 36, 40)).toBe('data');
    expect(wav.readUInt32LE(40)).toBe(pcm.length);
  });
});

describe('synthesize', () => {
  it('sends the text verbatim with the style in speechMetadata and the chosen voice', async () => {
    const wav = pcmToWav(Buffer.alloc(4800), 24000);
    const requests: GenerateContentParameters[] = [];
    const ai = {
      models: {
        generateContent: async (req: GenerateContentParameters) => {
          requests.push(req);
          return { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/wav', data: wav.toString('base64') } }] } }] };
        },
      },
    } as unknown as GoogleGenAI;
    const r = await synthesize(ai, 'नमस्ते रवि जी', 'hi', TTS_VOICES.buyer);
    expect(r.wav.equals(wav)).toBe(true);
    expect(TTS_VOICES).toEqual({ buyer: 'Aoede', maker: 'Umbriel' });
    const req = requests[0] as { model: string; contents: { parts: { text: string; speechMetadata: { style: string } }[] }[]; config: { speechConfig: unknown; responseModalities: string[] } };
    expect(req.model).toBe(TTS_MODEL);
    expect(req.contents[0].parts[0].text).toBe('नमस्ते रवि जी');
    expect(req.contents[0].parts[0].speechMetadata.style).toMatch(/Hindi/);
    expect(req.config.responseModalities).toEqual(['AUDIO']);
    expect(req.config.speechConfig).toEqual({ voiceConfig: { voice: 'Aoede' } });

    await synthesize(ai, 'a'.repeat(MAX_TTS_CHARS + 50), 'en', TTS_VOICES.maker);
    const long = requests[1] as typeof req;
    expect(long.contents[0].parts[0].text).toHaveLength(MAX_TTS_CHARS);
    expect(long.config.speechConfig).toEqual({ voiceConfig: { voice: 'Umbriel' } });
  });
});
