import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** The fake microphone input for the voice project: the user's Hindi clip as 48 kHz mono WAV (git-ignored). */
export const FAKE_MIC_WAV = path.join(ROOT, '.tmp', 'fixtures', 'hindi-order.wav');

export default function globalSetup(): void {
  if (existsSync(FAKE_MIC_WAV)) return;
  mkdirSync(path.dirname(FAKE_MIC_WAV), { recursive: true });
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(ROOT, 'samples', 'hindi-order.m4a'), '-ac', '1', '-ar', '48000', FAKE_MIC_WAV], {
    stdio: 'inherit',
  });
}
