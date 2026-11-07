import { describe, expect, it } from 'vitest';
import { openDb } from '../db.js';
import { AiBudget, AiBudgetError } from './budget.js';
import { generateJson, type CallModel } from './gemini.js';

const settings = { fastModel: 'fast', fallbackModel: 'slow', fastTimeoutMs: 100, fallbackTimeoutMs: 100 };
const req = { label: 'test', parts: [{ text: 'hi' }], system: 'sys', schema: {}, validate: (d: unknown) => (d as { ok?: boolean }).ok === true };

describe('AiBudget', () => {
  it('counts calls per UTC day and blocks at the limit', () => {
    let now = new Date('2026-11-10T23:59:00Z');
    const budget = new AiBudget(openDb(':memory:'), 3, () => now);
    expect(budget.status()).toEqual({ callsToday: 0, limit: 3 });
    budget.reserve();
    budget.reserve();
    budget.reserve();
    expect(budget.status()).toEqual({ callsToday: 3, limit: 3 });
    expect(() => budget.reserve()).toThrow(AiBudgetError);
    // A refused call is not counted.
    expect(budget.status().callsToday).toBe(3);
    now = new Date('2026-11-11T00:00:01Z');
    expect(budget.status()).toEqual({ callsToday: 0, limit: 3 });
    budget.reserve();
    expect(budget.status().callsToday).toBe(1);
  });

  it('is reserved before every model attempt, the fallback included, and stops the call when used up', async () => {
    const budget = new AiBudget(openDb(':memory:'), 2);
    const models: string[] = [];
    const callModel: CallModel = async (r) => {
      models.push(r.model);
      return r.model === 'fast' ? 'not json' : '{"ok":true}';
    };
    const r = await generateJson(req, { callModel, settings, budget });
    expect(r.model).toBe('slow');
    expect(budget.status().callsToday).toBe(2);
    await expect(generateJson(req, { callModel, settings, budget })).rejects.toBeInstanceOf(AiBudgetError);
    expect(models).toEqual(['fast', 'slow']);
  });
});
