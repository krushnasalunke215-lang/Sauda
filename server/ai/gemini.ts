import { GoogleGenAI, ThinkingLevel, type Part } from '@google/genai';
import type { GeminiConfig } from '../config.js';
import type { Reserve } from './budget.js';

export type { Part };

export interface ModelRequest {
  model: string;
  parts: Part[];
  system: string;
  schema: object;
  /** Thinking level LOW (fast model only); otherwise the model's default. */
  thinkingLow: boolean;
  timeoutMs: number;
  signal: AbortSignal;
}

/** One model call that returns the raw response text. Injected so tests can use fakes. */
export type CallModel = (req: ModelRequest) => Promise<string>;

/** 'cancelled': stopped because the other model answered first. */
export type AttemptOutcome = 'ok' | 'timeout' | 'invalid' | 'error' | 'cancelled';

export interface Attempt {
  model: string;
  ms: number;
  outcome: AttemptOutcome;
  /** Short reason for a failed attempt (never contains request data). */
  detail?: string;
}

export interface GenerateResult<T> {
  data: T;
  model: string;
  /** Wall-clock time of the whole call, including a failed fast attempt. */
  ms: number;
  fallback: boolean;
  attempts: Attempt[];
}

export class AiUnavailableError extends Error {
  constructor(
    readonly label: string,
    readonly attempts: Attempt[],
  ) {
    super(`${label}: no model returned a valid answer (${attempts.map((a) => `${a.model} ${a.outcome}`).join(', ')})`);
    this.name = 'AiUnavailableError';
  }
}

/** A validator in Ajv's shape: returns true for valid data and sets `errors` otherwise. */
export type Validate = ((data: unknown) => boolean) & { errors?: unknown };

export type ModelSettings = Pick<GeminiConfig, 'fastModel' | 'fallbackModel' | 'fastTimeoutMs' | 'fallbackTimeoutMs'>;

export interface GenerateDeps {
  callModel: CallModel;
  settings: ModelSettings;
  /** The daily AI budget: each model attempt reserves a call first (throws AiBudgetError when used up). */
  budget?: Reserve | null;
}

export function createGenAI(config: GeminiConfig): GoogleGenAI {
  if (!config.apiKey) throw new Error('GEMINI_API_KEY is not set');
  // Vertex AI express mode: an API key and the global endpoint, no project or location (findings §7).
  return config.backend === 'vertex' ? new GoogleGenAI({ vertexai: true, apiKey: config.apiKey }) : new GoogleGenAI({ apiKey: config.apiKey });
}

/** The real model call: structured JSON output constrained by the schema. */
export function sdkCallModel(ai: GoogleGenAI): CallModel {
  return async (req) => {
    const resp = await ai.models.generateContent({
      model: req.model,
      contents: [{ role: 'user', parts: req.parts }],
      config: {
        systemInstruction: req.system,
        responseMimeType: 'application/json',
        responseJsonSchema: req.schema,
        // 3.8 Flash rejects MINIMAL on Vertex; LOW is the fastest accepted level.
        ...(req.thinkingLow ? { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } } : {}),
        abortSignal: req.signal,
        httpOptions: { timeout: req.timeoutMs },
      },
    });
    return resp.text ?? '';
  };
}

class TimeoutError extends Error {}
class CancelledError extends Error {}

type Settled<T> = { attempt: Attempt; data?: T };

/** One model call; never rejects. `cancel` stops it early (outcome 'cancelled'). */
async function attempt<T>(
  model: string,
  thinkingLow: boolean,
  timeoutMs: number,
  req: { parts: Part[]; system: string; schema: object; validate: Validate },
  callModel: CallModel,
  cancel: AbortSignal,
): Promise<Settled<T>> {
  const t0 = performance.now();
  const ctrl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onCancel = () => {};
  // Our own timer wins even if the SDK ignores the abort signal.
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      ctrl.abort();
      reject(new TimeoutError());
    }, timeoutMs);
  });
  const cancelled = new Promise<never>((_, reject) => {
    onCancel = () => {
      ctrl.abort();
      reject(new CancelledError());
    };
    cancel.addEventListener('abort', onCancel, { once: true });
  });
  const ms = () => Math.round(performance.now() - t0);
  try {
    const text = await Promise.race([
      callModel({ model, parts: req.parts, system: req.system, schema: req.schema, thinkingLow, timeoutMs, signal: ctrl.signal }),
      timeout,
      cancelled,
    ]);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { attempt: { model, ms: ms(), outcome: 'invalid', detail: 'unparseable JSON' } };
    }
    if (!req.validate(parsed)) return { attempt: { model, ms: ms(), outcome: 'invalid', detail: 'schema validation failed' } };
    return { attempt: { model, ms: ms(), outcome: 'ok' }, data: parsed as T };
  } catch (e) {
    if (e instanceof CancelledError) return { attempt: { model, ms: ms(), outcome: 'cancelled' } };
    if (e instanceof TimeoutError || ctrl.signal.aborted) return { attempt: { model, ms: ms(), outcome: 'timeout' } };
    const detail = e instanceof Error ? e.message.slice(0, 200) : 'error';
    return { attempt: { model, ms: ms(), outcome: 'error', detail } };
  } finally {
    clearTimeout(timer);
    cancel.removeEventListener('abort', onCancel);
  }
}

/**
 * Asks the fast model (thinking LOW) first. When it fails (an error, unparseable JSON or a schema
 * failure) or has not answered within fastTimeoutMs, the fallback model (default thinking,
 * fallbackTimeoutMs) is asked too. A fast call that is only slow keeps running until the fallback's
 * deadline, and the first valid answer wins: when Vertex is busy, Flash can take 10-25 s while the
 * fallback returns 429 RESOURCE_EXHAUSTED, and the late Flash answer is then still used. Each attempt
 * reserves one call from the daily budget first.
 */
export async function generateJson<T>(
  req: { label: string; parts: Part[]; system: string; schema: object; validate: Validate },
  deps: GenerateDeps,
): Promise<GenerateResult<T>> {
  const { settings, callModel } = deps;
  const t0 = performance.now();
  const done = (data: T, model: string, fallback: boolean, attempts: Attempt[]): GenerateResult<T> => ({ data, model, ms: Math.round(performance.now() - t0), fallback, attempts });

  deps.budget?.reserve();
  const stopFast = new AbortController();
  const fast = attempt<T>(settings.fastModel, true, settings.fastTimeoutMs + settings.fallbackTimeoutMs, req, callModel, stopFast.signal);
  let switchTimer: ReturnType<typeof setTimeout> | undefined;
  const early = await Promise.race([fast, new Promise<null>((resolve) => (switchTimer = setTimeout(() => resolve(null), settings.fastTimeoutMs)))]);
  clearTimeout(switchTimer);
  if (early?.data !== undefined) return done(early.data, settings.fastModel, false, [early.attempt]);

  try {
    deps.budget?.reserve();
  } catch (e) {
    stopFast.abort();
    throw e;
  }
  const stopSlow = new AbortController();
  const slow = attempt<T>(settings.fallbackModel, false, settings.fallbackTimeoutMs, req, callModel, stopSlow.signal);
  // Waits for the first valid answer, or for every running attempt to fail.
  await new Promise<void>((resolve) => {
    const running = early ? [slow] : [fast, slow];
    let open = running.length;
    for (const p of running) void p.then((r) => (r.data !== undefined || --open === 0 ? resolve() : undefined));
  });
  stopFast.abort();
  stopSlow.abort();
  const [f, s] = await Promise.all([early ?? fast, slow]);
  const attempts = [f.attempt, s.attempt];
  if (f.data !== undefined) return done(f.data, settings.fastModel, false, attempts);
  if (s.data !== undefined) return done(s.data, settings.fallbackModel, true, attempts);
  throw new AiUnavailableError(req.label, attempts);
}
