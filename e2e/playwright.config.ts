import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';
import { FAKE_MIC_WAV } from './global-setup.js';

const BASE_URL = process.env.BASE_URL;
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const LOCAL_PORT = 8790;

/**
 * E2E runs make real Gemini (and later PayPal sandbox) calls, so they need .env. Without BASE_URL,
 * Playwright builds the client and starts the server on port 8790 with its own data dir.
 */
export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  timeout: 300_000,
  // Each AI turn takes 5-30 s.
  expect: { timeout: 60_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  outputDir: '../test-results',
  use: {
    baseURL: BASE_URL ?? `http://localhost:${LOCAL_PORT}`,
    trace: 'retain-on-failure',
  },
  globalSetup: './global-setup.ts',
  projects: [
    { name: 'chromium', testIgnore: /voice\.spec\.ts/, use: { ...devices['Desktop Chrome'] } },
    {
      // Chromium with a fake microphone that plays the user's Hindi clip.
      name: 'voice',
      testMatch: /voice\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        permissions: ['microphone'],
        launchOptions: {
          args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${FAKE_MIC_WAV}`],
        },
      },
    },
  ],
  webServer: BASE_URL
    ? undefined
    : {
        command: 'npm run build && npm start',
        cwd: ROOT,
        url: `http://localhost:${LOCAL_PORT}/healthz`,
        // Build + boot. With the Bryntum board the build bundles ~2 MB more; on a busy machine the
        // build took 67 s and the boot 44 s (FEAT-005), past the old 120 s.
        timeout: 240_000,
        reuseExistingServer: false,
        env: { PORT: String(LOCAL_PORT), DATA_DIR: '.tmp/e2e-data' },
      },
});
