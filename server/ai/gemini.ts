import { GoogleGenAI, ThinkingLevel, type Part } from '@google/genai';
import type { GeminiConfig } from '../config.js';

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

export type AttemptOutcome = 'ok' | 'timeout' | 'invalid' | 'error';

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

async function attempt<T>(
  model: string,
  thinkingLow: boolean,
  timeoutMs: number,
  req: { parts: Part[]; system: string; schema: object; validate: Validate },
  callModel: CallModel,
): Promise<{ attempt: Attempt; data?: T }> {
  const t0 = performance.now();
  const ctrl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Our own timer wins even if the SDK ignores the abort signal.
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      ctrl.abort();
      reject(new TimeoutError());
    }, timeoutMs);
  });
  const ms = () => Math.round(performance.now() - t0);
  try {
    const text = await Promise.race([callModel({ model, parts: req.parts, system: req.system, schema: req.schema, thinkingLow, timeoutMs, signal: ctrl.signal }), timeout]);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { attempt: { model, ms: ms(), outcome: 'invalid', detail: 'unparseable JSON' } };
    }
    if (!req.validate(parsed)) return { attempt: { model, ms: ms(), outcome: 'invalid', detail: 'schema validation failed' } };
    return { attempt: { model, ms: ms(), outcome: 'ok' }, data: parsed as T };
  } catch (e) {
    if (e instanceof TimeoutError || ctrl.signal.aborted) return { attempt: { model, ms: ms(), outcome: 'timeout' } };
    const detail = e instanceof Error ? e.message.slice(0, 200) : 'error';
    return { attempt: { model, ms: ms(), outcome: 'error', detail } };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Asks the fast model (thinking LOW, short timeout) first; on a timeout, an error, unparseable JSON or
 * a schema failure it asks the fallback model (default thinking, longer timeout).
 */
export async function generateJson<T>(
  req: { label: string; parts: Part[]; system: string; schema: object; validate: Validate },
  deps: GenerateDeps,
): Promise<GenerateResult<T>> {
  const { settings, callModel } = deps;
  const t0 = performance.now();
  const attempts: Attempt[] = [];
  const fast = await attempt<T>(settings.fastModel, true, settings.fastTimeoutMs, req, callModel);
  attempts.push(fast.attempt);
  if (fast.data !== undefined) return { data: fast.data, model: settings.fastModel, ms: Math.round(performance.now() - t0), fallback: false, attempts };
  const slow = await attempt<T>(settings.fallbackModel, false, settings.fallbackTimeoutMs, req, callModel);
  attempts.push(slow.attempt);
  if (slow.data !== undefined) return { data: slow.data, model: settings.fallbackModel, ms: Math.round(performance.now() - t0), fallback: true, attempts };
  throw new AiUnavailableError(req.label, attempts);
}
