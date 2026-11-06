import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { describeConfig, loadConfig } from './config.js';

describe('loadConfig', () => {
  it('lets non-empty .env values override the shell, and ignores empty ones', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'sauda-config-'));
    const file = path.join(dir, '.env');
    writeFileSync(file, 'GEMINI_API_KEY=from-file\nGEMINI_FAST_MODEL=\n');
    const env: Record<string, string> = { GEMINI_API_KEY: 'from-shell', GEMINI_FAST_MODEL: 'shell-model' };
    const c = loadConfig({ env, envFile: file });
    expect(c.gemini.apiKey).toBe('from-file');
    expect(c.gemini.fastModel).toBe('shell-model');
  });

  it('uses the defaults and reports missing secrets without crashing', () => {
    const c = loadConfig({ env: {}, envFile: null });
    expect(c.port).toBe(8787);
    expect(path.isAbsolute(c.dataDir)).toBe(true);
    expect(c.publicBaseUrl).toBeNull();
    expect(c.paypal.clientId).toBeNull();
    expect(c.gemini).toMatchObject({ backend: 'vertex', fastModel: 'gemini-3.8-flash', fallbackModel: 'gemini-4-argon', fastTimeoutMs: 8000 });
    expect(Object.isFrozen(c)).toBe(true);
  });

  it('never puts secret values in describeConfig', () => {
    const c = loadConfig({ env: { PAYPAL_CLIENT_SECRET: 'super-secret-value', RENDER_EXTERNAL_URL: 'https://x.onrender.com/' }, envFile: null });
    expect(c.publicBaseUrl).toBe('https://x.onrender.com');
    expect(JSON.stringify(describeConfig(c))).not.toContain('super-secret-value');
  });
});
