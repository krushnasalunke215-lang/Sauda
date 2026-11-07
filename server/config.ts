import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

/** The repo root (the folder that holds package.json and .env). */
export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_ENV_FILE = path.join(ROOT_DIR, '.env');

export type GeminiBackend = 'vertex' | 'aistudio';

export interface GeminiConfig {
  backend: GeminiBackend;
  apiKey: string | null;
  fastModel: string;
  fallbackModel: string;
  fastTimeoutMs: number;
  fallbackTimeoutMs: number;
}

export interface PayPalConfig {
  clientId: string | null;
  clientSecret: string | null;
  merchantEmail: string | null;
  buyerEmail: string | null;
  /** How often open invoices are re-read (PAYPAL_POLL_INTERVAL_MS, default 10 s). */
  pollIntervalMs: number;
  /** Use this webhook instead of finding or creating one at boot (PAYPAL_WEBHOOK_ID, optional). */
  webhookId: string | null;
}

export interface Config {
  port: number;
  dataDir: string;
  publicBaseUrl: string | null;
  commit: string;
  paypal: Readonly<PayPalConfig>;
  gemini: Readonly<GeminiConfig>;
}

type Env = Record<string, string | undefined>;

/** Names of the variables that came from the .env file (never their values). */
const fromFile = new Set<string>();

/**
 * Loads the .env file into `env`. Non-empty values in the file win over variables already set in
 * the shell, because the user's shell holds a different GEMINI_API_KEY. Returns the names loaded.
 */
export function loadEnvFile(file: string = DEFAULT_ENV_FILE, env: Env = process.env): string[] {
  if (!existsSync(file)) return [];
  const names: string[] = [];
  for (const [k, v] of Object.entries(parseEnv(readFileSync(file, 'utf8')))) {
    if (v?.trim()) {
      env[k] = v;
      names.push(k);
      if (env === process.env) fromFile.add(k);
    }
  }
  return names;
}

function str(env: Env, name: string): string | null {
  const v = env[name]?.trim();
  return v ? v : null;
}

function int(env: Env, name: string, fallback: number): number {
  const v = str(env, name);
  if (v === null) return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} must be a positive integer`);
  return n;
}

export interface LoadOptions {
  env?: Env;
  /** Path of the .env file, or null to skip it (tests). */
  envFile?: string | null;
}

export function loadConfig(opts: LoadOptions = {}): Config {
  const env = opts.env ?? process.env;
  const envFile = opts.envFile === undefined ? DEFAULT_ENV_FILE : opts.envFile;
  if (envFile) loadEnvFile(envFile, env);

  const backend = (str(env, 'GEMINI_BACKEND') ?? 'vertex').toLowerCase();
  if (backend !== 'vertex' && backend !== 'aistudio') throw new Error('GEMINI_BACKEND must be vertex or aistudio');

  const port = int(env, 'PORT', 8787);
  const publicBaseUrl = (str(env, 'PUBLIC_BASE_URL') ?? str(env, 'RENDER_EXTERNAL_URL'))?.replace(/\/+$/, '') ?? null;

  return Object.freeze({
    port,
    dataDir: path.resolve(ROOT_DIR, str(env, 'DATA_DIR') ?? 'data'),
    publicBaseUrl,
    commit: str(env, 'RENDER_GIT_COMMIT') ?? 'local',
    paypal: Object.freeze({
      clientId: str(env, 'PAYPAL_CLIENT_ID'),
      clientSecret: str(env, 'PAYPAL_CLIENT_SECRET'),
      merchantEmail: str(env, 'PAYPAL_MERCHANT_EMAIL'),
      buyerEmail: str(env, 'PAYPAL_BUYER_EMAIL'),
      pollIntervalMs: int(env, 'PAYPAL_POLL_INTERVAL_MS', 10_000),
      webhookId: str(env, 'PAYPAL_WEBHOOK_ID'),
    }),
    gemini: Object.freeze({
      backend,
      apiKey: str(env, 'GEMINI_API_KEY'),
      fastModel: str(env, 'GEMINI_FAST_MODEL') ?? 'gemini-3.8-flash',
      fallbackModel: str(env, 'GEMINI_FALLBACK_MODEL') ?? 'gemini-4-argon',
      fastTimeoutMs: int(env, 'GEMINI_FAST_TIMEOUT_MS', 8000),
      fallbackTimeoutMs: int(env, 'GEMINI_FALLBACK_TIMEOUT_MS', 30000),
    }),
  });
}

/** For logs: which settings are present and where secrets came from. Never prints a secret value. */
export function describeConfig(c: Config): Record<string, unknown> {
  const secret = (name: string, v: string | null) => (v ? (fromFile.has(name) ? 'set (.env)' : 'set (environment)') : 'unset');
  return {
    port: c.port,
    dataDir: c.dataDir,
    publicBaseUrl: c.publicBaseUrl,
    commit: c.commit,
    PAYPAL_CLIENT_ID: secret('PAYPAL_CLIENT_ID', c.paypal.clientId),
    PAYPAL_CLIENT_SECRET: secret('PAYPAL_CLIENT_SECRET', c.paypal.clientSecret),
    PAYPAL_MERCHANT_EMAIL: secret('PAYPAL_MERCHANT_EMAIL', c.paypal.merchantEmail),
    PAYPAL_BUYER_EMAIL: secret('PAYPAL_BUYER_EMAIL', c.paypal.buyerEmail),
    paypal: { pollIntervalMs: c.paypal.pollIntervalMs, webhookId: c.paypal.webhookId ? 'set' : 'unset' },
    GEMINI_API_KEY: secret('GEMINI_API_KEY', c.gemini.apiKey),
    gemini: {
      backend: c.gemini.backend,
      fastModel: c.gemini.fastModel,
      fallbackModel: c.gemini.fallbackModel,
      fastTimeoutMs: c.gemini.fastTimeoutMs,
      fallbackTimeoutMs: c.gemini.fallbackTimeoutMs,
    },
  };
}

export const paypalConfigured = (c: Config): boolean =>
  Boolean(c.paypal.clientId && c.paypal.clientSecret && c.paypal.merchantEmail && c.paypal.buyerEmail);
export const geminiConfigured = (c: Config): boolean => Boolean(c.gemini.apiKey);
