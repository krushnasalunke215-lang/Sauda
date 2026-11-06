import { describe, expect, it } from 'vitest';
import { pcmRate, pcmToWav } from './tts.js';

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
