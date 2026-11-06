import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

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
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: BASE_URL
    ? undefined
    : {
        command: 'npm run build && npm start',
        cwd: ROOT,
        url: `http://localhost:${LOCAL_PORT}/healthz`,
        timeout: 120_000,
        reuseExistingServer: false,
        env: { PORT: String(LOCAL_PORT), DATA_DIR: '.tmp/e2e-data' },
      },
});
