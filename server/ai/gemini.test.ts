import { describe, expect, it } from 'vitest';
import { AiUnavailableError, generateJson, type CallModel, type ModelRequest } from './gemini.js';

const settings = { fastModel: 'fast', fallbackModel: 'slow', fastTimeoutMs: 100, fallbackTimeoutMs: 1000 };
const schemaOk = (d: unknown) => typeof d === 'object' && d !== null && (d as { ok?: unknown }).ok === true;
const req = { label: 'test', parts: [{ text: 'hi' }], system: 'sys', schema: {}, validate: schemaOk };

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new Error('aborted'));
    });
  });

/** A fake model: per model id, how long it takes and what it returns. */
function fake(spec: Record<string, { delay: number; text?: string; error?: string; ignoreAbort?: boolean }>) {
  const calls: ModelRequest[] = [];
  const call: CallModel = async (r) => {
    calls.push(r);
    const s = spec[r.model];
    await sleep(s.delay, s.ignoreAbort ? undefined : r.signal);
    if (s.error) throw new Error(s.error);
    return s.text ?? '{"ok":true}';
  };
  return { call, calls };
}

describe('generateJson', () => {
  it('returns the fast model answer with thinking LOW', async () => {
    const f = fake({ fast: { delay: 5 }, slow: { delay: 5 } });
    const r = await generateJson(req, { callModel: f.call, settings });
    expect(r).toMatchObject({ data: { ok: true }, model: 'fast', fallback: false });
    expect(r.attempts.map((a) => a.outcome)).toEqual(['ok']);
    expect(f.calls).toHaveLength(1);
    // The fast call may run until the fallback's deadline.
    expect(f.calls[0]).toMatchObject({ thinkingLow: true, timeoutMs: 1100 });
  });

  it('asks the fallback model when the fast model has not answered in time, and stops the fast call when the fallback wins', async () => {
    const f = fake({ fast: { delay: 10_000, ignoreAbort: true }, slow: { delay: 30 } });
    const t0 = performance.now();
    const r = await generateJson(req, { callModel: f.call, settings });
    const elapsed = performance.now() - t0;
    expect(r).toMatchObject({ model: 'slow', fallback: true });
    expect(r.attempts.map((a) => [a.model, a.outcome])).toEqual([
      ['fast', 'cancelled'],
      ['slow', 'ok'],
    ]);
    expect(f.calls[0].signal.aborted).toBe(true);
    expect(f.calls[1]).toMatchObject({ thinkingLow: false, timeoutMs: 1000 });
    expect(elapsed).toBeLessThan(100 + 30 + 150);
  });

  it('uses a late fast answer when the fallback model fails (429 while Flash is slow)', async () => {
    const f = fake({ fast: { delay: 300 }, slow: { delay: 5, error: '429 RESOURCE_EXHAUSTED' } });
    const r = await generateJson(req, { callModel: f.call, settings });
    expect(r).toMatchObject({ data: { ok: true }, model: 'fast', fallback: false });
    expect(r.attempts.map((a) => [a.model, a.outcome])).toEqual([
      ['fast', 'ok'],
      ['slow', 'error'],
    ]);
    expect(f.calls).toHaveLength(2);
  });

  it('uses a late fast answer that arrives before the fallback answer, and stops the fallback call', async () => {
    const f = fake({ fast: { delay: 150 }, slow: { delay: 500 } });
    const r = await generateJson(req, { callModel: f.call, settings });
    expect(r).toMatchObject({ model: 'fast', fallback: false });
    expect(r.attempts.map((a) => a.outcome)).toEqual(['ok', 'cancelled']);
    expect(f.calls[1].signal.aborted).toBe(true);
  });

  it('times out when neither model answers by the fallback deadline', async () => {
    const f = fake({ fast: { delay: 10_000 }, slow: { delay: 10_000 } });
    const t0 = performance.now();
    const err = await generateJson(req, { callModel: f.call, settings }).catch((e) => e);
    expect(err).toBeInstanceOf(AiUnavailableError);
    expect((err as AiUnavailableError).attempts.map((a) => a.outcome)).toEqual(['timeout', 'timeout']);
    expect(performance.now() - t0).toBeLessThan(100 + 1000 + 150);
  });

  it('falls back on unparseable JSON and on a schema failure', async () => {
    const bad = fake({ fast: { delay: 1, text: 'not json' }, slow: { delay: 1 } });
    expect((await generateJson(req, { callModel: bad.call, settings })).attempts.map((a) => a.outcome)).toEqual(['invalid', 'ok']);
    const wrong = fake({ fast: { delay: 1, text: '{"ok":false}' }, slow: { delay: 1 } });
    expect((await generateJson(req, { callModel: wrong.call, settings })).model).toBe('slow');
  });

  it('falls back on an API error', async () => {
    const f = fake({ fast: { delay: 1, error: '429 RESOURCE_EXHAUSTED' }, slow: { delay: 1 } });
    const r = await generateJson(req, { callModel: f.call, settings });
    expect(r.attempts.map((a) => a.outcome)).toEqual(['error', 'ok']);
  });

  it('throws AiUnavailableError when both models fail', async () => {
    const f = fake({ fast: { delay: 1, error: 'boom' }, slow: { delay: 1, text: '{' } });
    const err = await generateJson(req, { callModel: f.call, settings }).catch((e) => e);
    expect(err).toBeInstanceOf(AiUnavailableError);
    expect((err as AiUnavailableError).attempts.map((a) => a.outcome)).toEqual(['error', 'invalid']);
  });
});
